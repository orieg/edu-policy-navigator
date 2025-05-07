// src/lib/kuzudbHandler.ts

import kuzuDefaultApi from 'kuzu-wasm';

// console.log("Kuzu-Wasm imported module structure (default export expected):", kuzuDefaultApi); // Remove log

// Use InstanceType to get the type of instances created by the constructors on the default export
type KuzuDatabase = InstanceType<typeof kuzuDefaultApi.Database>;
type KuzuConnection = InstanceType<typeof kuzuDefaultApi.Connection>;
type KuzuQueryResult = any; // Placeholder: The actual type for query results needs to be verified from kuzu-wasm API.

/**
 * Interface for the manifest entry for a district's database.
 */
interface DistrictDBInfo {
    dbPath: string; // Path or URL to the pre-built KuzuDB .db file
}

/**
 * Manifest mapping district IDs to their database information.
 */
interface DistrictDBManifest {
    [districtId: string]: DistrictDBInfo;
}

/**
 * Manages KuzuDB instances and connections for different school districts.
 */
export class KuzuDBHandler {
    private dbInstances: Map<string, KuzuDatabase>;
    private connections: Map<string, KuzuConnection>;
    private manifest: DistrictDBManifest | null = null;
    private static isWorkerPathSet: boolean = false; // Static to ensure it's set only once

    constructor() {
        this.dbInstances = new Map();
        this.connections = new Map();
    }

