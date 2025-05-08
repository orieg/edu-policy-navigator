// src/lib/clusteredSearchService.ts

import type {
    ClusterCentroidData,
    ClusterData,
    SearchResult,
    DocumentMetadata
} from '../types/vectorStore';

export class ClusteredSearchService {
    private centroids: ClusterCentroidData[];
    private clustersData: Map<string, ClusterData>; // Keyed by clusterId
    private embeddingDimensions: number;

    constructor(
        centroids: ClusterCentroidData[],
        clustersData: Map<string, ClusterData>,
        embeddingDimensions: number
    ) {
        if (!centroids || centroids.length === 0) {
            throw new Error("ClusteredSearchService: Centroids data cannot be null or empty.");
        }
        if (!clustersData || clustersData.size === 0) {
            throw new Error("ClusteredSearchService: Clusters data map cannot be null or empty.");
        }
        if (embeddingDimensions <= 0) {
            throw new Error("ClusteredSearchService: Embedding dimensions must be positive.");
        }

        this.centroids = centroids;
        this.clustersData = clustersData;
        this.embeddingDimensions = embeddingDimensions;
        console.log(`ClusteredSearchService initialized with ${this.centroids.length} centroids and data for ${this.clustersData.size} clusters.`);
    }

    /**
     * Calculates the dot product of two L2-normalized vectors.
     * For L2-normalized vectors, dot product is equivalent to cosine similarity.
     * @param vecA Float32Array
     * @param vecB Float32Array
     * @returns The dot product (cosine similarity).
     */
    public dotProduct(vecA: Float32Array, vecB: Float32Array): number {
        if (vecA.length !== vecB.length) {
            throw new Error("Vectors must have the same dimensionality for dot product.");
        }
        if (vecA.length !== this.embeddingDimensions) {
            // This check is against the service's configured dimensions
            console.warn(`Vector A length (${vecA.length}) does not match service embedding dimensions (${this.embeddingDimensions}).`);
        }
        let product = 0;
        for (let i = 0; i < vecA.length; i++) {
            product += vecA[i] * vecB[i];
        }
        return product;
    }

    // TODO: Implement findTopKClusters
    // TODO: Implement searchInCluster
    // TODO: Implement a public search method orchestrating the two-stage search

    /**
     * Finds the top M clusters most similar to the query embedding.
     * @param queryEmbedding The L2-normalized query embedding.
     * @param topM The number of top clusters to return.
     * @returns An array of the top M ClusterCentroidData objects, sorted by similarity score.
     */
    public findTopKClusters(queryEmbedding: Float32Array, topM: number): ClusterCentroidData[] {
        if (queryEmbedding.length !== this.embeddingDimensions) {
            throw new Error(`Query embedding dimensions (${queryEmbedding.length}) do not match service dimensions (${this.embeddingDimensions}).`);
        }
        if (topM <= 0) {
            console.warn("topM for findTopKClusters must be positive. Defaulting to 1.");
            topM = 1;
        }
        if (topM > this.centroids.length) {
            console.warn(`topM (${topM}) is greater than the number of available centroids (${this.centroids.length}). Returning all centroids.`);
            topM = this.centroids.length;
        }

        const scoredCentroids = this.centroids.map(centroidData => ({
            ...centroidData,
            score: this.dotProduct(queryEmbedding, centroidData.centroid)
        }));

        scoredCentroids.sort((a, b) => b.score - a.score); // Sort descending by score

        return scoredCentroids.slice(0, topM);
    }

