import WebLLMService from '../lib/WebLLMService.ts';
import { loadAllRAGData } from '../lib/dataLoader.ts';
import { ClusteredSearchService } from '../lib/clusteredSearchService.ts';
import type { SearchResult } from '../types/vectorStore';
import { RAGManager } from '../lib/ragManager.ts';
import { calculateSimilarity } from '../utils/mathUtils';

console.log("RAG Worker: Script loaded. All services imported.");

let ragManager: RAGManager | null = null;
let webLLMService: WebLLMService | null = null;
let clusteredSearchService: ClusteredSearchService | null = null;

// Cache for Transformers.js pipeline (for chat)
let activeTransformersPipeline: any = null;
let activeTransformersModelId: string | null = null;

// New: Cache for Transformers.js feature-extraction pipeline (for similarity validation)
let similarityValidationFeatureExtractor: any = null;

// BM25 Precomputation Store
let allDocsForBM25: { id: string, text: string, title?: string, [key: string]: any }[] = [];
let docFrequencies: Map<string, number> = new Map(); // Map<term, count_of_docs_containing_term>
let docLengths: Map<string, number> = new Map(); // Map<docId, length_in_tokens>
let totalDocsBM25: number = 0;
let avgDocLengthBM25: number = 0;
// End BM25 Precomputation Store

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

// --- Approximation for token count ---
function estimateTokenCount(text: string | null): number {
    if (!text) return 0;
    return Math.round(text.length / 4); // Simple approximation
}

// Simple tokenizer for BM25 (minimalist approach for PoC)
function tokenizeText(text: string): string[] {
    if (!text) return [];
    // Lowercase, split by non-alphanumeric characters, filter out empty strings
    return text.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length > 0);
}

// BM25 Scoring Function
const K1_DEFAULT = 1.2; // Typical value for k1
const B_DEFAULT = 0.75;  // Typical value for b

function calculateBM25Score(
    queryTokens: string[],
    doc: { id: string, text: string, title?: string },
    docLength: number, // Precomputed length of this document in tokens
    // Corpus-level stats (precomputed):
    averageDocumentLength: number,
    totalNumberOfDocuments: number,
    documentFrequencies: Map<string, number>, // Map<term, num_docs_containing_term>
    // BM25 parameters:
    k1: number = K1_DEFAULT,
    b: number = B_DEFAULT
): number {
    let score = 0;

    if (totalNumberOfDocuments === 0 || averageDocumentLength === 0) {
        return 0; // Avoid division by zero if corpus stats are not ready
    }

    const docTokens = tokenizeText(doc.text); // Tokenize doc text on the fly for TF calculation
    const termFrequenciesInDoc: Map<string, number> = new Map();
    for (const token of docTokens) {
        termFrequenciesInDoc.set(token, (termFrequenciesInDoc.get(token) || 0) + 1);
    }

    for (const term of queryTokens) {
        const tf = termFrequenciesInDoc.get(term) || 0;
        if (tf === 0) continue; // Term not in doc, skip

        const df = documentFrequencies.get(term) || 0;
        // IDF calculation: log( (N - n + 0.5) / (n + 0.5) + 1 )
        // Adding 1 to the argument of log to ensure it's always positive, common practice.
        const idf = Math.log(((totalNumberOfDocuments - df + 0.5) / (df + 0.5)) + 1);

        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (docLength / averageDocumentLength));

        score += idf * (numerator / denominator);
    }
    return score;
}

// Reciprocal Rank Fusion (RRF)
const K_RRF_DEFAULT = 60; // Default RRF k value

