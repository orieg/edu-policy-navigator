// src/lib/clusteredSearchService.ts

import type {
    ClusterCentroidData,
    ClusterData,
    SearchResult,
    DocumentMetadata
} from '../types/vectorStore';
import { calculateSimilarity } from '../utils/mathUtils'; // Import the new utility

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
    private internalDotProduct(vecA: Float32Array, vecB: Float32Array): number {
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
    public findTopKClusters(queryEmbedding: Float32Array, topM: number, similarityMetric: string = 'cosine'): ClusterCentroidData[] {
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
            score: calculateSimilarity(queryEmbedding, centroidData.centroid, similarityMetric)
        }));

        // Adjust sorting based on metric type
        if (similarityMetric === 'manhattan' || similarityMetric === 'euclidean') {
            scoredCentroids.sort((a, b) => a.score - b.score); // Manhattan/Euclidean: lower is better
        } else {
            scoredCentroids.sort((a, b) => b.score - a.score); // Cosine/Dot: higher is better
        }

        return scoredCentroids.slice(0, topM);
    }

    /**
     * Searches within a single cluster for documents most similar to the query embedding.
     * @param queryEmbedding The L2-normalized query embedding.
     * @param clusterData The data for the cluster to search within.
     * @param topKPerCluster The number of top documents to return from this cluster.
     * @returns An array of SearchResult objects, sorted by similarity score.
     */
    public searchInCluster(
        queryEmbedding: Float32Array,
        clusterData: ClusterData,
        topKPerCluster: number,
        similarityMetric: string = 'cosine'
    ): SearchResult[] {
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
            const score = calculateSimilarity(queryEmbedding, docEmbedding, similarityMetric);
            results.push({
                id: metadata[i].id,
                text: metadata[i].text,
                score,
                metadata: metadata[i] // Include full metadata
            });
        }

        // Adjust sorting based on metric type
        if (similarityMetric === 'manhattan' || similarityMetric === 'euclidean') {
            results.sort((a, b) => a.score - b.score); // Manhattan/Euclidean: lower is better
        } else {
            results.sort((a, b) => b.score - a.score); // Cosine/Dot: higher is better
        }

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
        finalTopN: number,
        similarityMetric: string = 'cosine'
    ): Promise<SearchResult[]> {
        if (!queryEmbedding || queryEmbedding.length !== this.embeddingDimensions) {
            throw new Error("Invalid query embedding provided.");
        }

        console.log(`Starting two-stage search: topMClusters=${topMClusters}, topKDocsPerCluster=${topKDocsPerCluster}, finalTopN=${finalTopN}, metric=${similarityMetric}`);

        // Stage 1: Find top M relevant clusters
        const topClusters = this.findTopKClusters(queryEmbedding, topMClusters, similarityMetric);
        console.log(`Found ${topClusters.length} top clusters: ${topClusters.map(c => c.clusterId).join(', ')} (Scores: ${topClusters.map(c => (c as any).score?.toFixed(4)).join(', ')})`);

        if (topClusters.length === 0) {
            return [];
        }

        // Stage 2: Search within each of these top clusters
        let aggregatedResults: SearchResult[] = [];
        for (const clusterCentroid of topClusters) {
            const clusterData = this.clustersData.get(clusterCentroid.clusterId);
            if (clusterData) {
                console.log(`Searching in cluster ${clusterCentroid.clusterId} with metric ${similarityMetric}...`);
                const clusterResults = this.searchInCluster(queryEmbedding, clusterData, topKDocsPerCluster, similarityMetric);
                aggregatedResults.push(...clusterResults);
                console.log(`Found ${clusterResults.length} results in cluster ${clusterCentroid.clusterId}. Total aggregated: ${aggregatedResults.length}`);
            } else {
                console.warn(`Cluster data not found for clusterId: ${clusterCentroid.clusterId}. Skipping.`);
            }
        }

        // Re-sort all aggregated results by score and take the final top N
        if (similarityMetric === 'manhattan' || similarityMetric === 'euclidean') {
            aggregatedResults.sort((a, b) => a.score - b.score); // Manhattan/Euclidean: lower is better
        } else {
            aggregatedResults.sort((a, b) => b.score - a.score); // Cosine/Dot: higher is better
        }
        const finalResults = aggregatedResults.slice(0, finalTopN);

        console.log(`Search completed. Returning ${finalResults.length} final results (Top score: ${finalResults[0]?.score?.toFixed(4)}).`);
        return finalResults;
    }

    /**
     * Retrieves ClusterData for a given cluster ID.
     * @param clusterId The ID of the cluster.
     * @returns The ClusterData object or undefined if not found.
     */
    public getClusterDataById(clusterId: string): ClusterData | undefined {
        return this.clustersData.get(clusterId);
    }

    public getAllDocumentsWithEmbeddings(): Array<{ id: string, text: string, embedding: Float32Array }> {
        const allDocs: Array<{ id: string, text: string, embedding: Float32Array }> = [];
        // Use this.clustersData directly, and no need for isInitialized if constructor ensures data
        if (!this.clustersData || this.clustersData.size === 0) {
            console.warn("ClusteredSearchService: No cluster data loaded.");
            return allDocs;
        }

        for (const clusterId of this.clustersData.keys()) {
            const cluster = this.clustersData.get(clusterId);
            // Access embeddings via cluster.embeddingData.embeddingsFlatArray
            if (cluster && cluster.metadata && cluster.embeddingData?.embeddingsFlatArray) {
                const { embeddingsFlatArray, numEmbeddings, dimensions } = cluster.embeddingData;
                if (dimensions !== this.embeddingDimensions) {
                    console.warn(`Cluster ${clusterId} has ${dimensions} dimensions, service expects ${this.embeddingDimensions}. Skipping.`);
                    continue;
                }
                for (let i = 0; i < numEmbeddings; i++) {
                    const meta = cluster.metadata[i];
                    if (!meta) continue; // Should not happen if data is consistent
                    const embedding = embeddingsFlatArray.slice(i * dimensions, (i + 1) * dimensions);
                    allDocs.push({
                        id: meta.id,
                        text: meta.text,
                        embedding: embedding
                    });
                }
            }
        }
        console.log(`ClusteredSearchService: Retrieved ${allDocs.length} documents with embeddings from all clusters.`);
        return allDocs;
    }
} 