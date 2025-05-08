console.log("RAG Worker: Script loaded.");

import WebLLMService from '@/lib/WebLLMService';
import { loadAllRAGData } from '@/lib/dataLoader';
import { ClusteredSearchService } from '@/lib/clusteredSearchService';
import { RAGManager } from '@/lib/ragManager';

let ragManager: RAGManager | null = null;
let webLLMService: WebLLMService | null = null;

// Path is relative to the worker script's location after it's processed by Vite/Astro.
// Vite will typically place assets from public/ into the root of the build output.
// So, if manifest.json is at `public/embeddings/school_districts/manifest.json`,
// it will be available at `/embeddings/school_districts/manifest.json` relative to the domain.
// For a worker in `src/`, `import.meta.url` gives its own URL. We need to construct the path
// relative to the server root, or ensure the file is copied to be relative to the worker output.
// Simpler: Astro/Vite often makes `public` dir contents available at the root.
const MANIFEST_URL = '/embeddings/school_districts/manifest.json';

/**
 * Handles messages received from the main thread.
 */
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
                // Initialize engines (can take time, especially first time downloading models)
                // We might want to do these sequentially to show progress for each
                await webLLMService.initializeEmbeddingEngine(); // Using default config for now
                self.postMessage({ type: 'progress', payload: { message: 'Embedding engine initialized. Initializing chat engine...', loaded: 33, total: 100 } });
                await webLLMService.initializeChatEngine();    // Using default config for now
                self.postMessage({ type: 'progress', payload: { message: 'Chat engine initialized. Loading RAG data...', loaded: 66, total: 100 } });

                const dataLoaderProgress = (progress: { message: string, loaded: number, total: number }) => {
                    // Scale data loader progress to the remaining 1/3 of the overall init progress
                    const overallLoaded = 66 + Math.floor((progress.loaded / progress.total) * 34);
                    self.postMessage({ type: 'progress', payload: { message: `Loading data: ${progress.message}`, loaded: overallLoaded, total: 100 } });
                };

                // Construct the full URL for the manifest if MANIFEST_URL is relative to public root
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
                    // Can add RAG parameters here if needed, e.g.:
                    // topMClusters: 3,
                    // topKDocsPerCluster: 5,
                    // finalTopNDocs: 5
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
            if (!ragManager) {
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

        case 'dispose': // Add a dispose message handler
            if (webLLMService) {
                try {
                    self.postMessage({ type: 'status', payload: { message: 'Disposing WebLLM engines...', isError: false, isReady: false } });
                    await webLLMService.disposeAllEngines();
                    webLLMService = null;
                    ragManager = null; // RAGManager depends on WebLLMService
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

// Signal that the worker is ready to receive messages (or at least loaded)
console.log("RAG Worker: Event listener attached.");
self.postMessage({ type: 'status', payload: { message: 'Worker script loaded. Ready for initialization command.', isError: false, isReady: false } }); 