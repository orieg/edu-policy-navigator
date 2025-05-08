// src/lib/dataLoader.ts

import type {
    ManifestData,
    ManifestClusterEntry,
    ClusterCentroidData,
    ClusterData,
    ClusterEmbeddingData,
    DocumentMetadata
} from '../types/vectorStore';

/**
 * Fetches and parses the manifest.json file.
 * @param manifestUrl The URL to the manifest.json file.
 * @returns A Promise that resolves to the ManifestData object.
 */
export async function loadManifest(manifestUrl: string): Promise<ManifestData> {
    try {
        console.log(`Fetching manifest from: ${manifestUrl}`);
        const response = await fetch(manifestUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
        }
        const manifest: ManifestData = await response.json();
        console.log("Manifest loaded and parsed successfully:", manifest);
        // TODO: Add more detailed validation of manifest structure if needed
        if (!manifest.clusters || !manifest.centroidsFile || !manifest.embeddingModelId) {
            throw new Error("Manifest is missing crucial fields (clusters, centroidsFile, embeddingModelId).");
        }
        return manifest;
    } catch (error) {
        console.error("Error loading or parsing manifest:", error);
        throw error; // Re-throw for the caller to handle
    }
}

/**
 * Loads and parses the centroids data from the path specified in the manifest.
 * @param manifest The parsed ManifestData object.
 * @param manifestDirUrl The base URL of the directory containing the manifest file.
 * @returns A Promise that resolves to an array of ClusterCentroidData.
 */
