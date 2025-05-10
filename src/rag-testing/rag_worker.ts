import WebLLMService from '../lib/WebLLMService.ts';
import { loadAllRAGData } from '../lib/dataLoader.ts';
import { ClusteredSearchService } from '../lib/clusteredSearchService.ts';
import { RAGManager } from '../lib/ragManager.ts';

console.log("RAG Worker: Script loaded. All services imported.");

let ragManager: RAGManager | null = null;
let webLLMService: WebLLMService | null = null;
let clusteredSearchService: ClusteredSearchService | null = null;

// Cache for Transformers.js pipeline
let activeTransformersPipeline: any = null; // Stores the active text-generation pipeline
let activeTransformersModelId: string | null = null; // Stores the ID of the currently loaded model

// MANIFEST_URL should be relative to the public directory if served statically,
// or an absolute path if constructed dynamically.
// Given it's from public/, and Astro base path is currently off for dev,
// a root-relative path from the domain should work.
const MANIFEST_URL = '/embeddings/school_districts/manifest.json';

// Helper for cosine similarity (dot product of L2 normalized vectors)
function calculateCosineSimilarity(vecA: Float32Array, vecB: Float32Array): number {
    if (vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
    }
    return dotProduct; // Assumes vectors are already L2 normalized by getQueryEmbedding
}

/**
 * Dynamically imports Transformers.js and initializes a text-generation pipeline.
 * Caches the pipeline to avoid reloading the same model.
 * Sends progress messages during model loading.
 * @param modelId The Hugging Face model ID or URL.
 * @returns The initialized text-generation pipeline.
 */
async function getTransformersChatPipeline(modelId: string) {
    if (activeTransformersPipeline && activeTransformersModelId === modelId) {
        return activeTransformersPipeline;
    }

    let effectiveModelId = modelId;
    if (modelId.startsWith('http://') || modelId.startsWith('https://')) {
        try {
            const url = new URL(modelId);
            if (url.hostname === 'huggingface.co') {
                let path = url.pathname;
                if (path.startsWith('/')) path = path.substring(1);
                if (path.endsWith('/')) path = path.substring(0, path.length - 1);

                const parts = path.split('/');
                if (parts.length >= 2) { // org/model is minimum
                    const orgOrUser = parts[0];
                    const modelName = parts[1];
                    let basePath = `${orgOrUser}/${modelName}`;
                    let subPathIndex = 2;

                    // Check for /tree/main, /blob/main, /raw/main, /resolve/main, or common revision names/hashes
                    if (parts.length > subPathIndex + 1 &&
                        (parts[subPathIndex] === 'tree' || parts[subPathIndex] === 'blob' || parts[subPathIndex] === 'raw' || parts[subPathIndex] === 'resolve') &&
                        (parts[subPathIndex + 1] === 'main' || parts[subPathIndex + 1].match(/^[0-9a-f]{7,40}$/i) || parts[subPathIndex + 1] === 'HEAD')) {
                        subPathIndex += 2; // Skip over the revision part like tree/main
                    }

                    if (parts.length > subPathIndex) {
                        const subfolder = parts.slice(subPathIndex).join('/');
                        if (subfolder) {
                            basePath += `/${subfolder}`;
                        }
                    }
                    effectiveModelId = basePath;
                    console.log(`RAG Worker: Parsed Hugging Face URL "${modelId}" to model ID: "${effectiveModelId}"`);
                } else {
                    console.warn(`RAG Worker: Hugging Face URL "${modelId}" could not be parsed into a standard model ID. Using it directly.`);
                }
            } else {
                console.log(`RAG Worker: Non-Hugging Face URL provided: "${modelId}". Using it directly with pipeline.`);
            }
        } catch (e) {
            console.warn(`RAG Worker: Could not parse "${modelId}" as a URL. Treating as a plain model ID. Error: ${e}`);
            // effectiveModelId remains modelId (original input)
        }
    }

    self.postMessage({ type: 'status', payload: { message: `Initializing Transformers.js with model: ${effectiveModelId}...`, isError: false, isReady: false } });
    const { pipeline, env } = await import('@huggingface/transformers');
    // Optional: Disable local models if you only want to use HF hub models and avoid indexDB interactions for model caching by Transformers.js
    // env.allowLocalModels = false;
    // Optional: Specify a remote path for models if not using default HF structure
    // env.remoteHost = 'https://your-model-hosting.com/';
    // env.remotePathTemplate = '{model}'; // Adjust if model files are directly at remoteHost/modelId

    self.postMessage({ type: 'status', payload: { message: `Loading Transformers.js model: ${effectiveModelId}...`, isError: false, isReady: false } });

    try {
        activeTransformersPipeline = await pipeline('text-generation', effectiveModelId, {
            progress_callback: (progress: any) => {
                if (progress.status === 'progress' || progress.status === 'download') {
                    self.postMessage({
                        type: 'progress',
                        payload: {
                            stage: `Loading ${effectiveModelId} (${progress.status})`,
                            file: progress.file,
                            loaded: progress.loaded,
                            total: progress.total,
                            progress: progress.progress,
                        }
                    });
                }
                // console.log("Transformers.js progress:", progress);
            }
        });
        activeTransformersModelId = effectiveModelId;
        self.postMessage({ type: 'status', payload: { message: `Transformers.js model ${effectiveModelId} loaded.`, isError: false, isReady: true } });
        return activeTransformersPipeline;
    } catch (error) {
        console.error("RAG Worker: Error loading Transformers.js pipeline:", error);
        self.postMessage({ type: 'status', payload: { message: `Error loading model ${effectiveModelId}: ${(error as Error).message}`, isError: true, isReady: true } });
        activeTransformersPipeline = null;
        activeTransformersModelId = null;
        throw error; // Re-throw to be caught by the caller
    }
}

