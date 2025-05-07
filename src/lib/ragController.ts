import type { WebLLMHandler, ChatMessage, InitializationCallbacks } from './webllmHandler';
import { WEBLLM_CHAT_MODEL_ID as MODEL_ID } from '../siteConfig';

export class RAGController {
    private webllmHandler: WebLLMHandler;

    constructor(webllmHandler: WebLLMHandler) {
        this.webllmHandler = webllmHandler;
    }

    public async processQuery(
        query: string,
        currentDistrictId: string, // This will likely change with Vector RAG
        progressCallback: (message: string, type: 'ai' | 'system' | 'error' | 'loading', replaceLast?: boolean) => void
    ): Promise<void> {
        try {
            progressCallback("Starting RAG process (Vector Search)...", 'system');

            // Placeholder for Vector Search RAG steps
            // 1. Query -> Embedding
            // 2. Embedding -> Vector Search -> Context
            // 3. Context -> LLM Answer

            progressCallback("Vector Search RAG steps not yet implemented.", 'system');

            // For now, let's just try to get a direct answer from LLM as a baseline
            // This is a temporary measure before full Vector RAG implementation.
            progressCallback("Attempting direct LLM response (temporary)...", 'loading');
            const answer = await this._contextToAnswer(query, "No specific context provided yet. Please answer based on general knowledge if possible.", progressCallback);
            if (!answer) {
                progressCallback("Failed to get a response from the LLM.", 'error', true);
                return;
            }
            progressCallback("LLM response received.", 'system');
            progressCallback(answer, 'ai', true);

        } catch (error) {
            console.error("Error in RAGController processQuery:", error);
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred in the RAG process.";
            progressCallback(errorMessage, 'error', true);
        }
    }

    private async _contextToAnswer(originalQuery: string, context: string, progressCallback: (message: string, type: 'ai' | 'system' | 'error' | 'loading', replaceLast?: boolean) => void): Promise<string | null> {
        // Placeholder: Implement actual answer generation using WebLLMHandler
        console.log(`RAGController: _contextToAnswer called with context of length: ${context.length}`);
        if (!this.webllmHandler.getIsInitialized()) {
            // Try to initialize if not already
            progressCallback("Initializing WebLLM for answer generation...", 'loading');
            try {
                await this.webllmHandler.initialize(
                    MODEL_ID,
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

        const systemPrompt = `Based on the following context, please answer the question: ${originalQuery}\\n\\nContext:\\n${context}\\n\\nAnswer:`;
        progressCallback("Sending prompt to LLM for answer generation...", 'loading', true);

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