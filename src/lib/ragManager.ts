// src/lib/ragManager.ts

import WebLLMService from './WebLLMService.ts';
import { ClusteredSearchService } from './clusteredSearchService.ts';
import type {
    ClusterCentroidData,
    ClusterData,
    SearchResult,
    DocumentMetadata
} from '../types/vectorStore.d.ts';
import type { ChatCompletionRequest, ChatOptions } from '@mlc-ai/web-llm';

interface RAGManagerConfig {
    webLLMService: WebLLMService;
    clusteredSearchService: ClusteredSearchService;
    // Context generation parameters
    maxContextTokens?: number; // Optional: Max tokens for context to fit LLM window
    topMClusters?: number;     // Number of top clusters to search
    topKDocsPerCluster?: number; // Number of docs to retrieve from each selected cluster
    finalTopNDocs?: number;    // Final number of documents to use for context
}

export class RAGManager {
    private webLLMService: WebLLMService;
    private searchService: ClusteredSearchService;

    // Default RAG parameters (can be overridden by config)
    private MAX_CONTEXT_TOKENS: number = 1500; // Example value, adjust based on chat model
    private TOP_M_CLUSTERS: number = 3;
    private TOP_K_DOCS_PER_CLUSTER: number = 5;
    private FINAL_TOP_N_DOCS: number = 5;
    private DEFAULT_SYSTEM_PROMPT: string = "You are a helpful AI assistant. Answer the user's question based on the provided context. If the context is empty or not relevant, try to answer generally but indicate that the answer is not based on specific provided documents.";
    private DEFAULT_REPHRASE_QUERY_PROMPT_TEMPLATE: string = "Rephrase the following user query to be concise and optimized for semantic search against a document database. Focus on key entities and concepts. Output only the rephrased query and nothing else. User query: {query}";
    private DEFAULT_FINAL_RAG_PROMPT_TEMPLATE: string = "Context:\n{context}\n\nQuestion: {query}\n\nAnswer:";

    constructor(config: RAGManagerConfig) {
        if (!config.webLLMService) {
            throw new Error("RAGManager: WebLLMService instance is required.");
        }
        if (!config.clusteredSearchService) {
            throw new Error("RAGManager: ClusteredSearchService instance is required.");
        }

        this.webLLMService = config.webLLMService;
        this.searchService = config.clusteredSearchService;

        // Override defaults if provided in config
        this.MAX_CONTEXT_TOKENS = config.maxContextTokens ?? this.MAX_CONTEXT_TOKENS;
        this.TOP_M_CLUSTERS = config.topMClusters ?? this.TOP_M_CLUSTERS;
        this.TOP_K_DOCS_PER_CLUSTER = config.topKDocsPerCluster ?? this.TOP_K_DOCS_PER_CLUSTER;
        this.FINAL_TOP_N_DOCS = config.finalTopNDocs ?? this.FINAL_TOP_N_DOCS;

        console.log("RAGManager initialized with config:", {
            MAX_CONTEXT_TOKENS: this.MAX_CONTEXT_TOKENS,
            TOP_M_CLUSTERS: this.TOP_M_CLUSTERS,
            TOP_K_DOCS_PER_CLUSTER: this.TOP_K_DOCS_PER_CLUSTER,
            FINAL_TOP_N_DOCS: this.FINAL_TOP_N_DOCS
        });
    }

    // TODO: Task 3.1: Implement getQueryEmbedding (delegates to WebLLMService)
    // TODO: Task 3.2: Implement retrieveRelevantDocuments (uses ClusteredSearchService)
    // TODO: Task 3.3: Implement formatContextFromDocuments
    // TODO: Task 3.3: Implement getRagResponse (orchestrates query embedding, retrieval, context formatting, and chat completion)