    /**
     * Initializes the KuzuDBHandler. Crucially, this method ensures the Kuzu-Wasm worker path
     * is set if provided and not already set. This should ideally be called once.
     * @param manifestData - An object mapping district IDs to their DB paths.
     */
    public async initialize(
        manifestData: DistrictDBManifest,
    ): Promise<void> {
        this.manifest = manifestData;
        console.log("KuzuDBHandler: Manifest loaded.");

        const siteBasePath = '/edu-policy-navigator/';
        const workerName = 'kuzu_wasm_worker.js';
        let fullWorkerScriptPath = siteBasePath.endsWith('/') ? siteBasePath + workerName : siteBasePath + '/' + workerName;
        fullWorkerScriptPath = fullWorkerScriptPath.replace(/\/\//g, '/');

        if (!KuzuDBHandler.isWorkerPathSet) {
            try {
                console.log(`KuzuDBHandler: Setting Kuzu-Wasm worker path to ${fullWorkerScriptPath}`);
                await kuzuDefaultApi.setWorkerPath(fullWorkerScriptPath);
                KuzuDBHandler.isWorkerPathSet = true;
                console.log("KuzuDBHandler: Kuzu-Wasm worker path configured.");
            } catch (error) {
                console.error("KuzuDBHandler: Error setting Kuzu-Wasm worker path:", error);
                throw new Error(`Failed to configure Kuzu-Wasm worker path using ${fullWorkerScriptPath}. Ensure vite-plugin-static-copy is set up correctly or the path is valid.`);
            }
        } else if (!KuzuDBHandler.isWorkerPathSet) {
            console.error("KuzuDBHandler: Worker path somehow not set despite default. This is unexpected.");
            throw new Error("Critical error: Kuzu-Wasm worker path could not be determined or set.");
        }
        console.log("KuzuDBHandler: Initialized.");
    }

    /**
     * Checks if the handler has been initialized with a manifest and the worker path is set.
     */
    public isReady(): boolean {
        return !!this.manifest && KuzuDBHandler.isWorkerPathSet;
    }

    /**
     * Retrieves or establishes a KuzuDB connection for the specified district.
     */
    private async getOrEstablishConnection(districtId: string): Promise<KuzuConnection> {
        if (!this.manifest) {
            throw new Error("KuzuDBHandler: Manifest not loaded. Please initialize first.");
        }
        if (!KuzuDBHandler.isWorkerPathSet) {
            console.warn("KuzuDBHandler: Kuzu-Wasm worker path was not explicitly set during initialization. Proceeding with caution.");
        }

        if (this.connections.has(districtId)) {
            return this.connections.get(districtId)!;
        }

        const districtInfo = this.manifest[districtId];
        if (!districtInfo || !districtInfo.dbPath) {
            throw new Error(`KuzuDBHandler: No database path found for district ${districtId} in manifest.`);
        }

        try {
            let db = this.dbInstances.get(districtId);
            if (!db) {
                console.log(`KuzuDBHandler: Loading database for district ${districtId} from ${districtInfo.dbPath}...`);
                db = new kuzuDefaultApi.Database(districtInfo.dbPath);
                this.dbInstances.set(districtId, db);
                console.log(`KuzuDBHandler: Database for district ${districtId} loaded.`);
            }

            const connection = new kuzuDefaultApi.Connection(db);
            this.connections.set(districtId, connection);
            console.log(`KuzuDBHandler: Connection established for district ${districtId}.`);
            return connection;
        } catch (error) {
            console.error(`KuzuDBHandler: Error loading DB or connecting for district ${districtId}:`, error);
            throw new Error(`Failed to load/connect to database for district ${districtId}.`);
        }
    }

    /**
     * Executes a Cypher query against the database of the specified district.
     */
    public async executeQuery(
        districtId: string,
        query: string,
        params?: Record<string, any>,
    ): Promise<KuzuQueryResult> {
        try {
            const connection = await this.getOrEstablishConnection(districtId);
            console.log(`KuzuDBHandler: Executing query on district ${districtId}: "${query}"`, params || '');
            const preparedStatement = await connection.prepare(query);
            const queryResult = await connection.execute(preparedStatement, params || {});
            console.log("KuzuDBHandler: Query executed. Raw result:", queryResult);
            return queryResult;
        } catch (error) {
            console.error(`KuzuDBHandler: Error executing query for district ${districtId}:`, error);
            throw new Error(`Query execution failed for district ${districtId}.`);
        }
    }

    /**
     * Disposes of the KuzuDB instance and connection for a specific district.
     */
    public async disposeDistrictDB(districtId: string): Promise<void> {
        const connection = this.connections.get(districtId);
        if (connection) {
            try {
                console.log(`KuzuDBHandler: Connection for district ${districtId} implicitly closed with DB.`);
            } catch (error) {
                console.error(`KuzuDBHandler: Error during (implicit) connection closing for ${districtId}:`, error);
            }
            this.connections.delete(districtId);
        }

        const db = this.dbInstances.get(districtId);
        if (db) {
            try {
                console.log(`KuzuDBHandler: Database instance for district ${districtId} disposed (mocked - actual terminate call needed if available).`);
            } catch (error) {
                console.error(`KuzuDBHandler: Error disposing database for ${districtId}:`, error);
            }
            this.dbInstances.delete(districtId);
        }
    }

    /**
     * Disposes of all loaded KuzuDB instances and active connections.
     */
    public async disposeAll(): Promise<void> {
        const districtIds = Array.from(this.dbInstances.keys());
        for (const districtId of districtIds) {
            await this.disposeDistrictDB(districtId);
        }
        console.log("KuzuDBHandler: All district DBs and connections disposed.");
    }
}

// Example of how it might be used (for local testing, not part of the class):
/*
async function runKuzuHandlerExample() {
    const mockManifestData: DistrictDBManifest = {
        'district_XYZ': { dbPath: '/db/district_XYZ.db' },
        'district_ABC': { dbPath: '/db/district_ABC.db' }
    };

    const handler = new KuzuDBHandler();
    try {
        await handler.initialize(mockManifestData); // Add wasmPath if needed by actual lib

        const resultsXYZ = await handler.executeQuery('district_XYZ', 'MATCH (n) RETURN count(n)');
        console.log('Query result for district_XYZ:', resultsXYZ);

        const resultsABC = await handler.executeQuery('district_ABC', 'MATCH (p:Policy) WHERE p.year = $year RETURN p.name', { year: 2023 });
        console.log('Query result for district_ABC:', resultsABC);

    } catch (error) {
        console.error('Error in KuzuDBHandler example:', error);
    } finally {
        await handler.disposeAll();
    }
}

// runKuzuHandlerExample();
*/ 