// src/types/vectorStore.d.ts

export interface DocumentMetadata {
    id: string; // Typically CDSCode for districts/schools
    text: string; // Original chunk text
    name?: string; // Name of the school or district, if applicable
    type?: 'district' | 'school' | 'other'; // Type of document
    // Add any other relevant metadata fields that are present in your metadata.json files
    // e.g., city, county, specific policy numbers, etc.
}

export interface ClusterEmbeddingData {
    embeddingsFlatArray: Float32Array; // All embeddings for the cluster, flattened
    numEmbeddings: number; // Number of embeddings in this flat array (should match metadata.length)
    dimensions: number; // Embedding dimensions (e.g., 384)
}

export interface ClusterData {
    clusterId: string;
    embeddingData: ClusterEmbeddingData;
    metadata: DocumentMetadata[]; // Ordered to match embeddings from the .bin file
}

export interface ClusterCentroidData {
    clusterId: string;
    centroid: Float32Array; // L2-normalized centroid vector
}

export interface SearchResult {
    id: string; // Document ID (e.g., CDSCode)
    text: string; // Original document text chunk
    score: number; // Similarity score (e.g., dot product)
    metadata?: DocumentMetadata; // Optional: include full metadata if needed for display
}

// --- Manifest File Structures (mirroring manifest.json) ---

export interface ManifestClusterEntry {
    clusterId: number; // Changed from string to number to match typical array indexing/IDs
    count: number; // Number of embeddings in this cluster (numEmbeddings in plan)
    embeddingsFile: string | null; // Path relative to OUTPUT_DIR/manifest.json location
    metadataFile: string | null;   // Path relative to OUTPUT_DIR/manifest.json location
}

export interface ManifestData {
    embeddingModelId: string;
    embeddingDimensions: number;
    kValue: number; // Number of clusters (K)
    // centroidsFileFormat: "binary" | "json"; // Decided on JSON for centroids.json
    centroidsFile: string; // Path to centroids.json, relative to manifest location
    // centroidClusterIds?: string[]; // Not needed if centroids.json has clusterId within it or implies order
    clusters: ManifestClusterEntry[];
    // Other parameters from your actual manifest.json if any
    // e.g., dateGenerated, sourceFiles, etc.
} 