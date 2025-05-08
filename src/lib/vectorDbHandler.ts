import { EntityDB, type EmbeddingVector as XenovaEmbeddingVector } from '@babycommando/entity-db'; // Reverted to named import

// Define the structure of the records we expect in embedded_data.json
// Export this interface for use in RAGController
export interface EmbeddedRecord {
    id: string; // e.g., "district_01407900000000", "school_01611190109835"
    type: 'district' | 'school'; // Type identifier
    text: string; // The text that was embedded
    embedding: EmbeddingVector; // Use the type alias again
    metadata: Record<string, any>; // Original data subset and other info
}

// Export the EmbeddingVector type alias for use in RAGController
export type EmbeddingVector = XenovaEmbeddingVector; // Restore original type alias

// Assign type dynamically - Using 'any' to bypass potential linter errors on EntityDB methods
const EntityDBConstructor = EntityDB as any;

export class VectorDBHandler {
    private db: any | null = null; // Use 'any' temporarily to bypass linter issues with db methods
    private isReady: boolean = false;
    private dbName: string = 'edu-policy-db'; // Name for the EntityDB instance

    constructor() {
        // Initialize the EntityDB instance
        // The schema definition tells EntityDB about the structure and which field contains the vector
        try {
            // Use the configuration object structure from the README example
            this.db = new EntityDBConstructor({
                vectorPath: this.dbName, // Use vectorPath instead of name in array
                schema: {
                    id: 'string',
                    type: 'string',
                    text: 'string',
                    embedding: 'vector', // Mark the 'embedding' field as the vector
                    metadata: 'json'
                },
                vectorField: 'embedding', // Explicitly state which field is the vector
                embedder: null, // Explicitly tell EntityDB not to initialize a default embedder
                // Consider adding distanceMetric if needed, default is usually cosine
            });
            console.log('VectorDBHandler: EntityDB instance created.');
        } catch (error) {
            console.error("VectorDBHandler: Failed to instantiate EntityDB:", error);
            this.db = null;
        }
    }

    /**
     * Initializes the vector database by loading data from the specified JSON file.
     * @param dataUrl The URL/path to the embedded_data.json file.
     * @returns {Promise<void>}
     */
    public async initialize(dataUrl: string): Promise<void> {
        if (this.isReady) {
            console.log('VectorDBHandler: Already initialized.');
            return;
        }
        if (!this.db) {
            console.error('VectorDBHandler: DB instance not created.');
            throw new Error('Database instance is null.');
        }

        console.log(`VectorDBHandler: Initializing with data from ${dataUrl}...`);
        try {
            // Fetch the pre-computed data
            const response = await fetch(dataUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch embedding data: ${response.statusText}`);
            }
            const data: EmbeddedRecord[] = await response.json();

            if (!Array.isArray(data)) {
                throw new Error('Fetched embedding data is not an array.');
            }

            const batchSize = 1000; // Insert in batches
            console.log(`VectorDBHandler: Adding ${data.length} records to the database in batches of ${batchSize}...`);

            for (let i = 0; i < data.length; i += batchSize) {
                const batch = data.slice(i, i + batchSize);
                const batchNumber = i / batchSize + 1;
                console.log(`VectorDBHandler: Processing batch ${batchNumber}...`);

                try {
                    for (const record of batch) {
                        // Still using insertManualVectors for each record within the batch
                        // *** Tentatively removing id to see if it resolves ConstraintError ***
                        await this.db.insertManualVectors({
                            // id: record.id, // Ensure 'id' is passed if EntityDB uses it as a key
                            text: record.text,
                            embedding: record.embedding,
                            metadata: record.metadata
                        });
                    }
                    console.log(`VectorDBHandler: Batch ${batchNumber} processed successfully.`);
                } catch (batchError) {
                    console.error(`VectorDBHandler: Error processing batch ${batchNumber}:`, batchError);
                    // Rethrow the error to stop initialization if a batch fails
                    // Include context about the batch if possible
                    throw new Error(`Error during batch insert (batch ${batchNumber}): ${batchError}`);
                }
                // Optional: Add a small delay between batches if needed, e.g.:
                // await new Promise(resolve => setTimeout(resolve, 50)); 
            }

            this.isReady = true;
            console.log('VectorDBHandler: Initialization complete. Database is ready.');
        } catch (error) {
            console.error('VectorDBHandler: Error during initialization:', error);
            this.isReady = false;
            // Re-throw or handle as appropriate for the application
            throw error;
        }
    }

    /**
     * Queries the vector database for records similar to the given query vector.
     * @param queryVector The embedding vector of the user's query.
     * @param topK The maximum number of results to return.
     * @returns {Promise<any[]>} A promise that resolves with the search results.
     */
    public async query(queryVector: EmbeddingVector, topK: number = 5): Promise<any[]> {
        if (!this.isReady || !this.db) {
            console.error('VectorDBHandler: Database not ready for querying.');
            throw new Error('Database is not initialized or ready.');
        }

        console.log(`VectorDBHandler: Querying database with topK=${topK}...`);
        try {
            // Reverting to try the main query method, passing the vector in options
            const results = await this.db.query(this.dbName, {
                vector: queryVector,
                topK: topK,
            });
            // const allResults = await this.db.queryManualVectors(queryVector);
            // Manually apply topK if the method doesn't support it directly
            // const results = allResults.slice(0, topK);

            // console.log(`VectorDBHandler: Query returned ${results.length} results (after slicing for topK=${topK}).`);
            console.log(`VectorDBHandler: Query returned ${results.length} results.`);
            return results;
        } catch (error) {
            console.error('VectorDBHandler: Error during query:', error);
            // Re-throw or handle as appropriate
            throw error;
        }
    }

    /**
     * Checks if the database is initialized and ready for use.
     * @returns {boolean} True if the database is ready, false otherwise.
     */
    public getIsReady(): boolean {
        return this.isReady;
    }
} 