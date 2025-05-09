// src/lib/ragManager.ts

import WebLLMService from './WebLLMService.ts';
import { ClusteredSearchService } from './clusteredSearchService.ts';
import type {
    ClusterCentroidData,
    ClusterData,
    SearchResult,
    DocumentMetadata
} from '../types/vectorStore.d.ts';

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
    private TOP_M_CLUSTERS: number = 3;        // Default number of clusters to check
    private TOP_K_DOCS_PER_CLUSTER: number = 5; // Default docs per cluster
    private FINAL_TOP_N_DOCS: number = 5;       // Final number of docs for context

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

    /**
     * Processes a user query through the RAG pipeline to generate a response.
     * @param query The user's query string.
     * @param chatOptions Optional chat parameters for the LLM.
     * @returns A Promise that resolves to the LLM's response string, or null if an error occurs.
     */
    public async getRagResponse(query: string, chatOptions?: any /* Adjust to actual ChatOptions from WebLLMService if defined */): Promise<string | null> {
        console.log(`RAGManager: Starting RAG process for query: "${query}"`);

        // 1. Get Query Embedding
        const queryEmbedding = await this.getQueryEmbedding(query);
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

        // 4. Construct Prompt and Get LLM Response
        // Basic prompt structure. This can be significantly improved.
        const systemPrompt = "You are a helpful AI assistant. Answer the user's question based on the provided context. If the context is empty or not relevant, try to answer generally but indicate that the answer is not based on specific provided documents.";

        const userPromptWithContext =
            `Context:
${context}

Question: ${query}

Answer:`;

        console.log("RAGManager: Sending request to chat model with prompt (context + query).");
        // console.debug("RAGManager: Full prompt being sent:\n", userPromptWithContext); // For deep debugging

        try {
            const llmResponse = await this.webLLMService.getChatCompletion(
                [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPromptWithContext }
                ],
                chatOptions
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