function reciprocalRankFusion(
    searchResultsLists: SearchResult[][],
    k_rrf: number = K_RRF_DEFAULT
): SearchResult[] {
    const fusedScores: Map<string, number> = new Map(); // Map<docId, RRF_score>
    // Store doc details to avoid losing them, prioritize details from the first list a doc appears in
    const docStore: Map<string, SearchResult> = new Map();

    for (const list of searchResultsLists) {
        if (!list || list.length === 0) {
            continue;
        }
        list.forEach((doc, index) => {
            const rank = index + 1; // Ranks are 1-based
            if (!doc || typeof doc.id !== 'string') { // Basic check for valid doc object
                console.warn("RRF: Skipping invalid document in a search list:", doc);
                return;
            }

            if (!docStore.has(doc.id)) {
                docStore.set(doc.id, { ...doc }); // Store a copy
            }

            const rrfScorePart = 1 / (k_rrf + rank);
            fusedScores.set(doc.id, (fusedScores.get(doc.id) || 0) + rrfScorePart);
        });
    }

    const finalFusedResults: SearchResult[] = [];
    for (const [docId, totalRrfScore] of fusedScores.entries()) {
        const docDetails = docStore.get(docId);
        if (docDetails) {
            finalFusedResults.push({
                ...docDetails, // Retain original id, text, metadata
                score: totalRrfScore // Update score with the RRF score
            });
        }
    }

    finalFusedResults.sort((a, b) => b.score - a.score); // Sort by RRF score descending
    return finalFusedResults;
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
    const pipelineOptions: any = {
        device: "wasm", // Or "webgpu" if preferred and supported
        dtype: undefined, // Explicitly undefined for now
        quantized: false // Add this line to disable library quantization for ONNX
    };

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

// New function to initialize the feature extractor for similarity validation
async function initializeSimilarityValidationFeatureExtractor() {
    if (similarityValidationFeatureExtractor) return; // Already initialized

    self.postMessage({ type: 'status', payload: { message: 'Initializing similarity validation feature extractor (Snowflake/snowflake-arctic-embed-xs)...', isError: false, isReady: false } });
    try {
        const { pipeline, env } = await import('@huggingface/transformers');
        env.allowLocalModels = false; // Consistent with main thread if desired
        env.useBrowserCache = true;   // Consistent with main thread if desired

        similarityValidationFeatureExtractor = await pipeline('feature-extraction', 'Snowflake/snowflake-arctic-embed-xs', {
            device: "wasm", // or "webgpu"
            progress_callback: (progress: any) => {
                if (progress.status === 'progress' || progress.status === 'download') {
                    self.postMessage({
                        type: 'progress',
                        payload: {
                            stage: `Loading Snowflake embedder (${progress.status})`,
                            file: progress.file,
                            loaded: progress.loaded,
                            total: progress.total,
                            progress: progress.progress,
                        }
                    });
                }
            }
        });
        self.postMessage({ type: 'status', payload: { message: 'Similarity validation feature extractor (Snowflake) loaded.', isError: false, isReady: true } }); // isReady might be true for this component only
    } catch (error) {
        console.error("RAG Worker: Error loading similarity validation feature extractor:", error);
        self.postMessage({ type: 'status', payload: { message: `Error loading Snowflake embedder: ${(error as Error).message}`, isError: true } });
        similarityValidationFeatureExtractor = null;
    }
}

self.onmessage = async (event: MessageEvent) => {
    console.log("RAG Worker: Message received from main thread:", event.data);
    const { type, payload } = event.data;

    switch (type) {
        case 'initialize':
            const { mlcModelId } = payload || {};

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
                await webLLMService.initializeChatEngine(undefined, mlcModelId);
                // Initialize the similarity validation feature extractor
                await initializeSimilarityValidationFeatureExtractor();
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

                // --- Populate BM25 Data ---
                console.log("RAG Worker: Starting BM25 precomputation...");
                let accumulatedDocLength = 0;
                allDocsForBM25 = [];
                docFrequencies.clear();
                docLengths.clear();

                for (const clusterData of ragData.clustersData.values()) {
                    if (clusterData.metadata) {
                        for (const metaDoc of clusterData.metadata) {
                            // Ensure metaDoc and its properties are not undefined
                            if (metaDoc && typeof metaDoc.id === 'string' && typeof metaDoc.text === 'string') {
                                allDocsForBM25.push({
                                    id: metaDoc.id,
                                    text: metaDoc.text,
                                    title: metaDoc.name || metaDoc.id, // Use name as title, fallback to id
                                    // Add other specific fields from metaDoc if needed for display/filtering later:
                                    // type: metaDoc.type,
                                    // city: metaDoc.city,
                                    // anyOtherDirectFieldOnMetaDoc: metaDoc.anyOtherDirectFieldOnMetaDoc
                                });

                                const tokens = tokenizeText(metaDoc.text);
                                docLengths.set(metaDoc.id, tokens.length);
                                accumulatedDocLength += tokens.length;

                                const uniqueTokensInDoc = new Set(tokens);
                                uniqueTokensInDoc.forEach(token => {
                                    docFrequencies.set(token, (docFrequencies.get(token) || 0) + 1);
                                });
                            } else {
                                console.warn("RAG Worker: Skipping invalid metaDoc during BM25 precomputation:", metaDoc);
                            }
                        }
                    }
                }
                totalDocsBM25 = allDocsForBM25.length;
                avgDocLengthBM25 = totalDocsBM25 > 0 ? accumulatedDocLength / totalDocsBM25 : 0;

                console.log(`RAG Worker: BM25 precomputation complete. Total docs: ${totalDocsBM25}, Avg doc length: ${avgDocLengthBM25.toFixed(2)}`);
                if (allDocsForBM25.length === 0) {
                    console.warn("RAG Worker: No documents were processed for BM25. Keyword search will not work.");
                }
                // --- End BM25 Data Population ---

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
                let tokensPerSecond = 0;
                let totalTokens = 0;

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
                        do_sample: rephraseShouldSample, // Explicitly set sampling
                        stop_sequences: (chatEngineType === 'transformers_pleias' || chatEngineType === 'transformers_pleias_1b') ? ["<|answer_end|>"] : undefined // <<< Add stop sequence for Pleias
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

                // Ensure webLLMService is available for embedding
                if (!webLLMService) {
                    throw new Error("WebLLMService not available for query embedding in full RAG pipeline.");
                }
                const queryEmbeddingForRetrieval = await webLLMService.getQueryEmbedding(queryForRetrieval);
                if (!queryEmbeddingForRetrieval) {
                    throw new Error("Failed to generate query embedding for context retrieval in full RAG pipeline.");
                }

                const { similarityMetric: fullPipelineSimilarityMetric } = payload; // Extract metric for full pipeline

                const context = await ragManager.retrieveContext(
                    queryForRetrieval,
                    queryEmbeddingForRetrieval,
                    { similarityMetric: fullPipelineSimilarityMetric } // Pass metric
                );
                self.postMessage({ type: 'retrieved_context_for_pipeline', payload: { context: context } });

                contextDuration = performance.now() - contextStart;

                // --- Stage 3: Generate Final Answer ---
                let finalAnswer: string | null;
                const finalAnswerStart = performance.now();
                if (chatEngineType.startsWith('transformers')) { // <<< Changed to startsWith to include _1b
                    if (!transformersModelId) {
                        throw new Error("Transformers.js model ID not provided for final answer.");
                    }
                    const finalAnswerPipeline = await getTransformersChatPipeline(transformersModelId, transformersOnnxFile);

                    // --- Format Context String ---
                    let formattedContextString = "No context provided.";
                    if (Array.isArray(context) && context.length > 0) {
                        if (chatEngineType === 'transformers_pleias' || chatEngineType === 'transformers_pleias_1b') {
                            // Special formatting for Pleias - Use index+1 and correct token format
                            formattedContextString = context.map((chunk: SearchResult, index: number) =>
                                // Use index+1 for ID, correct token structure, remove _start/_end for ID
                                `<|source_start|><|source_id|>${index + 1} <|source_content_start|>${chunk.text}<|source_content_end|><|source_end|>`
                            ).join('\n'); // Join with newline
                            console.log("RAG Worker: Formatted Pleias context string (with language_start):");
                            console.log(formattedContextString);
                        } else {
                            // Default formatting: just join text chunks (or improve later)
                            formattedContextString = context.map((chunk: SearchResult) => chunk.text).join('\n\n');
                        }
                    }
                    // --- End Format Context String ---

                    const finalPrompt = (finalRagPromptTemplate || "Context: {context}\nQuery: {query}\nAnswer:")
                        .replace("{context}", formattedContextString)
                        .replace("{query}", originalQuery);
                    self.postMessage({ type: 'status', payload: { message: `Generating final answer with Transformers.js (${transformersModelId})...`, isError: false, isReady: false } });

                    // <<< Add Log Here >>>
                    console.log("--- RAG Worker: Final Prompt for TJS Pipeline ---");
                    console.log(finalPrompt);
                    console.log("--------------------------------------------------");

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
                        do_sample: answerShouldSample, // Explicitly set sampling
                        stop_sequences: (chatEngineType === 'transformers_pleias' || chatEngineType === 'transformers_pleias_1b') ? ["<|answer_end|>"] : undefined, // Stop sequence for Pleias
                        callback_function: (outputs: any[]) => {
                            // Post intermediate results for streaming effect
                            console.log("RAG Worker: callback_function (Full Pipeline) invoked:", outputs);
                            if (outputs && outputs[0] && typeof outputs[0].generated_text === 'string') {
                                console.log("RAG Worker: callback_function (Full Pipeline) sending GENERATION_UPDATE");
                                self.postMessage({ type: 'GENERATION_UPDATE', payload: { partialResult: outputs[0].generated_text } });
                            }
                        }
                    };
                    if (tjsSettings.max_new_tokens) tjsSettings.max_length = tjsSettings.max_new_tokens;
                    console.log("RAG Worker: Final settings for step-by-step Transformers.js final answer:", tjsSettings);
                    const finalAnswerOutput = await finalAnswerPipeline(finalPrompt, tjsSettings);
                    // Log raw output
                    if (Array.isArray(finalAnswerOutput) && finalAnswerOutput.length > 0 && finalAnswerOutput[0].generated_text) {
                        console.log("RAG Worker: RAW step-by-step output from Transformers.js:", finalAnswerOutput[0].generated_text);
                    }
                    if (Array.isArray(finalAnswerOutput) && finalAnswerOutput.length > 0 && finalAnswerOutput[0].generated_text) {
                        finalAnswer = finalAnswerOutput[0].generated_text.replace(finalPrompt, '').trim();
                        if (!finalAnswer && finalAnswerOutput[0].generated_text.length > 0) finalAnswer = finalAnswerOutput[0].generated_text.trim();
                    } else {
                        finalAnswer = "Transformers.js generation produced unexpected output or no text.";
                    }
                } else {
                    self.postMessage({ type: 'status', payload: { message: `Generating final answer with WebLLM...`, isError: false, isReady: false } });
                    // --- Format Context String for WebLLM ---
                    let formattedContextString = "No context provided.";
                    if (Array.isArray(context) && context.length > 0) {
                        formattedContextString = context.map((chunk: SearchResult) => chunk.text).join('\n\n');
                    }
                    // --- End Format Context String ---
                    finalAnswer = await ragManager.generateFinalAnswer(
                        originalQuery,
                        formattedContextString,
                        finalRagPromptTemplate,
                        systemPrompt,
                        temperature,
                        answerSettings
                    );
                }

                finalAnswerDuration = performance.now() - finalAnswerStart;
                const totalPipelineDuration = performance.now() - totalPipelineStart;

                tokensPerSecond = (finalAnswer && finalAnswerDuration > 0) ? (estimateTokenCount(finalAnswer) / (finalAnswerDuration / 1000)) : 0;
                totalTokens = estimateTokenCount(finalAnswer);

                self.postMessage({
                    type: 'response', payload: {
                        result: finalAnswer,
                        metrics: {
                            generationTime: finalAnswerDuration,
                            totalTokens: totalTokens,
                            tokensPerSecond: tokensPerSecond
                        }
                    }
                });
                self.postMessage({
                    type: 'performanceMetrics',
                    payload: {
                        rephraseTime: rephraseDuration,
                        contextRetrievalTime: contextDuration,
                        generationTime: finalAnswerDuration,
                        totalPipelineTime: totalPipelineDuration, // Consistent naming
                        tokensPerSecond: tokensPerSecond,
                        totalTokens: totalTokens,
                        llmEngine: chatEngineType // Include engine type
                    }
                });
                self.postMessage({ type: 'status', payload: { message: 'Full RAG pipeline complete. Ready for new query.', isError: false, isReady: true } });

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

                // <<< Log incoming rephraseSettings payload >>>
                console.log("RAG Worker (REPHRASE_QUERY): Received payload rephraseSettings:", rephraseSettings);

                if (chatEngineType.startsWith('transformers')) { // Handle both transformers and pleias types
                    if (!transformersModelId) {
                        throw new Error("Transformers.js model ID not provided for rephrasing.");
                    }
                    const pipeline = await getTransformersChatPipeline(transformersModelId, transformersOnnxFile);
                    const fullPrompt = rephrasePromptTemplate.replace("{query}", originalQuery);
                    // System prompt handling for transformers.js is tricky, often baked into the prompt or model fine-tuning
                    self.postMessage({ type: 'status', payload: { message: `Rephrasing with TJS (${transformersModelId})...`, isError: false, isReady: false } });

                    // <<< ADD LOGS HERE >>>
                    const rephrasePipelineSettings = { temperature: temperature ?? 0.3, max_new_tokens: rephraseSettings?.max_new_tokens ?? 100 }; // Use rephraseSettings for max_tokens
                    console.log("--- RAG Worker: Rephrase Prompt for TJS Pipeline ---");
                    console.log(fullPrompt);
                    console.log("--- RAG Worker: Rephrase Settings for TJS Pipeline ---");
                    console.log(rephrasePipelineSettings);
                    console.log("-----------------------------------------------------");
                    // <<< END LOGS >>>

                    const output = await pipeline(fullPrompt, rephrasePipelineSettings); // Use defined settings object
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
                const resultPayload = {
                    rephrasedQuery,
                    metrics: {
                        duration: rephraseDuration,
                        generatedTokenCount: estimateTokenCount(rephrasedQuery)
                    }
                };
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
            if (!ragManager || !webLLMService) {
                self.postMessage({ type: 'RETRIEVED_CONTEXT_RESULT', payload: { error: 'RAG system not initialized (ragManager or webLLMService is null).' } });
                return;
            }
            console.log("RAG Worker: Received RETRIEVE_CONTEXT message:", payload);
            const { queryForContext, searchAllDocuments, similarityMetric: metricForContext } = payload;
            const startTimeCtx = performance.now();
            try {
                const queryEmbedding = await webLLMService.getQueryEmbedding(queryForContext);
                if (!queryEmbedding) {
                    throw new Error("Failed to generate query embedding for context retrieval.");
                }

                const searchResults = await ragManager.retrieveContext(queryForContext, queryEmbedding, {
                    searchAllDocuments: searchAllDocuments ?? false,
                    similarityMetric: metricForContext
                });

                const endTimeCtx = performance.now();
                self.postMessage({
                    type: 'RETRIEVED_CONTEXT_RESULT',
                    payload: {
                        searchResults,
                        metrics: {
                            duration: endTimeCtx - startTimeCtx
                        }
                    }
                });
                self.postMessage({ type: 'status', payload: { message: 'Context retrieved.' } });
            } catch (error) {
                console.error("RAG Worker: Error retrieving context:", error);
                self.postMessage({
                    type: 'RETRIEVED_CONTEXT_RESULT',
                    payload: {
                        searchResults: null,
                        error: `Error retrieving context: ${(error as Error).message}`,
                        metrics: null
                    }
                });
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

                if (chatEngineType.startsWith('transformers')) { // Handle both 'transformers' and 'transformers_pleias'
                    if (!transformersModelId) {
                        throw new Error("Transformers.js model ID not provided for final answer.");
                    }
                    const pipeline = await getTransformersChatPipeline(transformersModelId, transformersOnnxFile);

                    // --- Format Context String ---
                    let formattedContextString = "No context provided.";
                    if (Array.isArray(context) && context.length > 0) {
                        if (chatEngineType === 'transformers_pleias' || chatEngineType === 'transformers_pleias_1b') {
                            // Special formatting for Pleias - Use index+1 and correct token format
                            formattedContextString = context.map((chunk: SearchResult, index: number) =>
                                // Use index+1 for ID, correct token structure, remove _start/_end for ID
                                `<|source_start|><|source_id|>${index + 1} <|source_content_start|>${chunk.text}<|source_content_end|><|source_end|>`
                            ).join('\n'); // Join with newline
                            // Append language start token after all sources
                            formattedContextString += '\n<|language_start|>';
                            console.log("RAG Worker: Formatted Pleias context string (with language_start):");
                            console.log(formattedContextString);
                        } else {
                            // Default formatting: just join text chunks (or improve later)
                            formattedContextString = context.map((chunk: SearchResult) => chunk.text).join('\n\n');
                        }
                    }
                    // --- End Format Context String ---

                    const fullPrompt = finalRagPromptTemplate
                        .replace("{context}", formattedContextString)
                        .replace("{query}", originalQuery);
                    self.postMessage({ type: 'status', payload: { message: `Generating with TJS (${transformersModelId})...`, isError: false, isReady: false } });

                    // <<< Add Log Here >>>
                    console.log("--- RAG Worker: Final Prompt for TJS Pipeline ---");
                    console.log(fullPrompt);
                    console.log("--------------------------------------------------");

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
                        do_sample: answerShouldSample, // Explicitly set sampling
                        stop_sequences: (chatEngineType === 'transformers_pleias' || chatEngineType === 'transformers_pleias_1b') ? ["<|answer_end|>"] : undefined, // Stop sequence for Pleias
                        callback_function: (outputs: any[]) => {
                            // Post intermediate results for streaming effect
                            console.log("RAG Worker: callback_function (Full Pipeline) invoked:", outputs);
                            if (outputs && outputs[0] && typeof outputs[0].generated_text === 'string') {
                                console.log("RAG Worker: callback_function (Full Pipeline) sending GENERATION_UPDATE");
                                self.postMessage({ type: 'GENERATION_UPDATE', payload: { partialResult: outputs[0].generated_text } });
                            }
                        }
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
                    // --- Format Context String for WebLLM ---
                    let formattedContextString = "No context provided.";
                    if (Array.isArray(context) && context.length > 0) {
                        formattedContextString = context.map((chunk: SearchResult) => chunk.text).join('\n\n');
                    }
                    // --- End Format Context String ---
                    finalAnswer = await ragManager.generateFinalAnswer(
                        originalQuery,
                        formattedContextString,
                        finalRagPromptTemplate,
                        systemPrompt,
                        temperature,
                        answerSettings
                    );
                }

                const finalAnswerDuration = performance.now() - finalAnswerStart;
                self.postMessage({
                    type: 'FINAL_ANSWER_RESULT',
                    payload: {
                        finalAnswer,
                        metrics: {
                            duration: finalAnswerDuration,
                            generatedTokenCount: estimateTokenCount(finalAnswer)
                        }
                    }
                });
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

        case 'SIMILARITY_TEST_REQUEST':
            console.log("Worker: Received SIMILARITY_TEST_REQUEST", payload);
            if (payload && typeof payload.similarityMetric === 'string') {
                performSimilarityValidation(payload.similarityMetric);
            } else {
                console.error("Worker: SIMILARITY_TEST_REQUEST missing or invalid similarityMetric in payload.");
                self.postMessage({ type: 'SIMILARITY_TEST_ERROR', payload: 'Invalid similarityMetric in request.' });
            }
            break;

        case 'CLEAR_CACHE':
            console.log("RAG Worker: Clear cache request processed.");
            break;

        case 'bm25Search':
            try {
                if (!payload || typeof payload.query !== 'string') {
                    throw new Error("Missing or invalid query in bm25Search payload.");
                }
                if (totalDocsBM25 === 0 || allDocsForBM25.length === 0) {
                    console.warn("RAG Worker: BM25 data not ready or empty. Returning no results.");
                    self.postMessage({ type: 'BM25_SEARCH_RESULTS', payload: { results: [], metrics: { duration: 0 } } });
                    return;
                }

                const { query, k1 = K1_DEFAULT, b = B_DEFAULT, topN = 10 } = payload;
                const startTime = performance.now();
                self.postMessage({ type: 'status', payload: { message: `Performing BM25 search for: "${query}"...`, isError: false, isReady: false } });

                const queryTokens = tokenizeText(query);
                const rankedResults: SearchResult[] = [];

                for (const doc of allDocsForBM25) {
                    const currentDocLength = docLengths.get(doc.id) || 0;
                    if (currentDocLength === 0 && doc.text.length > 0) {
                        // Fallback if docLength wasn't precomputed for some reason, though it should be
                        // This is less efficient as it tokenizes twice if this path is hit often
                        // console.warn(`BM25: Doc length for ${doc.id} was 0, re-tokenizing. This should not happen frequently.`);
                        // currentDocLength = tokenizeText(doc.text).length;
                    }

                    const score = calculateBM25Score(
                        queryTokens,
                        doc,
                        currentDocLength,
                        avgDocLengthBM25,
                        totalDocsBM25,
                        docFrequencies,
                        k1,
                        b
                    );

                    if (score > 0) { // Only consider documents with a positive score
                        rankedResults.push({
                            id: doc.id,
                            text: doc.text, // Or a snippet
                            score: score,
                            metadata: { name: doc.title, ...doc } // Include title and other prepped fields
                        });
                    }
                }

                rankedResults.sort((a, b) => b.score - a.score); // Sort descending by score
                const finalResults = rankedResults.slice(0, topN);
                const duration = performance.now() - startTime;

                self.postMessage({ type: 'BM25_SEARCH_RESULTS', payload: { results: finalResults, metrics: { duration } } });
                self.postMessage({ type: 'status', payload: { message: `BM25 search complete. Found ${finalResults.length} results.`, isError: false, isReady: true } });

            } catch (error) {
                console.error("RAG Worker: Error in bm25Search:", error);
                self.postMessage({ type: 'BM25_SEARCH_RESULTS', payload: { results: [], error: (error as Error).message, metrics: { duration: 0 } } });
                self.postMessage({ type: 'status', payload: { message: `Error in BM25 search: ${(error as Error).message}`, isError: true, isReady: true } });
            }
            break;

        case 'hybridSearch':
            if (!ragManager || !webLLMService) {
                self.postMessage({ type: 'HYBRID_SEARCH_RESULTS', payload: { error: 'RAG system not fully initialized (ragManager or webLLMService missing).' } });
                return;
            }
            if (!payload || typeof payload.query !== 'string') {
                self.postMessage({ type: 'HYBRID_SEARCH_RESULTS', payload: { error: 'Missing or invalid query in hybridSearch payload.' } });
                return;
            }
            if (totalDocsBM25 === 0 || allDocsForBM25.length === 0) {
                console.warn("RAG Worker: BM25 data not ready for hybrid search. Keyword component will be empty.");
                // Proceeding, but BM25 results will be empty.
            }

            const {
                query,
                // BM25 params
                k1 = K1_DEFAULT,
                b = B_DEFAULT,
                // RRF param
                k_rrf = K_RRF_DEFAULT,
                // Semantic search params (from existing 'query' or 'RETRIEVE_CONTEXT' payloads)
                similarityMetric: metricForHybrid = 'cosine', // Default or from payload
                // topN for final fused results
                topN = 10
            } = payload;

            const hybridSearchStartTime = performance.now();
            self.postMessage({ type: 'status', payload: { message: `Performing Hybrid Search for: "${query}"...`, isError: false, isReady: false } });

            try {
                let semanticResults: SearchResult[] = []; // Declare with wider scope and initialize
                // 1. Perform Semantic Search using RAGManager (which handles embedding)
                const semanticSearchStartTime = performance.now();
                const queryEmbedding = await webLLMService.getQueryEmbedding(query);
                if (!queryEmbedding) {
                    console.error("HybridSearch: Failed to generate query embedding for semantic part.");
                    // semanticResults remains empty, RRF will handle it.
                } else {
                    // Use original query for semantic retrieval part
                    semanticResults = await ragManager.retrieveContext( // Assign to the wider-scoped variable
                        query,
                        queryEmbedding,
                        { similarityMetric: metricForHybrid }
                    );
                }
                const semanticSearchTime = performance.now() - semanticSearchStartTime;
                // Post semantic results for pipeline view (optional, but good for UI update)
                self.postMessage({ type: 'hybrid_search_semantic_results_for_pipeline', payload: { results: semanticResults } });


                // 2. Perform BM25 Search
                const bm25SearchStart = performance.now();
                const queryTokensBM25 = tokenizeText(query);
                let bm25Results: SearchResult[] = [];

                if (totalDocsBM25 > 0) {
                    for (const doc of allDocsForBM25) {
                        const currentDocLength = docLengths.get(doc.id) || 0;
                        const score = calculateBM25Score(
                            queryTokensBM25,
                            doc,
                            currentDocLength,
                            avgDocLengthBM25,
                            totalDocsBM25,
                            docFrequencies,
                            k1,
                            b
                        );
                        if (score > 0) {
                            bm25Results.push({
                                id: doc.id,
                                text: doc.text,
                                score: score,
                                metadata: { name: doc.title, ...doc }
                            });
                        }
                    }
                    bm25Results.sort((a, b) => b.score - a.score);
                }
                const bm25SearchDuration = performance.now() - bm25SearchStart;
                self.postMessage({ type: 'hybrid_search_bm25_results_for_pipeline', payload: { results: bm25Results } });

                // 3. Fuse Results using RRF
                const fusionStartTime = performance.now();
                const fusedResults = reciprocalRankFusion([semanticResults, bm25Results], k_rrf);
                const fusionDuration = performance.now() - fusionStartTime;

                const finalContextResults = fusedResults.slice(0, topN);
                // Post intermediate fused retrieval results (optional, good for debugging)
                self.postMessage({
                    type: 'HYBRID_SEARCH_RESULTS', // This can be used to display retrieved/fused docs
                    payload: {
                        results: finalContextResults,
                        metrics: { semanticSearchTime, bm25SearchDuration, fusionDuration }
                    }
                });

                // --- 4. Generate Final Answer using Fused Context (if templates/engine provided) ---
                let finalAnswer: string | null = "Hybrid search retrieval complete. Generative step not run or no templates provided.";
                let finalAnswerDuration = 0;
                const generativeStepStart = performance.now();
                let currentTokensPerSecond = 0;
                let currentTotalTokens = 0;

                const {
                    systemPrompt,
                    rephrasePromptTemplate, // May not be used if query is already good
                    finalRagPromptTemplate,
                    chatEngineType,
                    transformersModelId,
                    transformersOnnxFile,
                    rephraseSettings, // May not be used
                    answerSettings
                } = payload; // These are passed in the hybridSearch payload

                if (finalRagPromptTemplate && chatEngineType) {
                    self.postMessage({ type: 'status', payload: { message: `Hybrid: Generating final answer with ${chatEngineType}...`, isError: false, isReady: false } });

                    let contextForGeneration = "No context provided from hybrid search.";
                    if (finalContextResults.length > 0) {
                        // Format context similar to how full RAG pipeline does
                        if (chatEngineType === 'transformers_pleias' || chatEngineType === 'transformers_pleias_1b') {
                            contextForGeneration = finalContextResults.map((chunk: SearchResult, index: number) =>
                                `<|source_start|><|source_id|>${index + 1} <|source_content_start|>${chunk.text}<|source_content_end|><|source_end|>`
                            ).join('\n');
                            contextForGeneration += '\n<|language_start|>';
                        } else {
                            contextForGeneration = finalContextResults.map((chunk: SearchResult) => chunk.text).join('\n\n---\n\n');
                        }
                    }

                    if (chatEngineType.startsWith('transformers')) {
                        if (!transformersModelId) throw new Error("Transformers.js model ID not provided for Hybrid Search generation.");
                        const genPipeline = await getTransformersChatPipeline(transformersModelId, transformersOnnxFile);
                        const genPrompt = finalRagPromptTemplate
                            .replace("{context}", contextForGeneration)
                            .replace("{query}", query); // Use original query for final question

                        const tjsGenSettings: any = {
                            temperature: answerSettings?.temperature ?? 0.7,
                            top_p: answerSettings?.top_p,
                            top_k: answerSettings?.top_k,
                            max_new_tokens: answerSettings?.max_new_tokens ?? 500,
                            do_sample: (answerSettings?.temperature ?? 0) > 0 || (answerSettings?.top_k ?? 0) > 1 || ((answerSettings?.top_p ?? 1.0) < 1.0),
                            stop_sequences: (chatEngineType === 'transformers_pleias' || chatEngineType === 'transformers_pleias_1b') ? ["<|answer_end|>"] : undefined,
                            callback_function: (outputs: any[]) => {
                                if (outputs && outputs[0] && typeof outputs[0].generated_text === 'string') {
                                    self.postMessage({ type: 'GENERATION_UPDATE', payload: { partialResult: outputs[0].generated_text } });
                                }
                            }
                        };
                        const genOutput = await genPipeline(genPrompt, tjsGenSettings);
                        if (Array.isArray(genOutput) && genOutput.length > 0 && genOutput[0].generated_text) {
                            finalAnswer = genOutput[0].generated_text.replace(genPrompt, '').trim();
                            if (!finalAnswer && genOutput[0].generated_text.length > 0) finalAnswer = genOutput[0].generated_text.trim();
                        } else {
                            finalAnswer = "Hybrid/TJS generation produced no text.";
                        }
                    } else { // webllm
                        if (!ragManager) throw new Error("RAGManager not initialized for Hybrid/WebLLM generation.");
                        finalAnswer = await ragManager.generateFinalAnswer(
                            query, // Original query
                            contextForGeneration,
                            finalRagPromptTemplate,
                            systemPrompt,
                            answerSettings?.temperature,
                            answerSettings
                        );
                    }
                    finalAnswerDuration = performance.now() - generativeStepStart;
                    currentTotalTokens = estimateTokenCount(finalAnswer);
                    if (finalAnswerDuration > 0) {
                        currentTokensPerSecond = currentTotalTokens / (finalAnswerDuration / 1000);
                    }
                } // End if (finalRagPromptTemplate && chatEngineType)

                const totalHybridSearchDuration = performance.now() - hybridSearchStartTime;

                // Post the final generative answer using the 'response' message type
                self.postMessage({
                    type: 'response', // This is for the main answer display
                    payload: {
                        result: finalAnswer,
                        metrics: {
                            generationTime: finalAnswerDuration,
                            totalTokens: currentTotalTokens,
                            tokensPerSecond: currentTokensPerSecond
                        }
                    }
                });

                // Send performance metrics AFTER the main response, especially if generation occurred
                if (finalRagPromptTemplate && chatEngineType) {
                    self.postMessage({
                        type: 'performanceMetrics',
                        payload: {
                            rephraseTime: 0, // Hybrid search in this worker doesn't have a separate rephrase step for the main query
                            contextRetrievalTime: semanticSearchTime, // Time for the semantic part of hybrid retrieval
                            bm25Time: bm25SearchDuration, // Use the correct variable name
                            fusionTime: fusionDuration,   // Use the correct variable name
                            generationTime: finalAnswerDuration, // This is the generation time
                            totalHybridTime: totalHybridSearchDuration,
                            tokensPerSecond: currentTokensPerSecond,
                            totalTokens: currentTotalTokens,
                            llmEngine: chatEngineType // Pass the engine type
                        }
                    });
                } else {
                    // If no generative step, send retrieval/fusion metrics only
                    self.postMessage({
                        type: 'performanceMetrics',
                        payload: {
                            rephraseTime: 0,
                            contextRetrievalTime: semanticSearchTime,
                            bm25Time: bm25SearchDuration,
                            fusionTime: fusionDuration,
                            generationTime: 0,
                            totalHybridTime: totalHybridSearchDuration,
                            tokensPerSecond: 0,
                            totalTokens: 0,
                            llmEngine: 'N/A (Retrieval Only)'
                        }
                    });
                }


                self.postMessage({ type: 'status', payload: { message: `Hybrid search (incl. generation if run) complete. Found ${finalContextResults.length} context docs.`, isError: false, isReady: true } });

            } catch (error) {
                console.error("RAG Worker: Error in hybridSearch:", error);
                const totalHybridSearchDuration = performance.now() - hybridSearchStartTime;
                self.postMessage({
                    type: 'HYBRID_SEARCH_RESULTS',
                    payload: {
                        results: [],
                        error: (error as Error).message,
                        metrics: { totalHybridTime: totalHybridSearchDuration }
                    }
                });
                self.postMessage({ type: 'status', payload: { message: `Error in Hybrid search: ${(error as Error).message}`, isError: true, isReady: true } });
            }
            break;

        case 'DEDICATED_BM25_TEST_REQUEST':
            console.log("RAG Worker: Received DEDICATED_BM25_TEST_REQUEST message:", payload);
            const { query: dedicatedQuery, k1: dedicatedK1, b: dedicatedB, topN: dedicatedTopN } = payload;
            if (!allDocsForBM25 || allDocsForBM25.length === 0) {
                self.postMessage({ type: 'DEDICATED_BM25_TEST_RESULTS', payload: { error: 'BM25 data not precomputed or empty.' } });
                return;
            }
            try {
                const startTime = performance.now();
                const queryTokens = tokenizeText(dedicatedQuery);
                const scores: { doc: { id: string, text: string, title?: string }, score: number }[] = [];

                for (const doc of allDocsForBM25) {
                    const docId = doc.id;
                    const docLength = docLengths.get(docId) || 0;
                    const score = calculateBM25Score(
                        queryTokens,
                        doc,
                        docLength,
                        avgDocLengthBM25,
                        totalDocsBM25,
                        docFrequencies,
                        dedicatedK1,
                        dedicatedB
                    );
                    if (score > 0) { // Only consider documents with a positive score
                        scores.push({ doc, score });
                    }
                }

                scores.sort((a, b) => b.score - a.score); // Sort by score descending
                const topResults = scores.slice(0, dedicatedTopN).map(s => ({ ...s.doc, score: s.score, text: s.doc.text.substring(0, 500) + (s.doc.text.length > 500 ? '...' : '') })); // Include text snippet
                const duration = performance.now() - startTime;

                self.postMessage({
                    type: 'DEDICATED_BM25_TEST_RESULTS',
                    payload: {
                        results: topResults,
                        metrics: { duration, numResults: topResults.length, originalNumScores: scores.length }
                    }
                });
            } catch (error: any) {
                console.error("RAG Worker: Error during dedicated BM25 test:", error);
                self.postMessage({ type: 'DEDICATED_BM25_TEST_RESULTS', payload: { error: error.message || 'Unknown error during dedicated BM25 test.' } });
            }
            break;

        default:
            console.warn("RAG Worker: Unknown message type received:", type);
            self.postMessage({ type: 'error', payload: { message: `Unknown command: ${type}` } });
    }
};

console.log("RAG Worker: Event listener attached.");
self.postMessage({ type: 'status', payload: { message: 'Worker script loaded. Ready for initialization command.', isError: false, isReady: false } });

// Helper function to get embeddings using the active Transformers.js pipeline
async function getTransformersEmbedding(text: string, pipelineInstance: any): Promise<Float32Array | null> {
    if (!pipelineInstance) {
        console.error("Worker: Transformers.js pipeline instance (for feature extraction) not available for embedding.");
        return null;
    }
    try {
        const output = await pipelineInstance(text, { pooling: 'mean', normalize: true });
        if (output && output.data instanceof Float32Array) {
            return output.data;
        }
        console.error("Worker: Unexpected output structure from feature-extraction pipeline:", output);
        return null;
    } catch (error) {
        console.error("Worker: Error getting embedding from feature-extraction pipeline:", error);
        return null;
    }
}

async function performSimilarityValidation(similarityMetric: string) {
    // Check if webLLMService is instantiated and the dedicated similarityValidationFeatureExtractor is available.
    if (!webLLMService || !similarityValidationFeatureExtractor) {
        console.error("Worker: Services not initialized for similarity validation (WebLLMService or similarityValidationFeatureExtractor missing).");
        self.postMessage({ type: 'SIMILARITY_TEST_ERROR', payload: 'Core services not ready for similarity validation.' });
        return;
    }

    const textPairs = [
        { id: "pair1", text1: "The quick brown fox jumps over the lazy dog.", text2: "A fast, dark-colored fox leaps above a sleepy canine." },
        { id: "pair2", text1: "California is a state in the western USA.", text2: "The Golden State is known for its beaches and Hollywood." },
        { id: "pair3", text1: "Educational policies are complex.", text2: "Quantum physics is complicated." },
        { id: "pair4", text1: "San Ramon Valley Unified School District", text2: "SRVUSD" },
        { id: "pair5", text1: "What is the location of SRVUSD?", text2: "Where is San Ramon Valley Unified School District located?" }
    ];

    const results = [];
    try {
        for (const pair of textPairs) {
            let webLLMScore: number | string = 'N/A';
            try {
                const emb1_webllm = await webLLMService.getQueryEmbedding(pair.text1);
                const emb2_webllm = await webLLMService.getQueryEmbedding(pair.text2);
                if (emb1_webllm && emb2_webllm) {
                    webLLMScore = calculateSimilarity(emb1_webllm, emb2_webllm, similarityMetric).toFixed(6);
                } else {
                    webLLMScore = "Embedding failed";
                }
            } catch (e: any) {
                webLLMScore = `Error: ${e.message}`;
                console.error(`Error during WebLLM embedding for pair ${pair.id}:`, e);
            }

            let transformersScore: number | string = 'N/A';
            try {
                // Use the dedicated feature extractor pipeline
                const emb1_tfjs = await getTransformersEmbedding(pair.text1, similarityValidationFeatureExtractor);
                const emb2_tfjs = await getTransformersEmbedding(pair.text2, similarityValidationFeatureExtractor);
                if (emb1_tfjs && emb2_tfjs) {
                    transformersScore = calculateSimilarity(emb1_tfjs, emb2_tfjs, similarityMetric).toFixed(6);
                } else {
                    transformersScore = "Embedding failed";
                }
            } catch (e: any) {
                transformersScore = `Error: ${e.message}`;
                console.error(`Error during Transformers.js embedding for pair ${pair.id}:`, e);
            }

            results.push({
                pair: `${pair.text1.substring(0, 30)}... vs ${pair.text2.substring(0, 30)}...`,
                webLLMScore,
                transformersScore,
                details: `Metric: ${similarityMetric}`
            });
        }
        self.postMessage({ type: 'SIMILARITY_TEST_RESULTS', payload: { results, metricUsed: similarityMetric } });
    } catch (error: any) {
        console.error("Worker: Error during similarity validation process:", error);
        self.postMessage({ type: 'SIMILARITY_TEST_ERROR', payload: error.message });
    }
}