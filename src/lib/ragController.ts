import type { WebLLMHandler, ChatMessage } from './webllmHandler';
import { VectorDBHandler, type EmbeddedRecord, type EmbeddingVector } from './vectorDbHandler'; // Assuming EmbeddedRecord and EmbeddingVector are exported
import { WEBLLM_CHAT_MODEL_ID } from '../siteConfig';
import { WEBLLM_EMBEDDING_MODEL_ID } from '../modelConfig.js';
import { pipeline, env, type Pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';

// Allow local models for Transformers.js (consistent with pipeline script)
env.allowLocalModels = true;
// Optional: Specify a local model path if you intend to bundle models
// env.localModelPath = '/path/to/your/models'; 

const EMBEDDED_DATA_URL = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/embeddings/embedded_data.json`; // Path to the precomputed embeddings, accounting for base URL

export class RAGController {
    private webllmHandler: WebLLMHandler;
    private vectorDbHandler: VectorDBHandler;
    private embeddingPipeline: Promise<FeatureExtractionPipeline | null> | null = null;
    private isEmbeddingPipelineReady: boolean = false;
    private isVectorDBInitializing: boolean = false;

    constructor(webllmHandler: WebLLMHandler) {
        this.webllmHandler = webllmHandler;
        this.vectorDbHandler = new VectorDBHandler();
    }

    private async _ensureEmbeddingPipeline(progressCallback: (message: string, type: 'loading' | 'error', replaceLast?: boolean) => void): Promise<FeatureExtractionPipeline | null> {
        if (this.isEmbeddingPipelineReady && this.embeddingPipeline) {
            return this.embeddingPipeline;
        }
        if (this.embeddingPipeline) { // Already initializing
            progressCallback("Embedding model is already loading...", 'loading', true);
            return this.embeddingPipeline;
        }

        progressCallback(`Loading embedding model: ${WEBLLM_EMBEDDING_MODEL_ID}...`, 'loading', true);
        this.embeddingPipeline = new Promise(async (resolve) => {
            try {
                // Ensure pipelineParams exists before trying to access feature_extraction
                // if (!env.pipelineParams) {
                //     env.pipelineParams = {};
                // }
                // env.pipelineParams.feature_extraction = { ...(env.pipelineParams.feature_extraction || {}), progress_interval: 300 }; 

                const extractor = await pipeline('feature-extraction', WEBLLM_EMBEDDING_MODEL_ID, {
                    progress_callback: (progress: any) => {
                        if (progress.status === 'progress') {
                            progressCallback(`Embedding model: ${progress.file} (${Math.round(progress.progress)}%)...`, 'loading', true);
                        } else if (progress.status === 'ready') {
                            progressCallback(`Embedding model ${progress.file} ready.`, 'loading', true);
                        }
                    }
                }) as FeatureExtractionPipeline;
                this.isEmbeddingPipelineReady = true;
                progressCallback("Embedding model loaded successfully.", 'loading', false); // New message, not replacing
                resolve(extractor);
            } catch (error) {
                console.error("Failed to load embedding model:", error);
                progressCallback(`Error loading embedding model: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error', true);
                this.embeddingPipeline = null; // Reset so it can try again
                this.isEmbeddingPipelineReady = false;
                resolve(null);
            }
        });
        return this.embeddingPipeline;
    }

    private async _getQueryEmbedding(query: string, progressCallback: (message: string, type: 'loading' | 'error', replaceLast?: boolean) => void): Promise<EmbeddingVector | null> {
        const extractor = await this._ensureEmbeddingPipeline(progressCallback);
        if (!extractor) {
            progressCallback("Embedding model is not available.", 'error');
            return null;
        }

        try {
            progressCallback("Generating embedding for your query...", 'loading', true);
            const result = await extractor(query, { pooling: 'mean', normalize: true });
            progressCallback("Query embedding generated.", 'loading', false);
            return Array.from(result.data) as EmbeddingVector;
        } catch (error) {
            console.error("Error generating query embedding:", error);
            progressCallback(`Error generating query embedding: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error', true);
            return null;
        }
    }

    private async _ensureVectorDBInitialized(progressCallback: (message: string, type: 'loading' | 'error', replaceLast?: boolean) => void): Promise<boolean> {
        if (this.vectorDbHandler.getIsReady()) {
            return true;
        }
        if (this.isVectorDBInitializing) {
            progressCallback("Vector database is already initializing...", 'loading', true);
            await new Promise(resolve => setTimeout(resolve, 500));
            return this.vectorDbHandler.getIsReady();
        }

        this.isVectorDBInitializing = true;
        progressCallback("Initializing vector database...", 'loading', true);
        try {
            await this.vectorDbHandler.initialize(EMBEDDED_DATA_URL);
            progressCallback("Vector database initialized.", 'loading', false);
            this.isVectorDBInitializing = false;
            return true;
        } catch (error) {
            console.error("Error initializing vector database:", error);
            progressCallback(`Vector DB Init Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error', true);
            this.isVectorDBInitializing = false;
            return false;
        }
    }

    public async processQuery(
        query: string,
        currentDistrictId: string, // Currently unused but kept for potential future filtering
        progressCallback: (message: string, type: 'ai' | 'system' | 'error' | 'loading', replaceLast?: boolean) => void
    ): Promise<void> {
        try {
            progressCallback("Starting RAG process (Vector Search)...", 'system');

            // 1. Initialize Vector DB (if not already)
            const dbReady = await this._ensureVectorDBInitialized(progressCallback);
            if (!dbReady) {
                progressCallback("Failed to initialize vector database. Cannot proceed.", 'error');
                return;
            }

            // 2. Query -> Embedding
            const queryVector = await this._getQueryEmbedding(query, progressCallback);
            if (!queryVector) {
                progressCallback("Failed to generate query embedding. Cannot proceed.", 'error');
                return;
            }

            // 3. Embedding -> Vector Search -> Context
            progressCallback("Searching for relevant information...", 'loading', true);
            let searchResults: EmbeddedRecord[] = [];
            try {
                // Log the query vector before sending it
                console.log('Query Vector:', queryVector);
                console.log('Query Vector Type:', typeof queryVector);
                console.log('Is Query Vector Array?:', Array.isArray(queryVector));
                if (Array.isArray(queryVector)) {
                    console.log('Query Vector Length:', queryVector.length);
                    console.log('Query Vector First Element Type:', typeof queryVector[0]);
                }

                searchResults = await this.vectorDbHandler.query(queryVector, 5) as EmbeddedRecord[]; // topK = 5
            } catch (searchError) {
                console.error("Error querying vector database:", searchError);
                progressCallback(`Vector DB Search Error: ${searchError instanceof Error ? searchError.message : 'Unknown error'}`, 'error', true);
                return;
            }

            if (searchResults.length === 0) {
                progressCallback("No directly relevant information found in the vector database. Attempting general LLM response.", 'system', true);
                // Fallback to general knowledge if no context found
                const fallbackAnswer = await this._contextToAnswer(query, "No specific context found. Please answer based on general knowledge if possible.", progressCallback);
                if (fallbackAnswer) {
                    progressCallback(fallbackAnswer, 'ai', true);
                } else {
                    progressCallback("Failed to get a response from the LLM.", 'error', true);
                }
                return;
            }

            progressCallback(`Found ${searchResults.length} relevant pieces of information. Compiling context...`, 'loading', true);
            const context = searchResults.map((r, i) => `Context snippet ${i + 1}:\nType: ${r.type}\nText: ${r.text}\nMetadata: ${JSON.stringify(r.metadata)}`).join("\n\n---\n\n");

            // 4. Context -> LLM Answer
            progressCallback("Sending information to AI for final answer...", 'loading', true);
            const answer = await this._contextToAnswer(query, context, progressCallback);
            if (!answer) {
                progressCallback("Failed to get a response from the LLM based on the context.", 'error', true);
                return;
            }
            progressCallback(answer, 'ai', true);

        } catch (error) {
            console.error("Error in RAGController processQuery:", error);
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred in the RAG process.";
            progressCallback(errorMessage, 'error', true);
        }
    }

    private async _contextToAnswer(originalQuery: string, context: string, progressCallback: (message: string, type: 'ai' | 'system' | 'error' | 'loading', replaceLast?: boolean) => void): Promise<string | null> {
        console.log(`RAGController: _contextToAnswer called with context of length: ${context.length}`);
        if (!this.webllmHandler.getIsInitialized()) {
            progressCallback("Initializing WebLLM for answer generation...", 'loading', true);
            try {
                await this.webllmHandler.initialize(
                    WEBLLM_CHAT_MODEL_ID, // Corrected to use WEBLLM_CHAT_MODEL_ID
                    {
                        onProgress: (report) => progressCallback(`WebLLM loading: ${report.text}`, 'loading', true)
                    }
                );
            } catch (initError) {
                console.error("WebLLM initialization error during answer gen:", initError);
                progressCallback(`WebLLM Init Error: ${initError instanceof Error ? initError.message : 'Unknown error'}`, 'error', true);
                return null;
            }
            if (!this.webllmHandler.getIsInitialized()) {
                progressCallback("WebLLM is not initialized and could not be started.", 'error', true);
                return null;
            }
        }

        // Improved prompt structure
        const systemPrompt =
            `You are an AI assistant for the Multi-District Policy Navigator. Your task is to answer questions about California school districts and schools based ONLY on the provided context. If the context does not contain the answer, say "I do not have enough information from the provided context to answer that." Do not use external knowledge. Be concise and directly answer the question.

Question: "${originalQuery}"

Provided Context:
${context}

Answer (based ONLY on the context):
`;

        progressCallback("AI is generating an answer...", 'loading', true);

        try {
            const messages: ChatMessage[] = [{ role: "user", content: systemPrompt }];
            const answer = await this.webllmHandler.chatCompletion(messages, false);
            if (!answer) {
                progressCallback("LLM returned an empty answer.", 'error', true);
                return null;
            }
            return answer;
        } catch (error) {
            console.error("Error generating answer with WebLLM:", error);
            const finalErrorMessage = `Error generating answer: ${error instanceof Error ? error.message : "Unknown LLM error"}`;
            progressCallback(finalErrorMessage, 'error', true);
            return null;
        }
    }
} 