    /**
     * Generates an L2-normalized embedding for the given query text.
     * @param query The user's query text.
     * @returns A Promise that resolves to the Float32Array query embedding, or null if an error occurs.
     */
    private async getQueryEmbedding(query: string): Promise<Float32Array | null> {
        console.log(`RAGManager: Generating embedding for query: "${query}"`);
        try {
            const embedding = await this.webLLMService.getQueryEmbedding(query);
            if (!embedding) {
                console.error("RAGManager: Failed to generate query embedding.");
                return null;
            }
            console.log("RAGManager: Query embedding generated successfully.");
            return embedding;
        } catch (error) {
            console.error("RAGManager: Error in getQueryEmbedding:", error);
            return null;
        }
    }

    /**
     * Retrieves relevant documents for a given query embedding using the two-stage search.
     * @param queryEmbedding The L2-normalized query embedding.
     * @returns A Promise that resolves to an array of SearchResult objects, or an empty array if an error occurs or no documents are found.
     */
    private async retrieveRelevantDocuments(queryEmbedding: Float32Array): Promise<SearchResult[]> {
        if (!queryEmbedding) {
            console.error("RAGManager: Cannot retrieve documents without a query embedding.");
            return [];
        }
        console.log("RAGManager: Retrieving relevant documents...");
        try {
            const documents = await this.searchService.search(
                queryEmbedding,
                this.TOP_M_CLUSTERS,
                this.TOP_K_DOCS_PER_CLUSTER,
                this.FINAL_TOP_N_DOCS
            );
            console.log(`RAGManager: Retrieved ${documents.length} relevant documents.`);
            return documents;
        } catch (error) {
            console.error("RAGManager: Error in retrieveRelevantDocuments:", error);
            return [];
        }
    }

    /**
     * Formats the retrieved documents into a context string for the LLM prompt.
     * Tries to stay within a rough character limit (as a proxy for tokens).
     * @param documents An array of SearchResult objects.
     * @returns A string containing the formatted context.
     */
    private formatContextFromDocuments(documents: SearchResult[]): string {
        if (!documents || documents.length === 0) {
            return "No relevant context found.";
        }

        // Rough character limit for context based on MAX_CONTEXT_TOKENS.
        // Assuming an average of 3-4 characters per token for English text.
        // This is a very rough estimate and can be improved with actual tokenization.
        const roughlyMaxChars = this.MAX_CONTEXT_TOKENS * 3.5;
        let contextString = "";
        let currentChars = 0;

        console.log(`RAGManager: Formatting context from ${documents.length} documents, roughlyMaxChars: ${roughlyMaxChars}`);

        for (const doc of documents) {
            // Simple formatting: "Source ID: [id]\nText: [text]\n---\n"
            const docString = `Source ID: ${doc.id}\nText: ${doc.text}\n---\n`;
            if (currentChars + docString.length > roughlyMaxChars && contextString.length > 0) {
                console.log(`RAGManager: Context character limit reached. Used ${currentChars} chars. Stopping context addition.`);
                break; // Stop if adding this doc exceeds the rough limit (and we already have some context)
            }
            contextString += docString;
            currentChars += docString.length;
        }
        if (contextString.length === 0 && documents.length > 0) {
            // If the very first document is too long, take a truncated piece of it.
            const firstDocText = `Source ID: ${documents[0].id}\nText: ${documents[0].text}\n---\n`;
            contextString = firstDocText.substring(0, Math.min(firstDocText.length, roughlyMaxChars - " (truncated)...\n".length)) + " (truncated)...\n";
            console.log("RAGManager: First document was too long, truncated it for context.");
        } else if (contextString.length === 0) {
            return "No relevant context could be formatted within token limits.";
        }

        console.log(`RAGManager: Formatted context string length: ${contextString.length}`);
        return contextString.trim();
    }

    // --- Public methods for step-by-step execution ---

