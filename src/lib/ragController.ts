import type { KuzuDBHandler } from './kuzudbHandler';
import type { WebLLMHandler } from './webllmHandler';

export class RAGController {
    private kuzuHandler: KuzuDBHandler;
    private webllmHandler: WebLLMHandler;

    constructor(kuzuHandler: KuzuDBHandler, webllmHandler: WebLLMHandler) {
        this.kuzuHandler = kuzuHandler;
        this.webllmHandler = webllmHandler;
    }

    public async processQuery(
        query: string,
        progressCallback: (message: string, type: 'ai' | 'system' | 'error' | 'loading', replaceLast?: boolean) => void
    ): Promise<void> {
        try {
            progressCallback("Starting RAG process...", 'system');

            // Step 1: Text-to-Cypher
            progressCallback("Converting text to Cypher query...", 'loading');
            const cypherQuery = await this._textToCypher(query, progressCallback);
            if (!cypherQuery) {
                throw new Error("Failed to generate Cypher query.");
            }
            progressCallback(`Generated Cypher: ${cypherQuery}`, 'system');

            // Step 2: Cypher-to-Context
            progressCallback("Querying database for context...", 'loading');
            const context = await this._cypherToContext(cypherQuery, progressCallback);
            if (!context) {
                throw new Error("Failed to retrieve context from database.");
            }
            progressCallback("Retrieved context from database.", 'system');

            // Step 3: Context-to-Answer
            progressCallback("Generating answer...", 'loading');
            const answer = await this._contextToAnswer(query, context, progressCallback);
            if (!answer) {
                return;
            }
            progressCallback("Answer generated.", 'system');
            progressCallback(answer, 'ai', true);

        } catch (error) {
            console.error("Error in RAGController processQuery:", error);
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred in the RAG process.";
            progressCallback(errorMessage, 'error', true);
        }
    }

    private async _textToCypher(query: string, progressCallback: (message: string, type: 'ai' | 'system' | 'error' | 'loading', replaceLast?: boolean) => void): Promise<string | null> {
        // Placeholder: Implement actual text-to-Cypher logic using WebLLMHandler
        console.log(`RAGController: _textToCypher called with query: ${query}`);
        // This will involve a call to webllmHandler to construct a Cypher query.
        // For now, returning a placeholder.
        progressCallback("Text-to-Cypher generation (stubbed)...", 'system');
        // Simulate a simple keyword-based Cypher query for demonstration
        if (query.toLowerCase().includes("policy")) {
            return `MATCH (p:Policy) WHERE p.name CONTAINS '${query.replace("policy", "").trim()}' RETURN p.description;`;
        }
        return "MATCH (doc:Document) RETURN doc.text LIMIT 1;"; // Default placeholder
    }

    private async _cypherToContext(cypherQuery: string, progressCallback: (message: string, type: 'ai' | 'system' | 'error' | 'loading', replaceLast?: boolean) => void): Promise<string | null> {
        // Placeholder: Implement actual Cypher execution using KuzuDBHandler
        console.log(`RAGController: _cypherToContext called with cypher: ${cypherQuery}`);
        if (!this.kuzuHandler.isInitialized()) {
            progressCallback("KuzuDB is not initialized. Please open the chat to initialize.", 'error');
            return null;
        }
        try {
            const results = await this.kuzuHandler.query(cypherQuery);
            // Assuming the context is a string concatenation of results.
            // This will need to be refined based on actual query result structure.
            if (results && results.length > 0) {
                return JSON.stringify(results.map(row => Object.values(row).join(' \n'))); // Simplified context
            }
            return "No context found for the given query.";
        } catch (error) {
            console.error("Error querying KuzuDB:", error);
            progressCallback(`Error querying database: ${error instanceof Error ? error.message : "Unknown DB error"}`, 'error');
            return null;
        }
    }

    private async _contextToAnswer(originalQuery: string, context: string, progressCallback: (message: string, type: 'ai' | 'system' | 'error' | 'loading', replaceLast?: boolean) => void): Promise<string | null> {
        // Placeholder: Implement actual answer generation using WebLLMHandler
        console.log(`RAGController: _contextToAnswer called with context of length: ${context.length}`);
        if (!this.webllmHandler.isInitialized()) {
            // Try to initialize if not already
            progressCallback("Initializing WebLLM for answer generation...", 'loading');
            await this.webllmHandler.initialize(
                (progress) => progressCallback(`WebLLM loading: ${progress.text}`, 'loading', true)
            );
            if (!this.webllmHandler.isInitialized()) {
                progressCallback("WebLLM is not initialized and could not be started.", 'error', true);
                return null;
            }
        }

        const prompt = `Based on the following context, please answer the question: ${originalQuery}\n\nContext:\n${context}\n\nAnswer:`;
        progressCallback("Sending prompt to LLM for answer generation...", 'loading', true);

        try {
            const answer = await this.webllmHandler.generateResponse(prompt);
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