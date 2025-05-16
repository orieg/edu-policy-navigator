#!/usr/bin/env node
// pipeline/scripts/validateEmbeddings.ts

import { promises as fs } from 'fs';
import path from 'path';
import { pipeline, env } from '@huggingface/transformers';
import fetch from 'node-fetch'; // Ensure node-fetch is imported

// --- Configuration (Should match generateClusteredEmbeddings.ts) ---
const OUTPUT_DIR = path.resolve(process.cwd(), 'public', 'embeddings', 'school_districts');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const EXPECTED_EMBEDDING_MODEL_ID = 'Snowflake/snowflake-arctic-embed-xs';
const EXPECTED_EMBEDDING_DIMENSIONS = 384;
const NORMALIZATION_TOLERANCE = 1e-5; // Tolerance for checking L2 norm
const SIMILARITY_SAMPLES_OUTPUT_PATH = path.join(OUTPUT_DIR, '..', 'similarity_validation_samples.json'); // Save one level up from school_districts

// --- NEW: Embedding Mode Configuration ---
type EmbeddingMode = 'local' | 'api';
let EMBEDDING_MODE: EmbeddingMode = 'local'; // Default to local
const API_ENDPOINT = "http://localhost:8000/v1/embeddings"; // Define your API endpoint

const modeArg = process.argv.find(arg => arg.startsWith('--mode='));
if (modeArg) {
    const modeValue = modeArg.split('=')[1];
    if (modeValue === 'api') {
        EMBEDDING_MODE = 'api';
    } else if (modeValue === 'local') {
        EMBEDDING_MODE = 'local';
    } else {
        console.warn(`Invalid --mode value: ${modeValue}. Defaulting to 'local'. Supported: 'local', 'api'.`);
    }
}
// Log mode later, once main function starts or within validateSimilarityAndGenerateSamples
// --- END NEW ---

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
    embeddingModelId: string;
    embeddingDimensions: number;
    clusterAlgorithm: string;
    kmeansKValue: number;
    totalClusters: number;
    centroidsFile: string;
    clusters: ClusterInfo[];
}

interface CentroidEntry {
    clusterId: number;
    centroid: number[];
}