export async function loadCentroids(manifest: ManifestData, manifestDirUrl: string): Promise<ClusterCentroidData[]> {
    const centroidsUrl = getFullDataUrl(manifestDirUrl, manifest.centroidsFile);
    if (!centroidsUrl) {
        throw new Error("Centroids file path is not defined in the manifest.");
    }

    try {
        console.log(`Fetching centroids from: ${centroidsUrl}`);
        const response = await fetch(centroidsUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch centroids: ${response.status} ${response.statusText}`);
        }
        // Assuming centroids.json contains an array of { clusterId: number, centroid: number[] }
        const rawCentroids: Array<{ clusterId: number, centroid: number[] }> = await response.json();
        console.log(`Centroids data loaded and parsed. Found ${rawCentroids.length} centroids.`);

        if (rawCentroids.length !== manifest.kValue) {
            console.warn(`Manifest kValue (${manifest.kValue}) does not match the number of centroids found (${rawCentroids.length}). Using the count from centroids file.`);
        }

        const centroidsData: ClusterCentroidData[] = rawCentroids.map(rawCentroid => {
            if (!rawCentroid.centroid || rawCentroid.centroid.length !== manifest.embeddingDimensions) {
                throw new Error(`Centroid for cluster ${rawCentroid.clusterId} has incorrect dimensions or is missing. Expected ${manifest.embeddingDimensions}, got ${rawCentroid.centroid?.length}`);
            }
            return {
                clusterId: String(rawCentroid.clusterId), // Convert number to string to match ClusterData.clusterId type
                centroid: new Float32Array(rawCentroid.centroid)
            };
        });

        console.log("Centroids processed successfully.");
        return centroidsData;
    } catch (error) {
        console.error(`Error loading or parsing centroids from ${centroidsUrl}:`, error);
        throw error;
    }
}

// TODO: Implement loadSingleClusterData
// TODO: Implement loadAllRAGData

/**
 * Loads the embeddings and metadata for a single cluster.
 * @param clusterManifestEntry The manifest entry for the cluster.
 * @param embeddingDimensions The dimensionality of the embeddings.
 * @param manifestDirUrl The base URL of the directory containing the manifest file.
 * @returns A Promise that resolves to ClusterData for the specified cluster.
 */
export async function loadSingleClusterData(
    clusterManifestEntry: ManifestClusterEntry,
    embeddingDimensions: number,
    manifestDirUrl: string
): Promise<ClusterData> {
    const { clusterId, count, embeddingsFile, metadataFile } = clusterManifestEntry;

    if (count === 0) {
        // Handle empty cluster gracefully
        console.log(`Cluster ${clusterId} is empty. Skipping file loading.`);
        return {
            clusterId: String(clusterId),
            embeddingData: {
                embeddingsFlatArray: new Float32Array(0),
                numEmbeddings: 0,
                dimensions: embeddingDimensions,
            },
            metadata: [],
        };
    }

    const metadataUrl = getFullDataUrl(manifestDirUrl, metadataFile);
    const embeddingsUrl = getFullDataUrl(manifestDirUrl, embeddingsFile);

    if (!metadataUrl || !embeddingsUrl) {
        throw new Error(`Missing metadata or embeddings file path for cluster ${clusterId}. Metadata: ${metadataFile}, Embeddings: ${embeddingsFile}`);
    }

    try {
        // Fetch metadata
        console.log(`Fetching metadata for cluster ${clusterId} from: ${metadataUrl}`);
        const metadataResponse = await fetch(metadataUrl);
        if (!metadataResponse.ok) {
            throw new Error(`Failed to fetch metadata for cluster ${clusterId}: ${metadataResponse.status} ${metadataResponse.statusText}`);
        }
        const metadata: DocumentMetadata[] = await metadataResponse.json();
        console.log(`Metadata for cluster ${clusterId} loaded. Found ${metadata.length} entries.`);

        if (metadata.length !== count) {
            throw new Error(`Metadata count mismatch for cluster ${clusterId}. Manifest says ${count}, but found ${metadata.length} entries in ${metadataFile}`);
        }

        // Fetch embeddings
        console.log(`Fetching embeddings for cluster ${clusterId} from: ${embeddingsUrl}`);
        const embeddingsResponse = await fetch(embeddingsUrl);
        if (!embeddingsResponse.ok) {
            throw new Error(`Failed to fetch embeddings for cluster ${clusterId}: ${embeddingsResponse.status} ${embeddingsResponse.statusText}`);
        }
        const arrayBuffer = await embeddingsResponse.arrayBuffer();
        const embeddingsFlatArray = new Float32Array(arrayBuffer);
        console.log(`Embeddings for cluster ${clusterId} loaded. Total float values: ${embeddingsFlatArray.length}.`);

        const expectedFloatValues = count * embeddingDimensions;
        if (embeddingsFlatArray.length !== expectedFloatValues) {
            throw new Error(`Embeddings data size mismatch for cluster ${clusterId}. Expected ${expectedFloatValues} float values (count ${count} * dims ${embeddingDimensions}), but found ${embeddingsFlatArray.length} in ${embeddingsFile}`);
        }

        const clusterEmbeddingData: ClusterEmbeddingData = {
            embeddingsFlatArray,
            numEmbeddings: count,
            dimensions: embeddingDimensions,
        };

        console.log(`Successfully loaded data for cluster ${clusterId}.`);
        return {
            clusterId: String(clusterId), // Ensure clusterId is string
            embeddingData: clusterEmbeddingData,
            metadata,
        };

    } catch (error) {
        console.error(`Error loading data for cluster ${clusterId}:`, error);
        throw error;
    }
}

// TODO: Implement loadAllRAGData

/**
 * Loads all necessary RAG data including the manifest, centroids, and all cluster data.
 * @param manifestUrl The URL to the manifest.json file.
 * @param progressCallback Optional callback to report loading progress.
 * @returns A Promise that resolves to an object containing all loaded RAG data.
 */
export async function loadAllRAGData(manifestUrl: string, progressCallback?: (progress: { message: string, loaded: number, total: number }) => void): Promise<{
    manifest: ManifestData;
    centroids: ClusterCentroidData[];
    clustersData: Map<string, ClusterData>;
    embeddingDimensions: number;
    embeddingModelId: string;
}> {
    // Determine the base URL for relative paths in the manifest
    const manifestDirUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1);
    let loadedCount = 0;

    const reportProgress = (message: string, total: number) => {
        if (progressCallback) {
            progressCallback({ message, loaded: loadedCount, total });
        }
    };

    try {
        // 1. Load Manifest
        reportProgress("Loading manifest...", 0); // Initial total, will be updated
        const manifest = await loadManifest(manifestUrl);
        loadedCount++;
        const totalToLoad = 1 /* manifest */ + 1 /* centroids */ + manifest.clusters.filter(c => c.count > 0).length /* non-empty clusters */;
        reportProgress("Manifest loaded. Loading centroids...", totalToLoad);

        // 2. Load Centroids
        const centroids = await loadCentroids(manifest, manifestDirUrl);
        loadedCount++;
        reportProgress(`Centroids loaded. Loading ${manifest.clusters.length} clusters...`, totalToLoad);

        // 3. Load all Cluster Data in parallel
        const clustersDataMap = new Map<string, ClusterData>();
        const clusterLoadPromises: Promise<void>[] = [];

        for (const clusterManifestEntry of manifest.clusters) {
            const promise = loadSingleClusterData(clusterManifestEntry, manifest.embeddingDimensions, manifestDirUrl)
                .then(clusterData => {
                    clustersDataMap.set(clusterData.clusterId, clusterData);
                    loadedCount++;
                    reportProgress(`Loaded cluster ${clusterData.clusterId}. (${loadedCount - 2}/${manifest.clusters.length})`, totalToLoad);
                })
                .catch(error => {
                    // Decide if one failed cluster load should stop everything or just be logged
                    console.error(`Failed to load data for cluster ${clusterManifestEntry.clusterId}. This cluster will be skipped.`, error);
                    // Optionally, re-throw if critical: throw error;
                });
            clusterLoadPromises.push(promise);
        }

        await Promise.all(clusterLoadPromises);
        console.log("All cluster data loading attempted.");

        reportProgress("All RAG data loaded successfully.", totalToLoad);

        return {
            manifest,
            centroids,
            clustersData: clustersDataMap,
            embeddingDimensions: manifest.embeddingDimensions,
            embeddingModelId: manifest.embeddingModelId,
        };

    } catch (error) {
        console.error("Fatal error during RAG data loading process:", error);
        if (progressCallback) progressCallback({ message: "Error loading RAG data.", loaded: loadedCount, total: 0 });
        throw error; // Re-throw for the main application to handle
    }
}

// Helper to construct full URLs if paths in manifest are relative
function getFullDataUrl(basePath: string, relativePath: string | null): string | null {
    if (!relativePath) return null;
    // Assuming manifestUrl given to loadManifest includes the manifest filename itself.
    // So, basePath should be the path *to the directory containing* the manifest.
    return new URL(relativePath, basePath).toString();
} 