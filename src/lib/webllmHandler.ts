// src/lib/webllmHandler.ts

import {
    // Corrected imports based on documentation examples
    MLCEngine, // The main engine class
    // CreateMLCEngine, // Factory function also exists, but example uses constructor + reload
    type ChatOptions,
    type AppConfig,
    type InitProgressReport,
    type ChatCompletion, // Type for non-streaming response
    type ChatCompletionChunk, // Type for streaming chunk
    type ChatCompletionRequestStreaming, // Type for streaming request
    type ChatCompletionRequestNonStreaming // Type for non-streaming request
} from "@mlc-ai/web-llm";

// Local definition based on OpenAI API structure
type ChatMessage = {
    role: "system" | "user" | "assistant";
    content: string;
};


/**
 * Interface for callbacks during initialization.
 */
interface InitializationCallbacks {
    onProgress: (report: InitProgressReport) => void;
}

/**
 * Interface for callbacks during generation (if streaming).
 * Provides the delta content from the chunk.
 */
interface GenerationStreamCallbacks {
    onUpdate: (delta: string, finalMessage: string | null) => void;
}


/**
 * Manages the WebLLM engine, model loading, and text generation.
 * Uses the OpenAI-compatible chat completion API.
 */
export class WebLLMHandler {
    private engine: MLCEngine | null = null;
    private selectedModelId: string | null = null;
    private isInitialized: boolean = false;
    private isInitializing: boolean = false;
    private initProgressCallback: ((report: InitProgressReport) => void) | undefined;
    private currentAppConfig: AppConfig | undefined;
    private currentChatOptions: ChatOptions | undefined;

    constructor() { }

    /**
     * Initializes the WebLLM engine and loads a specific model.
     */
    public async initialize(
        modelId: string,
        callbacks?: InitializationCallbacks,
        chatOpts?: ChatOptions,
        appConfig?: AppConfig,
    ): Promise<void> {
        // Store callbacks and config for potential reload later
        this.initProgressCallback = callbacks?.onProgress;
        this.currentChatOptions = chatOpts;
        this.currentAppConfig = appConfig;

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
            if (!this.engine) {
                console.log("WebLLMHandler: Creating MLCEngine instance...");
                // Pass constructor options if needed - check MLCEngine docs
                this.engine = new MLCEngine({
                    initProgressCallback: this.initProgressCallback
                });
                console.log("WebLLMHandler: MLCEngine instance created.");
            }

            // Load or reload the specified model - assumes reload takes only modelId
            console.log(`WebLLMHandler: Reloading engine with model ${modelId}...`);
            // NOTE: chatOpts and appConfig might need to be applied differently, e.g. via engine constructor or setOptions methods.
            await this.engine.reload(modelId);
            this.selectedModelId = modelId;
            this.isInitialized = true;
            console.log(`WebLLMHandler: Successfully initialized/reloaded model ${modelId}.`);

        } catch (error) {
            console.error(`WebLLMHandler: Failed to initialize/reload model ${modelId}:`, error);
            this.selectedModelId = null;
            this.isInitialized = false;
            throw new Error(`WebLLM initialization/reload failed: ${(error as Error).message}`);
        } finally {
            this.isInitializing = false;
        }
    }

    /**
     * Generates a response using the OpenAI-compatible chat completion API.
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

        console.log(`WebLLMHandler: Generating chat completion (stream=${stream})...`);

        try {
            if (stream) {
                // Explicitly define options for streaming request
                const requestOptions: ChatCompletionRequestStreaming = {
                    messages,
                    stream: true,
                    stream_options: { include_usage: true },
                    ...options
                };
                const chunks: AsyncIterable<ChatCompletionChunk> = await this.engine.chat.completions.create(requestOptions);

                let fullReply = "";
                for await (const chunk of chunks) {
                    const delta = chunk.choices[0]?.delta?.content || "";
                    fullReply += delta;
                    streamCallbacks?.onUpdate(delta, null); // Provide delta
                    if (chunk.usage) {
                        console.log("WebLLMHandler: Final usage stats:", chunk.usage);
                        streamCallbacks?.onUpdate("", fullReply); // Signal completion with final message
                    }
                }
                console.log(`WebLLMHandler: Streaming finished.`);
                return null;

            } else {
                // Explicitly define options for non-streaming request
                const requestOptions: ChatCompletionRequestNonStreaming = {
                    messages,
                    stream: false,
                    ...options
                };
                const reply: ChatCompletion = await this.engine.chat.completions.create(requestOptions);
                const responseText = reply.choices[0]?.message?.content || "";
                console.log(`WebLLMHandler: Non-streaming response received.`);
                console.log(`WebLLMHandler: Usage:`, reply.usage);
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
        if (!this.engine) {
            console.log("WebLLMHandler: Already disposed or never initialized.");
            return;
        }

        console.log(`WebLLMHandler: Disposing engine (unload model ${this.selectedModelId})...`);
        try {
            if (typeof this.engine.unload === 'function') {
                await this.engine.unload();
                console.log(`WebLLMHandler: Engine unloaded successfully.`);
            } else {
                console.warn("WebLLMHandler: engine.unload method not found. Cannot explicitly unload model.");
            }

        } catch (error) {
            console.error("WebLLMHandler: Error during unload:", error);
        } finally {
            this.engine = null;
            this.isInitialized = false;
            this.selectedModelId = null;
        }
    }

    /**
     * Gets the ID of the currently loaded model.
     */
    public getSelectedModelId(): string | null {
        return this.selectedModelId;
    }

    /**
    * Checks if the handler has successfully initialized an engine.
    */
    public getIsInitialized(): boolean {
        return this.isInitialized;
    }
} 