interface SimilaritySample {
    id: string;
    text1: string;
    text2: string;
    embedding1?: number[]; // Optional, for debugging or direct use
    embedding2?: number[]; // Optional
    similarity: number | null; // Renamed from transformersJsSimilarity
    modeUsed: EmbeddingMode;
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

function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
        throw new Error('Vectors must be of the same length to compute cosine similarity.');
    }
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) {
        return 0; // Avoid division by zero if one vector is zero
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- NEW: Helper function for getting embeddings for text samples ---
async function getEmbeddingForTextSample(text: string, currentMode: EmbeddingMode, extractorInstance?: any): Promise<number[] | null> {
    if (currentMode === 'api') {
        // console.log(`Fetching sample embedding via API for: "${text.substring(0,30)}..."`); // Keep console clean
        try {
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Assuming API uses the EXPECTED_EMBEDDING_MODEL_ID or it's configured server-side
                body: JSON.stringify({ input: text, model: EXPECTED_EMBEDDING_MODEL_ID }),
            });
            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`API Error ${response.status} for text sample: ${errorBody}`);
                return null;
            }
            const responseJson = await response.json() as any;
            if (responseJson.data && responseJson.data[0] && responseJson.data[0].embedding) {
                return responseJson.data[0].embedding;
            }
            console.error("API Error: Unexpected response format for text sample.");
            return null;
        } catch (error) {
            console.error(`Error fetching sample embedding from API: ${error}`);
            return null;
        }
    } else { // local mode
        if (!extractorInstance) {
            console.error("Extractor (TF.js pipeline) not provided for local sample embedding mode.");
            return null;
        }
        try {
            const output = await extractorInstance(text, { pooling: 'mean', normalize: true });
            return Array.from(output.data as Float32Array);
        } catch (err) {
            console.warn('Failed to compute sample embedding via local model:', (err as Error).message);
            return null;
        }
    }
}
// --- END NEW ---

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
    if (manifest.embeddingModelId !== EXPECTED_EMBEDDING_MODEL_ID) {
        console.error(`❌ Manifest Error: Unexpected model ID. Expected ${EXPECTED_EMBEDDING_MODEL_ID}, found ${manifest.embeddingModelId}`);
        overallSuccess = false;
    } else {
        console.log(`  ✅ Model ID matches expected (${EXPECTED_EMBEDDING_MODEL_ID}).`);
    }
    if (manifest.embeddingDimensions !== EXPECTED_EMBEDDING_DIMENSIONS) {
        console.error(`❌ Manifest Error: Unexpected dimensions. Expected ${EXPECTED_EMBEDDING_DIMENSIONS}, found ${manifest.embeddingDimensions}`);
        overallSuccess = false;
    } else {
        console.log(`  ✅ Dimensions match expected (${EXPECTED_EMBEDDING_DIMENSIONS}).`);
    }
    if (typeof manifest.kmeansKValue !== 'number' || manifest.kmeansKValue <= 0) {
        console.error(`❌ Manifest Error: Invalid kmeansKValue: ${manifest.kmeansKValue}`);
        overallSuccess = false;
    } else {
        console.log(`  ✅ kmeansKValue is valid (${manifest.kmeansKValue}).`);
    }
    if (typeof manifest.totalClusters !== 'number' || manifest.totalClusters <= 0 || manifest.totalClusters < manifest.kmeansKValue) {
        console.error(`❌ Manifest Error: Invalid totalClusters value: ${manifest.totalClusters} (kmeansKValue: ${manifest.kmeansKValue})`);
        overallSuccess = false;
    } else {
        console.log(`  ✅ totalClusters value is valid (${manifest.totalClusters}).`);
    }
    if (!manifest.centroidsFile || typeof manifest.centroidsFile !== 'string') {
        console.error(`❌ Manifest Error: Invalid or missing centroidsFile.`);
        overallSuccess = false;
    }
    if (!Array.isArray(manifest.clusters) || manifest.clusters.length !== manifest.totalClusters) {
        console.error(`❌ Manifest Error: Clusters array is invalid or length (${manifest.clusters?.length}) does not match totalClusters (${manifest.totalClusters}).`);
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

        if (centroidsData.length !== manifest.totalClusters) {
            console.error(`❌ Centroids Error: Number of centroids (${centroidsData.length}) does not match manifest totalClusters (${manifest.totalClusters}).`);
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
            if (entry.centroid.length !== manifest.embeddingDimensions) {
                console.error(`❌ Centroids Error: Incorrect dimensions for ${context}. Expected ${manifest.embeddingDimensions}, found ${entry.centroid.length}.`);
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
            const expectedSizeBytes = clusterInfo.count * manifest.embeddingDimensions * 4;
            if (buffer.byteLength !== expectedSizeBytes) {
                console.error(`    ❌ Embeddings Error: Incorrect file size. Expected ${expectedSizeBytes} bytes, found ${buffer.byteLength}.`);
                clusterSuccess = false;
            } else {
                console.log(`    ✅ Embeddings file size matches expected (${buffer.byteLength} bytes).`);
            }

            const embeddingsArray = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);

            // Check each embedding
            let numEmbeddingsInFile = 0;
            for (let i = 0; i < embeddingsArray.length; i += manifest.embeddingDimensions) {
                numEmbeddingsInFile++;
                const embedding = embeddingsArray.slice(i, i + manifest.embeddingDimensions);
                const context = `cluster ${clusterInfo.clusterId}, embedding ${numEmbeddingsInFile - 1}`;

                if (embedding.length !== manifest.embeddingDimensions) {
                    // This check should be redundant if file size is correct, but good practice
                    console.error(`    ❌ Embeddings Error: Incorrect dimensions for ${context}. Expected ${manifest.embeddingDimensions}, found ${embedding.length}.`);
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

// --- New Section: Similarity Validation and Sample Generation ---
async function validateSimilarityAndGenerateSamples(): Promise<boolean> {
    console.log(`\n--- Validating Similarity & Generating Samples (Mode: ${EMBEDDING_MODE}) ---`);
    let success = true;
    env.allowLocalModels = true;
    let extractor: any = null;

    if (EMBEDDING_MODE === 'local') {
        try {
            console.log(`  Initializing local embedding model (${EXPECTED_EMBEDDING_MODEL_ID}) for similarity checks...`);
            extractor = await pipeline('feature-extraction', EXPECTED_EMBEDDING_MODEL_ID);
            console.log('  Local embedding model initialized.');
        } catch (error: any) {
            console.error(`❌ Error initializing local Hugging Face Transformers model: ${error.message}`);
            console.warn('  Skipping similarity validation due to model initialization failure.');
            return false; // Cannot proceed with similarity validation if model fails
        }
    }

    const sampleTexts: Omit<SimilaritySample, 'similarity' | 'modeUsed'>[] = [
        {
            id: 'sample1_similar',
            text1: 'The weather is sunny and warm today.',
            text2: 'It is a beautiful day with clear skies and high temperatures.'
        },
        {
            id: 'sample2_dissimilar',
            text1: 'Apples are a type of fruit.',
            text2: 'A bicycle is a mode of transportation.'
        },
        {
            id: 'sample3_identical',
            text1: 'The quick brown fox jumps over the lazy dog.',
            text2: 'The quick brown fox jumps over the lazy dog.'
        },
        {
            id: 'sample4_edge_case_short',
            text1: 'hi',
            text2: 'hello'
        },
        {
            id: 'sample5_school_district_lookup',
            text1: 'Where is SRVUSD?',
            text2: 'The San Ramon Valley Unified School District is located in the San Ramon Valley in California. Its website is https://www.srvusd.net. It is a public school district that serves the cities of San Ramon, Danville, and Alamo.'
        },
        {
            id: 'sample6_school_district_lookup',
            text1: 'SRVUSD, Locations, Grades, Type',
            text2: 'The San Ramon Valley Unified School District is located in the San Ramon Valley in California. Its website is https://www.srvusd.net. It is a public school district that serves the cities of San Ramon, Danville, and Alamo.'
        }
    ];

    const outputSamples: SimilaritySample[] = [];

    try {
        for (const sample of sampleTexts) {
            console.log(`    Processing sample "${sample.id}"...`);
            const text1 = sample.text1;
            const text2 = sample.text2;
            let sim: number | null = null;

            try {
                const emb1 = await getEmbeddingForTextSample(text1, EMBEDDING_MODE, extractor);
                const emb2 = await getEmbeddingForTextSample(text2, EMBEDDING_MODE, extractor);

                if (emb1 && emb2) {
                    if (!checkL2Normalization(emb1, NORMALIZATION_TOLERANCE) || !checkArrayForNaNInf(emb1, `sample ${sample.id} emb1`)) {
                        console.warn(`    ⚠️ Embedding 1 for sample "${sample.id}" is invalid (NaN/Inf or not L2 normalized).`);
                        success = false;
                    }
                    if (!checkL2Normalization(emb2, NORMALIZATION_TOLERANCE) || !checkArrayForNaNInf(emb2, `sample ${sample.id} emb2`)) {
                        console.warn(`    ⚠️ Embedding 2 for sample "${sample.id}" is invalid (NaN/Inf or not L2 normalized).`);
                        success = false;
                    }
                    sim = cosineSimilarity(emb1, emb2);
                    console.log(`      Similarity for "${sample.id}": ${sim.toFixed(4)} (Mode: ${EMBEDDING_MODE})`);
                    // Optionally store embeddings if needed for inspection, but can make JSON large
                    // sample.embedding1 = emb1;
                    // sample.embedding2 = emb2;
                } else {
                    console.warn(`    ⚠️ Could not generate one or both embeddings for sample "${sample.id}". Skipping similarity.`);
                    success = false; // Mark as not fully successful if embeddings fail
                }
            } catch (error: any) {
                console.error(`    ❌ Error processing sample "${sample.id}": ${error.message}`);
                sim = null;
                success = false;
            }
            outputSamples.push({ ...sample, similarity: sim, modeUsed: EMBEDDING_MODE });
        }

        // Save the samples to JSON
        await fs.writeFile(SIMILARITY_SAMPLES_OUTPUT_PATH, JSON.stringify(outputSamples, null, 2));
        console.log(`  ✅ Similarity samples saved to ${SIMILARITY_SAMPLES_OUTPUT_PATH}`);

    } catch (error: any) {
        console.error(`❌ Error during similarity validation setup or processing: ${error.message}`);
        success = false;
    }

    return success;
}

// --- Main Execution ---
async function main() {
    console.log(`INFO: Running validateEmbeddings in mode: ${EMBEDDING_MODE}`);
    const embeddingsValid = await validateEmbeddings();
    const similarityValid = await validateSimilarityAndGenerateSamples();

    if (embeddingsValid && similarityValid) {
        console.log('\nAll validation checks and sample generation completed successfully!');
    } else {
        console.warn('\nSome validation checks or sample generation steps failed. Please review logs.');
        process.exit(1); // Exit with error if any part failed.
    }
}

main().catch(error => {
    console.error('Unhandled error during validation script execution:', error);
    process.exit(1);
}); 