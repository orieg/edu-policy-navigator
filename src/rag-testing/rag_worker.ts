import WebLLMService from '../lib/WebLLMService.ts';
import { loadAllRAGData } from '../lib/dataLoader.ts';
import { ClusteredSearchService } from '../lib/clusteredSearchService.ts';
import { RAGManager } from '../lib/ragManager.ts';

console.log("RAG Worker: Script loaded. All services imported.");

let ragManager: RAGManager | null = null;
let webLLMService: WebLLMService | null = null;

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
            if (!ragManager || !webLLMService) { // Ensure webLLMService is also checked
                self.postMessage({ type: 'response', payload: { error: 'RAG system not initialized.' } });
                return;
            }
            if (!payload || !payload.query) {
                self.postMessage({ type: 'response', payload: { error: 'No query provided.' } });
                return;
            }
            try {
                self.postMessage({ type: 'status', payload: { message: 'Processing query...', isError: false, isReady: true } });
                const response = await ragManager.getRagResponse(payload.query, payload.chatOptions || {});
                self.postMessage({ type: 'response', payload: { result: response } });
                self.postMessage({ type: 'status', payload: { message: 'Ready for new query.', isError: false, isReady: true } });
            } catch (error) {
                console.error("RAG Worker: Error processing query:", error);
                self.postMessage({ type: 'response', payload: { error: `Error processing query: ${(error as Error).message}` } });
                self.postMessage({ type: 'status', payload: { message: 'Error processing query. Ready for new query.', isError: true, isReady: true } });
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