import { MLCEngine, type MLCEngineConfig, type ChatOptions, CreateMLCEngine, type InitProgressReport, ModelType, type ModelRecord } from '@mlc-ai/web-llm';
import { WEBLLM_CHAT_MODEL_ID, WEBLLM_EMBEDDING_MODEL_ID } from '../siteConfig.ts';

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
        console.log(`WebLLMService: Initializing embedding engine with actual model ID: ${this.embeddingModelId}...`);
        try {
            let modelRecord: ModelRecord; // Ensure ModelRecord is a recognized type

            if (this.embeddingModelId.startsWith("Snowflake/")) {
                console.log(`Configuring ONNX/Transformers.js embedding model (e.g., Snowflake): ${this.embeddingModelId}`);
                modelRecord = {
                    model_id: this.embeddingModelId, // "Snowflake/snowflake-arctic-embed-xs"
                    model: `https://huggingface.co/${this.embeddingModelId}/resolve/main/`, // Full base URL
                    model_lib: "ort.wasm", // Revert to "ort.wasm" as model_lib cannot be empty and must be a string
                    model_type: ModelType.embedding,
                };
            } else {
                // Default to original logic for MLC-provided/named models
                console.log(`Configuring MLC-style embedding model: ${this.embeddingModelId}`);
                // Determine the base name, removing potential HuggingFace org prefix
                const modelBaseName = this.embeddingModelId.includes('/') ? this.embeddingModelId.split('/')[1] : this.embeddingModelId;
                // Ensure the -MLC suffix is present for constructing the mlc-ai path
                const mlcModelName = modelBaseName.endsWith("-MLC") ? modelBaseName : `${modelBaseName}-MLC`;

                const modelUrlBase = `https://huggingface.co/mlc-ai/${mlcModelName}/resolve/main/`;
                // For MLC models, model_lib is typically <mlcModelName>-webllm.wasm
                const modelLibWasm = `${mlcModelName}-webllm.wasm`;

                console.log(`  Using model URL base: ${modelUrlBase}`);
                console.log(`  Using model lib WASM: ${modelLibWasm}`);

                modelRecord = {
                    model_id: this.embeddingModelId, // This ID is used to select the model from the list
                    model: modelUrlBase,             // Path to the directory containing model files and model_lib
                    model_lib: modelLibWasm,         // Filename of the WASM, relative to modelUrlBase
                    model_type: ModelType.embedding,
                };
            }

            const appConfigForEngine = {
                model_list: [modelRecord],
                // Explicitly declare "ort.wasm" as a known model library for WebLLM
                // This helps WebLLM use it for models that specify it, without defaulting to MLC-specific lib naming
                model_libs: this.embeddingModelId.startsWith("Snowflake/") ? ["ort.wasm"] : undefined,
            };

            const engineConfig: MLCEngineConfig = {
                ...(config || {}),
                initProgressCallback: this.initProgressCallback,
                appConfig: appConfigForEngine,
            };

            this.embeddingEngine = await CreateMLCEngine(
                this.embeddingModelId, // This should match modelRecord.model_id
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