    /**
     * Searches within a single cluster for documents most similar to the query embedding.
     * @param queryEmbedding The L2-normalized query embedding.
     * @param clusterData The data for the cluster to search within.
     * @param topKPerCluster The number of top documents to return from this cluster.
     * @returns An array of SearchResult objects, sorted by similarity score.
     */
    public searchInCluster(queryEmbedding: Float32Array, clusterData: ClusterData, topKPerCluster: number): SearchResult[] {
        if (queryEmbedding.length !== this.embeddingDimensions) {
            throw new Error(`Query embedding dimensions (${queryEmbedding.length}) do not match service dimensions (${this.embeddingDimensions}).`);
        }
        if (!clusterData || !clusterData.embeddingData || !clusterData.metadata) {
            throw new Error("Invalid clusterData provided to searchInCluster.");
        }

        const { embeddingsFlatArray, numEmbeddings, dimensions } = clusterData.embeddingData;
        const metadata = clusterData.metadata;

        if (dimensions !== this.embeddingDimensions) {
            throw new Error(`Cluster embedding dimensions (${dimensions}) do not match service dimensions (${this.embeddingDimensions}).`);
        }
        if (metadata.length !== numEmbeddings) {
            throw new Error(`Metadata count (${metadata.length}) does not match numEmbeddings (${numEmbeddings}) in cluster ${clusterData.clusterId}.`);
        }
        if (embeddingsFlatArray.length !== numEmbeddings * dimensions) {
            throw new Error(`Flat embeddings array size (${embeddingsFlatArray.length}) is inconsistent with numEmbeddings (${numEmbeddings}) and dimensions (${dimensions}) in cluster ${clusterData.clusterId}.`);
        }

        if (topKPerCluster <= 0) {
            console.warn("topKPerCluster must be positive. Defaulting to 1.");
            topKPerCluster = 1;
        }

        if (numEmbeddings === 0) {
            return []; // No documents in this cluster
        }

        const results: SearchResult[] = [];
        for (let i = 0; i < numEmbeddings; i++) {
            // Extract the i-th document embedding from the flat array
            const docEmbedding = embeddingsFlatArray.slice(i * dimensions, (i + 1) * dimensions);
            const score = this.dotProduct(queryEmbedding, docEmbedding);
            results.push({
                id: metadata[i].id,
                text: metadata[i].text,
                score,
                metadata: metadata[i] // Include full metadata
            });
        }

        results.sort((a, b) => b.score - a.score); // Sort descending by score

        return results.slice(0, topKPerCluster);
    }

    /**
     * Performs a two-stage search: first finds top M clusters, then searches within those for top K documents.
     * @param queryEmbedding The L2-normalized query embedding.
     * @param topMClusters The number of most relevant clusters to consider.
     * @param topKDocsPerCluster The number of most relevant documents to retrieve from each of those clusters.
     * @param finalTopN The total number of top documents to return after aggregating and re-sorting.
     * @returns A Promise that resolves to an array of SearchResult objects.
     */
    public async search(
        queryEmbedding: Float32Array,
        topMClusters: number,
        topKDocsPerCluster: number,
        finalTopN: number
    ): Promise<SearchResult[]> {
        if (!queryEmbedding || queryEmbedding.length !== this.embeddingDimensions) {
            throw new Error("Invalid query embedding provided.");
        }

        console.log(`Starting two-stage search: topMClusters=${topMClusters}, topKDocsPerCluster=${topKDocsPerCluster}, finalTopN=${finalTopN}`);

        // Stage 1: Find top M relevant clusters
        const topClusters = this.findTopKClusters(queryEmbedding, topMClusters);
        console.log(`Found ${topClusters.length} top clusters: ${topClusters.map(c => c.clusterId).join(', ')}`);

        if (topClusters.length === 0) {
            return [];
        }

        // Stage 2: Search within each of these top clusters
        let aggregatedResults: SearchResult[] = [];
        for (const clusterCentroid of topClusters) {
            const clusterData = this.clustersData.get(clusterCentroid.clusterId);
            if (clusterData) {
                console.log(`Searching in cluster ${clusterCentroid.clusterId}...`);
                const clusterResults = this.searchInCluster(queryEmbedding, clusterData, topKDocsPerCluster);
                aggregatedResults.push(...clusterResults);
                console.log(`Found ${clusterResults.length} results in cluster ${clusterCentroid.clusterId}. Total aggregated: ${aggregatedResults.length}`);
            } else {
                console.warn(`Cluster data not found for clusterId: ${clusterCentroid.clusterId}. Skipping.`);
            }
        }

        // Re-sort all aggregated results by score and take the final top N
        aggregatedResults.sort((a, b) => b.score - a.score);
        const finalResults = aggregatedResults.slice(0, finalTopN);

        console.log(`Search completed. Returning ${finalResults.length} final results.`);
        return finalResults;
    }
} 