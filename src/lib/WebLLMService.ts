import { MLCEngine, type MLCEngineConfig, type ChatOptions, CreateMLCEngine, type InitProgressReport, ModelType } from '@mlc-ai/web-llm';
import { WEBLLM_CHAT_MODEL_ID, WEBLLM_EMBEDDING_MODEL_ID } from '../siteConfig';

class WebLLMService {
    private chatEngine: MLCEngine | null = null;
    private embeddingEngine: MLCEngine | null = null;

    private chatModelId: string = WEBLLM_CHAT_MODEL_ID;
    private embeddingModelId: string = WEBLLM_EMBEDDING_MODEL_ID;

    private initProgressCallback?: (report: InitProgressReport) => void;

    constructor(initProgressCallback?: (report: InitProgressReport) => void) {
        this.initProgressCallback = initProgressCallback;
        console.log("WebLLMService: Instance created.");
    }

    public async initializeEmbeddingEngine(config?: Omit<MLCEngineConfig, 'appConfig'>): Promise<void> {
        if (this.embeddingEngine) {
            console.log("WebLLMService: Embedding engine already initialized.");
            return;
        }
        console.log(`WebLLMService: Initializing embedding engine with model: ${this.embeddingModelId}...`);
        try {
            const embeddingModelRecord = {
                model_id: this.embeddingModelId,
                model: this.embeddingModelId, // For pre-built MLC models, use the ID directly
                model_lib: `${this.embeddingModelId.includes('/') ? this.embeddingModelId.split('/').pop() : this.embeddingModelId}-webllm`,
                model_type: ModelType.embedding // Use ModelType.embedding
            };

            const appConfigForEngine = {
                model_list: [embeddingModelRecord]
            };

            const engineConfig: MLCEngineConfig = {
                ...(config || {}),
                initProgressCallback: this.initProgressCallback,
                appConfig: appConfigForEngine
            };

            this.embeddingEngine = await CreateMLCEngine(
                this.embeddingModelId, // Specifies which model from the list to load
                engineConfig
            );
            console.log("WebLLMService: Embedding engine initialized successfully.");
        } catch (error) {
            console.error("WebLLMService: Error initializing embedding engine:", error);
            this.embeddingEngine = null;
            throw error;
        }
    }

    public async initializeChatEngine(config?: Omit<MLCEngineConfig, 'appConfig'>): Promise<void> {
        if (this.chatEngine) {
            console.log("WebLLMService: Chat engine already initialized.");
            return;
        }
        console.log(`WebLLMService: Initializing chat engine with model: ${this.chatModelId}...`);
        try {
            const chatModelRecord = {
                model_id: this.chatModelId,
                model: this.chatModelId, // For prebuilt/known MLC models
                model_lib: `${this.chatModelId}-webllm` // e.g., SmolLM2-135M-Instruct-q0f16-MLC-webllm
            };

            const appConfigForEngine = {
                model_list: [chatModelRecord]
            };

            const engineConfig: MLCEngineConfig = {
                ...(config || {}),
                initProgressCallback: this.initProgressCallback,
                appConfig: appConfigForEngine
            };

            this.chatEngine = await CreateMLCEngine(
                this.chatModelId, // Specifies which model from the list to load
                engineConfig
            );
            console.log("WebLLMService: Chat engine initialized successfully.");
        } catch (error) {
            console.error("WebLLMService: Error initializing chat engine:", error);
            this.chatEngine = null;
            throw error;
        }
    }

    public async getQueryEmbedding(text: string): Promise<Float32Array | null> {
        if (!this.embeddingEngine) {
            console.error("WebLLMService: Embedding engine not initialized. Call initializeEmbeddingEngine() first.");
            return null;
        }
        try {
            // console.log(`WebLLMService: Generating embedding for text (start): "${text.substring(0, 100)}..."`);
            const embeddingResponse = await this.embeddingEngine.embeddings.create({
                input: text,
            });
            let rawEmbedding: Float32Array | undefined;
            if (embeddingResponse && embeddingResponse.data && embeddingResponse.data.length > 0 && embeddingResponse.data[0].embedding) {
                if (embeddingResponse.data[0].embedding instanceof Float32Array) {
                    rawEmbedding = embeddingResponse.data[0].embedding;
                } else if (Array.isArray(embeddingResponse.data[0].embedding)) {
                    rawEmbedding = new Float32Array(embeddingResponse.data[0].embedding);
                } else {
                    console.error("WebLLMService: Unexpected embedding format.", embeddingResponse.data[0]);
                    return null;
                }
            } else {
                console.error("WebLLMService: Could not find embedding in response.", embeddingResponse);
                return null;
            }
            if (!rawEmbedding) return null;
            return this.normalizeL2(rawEmbedding);
        } catch (error) {
            console.error("WebLLMService: Error generating query embedding:", error);
            return null;
        }
    }

    public async getChatCompletion(
        messages: Array<{ role: "system" | "user" | "assistant", content: string }>,
        chatOptions?: ChatOptions
    ): Promise<string | null> {
        if (!this.chatEngine) {
            console.error("WebLLMService: Chat engine not initialized. Call initializeChatEngine() first.");
            return null;
        }
        try {
            const response = await this.chatEngine.chat.completions.create({
                messages,
                ...chatOptions,
                stream: false, // Non-streaming implementation
            });
            if (response && response.choices && response.choices.length > 0 && response.choices[0].message) {
                return response.choices[0].message.content || "";
            } else {
                console.error("WebLLMService: Could not find assistant message in response.", response);
                return null;
            }
        } catch (error) {
            console.error("WebLLMService: Error generating chat completion:", error);
            return null;
        }
    }

    // Add streaming chat completion method if needed later
    // public async getChatCompletionStream(...) { ... }

    private normalizeL2(vector: Float32Array): Float32Array {
        if (!vector || vector.length === 0) return new Float32Array(0);
        let norm = 0;
        for (let i = 0; i < vector.length; i++) norm += vector[i] * vector[i];
        if (norm === 0) return new Float32Array(vector.length);
        norm = Math.sqrt(norm);
        const normalizedVector = new Float32Array(vector.length);
        for (let i = 0; i < vector.length; i++) normalizedVector[i] = vector[i] / norm;
        return normalizedVector;
    }

    public async disposeChatEngine(): Promise<void> {
        if (this.chatEngine) {
            try {
                await this.chatEngine.unload();
                this.chatEngine = null;
                console.log("WebLLMService: Chat engine disposed.");
            } catch (error) {
                console.error("WebLLMService: Error disposing chat engine:", error);
                this.chatEngine = null;
            }
        }
    }

    public async disposeEmbeddingEngine(): Promise<void> {
        if (this.embeddingEngine) {
            try {
                await this.embeddingEngine.unload();
                this.embeddingEngine = null;
                console.log("WebLLMService: Embedding engine disposed.");
            } catch (error) {
                console.error("WebLLMService: Error disposing embedding engine:", error);
                this.embeddingEngine = null;
            }
        }
    }

    public async disposeAllEngines(): Promise<void> {
        await this.disposeChatEngine();
        await this.disposeEmbeddingEngine();
    }
}

export default WebLLMService; 