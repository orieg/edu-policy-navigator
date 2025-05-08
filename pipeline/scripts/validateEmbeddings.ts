#!/usr/bin/env node
// pipeline/scripts/validateEmbeddings.ts

import { promises as fs } from 'fs';
import path from 'path';

// --- Configuration (Should match generateClusteredEmbeddings.ts) ---
const OUTPUT_DIR = path.resolve(process.cwd(), 'public', 'embeddings', 'school_districts');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const EXPECTED_EMBEDDING_MODEL_ID = 'Snowflake/snowflake-arctic-embed-xs';
const EXPECTED_EMBEDDING_DIMENSIONS = 384;
const NORMALIZATION_TOLERANCE = 1e-5; // Tolerance for checking L2 norm

// --- Interfaces (Should match generateClusteredEmbeddings.ts output) ---
interface DocumentChunkMetadata {
    type: 'district' | 'school';
    cdsCode: string;
    name: string;
    city: string;
    // Add other expected fields if necessary
}

interface DocumentChunk {
    id: string;
    text: string;
    metadata: DocumentChunkMetadata;
}

interface ClusterInfo {
    clusterId: number;
    count: number;
    embeddingsFile: string | null;
    metadataFile: string | null;
}

interface Manifest {
    model: string;
    dimensions: number;
    clusterAlgorithm: string;
    k: number;
    centroidsFile: string;
    clusters: ClusterInfo[];
}

interface CentroidEntry {
    clusterId: number;
    centroid: number[];
}

// --- Helper Functions ---