self.onmessage = async (event: MessageEvent) => {
    console.log("RAG Worker: Message received from main thread:", event.data);
    const { type, payload } = event.data;

    switch (type) {
        case 'initialize':
            if (ragManager) {
                self.postMessage({ type: 'status', payload: { message: 'RAG system already initialized.', isError: false, isReady: true } });
                return;
            }
            try {
                self.postMessage({ type: 'status', payload: { message: 'Initializing RAG system...', isError: false, isReady: false } });
                self.postMessage({ type: 'progress', payload: { message: 'Initializing WebLLM Service...', loaded: 0, total: 100 } });

                webLLMService = new WebLLMService();
                await webLLMService.initializeEmbeddingEngine();
                self.postMessage({ type: 'progress', payload: { message: 'Embedding engine initialized. Initializing chat engine...', loaded: 33, total: 100 } });
                await webLLMService.initializeChatEngine();
                self.postMessage({ type: 'progress', payload: { message: 'Chat engine initialized. Loading RAG data...', loaded: 66, total: 100 } });

                const dataLoaderProgress = (progress: { message: string, loaded: number, total: number }) => {
                    const overallLoaded = 66 + Math.floor((progress.loaded / progress.total) * 34);
                    self.postMessage({ type: 'progress', payload: { message: `Loading data: ${progress.message}`, loaded: overallLoaded, total: 100 } });
                };

                const manifestFullUrl = new URL(MANIFEST_URL, self.location.origin).href;
                const ragData = await loadAllRAGData(manifestFullUrl, dataLoaderProgress);

                const searchService = new ClusteredSearchService(
                    ragData.centroids,
                    ragData.clustersData,
                    ragData.embeddingDimensions
                );

                ragManager = new RAGManager({
                    webLLMService: webLLMService,
                    clusteredSearchService: searchService,
                });

                self.postMessage({ type: 'progress', payload: { message: 'RAG System Ready.', loaded: 100, total: 100 } });
                self.postMessage({ type: 'status', payload: { message: 'RAG system initialized and ready.', isError: false, isReady: true } });
                console.log("RAG Worker: System initialized successfully.");

            } catch (error) {
                console.error("RAG Worker: Initialization error:", error);
                self.postMessage({ type: 'status', payload: { message: `Initialization failed: ${(error as Error).message}`, isError: true, isReady: false } });
            }
            break;

        case 'query':
            if (!ragManager || !webLLMService || !clusteredSearchService) {
                self.postMessage({ type: 'response', payload: { error: 'RAG system not initialized.' } });
                return;
            }
            if (!payload || !payload.query) {
                self.postMessage({ type: 'response', payload: { error: 'Missing query in payload.' } });
                return;
            }

            const { query: originalQuery, systemPrompt, rephrasePromptTemplate, finalRagPromptTemplate, temperature, chatEngineType, transformersModelId } = payload;

            try {
                self.postMessage({ type: 'status', payload: { message: 'Processing query (full RAG)...', isError: false, isReady: false } });

                let queryForRetrieval = originalQuery;
                // --- Stage 1: Rephrase Query ---
                if (chatEngineType === 'transformers') {
                    if (!transformersModelId) {
                        throw new Error("Transformers.js model ID not provided for rephrasing.");
                    }
                    const rephrasePipeline = await getTransformersChatPipeline(transformersModelId);
                    const rephraseFullPrompt = (rephrasePromptTemplate || "Rephrase: {query}").replace("{query}", originalQuery);
                    // Note: Transformers.js pipeline might have different API for system prompt.
                    // For basic text-generation, it's part of the main prompt or handled by model fine-tuning.
                    self.postMessage({ type: 'status', payload: { message: `Rephrasing query with Transformers.js (${transformersModelId})...`, isError: false, isReady: false } });
                    const rephrasedOutput = await rephrasePipeline(rephraseFullPrompt, { temperature: temperature ?? 0.3, max_new_tokens: 100 });
                    // Assuming rephrasedOutput is an array and we take the first generated text
                    if (Array.isArray(rephrasedOutput) && rephrasedOutput.length > 0 && rephrasedOutput[0].generated_text) {
                        queryForRetrieval = rephrasedOutput[0].generated_text.replace(rephraseFullPrompt, '').trim(); // Remove prompt from output
                        if (!queryForRetrieval) queryForRetrieval = originalQuery; // Fallback if stripping prompt results in empty
                        console.log("RAG Worker: Rephrased with Transformers.js to:", queryForRetrieval);
                    } else {
                        console.warn("RAG Worker: Transformers.js rephrasing produced unexpected output or no text. Using original query.");
                    }
                } else { // Default to WebLLM
                    self.postMessage({ type: 'status', payload: { message: `Rephrasing query with WebLLM...`, isError: false, isReady: false } });
                    queryForRetrieval = await ragManager.rephraseQuery(originalQuery, rephrasePromptTemplate, systemPrompt, temperature);
                    console.log("RAG Worker: Rephrased with WebLLM to:", queryForRetrieval);
                }
                self.postMessage({ type: 'rephrased_query_for_pipeline', payload: { rephrasedQuery: queryForRetrieval } }); // For potential UI update

                // --- Stage 2: Retrieve Context ---
                self.postMessage({ type: 'status', payload: { message: `Retrieving context for: "${queryForRetrieval}"...`, isError: false, isReady: false } });
                const context = await ragManager.retrieveContext(queryForRetrieval);
                self.postMessage({ type: 'retrieved_context_for_pipeline', payload: { context: context } }); // For potential UI update

                // --- Stage 3: Generate Final Answer ---
                let finalAnswer: string | null;
                if (chatEngineType === 'transformers') {
                    if (!transformersModelId) {
                        throw new Error("Transformers.js model ID not provided for final answer.");
                    }
                    const finalAnswerPipeline = await getTransformersChatPipeline(transformersModelId);
                    const finalPrompt = (finalRagPromptTemplate || "Context: {context}\nQuery: {query}\nAnswer:")
                        .replace("{context}", context || "No context provided.")
                        .replace("{query}", originalQuery);
                    self.postMessage({ type: 'status', payload: { message: `Generating final answer with Transformers.js (${transformersModelId})...`, isError: false, isReady: false } });
                    const finalAnswerOutput = await finalAnswerPipeline(finalPrompt, { temperature: temperature ?? 0.7, max_new_tokens: 500 });
                    if (Array.isArray(finalAnswerOutput) && finalAnswerOutput.length > 0 && finalAnswerOutput[0].generated_text) {
                        finalAnswer = finalAnswerOutput[0].generated_text.replace(finalPrompt, '').trim(); // Remove prompt from output
                        if (!finalAnswer && finalAnswerOutput[0].generated_text.length > 0) finalAnswer = finalAnswerOutput[0].generated_text.trim(); // If prompt was not in output
                    } else {
                        finalAnswer = "Transformers.js generation produced unexpected output or no text.";
                    }
                } else { // Default to WebLLM
                    self.postMessage({ type: 'status', payload: { message: `Generating final answer with WebLLM...`, isError: false, isReady: false } });
                    finalAnswer = await ragManager.generateFinalAnswer(originalQuery, context, finalRagPromptTemplate, systemPrompt, temperature);
                }

                self.postMessage({ type: 'response', payload: { result: finalAnswer } });
                self.postMessage({ type: 'status', payload: { message: 'Full RAG pipeline complete. Ready for new query.', isError: false, isReady: true } });

            } catch (error) {
                console.error("RAG Worker: Error in full RAG pipeline:", error);
                self.postMessage({ type: 'response', payload: { error: `Error in RAG pipeline: ${(error as Error).message}` } });
                self.postMessage({ type: 'status', payload: { message: 'Error in RAG pipeline. Ready for new query.', isError: true, isReady: true } });
            }
            break;

        case 'REPHRASE_QUERY':
            if (!ragManager || !webLLMService) {
                self.postMessage({ type: 'REPHRASED_QUERY_RESULT', payload: { error: 'RAG system not initialized.' } });
                return;
            }
            if (!payload || !payload.originalQuery || !payload.rephrasePromptTemplate) {
                self.postMessage({ type: 'REPHRASED_QUERY_RESULT', payload: { error: 'Missing originalQuery or rephrasePromptTemplate for rephrasing.' } });
                return;
            }
            try {
                const { originalQuery, rephrasePromptTemplate, systemPrompt, temperature, chatEngineType, transformersModelId } = payload;
                self.postMessage({ type: 'status', payload: { message: 'Rephrasing query in worker...', isError: false, isReady: false } });
                let rephrasedQuery;

                if (chatEngineType === 'transformers') {
                    if (!transformersModelId) {
                        throw new Error("Transformers.js model ID not provided for rephrasing.");
                    }
                    const pipeline = await getTransformersChatPipeline(transformersModelId);
                    const fullPrompt = rephrasePromptTemplate.replace("{query}", originalQuery);
                    // System prompt handling for transformers.js is tricky, often baked into the prompt or model fine-tuning
                    self.postMessage({ type: 'status', payload: { message: `Rephrasing with TJS (${transformersModelId})...`, isError: false, isReady: false } });
                    const output = await pipeline(fullPrompt, { temperature: temperature ?? 0.3, max_new_tokens: 100 });
                    if (Array.isArray(output) && output.length > 0 && output[0].generated_text) {
                        rephrasedQuery = output[0].generated_text.replace(fullPrompt, '').trim(); // Attempt to remove prompt
                        if (!rephrasedQuery) rephrasedQuery = output[0].generated_text.trim(); // Fallback if prompt wasn't in output
                    } else {
                        rephrasedQuery = "Transformers.js rephrasing produced no text.";
                    }
                } else {
                    if (!ragManager) throw new Error("RAGManager not initialized for WebLLM rephrase.");
                    rephrasedQuery = await ragManager.rephraseQuery(originalQuery, rephrasePromptTemplate, systemPrompt, temperature);
                }

                self.postMessage({ type: 'REPHRASED_QUERY_RESULT', payload: { rephrasedQuery } });
                self.postMessage({ type: 'status', payload: { message: 'Query rephrased.', isError: false, isReady: true } });
            } catch (error) {
                console.error("RAG Worker: Error rephrasing query:", error);
                self.postMessage({ type: 'REPHRASED_QUERY_RESULT', payload: { error: `Error rephrasing query: ${(error as Error).message}` } });
                self.postMessage({ type: 'status', payload: { message: 'Error rephrasing query.', isError: true, isReady: true } });
            }
            break;

        case 'RETRIEVE_CONTEXT':
            if (!ragManager || !webLLMService || !clusteredSearchService) {
                self.postMessage({ type: 'RETRIEVED_CONTEXT_RESULT', payload: { error: 'RAG system not initialized.' } });
                return;
            }
            if (!payload || !payload.queryForContext) {
                self.postMessage({ type: 'RETRIEVED_CONTEXT_RESULT', payload: { error: 'Missing queryForContext for context retrieval.' } });
                return;
            }
            try {
                self.postMessage({ type: 'status', payload: { message: 'Retrieving context in worker...', isError: false, isReady: false } });
                const context = await ragManager.retrieveContext(payload.queryForContext);
                self.postMessage({ type: 'RETRIEVED_CONTEXT_RESULT', payload: { context } });
                self.postMessage({ type: 'status', payload: { message: 'Context retrieved.', isError: false, isReady: true } });
            } catch (error) {
                console.error("RAG Worker: Error retrieving context:", error);
                self.postMessage({ type: 'RETRIEVED_CONTEXT_RESULT', payload: { error: `Error retrieving context: ${(error as Error).message}` } });
                self.postMessage({ type: 'status', payload: { message: 'Error retrieving context.', isError: true, isReady: true } });
            }
            break;

        case 'GENERATE_FINAL_ANSWER':
            if (!ragManager || !webLLMService) {
                self.postMessage({ type: 'FINAL_ANSWER_RESULT', payload: { error: 'RAG system not initialized.' } });
                return;
            }
            if (!payload || !payload.originalQuery || payload.context === undefined || !payload.finalRagPromptTemplate) { // context can be null (empty)
                self.postMessage({ type: 'FINAL_ANSWER_RESULT', payload: { error: 'Missing data for final answer generation.' } });
                return;
            }
            try {
                const { originalQuery, context, finalRagPromptTemplate, systemPrompt, temperature, chatEngineType, transformersModelId } = payload;
                self.postMessage({ type: 'status', payload: { message: 'Generating final answer in worker...', isError: false, isReady: false } });
                let finalAnswer;

                if (chatEngineType === 'transformers') {
                    if (!transformersModelId) {
                        throw new Error("Transformers.js model ID not provided for final answer.");
                    }
                    const pipeline = await getTransformersChatPipeline(transformersModelId);
                    const fullPrompt = finalRagPromptTemplate
                        .replace("{context}", context || "No context provided.")
                        .replace("{query}", originalQuery);
                    self.postMessage({ type: 'status', payload: { message: `Generating with TJS (${transformersModelId})...`, isError: false, isReady: false } });
                    const output = await pipeline(fullPrompt, { temperature: temperature ?? 0.7, max_new_tokens: 500 });
                    if (Array.isArray(output) && output.length > 0 && output[0].generated_text) {
                        finalAnswer = output[0].generated_text.replace(fullPrompt, '').trim(); // Attempt to remove prompt
                        if (!finalAnswer && output[0].generated_text.length > 0) finalAnswer = output[0].generated_text.trim(); // Fallback if prompt wasn't in output
                    } else {
                        finalAnswer = "Transformers.js generation produced no text.";
                    }
                } else {
                    if (!ragManager) throw new Error("RAGManager not initialized for WebLLM final answer.");
                    finalAnswer = await ragManager.generateFinalAnswer(originalQuery, context, finalRagPromptTemplate, systemPrompt, temperature);
                }

                self.postMessage({ type: 'FINAL_ANSWER_RESULT', payload: { finalAnswer } });
                self.postMessage({ type: 'status', payload: { message: 'Final answer generated.', isError: false, isReady: true } });

            } catch (error) {
                console.error("RAG Worker: Error generating final answer:", error);
                self.postMessage({ type: 'FINAL_ANSWER_RESULT', payload: { error: `Error generating final answer: ${(error as Error).message}` } });
                self.postMessage({ type: 'status', payload: { message: 'Error generating final answer.', isError: true, isReady: true } });
            }
            break;

        case 'GET_EMBEDDING_SIMILARITY':
            if (!webLLMService) {
                self.postMessage({
                    type: 'SIMILARITY_RESULT',
                    payload: { sampleId: payload.sampleId, webLLMSimilarity: null, error: 'WebLLMService not initialized.' }
                });
                return;
            }
            if (!payload || !payload.text1 || !payload.text2 || !payload.sampleId) {
                self.postMessage({
                    type: 'SIMILARITY_RESULT',
                    payload: { sampleId: payload.sampleId, webLLMSimilarity: null, error: 'Invalid payload for similarity test.' }
                });
                return;
            }
            try {
                const embedding1 = await webLLMService.getQueryEmbedding(payload.text1);
                const embedding2 = await webLLMService.getQueryEmbedding(payload.text2);

                if (!embedding1 || !embedding2) {
                    throw new Error('Failed to generate one or both embeddings using WebLLM.');
                }

                // getQueryEmbedding should already L2 normalize.
                const similarity = calculateCosineSimilarity(embedding1, embedding2);

                self.postMessage({
                    type: 'SIMILARITY_RESULT',
                    payload: { sampleId: payload.sampleId, webLLMSimilarity: similarity, error: null }
                });

            } catch (error) {
                console.error("RAG Worker: Error calculating WebLLM similarity:", error);
                self.postMessage({
                    type: 'SIMILARITY_RESULT',
                    payload: { sampleId: payload.sampleId, webLLMSimilarity: null, error: (error as Error).message }
                });
            }
            break;

        case 'dispose':
            if (webLLMService) {
                try {
                    self.postMessage({ type: 'status', payload: { message: 'Disposing WebLLM engines...', isError: false, isReady: false } });
                    await webLLMService.disposeAllEngines();
                    webLLMService = null;
                    ragManager = null;
                    self.postMessage({ type: 'status', payload: { message: 'Engines disposed. System is no longer ready.', isError: false, isReady: false } });
                    console.log("RAG Worker: Engines disposed.");
                } catch (error) {
                    console.error("RAG Worker: Error disposing engines:", error);
                    self.postMessage({ type: 'status', payload: { message: `Error disposing: ${(error as Error).message}`, isError: true, isReady: false } });
                }
            } else {
                self.postMessage({ type: 'status', payload: { message: 'Engines already disposed or never initialized.', isError: false, isReady: false } });
            }
            break;

        default:
            console.warn("RAG Worker: Unknown message type received:", type);
            self.postMessage({ type: 'error', payload: { message: `Unknown command: ${type}` } });
    }
};

console.log("RAG Worker: Event listener attached.");
self.postMessage({ type: 'status', payload: { message: 'Worker script loaded. Ready for initialization command.', isError: false, isReady: false } }); 