    public async rephraseQuery(
        originalQuery: string,
        rephrasePromptTemplate?: string,
        systemPromptText?: string,
        temperature?: number
    ): Promise<string> {
        console.log("RAGManager: Rephrasing query:", originalQuery, "Temp:", temperature);
        const template = rephrasePromptTemplate || this.DEFAULT_REPHRASE_QUERY_PROMPT_TEMPLATE;

        const rephraseSystemPrompt = systemPromptText || "You are a query optimization assistant.";

        // Explicitly type messages for WebLLMService.getChatCompletion
        const messages: Array<{ role: "system" | "user" | "assistant", content: string }> = [
            { role: 'system', content: rephraseSystemPrompt },
            { role: 'user', content: template.replace("{query}", originalQuery) }
        ];

        const chatOpts: ChatOptions = { temperature: temperature ?? 0.2 };

        const rephrasedQueryText = await this.webLLMService.getChatCompletion(
            messages,
            chatOpts
        );
        console.log("RAGManager: Rephrased query text:", rephrasedQueryText);
        if (!rephrasedQueryText) {
            throw new Error("Query rephrasing failed to produce text.");
        }
        // Clean up the rephrased query: remove potential quotes, newlines etc.
        return rephrasedQueryText.trim().replace(/^"|"$/g, '');
    }

    public async retrieveContext(
        queryForContext: string
    ): Promise<string | null> { // Context can be a string or null if nothing is found
        console.log("RAGManager: Retrieving context for query:", queryForContext);
        const queryEmbedding = await this.webLLMService.getQueryEmbedding(queryForContext);
        if (!queryEmbedding) {
            console.warn("RAGManager: Could not generate query embedding for context retrieval.");
            return null;
        }

        const searchResults = await this.searchService.search(
            queryEmbedding,
            this.TOP_M_CLUSTERS,
            this.TOP_K_DOCS_PER_CLUSTER,
            this.FINAL_TOP_N_DOCS
        );

        if (!searchResults || searchResults.length === 0) {
            console.log("RAGManager: No relevant documents found for context.");
            return null;
        }

        // For now, returning combined text content. Could be more structured later.
        const contextText = searchResults.map(doc => doc.text).join("\n\n---\n\n");
        console.log("RAGManager: Retrieved context text based on query:", queryForContext, "Context length:", contextText.length);
        return contextText;
    }

    public async generateFinalAnswer(
        originalQuery: string,
        context: string | null, // Context can be null
        finalRagPromptTemplate?: string,
        systemPromptText?: string,
        temperature?: number
    ): Promise<string> {
        console.log("RAGManager: Generating final answer for query:", originalQuery, "Temp:", temperature);
        const finalTemplate = finalRagPromptTemplate || this.DEFAULT_FINAL_RAG_PROMPT_TEMPLATE;
        const effectiveSystemPrompt = systemPromptText || this.DEFAULT_SYSTEM_PROMPT;

        const contextStr = context || "No specific context documents were found.";
        const finalPrompt = finalTemplate
            .replace("{context}", contextStr)
            .replace("{query}", originalQuery);

        // Explicitly type messages for WebLLMService.getChatCompletion
        const messages: Array<{ role: "system" | "user" | "assistant", content: string }> = [
            { role: 'system', content: effectiveSystemPrompt },
            { role: 'user', content: finalPrompt }
        ];

        const chatOpts: ChatOptions = { temperature: temperature ?? undefined };

        const finalAnswerText = await this.webLLMService.getChatCompletion(
            messages,
            chatOpts
        );
        console.log("RAGManager: Generated final answer text:", finalAnswerText);
        if (!finalAnswerText) {
            throw new Error("Final answer generation failed to produce text.");
        }
        return finalAnswerText;
    }

