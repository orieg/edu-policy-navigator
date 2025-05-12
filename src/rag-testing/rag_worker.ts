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
 * @param onnxFile Optional ONNX file path or URL.
 * @returns The initialized text-generation pipeline.
 */
async function getTransformersChatPipeline(modelId: string, onnxFile?: string) {
    if (activeTransformersPipeline && activeTransformersModelId === (onnxFile ? `${modelId}|${onnxFile}` : modelId)) {
        return activeTransformersPipeline;
    }

    let modelPath = modelId;
    let pipelineOptions: any = {};

    if (onnxFile) {
        if (onnxFile.startsWith('http://') || onnxFile.startsWith('https://')) {
            modelPath = onnxFile;
        } else {
            pipelineOptions.fileName = onnxFile;
        }
    }

    self.postMessage({ type: 'status', payload: { message: `Initializing Transformers.js with model: ${modelPath}...`, isError: false, isReady: false } });
    const { pipeline, env } = await import('@huggingface/transformers');
    // Optional: Disable local models if you only want to use HF hub models and avoid indexDB interactions for model caching by Transformers.js
    // env.allowLocalModels = false;
    // Optional: Specify a remote path for models if not using default HF structure
    // env.remoteHost = 'https://your-model-hosting.com/';
    // env.remotePathTemplate = '{model}'; // Adjust if model files are directly at remoteHost/modelId

    self.postMessage({ type: 'status', payload: { message: `Loading Transformers.js model: ${modelPath}...`, isError: false, isReady: false } });

    try {
        activeTransformersPipeline = await pipeline('text-generation', modelPath, {
            ...pipelineOptions,
            progress_callback: (progress: any) => {
                if (progress.status === 'progress' || progress.status === 'download') {
                    self.postMessage({
                        type: 'progress',
                        payload: {
                            stage: `Loading ${modelPath} (${progress.status})`,
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
        activeTransformersModelId = onnxFile ? `${modelId}|${onnxFile}` : modelId;
        self.postMessage({ type: 'status', payload: { message: `Transformers.js model ${modelPath} loaded.`, isError: false, isReady: true } });
        return activeTransformersPipeline;
    } catch (error) {
        console.error("RAG Worker: Error loading Transformers.js pipeline:", error);
        self.postMessage({ type: 'status', payload: { message: `Error loading model ${modelPath}: ${(error as Error).message}`, isError: true, isReady: true } });
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
                // Assign the created service to the global variable
                clusteredSearchService = searchService;

                ragManager = new RAGManager({
                    webLLMService: webLLMService,
                    clusteredSearchService: clusteredSearchService, // Use the now-assigned global variable
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

            const { query: originalQuery, systemPrompt, rephrasePromptTemplate, finalRagPromptTemplate, temperature, chatEngineType, transformersModelId, transformersOnnxFile, rephraseSettings, answerSettings } = payload;

            try {
                const totalPipelineStart = performance.now();
                self.postMessage({ type: 'status', payload: { message: 'Processing query (full RAG)...', isError: false, isReady: false } });

                let queryForRetrieval = originalQuery;
                let rephraseDuration = 0;
                let contextDuration = 0;
                let finalAnswerDuration = 0;

                // --- Stage 1: Rephrase Query ---
                const rephraseStart = performance.now();
                if (chatEngineType === 'transformers') {
                    if (!transformersModelId) {
                        throw new Error("Transformers.js model ID not provided for rephrasing.");
                    }
                    const rephrasePipeline = await getTransformersChatPipeline(transformersModelId, transformersOnnxFile);
                    const rephraseFullPrompt = (rephrasePromptTemplate || "Rephrase: {query}").replace("{query}", originalQuery);
                    self.postMessage({ type: 'status', payload: { message: `Rephrasing query with Transformers.js (${transformersModelId})...`, isError: false, isReady: false } });
                    console.log("RAG Worker: Using Transformers.js settings:", rephraseSettings);

                    // Determine if sampling should be enabled
                    const rephraseShouldSample = (rephraseSettings?.temperature ?? 0) > 0 ||
                        (rephraseSettings?.top_k ?? 0) > 1 ||
                        ((rephraseSettings?.top_p ?? 1.0) < 1.0);

                    const tjsSettings: any = {
                        temperature: rephraseSettings?.temperature ?? 0.2,
                        top_p: rephraseSettings?.top_p,
                        top_k: rephraseSettings?.top_k,
                        max_new_tokens: rephraseSettings?.max_new_tokens ?? 100,
                        max_length: undefined, // Initialize max_length
                        do_sample: rephraseShouldSample // Explicitly set sampling
                    };
                    if (tjsSettings.max_new_tokens) tjsSettings.max_length = tjsSettings.max_new_tokens;
                    console.log("RAG Worker: Final settings for Transformers.js rephrase:", tjsSettings);
                    const rephrasedOutput = await rephrasePipeline(rephraseFullPrompt, tjsSettings);
                    // Log raw output
                    if (Array.isArray(rephrasedOutput) && rephrasedOutput.length > 0 && rephrasedOutput[0].generated_text) {
                        console.log("RAG Worker: RAW rephrasedOutput from Transformers.js:", rephrasedOutput[0].generated_text);
                    }
                    if (Array.isArray(rephrasedOutput) && rephrasedOutput.length > 0 && rephrasedOutput[0].generated_text) {
                        queryForRetrieval = rephrasedOutput[0].generated_text.replace(rephraseFullPrompt, '').trim();
                        if (!queryForRetrieval) queryForRetrieval = originalQuery;
                        console.log("RAG Worker: Rephrased with Transformers.js to:", queryForRetrieval);
                    } else {
                        console.warn("RAG Worker: Transformers.js rephrasing produced unexpected output or no text. Using original query.");
                    }
                } else {
                    self.postMessage({ type: 'status', payload: { message: `Rephrasing query with WebLLM...`, isError: false, isReady: false } });
                    console.log("RAG Worker: Using WebLLM settings:", rephraseSettings);
                    queryForRetrieval = await ragManager.rephraseQuery(
                        originalQuery,
                        rephrasePromptTemplate,
                        systemPrompt,
                        rephraseSettings?.temperature,
                        rephraseSettings
                    );
                    console.log("RAG Worker: Rephrased with WebLLM to:", queryForRetrieval);
                }
                self.postMessage({ type: 'rephrased_query_for_pipeline', payload: { rephrasedQuery: queryForRetrieval } });

                rephraseDuration = performance.now() - rephraseStart;

                // --- Stage 2: Retrieve Context ---
                const contextStart = performance.now();
                self.postMessage({ type: 'status', payload: { message: `Retrieving context for: "${queryForRetrieval}"...`, isError: false, isReady: false } });
                const context = await ragManager.retrieveContext(queryForRetrieval);
                self.postMessage({ type: 'retrieved_context_for_pipeline', payload: { context: context } });

                contextDuration = performance.now() - contextStart;

                // --- Stage 3: Generate Final Answer ---
                let finalAnswer: string | null;
                const finalAnswerStart = performance.now();
                if (chatEngineType === 'transformers') {
                    if (!transformersModelId) {
                        throw new Error("Transformers.js model ID not provided for final answer.");
                    }
                    const finalAnswerPipeline = await getTransformersChatPipeline(transformersModelId, transformersOnnxFile);
                    const finalPrompt = (finalRagPromptTemplate || "Context: {context}\nQuery: {query}\nAnswer:")
                        .replace("{context}", context || "No context provided.")
                        .replace("{query}", originalQuery);
                    self.postMessage({ type: 'status', payload: { message: `Generating final answer with Transformers.js (${transformersModelId})...`, isError: false, isReady: false } });

                    // Determine if sampling should be enabled for final answer
                    const answerShouldSample = (answerSettings?.temperature ?? 0) > 0 ||
                        (answerSettings?.top_k ?? 0) > 1 ||
                        ((answerSettings?.top_p ?? 1.0) < 1.0);

                    const tjsSettings: any = {
                        temperature: answerSettings?.temperature ?? 0.7,
                        top_p: answerSettings?.top_p,
                        top_k: answerSettings?.top_k,
                        max_new_tokens: answerSettings?.max_new_tokens ?? 500,
                        max_length: undefined, // Initialize max_length
                        do_sample: answerShouldSample // Explicitly set sampling
                    };
                    if (tjsSettings.max_new_tokens) tjsSettings.max_length = tjsSettings.max_new_tokens;
                    console.log("RAG Worker: Final settings for Transformers.js final answer:", tjsSettings);
                    const finalAnswerOutput = await finalAnswerPipeline(finalPrompt, tjsSettings);
                    // Log raw output
                    if (Array.isArray(finalAnswerOutput) && finalAnswerOutput.length > 0 && finalAnswerOutput[0].generated_text) {
                        console.log("RAG Worker: RAW finalAnswerOutput from Transformers.js:", finalAnswerOutput[0].generated_text);
                    }
                    if (Array.isArray(finalAnswerOutput) && finalAnswerOutput.length > 0 && finalAnswerOutput[0].generated_text) {
                        finalAnswer = finalAnswerOutput[0].generated_text.replace(finalPrompt, '').trim();
                        if (!finalAnswer && finalAnswerOutput[0].generated_text.length > 0) finalAnswer = finalAnswerOutput[0].generated_text.trim();
                    } else {
                        finalAnswer = "Transformers.js generation produced unexpected output or no text.";
                    }
                } else {
                    self.postMessage({ type: 'status', payload: { message: `Generating final answer with WebLLM...`, isError: false, isReady: false } });
                    finalAnswer = await ragManager.generateFinalAnswer(
                        originalQuery,
                        context,
                        finalRagPromptTemplate,
                        systemPrompt,
                        temperature,
                        answerSettings
                    );
                }

                finalAnswerDuration = performance.now() - finalAnswerStart;
                const totalPipelineDuration = performance.now() - totalPipelineStart;

                self.postMessage({
                    type: 'response', payload: {
                        result: finalAnswer,
                        metrics: {
                            rephraseDuration,
                            contextDuration,
                            finalAnswerDuration,
                            totalPipelineDuration
                        }
                    }
                });
                self.postMessage({ type: 'status', payload: { message: 'Full RAG pipeline complete. Ready for new query.', isError: false } });

            } catch (error) {
                console.error("RAG Worker: Error in full RAG pipeline:", error);
                self.postMessage({ type: 'response', payload: { error: `Error in RAG pipeline: ${(error as Error).message}`, metrics: null } });
                self.postMessage({ type: 'status', payload: { message: 'Error in RAG pipeline. Ready for new query.', isError: true } });
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
                const { originalQuery, rephrasePromptTemplate, systemPrompt, temperature, chatEngineType, transformersModelId, transformersOnnxFile, rephraseSettings } = payload;
                const rephraseStart = performance.now();
                self.postMessage({ type: 'status', payload: { message: 'Rephrasing query in worker...', isError: false, isReady: false } });
                let rephrasedQuery;

                if (chatEngineType === 'transformers') {
                    if (!transformersModelId) {
                        throw new Error("Transformers.js model ID not provided for rephrasing.");
                    }
                    const pipeline = await getTransformersChatPipeline(transformersModelId, transformersOnnxFile);
                    const fullPrompt = rephrasePromptTemplate.replace("{query}", originalQuery);
                    // System prompt handling for transformers.js is tricky, often baked into the prompt or model fine-tuning
                    self.postMessage({ type: 'status', payload: { message: `Rephrasing with TJS (${transformersModelId})...`, isError: false, isReady: false } });
                    const output = await pipeline(fullPrompt, { temperature: temperature ?? 0.3, max_new_tokens: 100 });
                    if (Array.isArray(output) && output.length > 0 && output[0].generated_text) {
                        let rawGeneratedText = output[0].generated_text;

                        if (transformersModelId === 'transformers_pleias') {
                            console.log("RAG Worker: Attempting Pleias-specific parsing for rephrase output.");
                            // Attempt to parse structured Pleias output for query report
                            const queryReportMatch = rawGeneratedText.match(/<\|query_report_start\|>([\s\S]*?)<\|query_report_end\|>/);
                            if (queryReportMatch && queryReportMatch[1]) {
                                const queryReportContent = queryReportMatch[1].trim();
                                console.log("RAG Worker: Extracted Query Report content:", queryReportContent);
                                // Further attempt to find a reformulated query within the report
                                const reformulatedMatch = queryReportContent.match(/(?:Reformulated Query|query_reformulation):\s*([\s\S]+)/i);
                                if (reformulatedMatch && reformulatedMatch[1]) {
                                    rephrasedQuery = reformulatedMatch[1].trim();
                                    console.log("RAG Worker: Parsed Reformulated Query (Pleias):", rephrasedQuery);
                                } else {
                                    console.warn("RAG Worker: Could not find 'Reformulated Query:' in Pleias query report. Using full report content as fallback.");
                                    rephrasedQuery = queryReportContent; // Fallback to the whole report content if specific line not found
                                }
                            } else {
                                // Fallback for Pleias if query_report tags are missing but source_analysis_start was the stop
                                const promptEndMarker = "<|source_analysis_start|>";
                                const promptEndIndex = rawGeneratedText.indexOf(promptEndMarker);
                                if (promptEndIndex !== -1) {
                                    // Take text after the input prompt, up to where source_analysis_start would be in the output
                                    // This assumes the model output the reformulation before this implicit stop
                                    rephrasedQuery = rawGeneratedText.substring(fullPrompt.length, promptEndIndex).trim();
                                    console.log("RAG Worker: Pleias rephrase (fallback, text before source_analysis_start):", rephrasedQuery);
                                } else {
                                    // Generic fallback: remove the prompt part and hope the rest is the reformulation
                                    rephrasedQuery = rawGeneratedText.replace(fullPrompt, '').trim();
                                    console.warn("RAG Worker: Pleias query_report tags not found, and no clear stop. Using generic prompt removal for rephrase.");
                                }
                            }
                        } else {
                            // Original behavior for non-Pleias transformers
                            rephrasedQuery = rawGeneratedText.replace(fullPrompt, '').trim();
                            console.log(`RAG Worker: Standalone rephrase result (generic transformer, after prompt removal): ${rephrasedQuery}`);
                        }

                        if (!rephrasedQuery || rephrasedQuery.startsWith("<|")) { // Basic sanity check if parsing failed or returned unwanted tokens
                            console.warn("RAG Worker: Rephrase parsing resulted in empty or token-like string. Falling back to original query.", rephrasedQuery);
                            rephrasedQuery = originalQuery; // Fallback if parsing failed or produced something odd
                        }
                    } else {
                        console.warn("RAG Worker: Standalone rephrasing produced unexpected output or no text.");
                        rephrasedQuery = originalQuery; // Fallback
                    }
                } else {
                    if (!ragManager) throw new Error("RAGManager not initialized for WebLLM rephrase.");
                    rephrasedQuery = await ragManager.rephraseQuery(originalQuery, rephrasePromptTemplate, systemPrompt, temperature, rephraseSettings);
                }

                // Log the payload just before sending
                const rephraseDuration = performance.now() - rephraseStart;
                const resultPayload = { rephrasedQuery, metrics: { duration: rephraseDuration } };
                console.log("RAG Worker: Sending REPHRASED_QUERY_RESULT payload:", resultPayload);
                self.postMessage({ type: 'REPHRASED_QUERY_RESULT', payload: resultPayload });
                self.postMessage({ type: 'status', payload: { message: 'Query rephrased.' } });
            } catch (error) {
                console.error("RAG Worker: Error rephrasing query:", error);
                self.postMessage({ type: 'REPHRASED_QUERY_RESULT', payload: { error: `Error rephrasing query: ${(error as Error).message}`, metrics: null } });
                self.postMessage({ type: 'status', payload: { message: 'Error rephrasing query.' } });
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
                const contextStart = performance.now();
                const searchResults = await ragManager.retrieveContext(payload.queryForContext);
                const contextDuration = performance.now() - contextStart;

                self.postMessage({ type: 'RETRIEVED_CONTEXT_RESULT', payload: { searchResults, metrics: { duration: contextDuration } } });
                self.postMessage({ type: 'status', payload: { message: 'Context retrieved.' } });
            } catch (error) {
                console.error("RAG Worker: Error retrieving context:", error);
                self.postMessage({ type: 'RETRIEVED_CONTEXT_RESULT', payload: { searchResults: null, error: `Error retrieving context: ${(error as Error).message}`, metrics: null } });
                self.postMessage({ type: 'status', payload: { message: 'Error retrieving context.' } });
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
                const { originalQuery, context, finalRagPromptTemplate, systemPrompt, temperature, chatEngineType, transformersModelId, transformersOnnxFile, answerSettings } = payload;
                const finalAnswerStart = performance.now();
                self.postMessage({ type: 'status', payload: { message: 'Generating final answer in worker...', isError: false, isReady: false } });
                let finalAnswer;

                if (chatEngineType === 'transformers') {
                    if (!transformersModelId) {
                        throw new Error("Transformers.js model ID not provided for final answer.");
                    }
                    const pipeline = await getTransformersChatPipeline(transformersModelId, transformersOnnxFile);
                    const fullPrompt = finalRagPromptTemplate
                        .replace("{context}", context || "No context provided.")
                        .replace("{query}", originalQuery);
                    self.postMessage({ type: 'status', payload: { message: `Generating with TJS (${transformersModelId})...`, isError: false, isReady: false } });

                    // Determine if sampling should be enabled for final answer
                    const answerShouldSample = (answerSettings?.temperature ?? 0) > 0 ||
                        (answerSettings?.top_k ?? 0) > 1 ||
                        ((answerSettings?.top_p ?? 1.0) < 1.0);

                    const tjsSettings: any = {
                        temperature: temperature ?? 0.7,
                        top_p: answerSettings?.top_p,
                        top_k: answerSettings?.top_k,
                        max_new_tokens: answerSettings?.max_new_tokens ?? 500,
                        max_length: undefined, // Initialize max_length
                        do_sample: answerShouldSample // Explicitly set sampling
                    };
                    if (tjsSettings.max_new_tokens) tjsSettings.max_length = tjsSettings.max_new_tokens;
                    console.log("RAG Worker: Final settings for step-by-step Transformers.js final answer:", tjsSettings);
                    const output = await pipeline(fullPrompt, tjsSettings);
                    // Log raw output
                    if (Array.isArray(output) && output.length > 0 && output[0].generated_text) {
                        console.log("RAG Worker: RAW step-by-step output from Transformers.js:", output[0].generated_text);
                    }
                    if (Array.isArray(output) && output.length > 0 && output[0].generated_text) {
                        finalAnswer = output[0].generated_text.replace(fullPrompt, '').trim();
                        if (!finalAnswer && output[0].generated_text.length > 0) finalAnswer = output[0].generated_text.trim();
                    } else {
                        finalAnswer = "Transformers.js generation produced no text.";
                    }
                } else {
                    if (!ragManager) throw new Error("RAGManager not initialized for WebLLM final answer.");
                    finalAnswer = await ragManager.generateFinalAnswer(
                        originalQuery,
                        context,
                        finalRagPromptTemplate,
                        systemPrompt,
                        temperature,
                        answerSettings
                    );
                }

                const finalAnswerDuration = performance.now() - finalAnswerStart;
                self.postMessage({ type: 'FINAL_ANSWER_RESULT', payload: { finalAnswer, metrics: { duration: finalAnswerDuration } } });
                self.postMessage({ type: 'status', payload: { message: 'Final answer generated.' } });

            } catch (error) {
                console.error("RAG Worker: Error generating final answer:", error);
                self.postMessage({ type: 'FINAL_ANSWER_RESULT', payload: { error: `Error generating final answer: ${(error as Error).message}`, metrics: null } });
                self.postMessage({ type: 'status', payload: { message: 'Error generating final answer.' } });
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