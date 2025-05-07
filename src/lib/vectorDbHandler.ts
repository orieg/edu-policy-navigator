import { EntityDB, type EmbeddingVector } from '@babycommando/entity-db';

// Define the structure of the records we expect in embedded_data.json
interface EmbeddedRecord {
    id: string; // e.g., "district_01407900000000", "school_01611190109835"
    type: 'district' | 'school'; // Type identifier
    text: string; // The text that was embedded
    embedding: EmbeddingVector; // The actual embedding vector
    metadata: Record<string, any>; // Original data subset and other info
}

export class VectorDBHandler {
    private db: EntityDB<EmbeddedRecord> | null = null;
    private isReady: boolean = false;
    private dbName: string = 'edu-policy-db'; // Name for the EntityDB instance

    constructor() {
        // Initialize the EntityDB instance
        // The schema definition tells EntityDB about the structure and which field contains the vector
        this.db = new EntityDB<EmbeddedRecord>([
            {
                name: this.dbName,
                schema: {
                    id: 'string',
                    type: 'string',
                    text: 'string',
                    embedding: 'vector', // Mark the 'embedding' field as the vector
                    metadata: 'json'
                },
                vectorField: 'embedding', // Explicitly state which field is the vector
                // Consider adding distanceMetric if needed, default is usually cosine
            }
        ]);
        console.log('VectorDBHandler: EntityDB instance created.');
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

            console.log(`VectorDBHandler: Adding ${data.length} records to the database...`);
            // Add data to the database
            // Ensure the target collection name matches the one defined in the constructor
            await this.db.add(this.dbName, data);

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
            // Perform the vector search
            // Ensure the target collection name matches the one defined in the constructor
            const results = await this.db.query(this.dbName, {
                vector: queryVector,
                topK: topK,
                // include: ['id', 'text', 'metadata'] // Specify fields to include, if needed
                // filter: { type: 'school' } // Example filter
            });

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