    // --- Existing full pipeline method ---
    public async getRagResponse(
        originalQuery: string,
        options?: {
            systemPrompt?: string;
            rephrasePromptTemplate?: string;
            finalRagPromptTemplate?: string;
            temperature?: number; // Example of other ChatOptions
            top_p?: number;       // Example of other ChatOptions
            // Add other valid ChatOptions fields here as needed
            [key: string]: any; // Allow other properties but they might not be used by getChatCompletion if not valid ChatOptions
        }
    ): Promise<string | null> {
        console.log(`RAGManager: Starting RAG process for original query: "${originalQuery}"`);

        const systemPrompt = options?.systemPrompt || this.DEFAULT_SYSTEM_PROMPT;
        const rephraseTemplate = options?.rephrasePromptTemplate?.includes("{query}")
            ? options.rephrasePromptTemplate
            : this.DEFAULT_REPHRASE_QUERY_PROMPT_TEMPLATE;
        const finalRagTemplate = (options?.finalRagPromptTemplate?.includes("{context}") && options?.finalRagPromptTemplate?.includes("{query}"))
            ? options.finalRagPromptTemplate
            : this.DEFAULT_FINAL_RAG_PROMPT_TEMPLATE;

        // Extract known ChatOptions for clarity, pass the rest if webLLMService handles them
        const chatCompletionOptions: ChatOptions = {};
        if (options?.temperature !== undefined) chatCompletionOptions.temperature = options.temperature;
        if (options?.top_p !== undefined) chatCompletionOptions.top_p = options.top_p;
        // Add other specific ChatOptions here if they are part of the ChatOptions interface
        // For unknown options, they would need to be handled by a more generic type if passed through

        // --- Stage 1: Rephrase Query for RAG retrieval ---
        let queryForRetrieval = originalQuery;
        try {
            console.log(`RAGManager: Rephrasing query for retrieval using template: "${rephraseTemplate.replace("{query}", originalQuery)}"`);
            const rephrasePrompt = rephraseTemplate.replace("{query}", originalQuery);

            const rephrasedQueryResponse = await this.webLLMService.getChatCompletion(
                [{ role: "user", content: rephrasePrompt }], // System prompt handled by default or options
                { temperature: 0.3, system_prompt: systemPrompt } as ChatOptions // Pass system prompt via options if preferred for this call
            );

            if (rephrasedQueryResponse && rephrasedQueryResponse.trim().length > 0) {
                queryForRetrieval = rephrasedQueryResponse.trim();
                console.log(`RAGManager: Query rephrased to: "${queryForRetrieval}"`);
            } else {
                console.warn("RAGManager: Query rephrasing did not return a valid response. Using original query for retrieval.");
            }
        } catch (error) {
            console.warn("RAGManager: Error during query rephrasing. Using original query for retrieval.", error);
        }

        // 1. Get Embedding for (potentially rephrased) Query
        const queryEmbedding = await this.getQueryEmbedding(queryForRetrieval);
        if (!queryEmbedding) {
            return "I apologize, but I encountered an issue processing your query's embedding. Please try again.";
        }

        // 2. Retrieve Relevant Documents
        const relevantDocuments = await this.retrieveRelevantDocuments(queryEmbedding);
        if (relevantDocuments.length === 0) {
            console.log("RAGManager: No relevant documents found. Proceeding without context or with a specific message.");
            // Option 1: Try to answer without context
            // Option 2: Return a message indicating no context was found
            // For now, let's try to answer without specific context, but inform the LLM.
        }

        // 3. Format Context
        const context = this.formatContextFromDocuments(relevantDocuments);

        // 4. Construct Final Prompt and Get LLM Response (using original query and custom system prompt)
        const userPromptWithContext = finalRagTemplate
            .replace("{context}", context)
            .replace("{query}", originalQuery);

        console.log("RAGManager: Sending request to chat model with system prompt, context, and original query.");
        // console.debug("RAGManager: System Prompt: ", systemPrompt);
        // console.debug("RAGManager: User Prompt with Context:\n", userPromptWithContext);

        try {
            const llmResponse = await this.webLLMService.getChatCompletion(
                [
                    { role: "system", content: systemPrompt }, // Ensure system prompt is part of messages if not in options
                    { role: "user", content: userPromptWithContext }
                ],
                chatCompletionOptions
            );

            if (llmResponse === null) {
                console.error("RAGManager: Received null response from LLM.");
                return "I apologize, but I couldn't generate a response at this time.";
            }
            console.log("RAGManager: Received response from LLM:", llmResponse);
            return llmResponse;
        } catch (error) {
            console.error("RAGManager: Error getting LLM response:", error);
            return "I apologize, but an unexpected error occurred while generating a response.";
        }
    }
} 