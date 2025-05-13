#!/usr/bin/env node
// pipeline/scripts/validateRAGData.ts

// Note: Run this script from the project root directory.

import { promises as fs } from 'fs';
import path from 'path';

// Configuration - Should match generateClusteredEmbeddings.ts
const OUTPUT_DIR = path.resolve(process.cwd(), 'public', 'embeddings', 'school_districts');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const FLOAT32_BYTES = 4;

interface ManifestCluster {
    clusterId: number;
    count: number;
    embeddingsFile: string | null;
    metadataFile: string | null;
}

interface Manifest {
    embeddingModelId: string;
    embeddingDimensions: number;
    clusterAlgorithm: string;
    kValue: number;
    centroidsFile: string;
    clusters: ManifestCluster[];
}

interface CentroidEntry {
    clusterId: number;
    centroid: number[];
}

let errorCount = 0;

function logError(message: string, ...args: any[]) {
    console.error(`❌ Error: ${message}`, ...args);
    errorCount++;
}

function logInfo(message: string, ...args: any[]) {
    console.log(`✅ Info: ${message}`, ...args);
}

async function checkFileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error) {
        return false;
    }
}

async function getFileSize(filePath: string): Promise<number | null> {
    try {
        const stats = await fs.stat(filePath);
        return stats.size;
    } catch (error) {
        return null;
    }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(fileContent) as T;
    } catch (error: any) {
        logError(`Failed to read or parse JSON file: ${filePath}`, error.message);
        return null;
    }
}

