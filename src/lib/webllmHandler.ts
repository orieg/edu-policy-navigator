// src/lib/webllmHandler.ts
// Basic WebLLM Handler for direct chat functionality (non-RAG)

import {
    MLCEngine,
    type ChatOptions,
    type AppConfig,
    type InitProgressReport,
    type ChatCompletion,
    type ChatCompletionChunk,
    type ChatCompletionRequestStreaming,
    type ChatCompletionRequestNonStreaming,
    CreateMLCEngine
} from "@mlc-ai/web-llm";

// Type for messages in standard chat format
export type ChatMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};

// Interface for callbacks during initialization
export interface InitializationCallbacks {
    onProgress: (report: InitProgressReport) => void;
}

// Interface for callbacks during streaming generation
interface GenerationStreamCallbacks {
    onUpdate: (delta: string, finalMessage: string | null) => void;
}

export class WebLLMHandler {
    private engine: MLCEngine | null = null;
    private selectedModelId: string | null = null;
    private isInitialized: boolean = false;
    private isInitializing: boolean = false;
    private initProgressCallback?: (report: InitProgressReport) => void;

    constructor() {
        console.log("WebLLMHandler (Chat-Only): Instance created.");
    }

    /**
     * Initializes the WebLLM engine and loads a specific model.
     * Uses CreateMLCEngine for combined instantiation and loading.
     */
    public async initialize(
        modelId: string,
        callbacks?: InitializationCallbacks,
        engineConfig?: Omit<ConstructorParameters<typeof MLCEngine>[0], 'initProgressCallback'> // Pass other engine config if needed
    ): Promise<void> {
        this.initProgressCallback = callbacks?.onProgress;

        if (this.isInitialized && this.selectedModelId === modelId) {
            console.log(`WebLLMHandler: Already initialized with model ${modelId}.`);
            return;
        }
        if (this.isInitializing) {
            console.warn(`WebLLMHandler: Initialization/Reload already in progress.`);
            throw new Error("Initialization/Reload already in progress.");
        }

        this.isInitializing = true;
        this.isInitialized = false;
        console.log(`WebLLMHandler: Initializing/Reloading model ${modelId}...`);

        try {
            // If engine exists, unload previous model first
            if (this.engine) {
                await this.engine.unload();
                this.engine = null;
            }

            console.log("WebLLMHandler: Creating and loading MLCEngine...");
            this.engine = await CreateMLCEngine(modelId, {
                ...(engineConfig || {}),
                initProgressCallback: this.initProgressCallback
            });

            this.selectedModelId = modelId;
            this.isInitialized = true;
            console.log(`WebLLMHandler: Successfully initialized/reloaded model ${modelId}.`);

        } catch (error) {
            console.error(`WebLLMHandler: Failed to initialize/reload model ${modelId}:`, error);
            this.selectedModelId = null;
            this.isInitialized = false;
            this.engine = null;
            throw new Error(`WebLLM initialization/reload failed: ${(error as Error).message}`);
        } finally {
            this.isInitializing = false;
        }
    }

    /**
     * Generates a response using the OpenAI-compatible chat completion API.
     * Supports both streaming and non-streaming modes.
     */
    public async chatCompletion(
        messages: ChatMessage[],
        stream: boolean,
        streamCallbacks?: GenerationStreamCallbacks,
        options?: Partial<ChatCompletionRequestStreaming | ChatCompletionRequestNonStreaming>
    ): Promise<string | null> {
        if (!this.isInitialized || !this.engine) {
            throw new Error("WebLLMHandler: Not initialized. Please initialize first.");
        }
        if (this.isInitializing) {
            throw new Error("WebLLMHandler: Initialization/Reload still in progress.");
        }

        // console.log(`WebLLMHandler: Generating chat completion (stream=${stream})...`);

        try {
            if (stream && streamCallbacks) {
                const requestOptions: ChatCompletionRequestStreaming = {
                    messages,
                    ...options,
                    stream: true,
                    stream_options: { include_usage: true }, // Request usage stats at the end
                };
                const chunks: AsyncIterable<ChatCompletionChunk> = await this.engine.chat.completions.create(requestOptions);

                let fullReply = "";
                for await (const chunk of chunks) {
                    const delta = chunk.choices[0]?.delta?.content || "";
                    fullReply += delta;
                    streamCallbacks.onUpdate(delta, null); // Provide delta update
                    // The last chunk might contain usage stats
                    if (chunk.usage) {
                        // console.log("WebLLMHandler: Final usage stats:", chunk.usage);
                        // Signal completion by sending final message in the callback
                        streamCallbacks.onUpdate("", fullReply);
                    }
                }
                // console.log(`WebLLMHandler: Streaming finished.`);
                return null; // Indicate streaming handled via callback
            } else {
                const requestOptions: ChatCompletionRequestNonStreaming = {
                    messages,
                    ...options,
                    stream: false,
                };
                const reply: ChatCompletion = await this.engine.chat.completions.create(requestOptions);
                const responseText = reply.choices[0]?.message?.content || "";
                // console.log(`WebLLMHandler: Non-streaming response received. Usage:`, reply.usage);
                return responseText;
            }
        } catch (error) {
            console.error("WebLLMHandler: Error during chat completion:", error);
            throw new Error(`WebLLM chat completion failed: ${(error as Error).message}`);
        }
    }

    /**
     * Disposes of the current WebLLM engine instance.
     */
    public async dispose(): Promise<void> {
        if (this.isInitializing) {
            console.warn("WebLLMHandler: Cannot dispose while initialization/reload is in progress.");
            return;
        }
        if (this.engine) {
            // console.log(`WebLLMHandler: Disposing engine (unload model ${this.selectedModelId})...`);
            try {
                await this.engine.unload();
                // console.log(`WebLLMHandler: Engine unloaded successfully.`);
            } catch (error) {
                console.error("WebLLMHandler: Error during unload:", error);
            } finally {
                this.engine = null;
                this.isInitialized = false;
                this.selectedModelId = null;
            }
        } else {
            // console.log("WebLLMHandler: Already disposed or never initialized.");
        }
    }

    public getSelectedModelId(): string | null {
        return this.selectedModelId;
    }

    public getIsInitialized(): boolean {
        return this.isInitialized;
    }
}

export default WebLLMHandler; 