#!/usr/bin/env node
// pipeline/scripts/validateEmbeddings.ts

import { promises as fs } from 'fs';
import path from 'path';
import { pipeline, env } from '@xenova/transformers';

// --- Configuration (Should match generateClusteredEmbeddings.ts) ---
const OUTPUT_DIR = path.resolve(process.cwd(), 'public', 'embeddings', 'school_districts');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const EXPECTED_EMBEDDING_MODEL_ID = 'Snowflake/snowflake-arctic-embed-xs';
const EXPECTED_EMBEDDING_DIMENSIONS = 384;
const NORMALIZATION_TOLERANCE = 1e-5; // Tolerance for checking L2 norm
const SIMILARITY_SAMPLES_OUTPUT_PATH = path.join(OUTPUT_DIR, '..', 'similarity_validation_samples.json'); // Save one level up from school_districts

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
interface SimilaritySample {
    id: string;
    text1: string;
    text2: string;
    embedding1?: number[]; // Optional, for debugging or direct use
    embedding2?: number[]; // Optional
    transformersJsSimilarity: number | null;
}

async function validateSimilarityAndGenerateSamples(): Promise<boolean> {
    console.log(`\n--- Validating Similarity & Generating Samples (${path.basename(SIMILARITY_SAMPLES_OUTPUT_PATH)}) ---`);
    let success = true;

    const sampleTexts: Omit<SimilaritySample, 'transformersJsSimilarity'>[] = [
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
        }
    ];

    const outputSamples: SimilaritySample[] = [];

    try {
        // Configure transformers.js for Node.js environment
        env.allowLocalModels = true; // Assuming model might be cached locally by previous runs
        env.allowRemoteModels = true;
        env.useBrowserCache = false; // Not in browser
        env.localModelPath = path.resolve(process.cwd(), 'models'); // If you have a dedicated local model path
        env.cacheDir = path.resolve(process.cwd(), '.cache', 'transformers-cache'); // Cache for node

        console.log(`  Initializing feature-extraction pipeline with model: ${EXPECTED_EMBEDDING_MODEL_ID}`);
        const extractor = await pipeline('feature-extraction', EXPECTED_EMBEDDING_MODEL_ID, {
            quantized: false, // Ensure we get float32 for best comparison initially
            progress_callback: (progress: any) => {
                if (progress.status === 'progress') {
                    // console.log(`    Model loading progress: ${progress.file} ${Math.round(progress.loaded / progress.total * 100)}%`);
                } else if (progress.status === 'ready') {
                    console.log('    Feature extraction pipeline ready.');
                }
            }
        });
        console.log('  ✅ Feature extraction pipeline initialized.');

        for (const sample of sampleTexts) {
            console.log(`    Processing sample: ${sample.id}`);
            let emb1: number[] | undefined;
            let emb2: number[] | undefined;
            let similarity: number | null = null;

            try {
                const output1 = await extractor(sample.text1, { pooling: 'cls', normalize: true });
                emb1 = Array.from(output1.data as Float32Array);

                const output2 = await extractor(sample.text2, { pooling: 'cls', normalize: true });
                emb2 = Array.from(output2.data as Float32Array);

                if (emb1.length !== EXPECTED_EMBEDDING_DIMENSIONS || emb2.length !== EXPECTED_EMBEDDING_DIMENSIONS) {
                    console.error(`    ❌ Sample ${sample.id} Error: Embedding dimension mismatch. Got ${emb1.length}, ${emb2.length}. Expected ${EXPECTED_EMBEDDING_DIMENSIONS}`);
                    success = false;
                    // Continue to next sample but mark this one as failed.
                } else {
                    similarity = cosineSimilarity(emb1, emb2);
                    console.log(`      Text 1: "${sample.text1.substring(0, 30)}..."`);
                    console.log(`      Text 2: "${sample.text2.substring(0, 30)}..."`);
                    console.log(`      Similarity (transformers.js): ${similarity?.toFixed(6)}`);
                }
            } catch (e: any) {
                console.error(`    ❌ Sample ${sample.id} Error generating embeddings or similarity: ${e.message}`);
                success = false;
            }
            outputSamples.push({ ...sample, embedding1: emb1, embedding2: emb2, transformersJsSimilarity: similarity });
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
    const validationSuccess = await validateEmbeddings();
    if (!validationSuccess) {
        console.error('\nCore embedding validation failed. Some tests were unsuccessful.');
        // process.exit(1); // Decide if core failure should halt everything
    }

    const similarityTestSuccess = await validateSimilarityAndGenerateSamples();
    if (!similarityTestSuccess) {
        console.error('\nSimilarity validation and sample generation encountered errors.');
    }

    if (validationSuccess && similarityTestSuccess) {
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