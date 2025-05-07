import type { KuzuDBHandler } from './kuzudbHandler';
import type { WebLLMHandler, ChatMessage, InitializationCallbacks } from './webllmHandler';
import { WEBLLM_CHAT_MODEL_ID as MODEL_ID } from '../siteConfig';

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
        progressCallback("Ensuring LLM is ready for Cypher generation...", 'loading', true);
        if (!this.webllmHandler.getIsInitialized()) {
            progressCallback("Initializing WebLLM for Cypher generation...", 'loading', true);
            try {
                await this.webllmHandler.initialize(
                    MODEL_ID,
                    {
                        onProgress: (report) => progressCallback(`WebLLM loading: ${report.text}`, 'loading', true)
                    }
                );
            } catch (initError) {
                console.error("WebLLM initialization error during Cypher gen:", initError);
                progressCallback(`WebLLM Init Error: ${initError instanceof Error ? initError.message : 'Unknown error'}`, 'error', true);
                return null;
            }
            if (!this.webllmHandler.getIsInitialized()) {
                progressCallback("WebLLM is not initialized and could not be started for Cypher generation.", 'error', true);
                return null;
            }
        }
        progressCallback("LLM ready. Generating Cypher query...", 'loading', true);

        const KUZUDB_SCHEMA_DESCRIPTION = `
KuzuDB Schema Overview:
Node Tables (Collections of Records):
  - Policy: Represents a specific policy document or section.
    Properties:
      - name: STRING (A unique identifier or title for the policy, e.g., "BP 5131.2 Conduct")
      - title: STRING (The official title of the policy document or section)
      - text_content: STRING (The full text content of the policy)
      - description: STRING (A brief summary or abstract of the policy)
      - keywords: LIST<STRING> (A list of relevant keywords or tags, e.g., ["discipline", "student conduct", "suspension"])
      - category: STRING (A general category for the policy, e.g., "Student Services", "Administration")
      - last_updated: DATE (The date the policy was last updated)

  - Document: Represents a source document that contains policies or is related to them.
    Properties:
      - doc_id: STRING (A unique identifier for the document)
      - title: STRING (The title of the document, e.g., "Board Policy Manual Section 5000")
      - source_url: STRING (URL where the document can be found, if applicable)
      - full_text: STRING (The complete text of the document if it's not broken into Policy nodes)

Relationship Tables (Connections between Node Tables):
  - Policy -[MENTIONED_IN]-> Document: Connects a Policy to a Document it is mentioned or contained in.
  - Document -[CONTAINS_POLICY]-> Policy: (Alternative to MENTIONED_IN, depending on data model direction)

Cypher Query Guidelines for KuzuDB:
- Use \`MATCH\` to specify patterns of nodes and relationships.
- Use \`WHERE\` to filter results (e.g., \`p.category = 'Student Services'\`).
- For string matching, use the \`CONTAINS\` keyword (e.g., \`p.text_content CONTAINS 'bullying'\`). \`CONTAINS\` is case-insensitive by default in common KuzuDB setups for text search.
- Prefer returning specific, relevant properties (e.g., \`RETURN p.name, p.description\`). Avoid \`RETURN *\` unless necessary.
- If looking for policies related to keywords, search in \`p.text_content\`, \`p.description\`, or \`p.keywords\`.
- Example for finding policies about "bullying": 
  \`MATCH (p:Policy) WHERE p.text_content CONTAINS 'bullying' OR p.description CONTAINS 'bullying' RETURN p.name, p.text_content LIMIT 5;\`
- Ensure queries are syntactically correct for KuzuDB Cypher.
`;

        const prompt = `You are an expert KuzuDB Cypher query generator. Your task is to convert the user's question into a single, concise, and valid KuzuDB Cypher query. 
Only output the Cypher query itself, with no additional explanation, introductory text, or markdown formatting (like \`\`\`cypher ... \`\`\`).

KuzuDB Schema and Guidelines:
${KUZUDB_SCHEMA_DESCRIPTION}

User Question: "${query}"

Cypher Query:`;

        try {
            progressCallback("Sending question to LLM for Cypher generation...", 'loading', true);
            const messages: ChatMessage[] = [{ role: "user", content: prompt }];
            const generatedCypher = await this.webllmHandler.chatCompletion(messages, false);

            if (!generatedCypher || generatedCypher.startsWith("Error during LLM response generation")) {
                const errorMsg = generatedCypher || "LLM failed to generate a Cypher query (returned empty).";
                progressCallback(errorMsg, 'error', true);
                console.error("Text-to-Cypher Error:", errorMsg);
                return null;
            }

            // Basic validation: check if it looks like a Cypher query (starts with MATCH)
            // More sophisticated validation might be needed later.
            const trimmedCypher = generatedCypher.trim();
            if (!trimmedCypher.toUpperCase().startsWith("MATCH")) {
                progressCallback(`LLM returned an invalid Cypher query format: ${trimmedCypher.substring(0, 100)}...`, 'error', true);
                console.error("Text-to-Cypher Invalid Format:", trimmedCypher);
                return null;
            }

            progressCallback("Cypher query generated successfully.", 'system', false);
            return trimmedCypher;

        } catch (error) {
            console.error("Error in _textToCypher during LLM call:", error);
            const errorMessage = error instanceof Error ? error.message : "An unknown error occurred generating Cypher.";
            progressCallback(errorMessage, 'error', true);
            return null;
        }
    }

    private async _cypherToContext(cypherQuery: string, progressCallback: (message: string, type: 'ai' | 'system' | 'error' | 'loading', replaceLast?: boolean) => void): Promise<string | null> {
        // Placeholder: Implement actual Cypher execution using KuzuDBHandler
        console.log(`RAGController: _cypherToContext called with cypher: ${cypherQuery}`);
        if (!this.kuzuHandler.isReady()) {
            progressCallback("KuzuDB is not initialized with manifest or worker path. Please open the chat to initialize.", 'error');
            return null;
        }
        try {
            // TODO: RAGController needs access to currentDistrictId
            const placeholderDistrictId = "default_district"; // Or get from a central state
            progressCallback(`Querying ${placeholderDistrictId} DB...`, 'loading', true);
            const results = await this.kuzuHandler.executeQuery(placeholderDistrictId, cypherQuery);

            // Assuming the context is a string concatenation of results.
            // This will need to be refined based on actual query result structure.
            if (results && results.length > 0) {
                // Assuming results is an array of objects (records)
                return JSON.stringify(results.map((row: Record<string, any>) => Object.values(row).join(' \n'))); // Typed row
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

        const systemPrompt = `Based on the following context, please answer the question: ${originalQuery}\n\nContext:\n${context}\n\nAnswer:`;
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