// L2 Normalization check helper
function checkL2Normalization(vector: Float32Array | number[], tolerance: number): boolean {
    let normSq = 0;
    for (let i = 0; i < vector.length; i++) {
        if (isNaN(vector[i]) || !isFinite(vector[i])) {
            return false; // Contains invalid numbers
        }
        normSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(normSq);
    return Math.abs(norm - 1.0) < tolerance;
}

function checkArrayForNaNInf(arr: number[] | Float32Array, context: string): boolean {
    for (let i = 0; i < arr.length; i++) {
        if (isNaN(arr[i]) || !isFinite(arr[i])) {
            console.error(`Validation Error: NaN or Infinity found in ${context} at index ${i}`);
            return false;
        }
    }
    return true;
}

// --- Main Validation Logic ---
async function validateEmbeddings(): Promise<boolean> {
    console.log(`Starting validation of embeddings in: ${OUTPUT_DIR}`);
    let overallSuccess = true;

    // 1. Validate Manifest File
    console.log(`\n--- Validating Manifest (${path.basename(MANIFEST_PATH)}) ---`);
    let manifest: Manifest;
    try {
        const manifestContent = await fs.readFile(MANIFEST_PATH, 'utf-8');
        manifest = JSON.parse(manifestContent);
        console.log('  ✅ Manifest file read and parsed successfully.');
    } catch (error: any) {
        console.error(`❌ Error reading or parsing manifest file: ${error.message}`);
        return false; // Cannot proceed without manifest
    }

    // Validate manifest content
    if (manifest.model !== EXPECTED_EMBEDDING_MODEL_ID) {
        console.error(`❌ Manifest Error: Unexpected model ID. Expected ${EXPECTED_EMBEDDING_MODEL_ID}, found ${manifest.model}`);
        overallSuccess = false;
    } else {
        console.log(`  ✅ Model ID matches expected (${EXPECTED_EMBEDDING_MODEL_ID}).`);
    }
    if (manifest.dimensions !== EXPECTED_EMBEDDING_DIMENSIONS) {
        console.error(`❌ Manifest Error: Unexpected dimensions. Expected ${EXPECTED_EMBEDDING_DIMENSIONS}, found ${manifest.dimensions}`);
        overallSuccess = false;
    } else {
        console.log(`  ✅ Dimensions match expected (${EXPECTED_EMBEDDING_DIMENSIONS}).`);
    }
    if (typeof manifest.k !== 'number' || manifest.k <= 0) {
        console.error(`❌ Manifest Error: Invalid K value: ${manifest.k}`);
        overallSuccess = false;
    } else {
        console.log(`  ✅ K value is valid (${manifest.k}).`);
    }
    if (!manifest.centroidsFile || typeof manifest.centroidsFile !== 'string') {
        console.error(`❌ Manifest Error: Invalid or missing centroidsFile.`);
        overallSuccess = false;
    }
    if (!Array.isArray(manifest.clusters) || manifest.clusters.length !== manifest.k) {
        console.error(`❌ Manifest Error: Clusters array is invalid or length (${manifest.clusters?.length}) does not match K (${manifest.k}).`);
        overallSuccess = false;
    } else {
        console.log(`  ✅ Clusters array structure seems valid (length ${manifest.clusters.length}).`);
    }

    // 2. Validate Centroids File
    console.log(`\n--- Validating Centroids (${manifest.centroidsFile}) ---`);
    const centroidsPath = path.join(OUTPUT_DIR, manifest.centroidsFile);
    let centroidsData: CentroidEntry[];
    try {
        const centroidsContent = await fs.readFile(centroidsPath, 'utf-8');
        centroidsData = JSON.parse(centroidsContent);
        if (!Array.isArray(centroidsData)) throw new Error('Centroids data is not an array');
        console.log('  ✅ Centroids file read and parsed successfully.');

        if (centroidsData.length !== manifest.k) {
            console.error(`❌ Centroids Error: Number of centroids (${centroidsData.length}) does not match manifest K (${manifest.k}).`);
            overallSuccess = false;
        } else {
            console.log(`  ✅ Correct number of centroids found (${centroidsData.length}).`);
        }

        for (let i = 0; i < centroidsData.length; i++) {
            const entry = centroidsData[i];
            const context = `centroid ${i} (clusterId ${entry?.clusterId})`;
            if (typeof entry?.clusterId !== 'number' || !Array.isArray(entry?.centroid)) {
                console.error(`❌ Centroids Error: Invalid structure for ${context}.`);
                overallSuccess = false;
                continue;
            }
            if (entry.centroid.length !== manifest.dimensions) {
                console.error(`❌ Centroids Error: Incorrect dimensions for ${context}. Expected ${manifest.dimensions}, found ${entry.centroid.length}.`);
                overallSuccess = false;
            }
            if (!checkArrayForNaNInf(entry.centroid, context)) {
                overallSuccess = false;
            }
            if (!checkL2Normalization(entry.centroid, NORMALIZATION_TOLERANCE)) {
                console.error(`❌ Centroids Error: ${context} is not L2 normalized.`);
                overallSuccess = false;
            }
        }
        if (overallSuccess) {
            console.log(`  ✅ All centroids validated (structure, dimensions, NaN/Inf, normalization).`);
        }

    } catch (error: any) {
        console.error(`❌ Error reading, parsing, or validating centroids file: ${error.message}`);
        overallSuccess = false;
    }

    // 3. Validate Clusters
    console.log(`\n--- Validating Individual Clusters ---`);
    for (const clusterInfo of manifest.clusters) {
        console.log(`\n  -- Validating Cluster ${clusterInfo.clusterId} --`);
        let clusterSuccess = true;

        if (clusterInfo.count === 0) {
            if (clusterInfo.embeddingsFile !== null || clusterInfo.metadataFile !== null) {
                console.error(`  ❌ Cluster ${clusterInfo.clusterId} Error: Manifest indicates count 0 but file paths are not null.`);
                clusterSuccess = false;
            } else {
                console.log(`  ✅ Cluster ${clusterInfo.clusterId}: Empty cluster, files correctly marked as null.`);
            }
            overallSuccess = overallSuccess && clusterSuccess;
            continue; // Skip file checks for empty clusters
        }

        if (!clusterInfo.embeddingsFile || !clusterInfo.metadataFile) {
            console.error(`  ❌ Cluster ${clusterInfo.clusterId} Error: Manifest indicates count > 0 but file paths are missing.`);
            clusterSuccess = false;
            overallSuccess = false;
            continue;
        }

        const embeddingsPath = path.join(OUTPUT_DIR, clusterInfo.embeddingsFile);
        const metadataPath = path.join(OUTPUT_DIR, clusterInfo.metadataFile);

        // Validate Metadata File
        let metadataEntries: DocumentChunk[];
        try {
            const metadataContent = await fs.readFile(metadataPath, 'utf-8');
            metadataEntries = JSON.parse(metadataContent);
            if (!Array.isArray(metadataEntries)) throw new Error('Metadata is not an array');
            console.log(`    ✅ Metadata file (${path.basename(metadataPath)}) read and parsed.`);

            if (metadataEntries.length !== clusterInfo.count) {
                console.error(`    ❌ Metadata Error: Count mismatch. Manifest: ${clusterInfo.count}, File: ${metadataEntries.length}.`);
                clusterSuccess = false;
            } else {
                console.log(`    ✅ Metadata count matches manifest (${metadataEntries.length}).`);
            }

            // Basic structure check on first entry
            if (metadataEntries.length > 0) {
                const firstEntry = metadataEntries[0];
                if (typeof firstEntry?.id !== 'string' || typeof firstEntry?.text !== 'string' || typeof firstEntry?.metadata?.cdsCode !== 'string') {
                    console.error(`    ❌ Metadata Error: Invalid structure detected in first entry.`);
                    clusterSuccess = false;
                } else {
                    console.log(`    ✅ Basic structure of first metadata entry seems valid.`);
                }
            }

        } catch (error: any) {
            console.error(`    ❌ Error reading, parsing, or validating metadata file ${metadataPath}: ${error.message}`);
            clusterSuccess = false;
        }

        // Validate Embeddings File
        try {
            const buffer = await fs.readFile(embeddingsPath);
            console.log(`    ✅ Embeddings file (${path.basename(embeddingsPath)}) read successfully.`);
            const expectedSizeBytes = clusterInfo.count * manifest.dimensions * 4; // Float32 = 4 bytes
            if (buffer.byteLength !== expectedSizeBytes) {
                console.error(`    ❌ Embeddings Error: Incorrect file size. Expected ${expectedSizeBytes} bytes, found ${buffer.byteLength}.`);
                clusterSuccess = false;
            } else {
                console.log(`    ✅ Embeddings file size matches expected (${buffer.byteLength} bytes).`);
            }

            const embeddingsArray = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);

            // Check each embedding
            let numEmbeddingsInFile = 0;
            for (let i = 0; i < embeddingsArray.length; i += manifest.dimensions) {
                numEmbeddingsInFile++;
                const embedding = embeddingsArray.slice(i, i + manifest.dimensions);
                const context = `cluster ${clusterInfo.clusterId}, embedding ${numEmbeddingsInFile - 1}`;

                if (embedding.length !== manifest.dimensions) {
                    // This check should be redundant if file size is correct, but good practice
                    console.error(`    ❌ Embeddings Error: Incorrect dimensions for ${context}. Expected ${manifest.dimensions}, found ${embedding.length}.`);
                    clusterSuccess = false;
                    break; // Stop checking this file if dimensions are wrong early
                }
                if (!checkArrayForNaNInf(embedding, context)) {
                    clusterSuccess = false;
                }
                if (!checkL2Normalization(embedding, NORMALIZATION_TOLERANCE)) {
                    console.error(`    ❌ Embeddings Error: ${context} is not L2 normalized.`);
                    clusterSuccess = false;
                }
            }

            if (numEmbeddingsInFile !== clusterInfo.count) {
                console.error(`    ❌ Embeddings Error: Number of embeddings in file (${numEmbeddingsInFile}) does not match manifest count (${clusterInfo.count}).`);
                clusterSuccess = false;
            } else if (clusterSuccess) {
                console.log(`    ✅ All ${numEmbeddingsInFile} embeddings validated (dimensions, NaN/Inf, normalization).`);
            }

        } catch (error: any) {
            console.error(`    ❌ Error reading or validating embeddings file ${embeddingsPath}: ${error.message}`);
            clusterSuccess = false;
        }

        if (clusterSuccess) {
            console.log(`  ✅ Cluster ${clusterInfo.clusterId} validation passed.`);
        } else {
            console.log(`  ❌ Cluster ${clusterInfo.clusterId} validation failed.`);
        }
        overallSuccess = overallSuccess && clusterSuccess;
    }

    console.log('\n--- Validation Summary ---');
    if (overallSuccess) {
        console.log('✅ All validation checks passed!');
    } else {
        console.log('❌ Some validation checks failed. Please review the errors above.');
    }

    return overallSuccess;
}

// Run the validation
validateEmbeddings()
    .then(success => {
        process.exit(success ? 0 : 1);
    })
    .catch(error => {
        console.error("\nUnhandled error during validation:", error);
        process.exit(1);
    }); 