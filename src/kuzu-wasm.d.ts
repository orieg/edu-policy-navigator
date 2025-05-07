// src/kuzu-wasm.d.ts
declare module 'kuzu-wasm' {
    // This is a minimal set of declarations based on observed usage and common patterns.
    // It may need to be expanded and refined by inspecting the kuzu-wasm API more closely.

    // Define the classes and functions as named exports internally to this module declaration
    export class Database {
        constructor(path: string);
        // Example: if a terminate/close method exists for Wasm resource management
        // terminate?(): Promise<void>; 
    }

    export class Connection {
        constructor(db: Database);
        prepare(query: string): Promise<PreparedStatement>;
        execute(statement: PreparedStatement, params?: Record<string, any>): Promise<any>; // TODO: Refine 'any' to a more specific QueryResult type
        // Example: if a close method exists
        // close?(): Promise<void>;
    }

    // This is an assumed type. The actual PreparedStatement might be an opaque object
    // or have specific methods/properties.
    export interface PreparedStatement {
        // Define properties or methods if known, e.g.:
        // bind(key: string, value: any): void;
    }

    export function setWorkerPath(path: string): Promise<void>;

    // Interface for the actual default export object
    interface KuzuModuleAPI {
        Database: typeof Database;
        Connection: typeof Connection;
        setWorkerPath: typeof setWorkerPath;
        // Add other exports if they exist on the default object, e.g.:
        // getVersion?: () => string;
    }

    // Declare that the module's default export is of type KuzuModuleAPI
    const kuzu: KuzuModuleAPI;
    export default kuzu;

    // If KuzuDB exports other entities like Enums (e.g., AccessMode), declare them here.
    // export enum AccessMode { READ_ONLY, READ_WRITE /*, ... */ }
} 