async function main() {
    logInfo(`Starting validation for RAG data in: ${OUTPUT_DIR}`);

    // 1. Check Manifest
    logInfo(`Checking manifest file: ${MANIFEST_PATH}`);
    if (!(await checkFileExists(MANIFEST_PATH))) {
        logError(`Manifest file not found at ${MANIFEST_PATH}`);
        process.exit(1);
    }

    const manifest = await readJsonFile<Manifest>(MANIFEST_PATH);
    if (!manifest) {
        logError('Manifest file could not be read or parsed.');
        process.exit(1);
    }
    logInfo('Manifest file read successfully.');

    // 2. Validate Manifest Content
    let manifestValid = true;
    const requiredKeys: (keyof Manifest)[] = ['embeddingModelId', 'embeddingDimensions', 'kValue', 'centroidsFile', 'clusters'];
    for (const key of requiredKeys) {
        if (manifest[key] === undefined || manifest[key] === null) {
            logError(`Manifest is missing required key: "${key}"`);
            manifestValid = false;
        }
    }
    if (typeof manifest.embeddingDimensions !== 'number' || !Number.isInteger(manifest.embeddingDimensions) || manifest.embeddingDimensions <= 0) {
        logError(`Manifest "embeddingDimensions" must be a positive integer. Found: ${manifest.embeddingDimensions}`);
        manifestValid = false;
    }
    if (typeof manifest.kValue !== 'number' || !Number.isInteger(manifest.kValue) || manifest.kValue < 0) {
        logError(`Manifest "kValue" must be a non-negative integer. Found: ${manifest.kValue}`);
        manifestValid = false;
    }
    if (!Array.isArray(manifest.clusters)) {
        logError(`Manifest "clusters" must be an array. Found: ${typeof manifest.clusters}`);
        manifestValid = false;
    }
    if (manifestValid && manifest.clusters.length !== manifest.kValue) {
        logError(`Manifest "kValue" (${manifest.kValue}) does not match the number of entries in "clusters" (${manifest.clusters.length}).`);
        manifestValid = false;
    }

    if (!manifestValid) {
        logError('Manifest content validation failed.');
        process.exit(1);
    }
    logInfo('Manifest content validated.');
    const dimensions = manifest.embeddingDimensions;
    const kValue = manifest.kValue;

    // 3. Check Centroids File
    const centroidsFilePath = path.join(OUTPUT_DIR, manifest.centroidsFile);
    logInfo(`Checking centroids file: ${centroidsFilePath}`);
    if (!(await checkFileExists(centroidsFilePath))) {
        logError(`Centroids file specified in manifest ("${manifest.centroidsFile}") not found at ${centroidsFilePath}`);
    } else {
        const centroidsData = await readJsonFile<CentroidEntry[]>(centroidsFilePath);
        if (centroidsData) {
            if (!Array.isArray(centroidsData)) {
                logError(`Centroids file (${centroidsFilePath}) does not contain a JSON array.`);
            } else if (centroidsData.length !== kValue) {
                logError(`Number of centroids in ${centroidsFilePath} (${centroidsData.length}) does not match manifest kValue (${kValue}).`);
            } else {
                logInfo(`Centroids file contains expected number of centroids (${kValue}).`);
                centroidsData.forEach((entry, index) => {
                    if (entry.clusterId === undefined || entry.centroid === undefined) {
                        logError(`Centroid entry at index ${index} in ${centroidsFilePath} is missing "clusterId" or "centroid".`);
                    } else if (typeof entry.clusterId !== 'number') {
                        logError(`Centroid entry at index ${index} in ${centroidsFilePath} has non-number "clusterId".`);
                    } else if (!Array.isArray(entry.centroid)) {
                        logError(`Centroid entry at index ${index} (ID ${entry.clusterId}) in ${centroidsFilePath} has non-array "centroid".`);
                    } else if (entry.centroid.length !== dimensions) {
                        logError(`Centroid vector for clusterId ${entry.clusterId} in ${centroidsFilePath} has incorrect length (${entry.centroid.length}). Expected ${dimensions}.`);
                    }
                });
            }
        }
    }

    // 4. Check Cluster Files
    logInfo(`Checking files for ${kValue} clusters...`);
    for (const clusterInfo of manifest.clusters) {
        const clusterId = clusterInfo.clusterId;
        const count = clusterInfo.count;
        const embeddingsFile = clusterInfo.embeddingsFile;
        const metadataFile = clusterInfo.metadataFile;

        if (clusterId === undefined || count === undefined || embeddingsFile === undefined || metadataFile === undefined) {
            logError(`Cluster entry for ID ${clusterId ?? '?'} in manifest is missing required fields.`);
            continue;
        }

        const clusterDirPath = path.join(OUTPUT_DIR, `cluster_${clusterId}`); // Assuming naming convention

        if (count > 0) {
            // Validate non-empty cluster
            if (!metadataFile) {
                logError(`Cluster ${clusterId}: Manifest lists count > 0 but metadataFile is null/missing.`);
            } else {
                const metadataFilePath = path.join(OUTPUT_DIR, metadataFile);
                if (!(await checkFileExists(metadataFilePath))) {
                    logError(`Cluster ${clusterId}: Metadata file ("${metadataFile}") not found at ${metadataFilePath}`);
                } else {
                    const metadata = await readJsonFile<any[]>(metadataFilePath);
                    if (metadata && !Array.isArray(metadata)) {
                        logError(`Cluster ${clusterId}: Metadata file (${metadataFilePath}) does not contain a JSON array.`);
                    } else if (metadata && metadata.length !== count) {
                        logError(`Cluster ${clusterId}: Metadata file (${metadataFilePath}) contains ${metadata.length} items, but manifest count is ${count}.`);
                    }
                }
            }

            if (!embeddingsFile) {
                logError(`Cluster ${clusterId}: Manifest lists count > 0 but embeddingsFile is null/missing.`);
            } else {
                const embeddingsFilePath = path.join(OUTPUT_DIR, embeddingsFile);
                if (!(await checkFileExists(embeddingsFilePath))) {
                    logError(`Cluster ${clusterId}: Embeddings file ("${embeddingsFile}") not found at ${embeddingsFilePath}`);
                } else {
                    const fileSize = await getFileSize(embeddingsFilePath);
                    const expectedSize = count * dimensions * FLOAT32_BYTES;
                    if (fileSize === null) {
                        logError(`Cluster ${clusterId}: Could not get file size for embeddings file: ${embeddingsFilePath}`);
                    } else if (fileSize !== expectedSize) {
                        logError(`Cluster ${clusterId}: Embeddings file (${embeddingsFilePath}) has incorrect size. Found ${fileSize} bytes, expected ${expectedSize} bytes (${count} * ${dimensions} * ${FLOAT32_BYTES}).`);
                    }
                }
            }
        } else { // count === 0
            // Validate empty cluster files (should be null in manifest or size 0)
            if (metadataFile) {
                const metadataFilePath = path.join(OUTPUT_DIR, metadataFile);
                const fileSize = await getFileSize(metadataFilePath);
                if (fileSize !== null && fileSize !== 0) {
                    logError(`Cluster ${clusterId}: Manifest count is 0, but metadata file ("${metadataFile}") exists and is not empty (${fileSize} bytes).`);
                }
            }
            if (embeddingsFile) {
                const embeddingsFilePath = path.join(OUTPUT_DIR, embeddingsFile);
                const fileSize = await getFileSize(embeddingsFilePath);
                if (fileSize !== null && fileSize !== 0) {
                    logError(`Cluster ${clusterId}: Manifest count is 0, but embeddings file ("${embeddingsFile}") exists and is not empty (${fileSize} bytes).`);
                }
            }
        }
    }

    // 5. Final Result
    if (errorCount === 0) {
        logInfo('----------------------------------------');
        logInfo('RAG data structure validation passed!');
        logInfo('----------------------------------------');
    } else {
        console.error('--------------------------------------------');
        console.error(` RAG data structure validation FAILED with ${errorCount} error(s).`);
        console.error('--------------------------------------------');
        process.exit(1);
    }
}

main().catch(error => {
    console.error('An unexpected error occurred during validation:', error);
    process.exit(1);
}); 