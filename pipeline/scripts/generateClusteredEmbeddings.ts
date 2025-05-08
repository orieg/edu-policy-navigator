#!/usr/bin/env node
// pipeline/scripts/generateClusteredEmbeddings.ts

// Note: Run this script from the project root directory.

import { pipeline, env, AutoTokenizer, AutoModel, Tensor } from "@xenova/transformers";
import { kmeans } from "ml-kmeans"; // Changed: Use named import
import { promises as fs } from 'fs';
import path from 'path';

// Allow local models
env.allowLocalModels = true;
// env.localModelPath = path.resolve(process.cwd(), 'models'); // Optional: if you have models stored locally

// Configuration
const INPUT_DISTRICTS_JSON_PATH = path.resolve(process.cwd(), 'public', 'assets', 'districts.json');
const INPUT_SCHOOLS_JSON_PATH = path.resolve(process.cwd(), 'public', 'assets', 'schools_by_district.json');
const OUTPUT_DIR = path.resolve(process.cwd(), 'public', 'embeddings', 'school_districts');
const OUTPUT_MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const RAW_EMBEDDINGS_CACHE_DIR = path.resolve(process.cwd(), 'public', 'embeddings', '.caches', 'school_districts'); // New cache directory
const EMBEDDING_MODEL_ID = 'Snowflake/snowflake-arctic-embed-xs';
const EMBEDDING_DIMENSIONS = 384; // For Snowflake/snowflake-arctic-embed-xs
const MAX_CHUNK_LENGTH = 512; // Max tokens for the embedding model
let NUM_CLUSTERS_K = 12; // Default K, will be adjusted if less documents than K

interface DocumentChunk {
    id: string; // Unique ID for the document chunk (typically CDSCode for schools/districts)
    text: string; // The actual text content of the chunk
    metadata: { // Relevant metadata for the chunk
        type: 'district' | 'school';
        cdsCode: string;
        name: string;
        city: string;
        // Add any other fields from originalData that might be useful for display or filtering client-side
    };
}

interface ProcessedDocument {
    id: string; // district_CDSCODE or school_CDSCODE
    type: 'district' | 'school';
    cdsCode: string;
    text: string; // Constructed narrative text
    originalData: Record<string, any>; // The original JSON object for the district/school
}

// --- Helper Functions ---

async function loadAndPrepareData(): Promise<ProcessedDocument[]> {
    console.log('Loading and preparing data...');
    const documents: ProcessedDocument[] = [];

    // Read Districts
    console.log(`Reading districts from: ${INPUT_DISTRICTS_JSON_PATH}`);
    const districtsFileContent = await fs.readFile(INPUT_DISTRICTS_JSON_PATH, 'utf-8');
    const districtsData = JSON.parse(districtsFileContent);
    if (typeof districtsData !== 'object' || districtsData === null || Array.isArray(districtsData)) {
        console.error('Error: districtsData is not an object or is an array. Expected an object mapping CDS codes to district info.');
        throw new Error('Invalid districts.json format');
    }
    const districtList = Object.values(districtsData as Record<string, any>);
    console.log(`Found ${districtList.length} raw district entries.`);

    // Read Schools by District
    console.log(`Reading schools from: ${INPUT_SCHOOLS_JSON_PATH}`);
    const schoolsFileContent = await fs.readFile(INPUT_SCHOOLS_JSON_PATH, 'utf-8');
    const schoolsByDistrictData = JSON.parse(schoolsFileContent);
    if (typeof schoolsByDistrictData !== 'object' || schoolsByDistrictData === null) {
        console.error('Error: schoolsByDistrictData is not an object.');
        throw new Error('Invalid schools_by_district.json format');
    }
    console.log(`School data loaded for ${Object.keys(schoolsByDistrictData).length} districts.`);

    // Process Districts
    for (const district of districtList) {
        if (district.Status !== 'Active') {
            continue;
        }
        const districtName = district.District || 'Unknown District';
        const cdsCode = district['CDS Code'] || 'N/A';
        if (cdsCode === 'N/A') {
            console.warn(`Skipping district with N/A CDS Code: ${districtName}`);
            continue;
        }
        const county = district.County || 'N/A';
        const city = district['Street City'] || 'N/A';
        const streetAddress = district['Street Address'];
        const entityType = district['Entity Type'] || 'educational institution';

        let districtText = `The ${districtName} (${cdsCode}) is a ${entityType}`;
        if (streetAddress && streetAddress !== 'No Data') {
            districtText += ` located at ${streetAddress} in ${city}, ${county} County, California.`;
        } else {
            districtText += ` located in ${city}, ${county} County, California.`;
        }
        if (district['Funding Type'] && district['Funding Type'] !== 'No Data') {
            districtText += ` Funding Type: ${district['Funding Type']}.`;
        }

        documents.push({
            id: cdsCode, // Changed: Use CDSCode directly as ID
            type: 'district',
            cdsCode: cdsCode,
            text: districtText,
            originalData: { ...district }
        });
    }
    console.log(`Processed ${documents.length} active districts.`);
    const initialDocCount = documents.length;

    // Process Schools
    for (const districtCdsKey in schoolsByDistrictData) {
        const schoolsInDistrict = schoolsByDistrictData[districtCdsKey];
        if (!Array.isArray(schoolsInDistrict)) {
            console.warn(`No schools array found for district CDS: ${districtCdsKey}, skipping.`);
            continue;
        }
        const parentDistrict = districtList.find(d => d['CDS Code'] === districtCdsKey);
        const parentDistrictName = parentDistrict?.District || 'Unknown District';

        for (const school of schoolsInDistrict) {
            if (school.Status !== 'Active' || school['Public Yes/No'] !== 'Y') {
                continue;
            }
            const schoolName = school.School || 'Unknown School';
            const schoolCdsCode = school['CDS Code'] || 'N/A';
            if (schoolCdsCode === 'N/A') {
                console.warn(`Skipping school with N/A CDS Code: ${schoolName} in district ${districtCdsKey}`);
                continue;
            }
            const schoolType = school['Educational Program Type'] || 'school';
            const schoolCity = school['Street City'] || 'N/A';
            const streetAddress = school['Street Address'];
            const lowGrade = school['Low Grade'];
            const highGrade = school['High Grade'];
            const website = school.Website;

            let schoolText = `The ${schoolName} (${schoolCdsCode}) is a ${schoolType}`;
            if (streetAddress && streetAddress !== 'No Data') {
                schoolText += ` located at ${streetAddress} in ${schoolCity}, California,`;
            } else {
                schoolText += ` located in ${schoolCity}, California,`;
            }
            schoolText += ` and is part of the ${parentDistrictName} district (${districtCdsKey}).`;

            if (lowGrade && highGrade && lowGrade !== 'No Data' && highGrade !== 'No Data') {
                if (lowGrade === 'P' && highGrade === 'Adult') {
                    schoolText += ` It serves a wide range of grade levels from Preschool through Adult education.`;
                } else if (lowGrade === 'P') {
                    schoolText += ` It serves grades from Preschool to ${highGrade}.`;
                } else if (highGrade === 'Adult') {
                    schoolText += ` It serves grades from ${lowGrade} through Adult education.`;
                } else {
                    schoolText += ` It serves grades ${lowGrade} to ${highGrade}.`;
                }
            } else if (lowGrade && lowGrade !== 'No Data') {
                schoolText += ` It serves grade ${lowGrade} and potentially others.`;
            } else if (highGrade && highGrade !== 'No Data') {
                schoolText += ` It serves up to grade ${highGrade}.`;
            }

            if (website && website !== 'No Data') {
                schoolText += ` Its website is ${website}.`;
            }

            documents.push({
                id: schoolCdsCode, // Changed: Use CDSCode directly as ID
                type: 'school',
                cdsCode: schoolCdsCode,
                text: schoolText,
                originalData: { ...school, districtCdsCode: districtCdsKey }
            });
        }
    }
    console.log(`Processed ${documents.length - initialDocCount} active public schools.`);
    console.log(`Total documents to embed: ${documents.length}`);
    return documents;
}

// Helper function to save a single embedding to a binary file
async function saveEmbeddingToCache(filePath: string, embedding: number[]): Promise<void> {
    try {
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true }); // Ensure directory exists
        const float32Embedding = new Float32Array(embedding);
        await fs.writeFile(filePath, Buffer.from(float32Embedding.buffer));
        // console.log(`Cached embedding to ${filePath}`); // Optional: for verbose logging
    } catch (error: any) {
        console.warn(`Warning: Could not save embedding to cache file ${filePath}: ${error.message}`);
    }
}

// Helper function to load a single embedding from a binary file
async function loadEmbeddingFromCache(filePath: string, expectedDimensions: number): Promise<number[] | null> {
    try {
        const buffer = await fs.readFile(filePath);
        // Each float32 is 4 bytes
        if (buffer.byteLength !== expectedDimensions * 4) {
            console.warn(`Warning: Cached embedding file ${filePath} has incorrect size. Expected ${expectedDimensions * 4} bytes, got ${buffer.byteLength}. Re-generating.`);
            await fs.unlink(filePath); // Delete invalid cache file
            return null;
        }
        const float32Embedding = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
        return Array.from(float32Embedding);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            // File not found, which is expected if not cached
            return null;
        }
        console.warn(`Warning: Could not load embedding from cache file ${filePath}: ${error.message}. Re-generating.`);
        try {
            await fs.unlink(filePath); // Attempt to delete corrupted/unreadable cache file
        } catch (unlinkError: any) {
            // ignore if unlinking also fails
        }
        return null;
    }
}

// Helper function to normalize embeddings to L2 unit norm
function normalizeL2(embeddings: Float32Array | number[]): Float32Array {
    const tensorEmbeddings = embeddings instanceof Float32Array ? embeddings : new Float32Array(embeddings);
    let norm = 0;
    for (let i = 0; i < tensorEmbeddings.length; i++) {
        norm += tensorEmbeddings[i] * tensorEmbeddings[i];
    }
    norm = Math.sqrt(norm);
    if (norm === 0) return tensorEmbeddings; // Avoid division by zero for zero vectors
    const normalized = tensorEmbeddings.map(x => x / norm);
    return normalized;
}

// Modified getEmbedding to use the pipeline
async function getEmbedding(text: string, extractor: any): Promise<number[]> {
    // 1. Input Text Validation
    if (!text || text.trim().length === 0) {
        console.warn(`\nWarning: Attempted to generate embedding for empty or whitespace-only text. Skipping.`);
        return []; // Return empty array to signify failure
    }

    try {
        // Use the pipeline directly for embedding, pooling, and normalization
        const output = await extractor(text, { pooling: 'mean', normalize: true });

        if (!(output instanceof Tensor)) {
            console.error(`\nError: Pipeline output is not a Tensor for text (start): "${text.substring(0, 100)}...". Type: ${typeof output}, Value:`, output);
            return [];
        }

        if (output.dims.length === 0 || output.dims[0] === 0 || output.dims[1] !== EMBEDDING_DIMENSIONS) {
            console.error(`\nError: Pipeline output tensor has unexpected dimensions ${output.dims} for text (start): "${text.substring(0, 100)}...". Expected [1, ${EMBEDDING_DIMENSIONS}]. Skipping.`);
            return [];
        }

        const embeddingData = await output.data as Float32Array;

        // Validate final pipeline output
        for (let i = 0; i < embeddingData.length; ++i) {
            if (isNaN(embeddingData[i]) || !isFinite(embeddingData[i])) {
                console.error(`\nError: NaN or Infinity detected in final pipeline output data at index ${i} for text (start): "${text.substring(0, 100)}...". Skipping.`);
                return [];
            }
        }

        // Check final length just in case
        if (embeddingData.length !== EMBEDDING_DIMENSIONS) {
            console.error(`\nError: Final pipeline embedding has unexpected length ${embeddingData.length} (expected ${EMBEDDING_DIMENSIONS}) for text: "${text.substring(0, 100)}...". Skipping.`);
            return [];
        }

        return Array.from(embeddingData); // Return the first (and only) embedding in the batch

    } catch (error: any) {
        console.error(`\nError during pipeline execution for text (start): "${text.substring(0, 100)}...": ${error.message}`);
        return [];
    }
}

async function performKMeans(embeddings: Float32Array[], k: number, allDocumentChunks: DocumentChunk[]): Promise<{ centroids: Float32Array[], assignments: number[] }> {
    console.log(`Performing K-Means clustering with K=${k} for ${embeddings.length} embeddings.`);
    const dataForKMeans = embeddings.map(emb => Array.from(emb));

    if (dataForKMeans.length === 0 && k > 0) {
        console.error("KMeans error: dataForKMeans is empty but k > 0.");
        throw new Error("Cannot perform K-Means on empty dataset with k > 0");
    }
    if (k === 0) {
        console.warn("KMeans warning: k is 0. Returning empty results.");
        return { centroids: [], assignments: [] };
    }

    let effectiveK = k;
    if (effectiveK > dataForKMeans.length) {
        console.warn(`KMeans warning: k (${effectiveK}) is greater than the number of data points (${dataForKMeans.length}). Adjusting k to ${dataForKMeans.length}.`);
        effectiveK = dataForKMeans.length;
        if (effectiveK === 0) {
            console.warn("KMeans warning: k adjusted to 0 due to empty dataset. Returning empty results.");
            return { centroids: [], assignments: [] };
        }
    }

    console.log(`Calling ml-kmeans with (potentially filtered) ${dataForKMeans.length} points and k=${effectiveK}.`);

    const validEmbeddings: number[][] = [];
    const originalIndexToValidIndex: { [originalIndex: number]: number } = {};
    const invalidIndices = new Set<number>();
    let validIndexCounter = 0;

    // Check for NaN/Infinity and create filtered list
    if (dataForKMeans.length > 0) {
        const firstEmbeddingLength = dataForKMeans[0].length;
        if (firstEmbeddingLength === 0) {
            throw new Error("Embeddings have zero length.");
        }
        for (let i = 0; i < dataForKMeans.length; ++i) {
            const currentEmbedding = dataForKMeans[i];
            let isValid = true;
            if (currentEmbedding.length !== firstEmbeddingLength) {
                console.warn(`WARNING: Embedding at index ${i} (ID: ${allDocumentChunks[i]?.id || 'N/A'}) has inconsistent length ${currentEmbedding.length}. Skipping.`);
                isValid = false;
            }
            for (let j = 0; j < currentEmbedding.length; ++j) {
                if (isNaN(currentEmbedding[j]) || !isFinite(currentEmbedding[j])) {
                    console.warn(`WARNING: Embedding at index ${i} (ID: ${allDocumentChunks[i]?.id || 'N/A'}) contains invalid number ${currentEmbedding[j]} at dimension ${j}. Skipping.`);
                    isValid = false;
                    break; // No need to check further dimensions for this embedding
                }
            }

            if (isValid) {
                validEmbeddings.push(currentEmbedding);
                originalIndexToValidIndex[i] = validIndexCounter++;
            } else {
                invalidIndices.add(i);
            }
        }
        console.log(`Filtered out ${invalidIndices.size} invalid embeddings. Proceeding with ${validEmbeddings.length} valid embeddings.`);

        // Adjust effectiveK again based on the *valid* number of embeddings
        if (effectiveK > validEmbeddings.length) {
            console.warn(`KMeans warning: effectiveK (${effectiveK}) is greater than the number of *valid* data points (${validEmbeddings.length}). Adjusting k to ${validEmbeddings.length}.`);
            effectiveK = validEmbeddings.length;
            if (effectiveK === 0) {
                console.warn("KMeans warning: effectiveK adjusted to 0 due to no valid embeddings. Returning empty results.");
                // Return assignments array matching original length, filled with -1
                return { centroids: [], assignments: Array(embeddings.length).fill(-1) };
            }
        }

    } else { // Original dataForKMeans was empty
        console.warn("KMeans warning: Initial dataset was empty. Returning empty results.");
        return { centroids: [], assignments: [] }; // Should match original length? If original was 0, this is fine.
    }

    if (validEmbeddings.length === 0) {
        console.warn("KMeans warning: No valid embeddings left after filtering. Returning empty results.");
        return { centroids: [], assignments: Array(embeddings.length).fill(-1) };
    }

    // Run kmeans on the filtered data
    const kmeansResult = kmeans(validEmbeddings, effectiveK, {
        initialization: 'random',
        maxIterations: 300,
    });

    // Centroids are based on valid embeddings
    const normalizedCentroids = kmeansResult.centroids.map((centroidArray: number[]) => normalizeL2(new Float32Array(centroidArray)));
    const validAssignments = kmeansResult.clusters; // Assignments for valid embeddings

    // Map assignments back to the original full list length
    const finalAssignments = Array(embeddings.length).fill(-1); // Initialize with -1 (invalid cluster)
    for (let originalIndex = 0; originalIndex < embeddings.length; ++originalIndex) {
        if (!invalidIndices.has(originalIndex)) {
            const validIndex = originalIndexToValidIndex[originalIndex];
            if (validIndex !== undefined && validIndex < validAssignments.length) {
                finalAssignments[originalIndex] = validAssignments[validIndex];
            } else {
                console.error(`Error mapping assignment back: Could not find valid index for original index ${originalIndex} or valid index out of bounds.`);
                // Keep assignment as -1
            }
        }
        // Else: keep assignment as -1 for invalid embeddings
    }

    console.log('K-Means clustering finished.');
    return { centroids: normalizedCentroids, assignments: finalAssignments }; // Return assignments matching original length
}

async function saveBinaryFloat32(filePath: string, data: Float32Array[]) {
    // Flatten the array of Float32Arrays into a single Float32Array
    const totalLength = data.reduce((sum, arr) => sum + arr.length, 0);
    const flatData = new Float32Array(totalLength);
    let offset = 0;
    for (const arr of data) {
        flatData.set(arr, offset);
        offset += arr.length;
    }
    await fs.writeFile(filePath, Buffer.from(flatData.buffer));
    console.log(`Binary data saved to ${filePath}`);
}

async function saveJSON(filePath: string, data: any) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log(`JSON data saved to ${filePath}`);
}

async function main() {
    console.log("Starting embedding generation and clustering process...");

    // --- Step 0.0: Load and Prepare Data ---
    const documentsToProcess = await loadAndPrepareData();
    if (documentsToProcess.length === 0) {
        console.log("No documents found to process. Exiting.");
        return;
    }

    // Ensure output directories exist
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.mkdir(RAW_EMBEDDINGS_CACHE_DIR, { recursive: true }); // Ensure cache directory exists

    // --- Step 0.1: Initialize Embedding Pipeline --- Change: Initialize pipeline
    console.log(`Initializing feature-extraction pipeline with model: ${EMBEDDING_MODEL_ID}`);
    const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID);
    console.log('Feature-extraction pipeline initialized.');

    // --- Step 0.2: Embedding Generation & Normalization --- Change: Use pipeline
    const allEmbeddingsNumeric: number[][] = []; // Store L2-normalized embeddings as number arrays
    const allDocumentChunks: DocumentChunk[] = []; // Store corresponding chunk data

    console.log(`Generating embeddings for ${documentsToProcess.length} documents...`);
    for (let i = 0; i < documentsToProcess.length; i++) {
        const doc = documentsToProcess[i];
        process.stdout.write(`\rEmbedding document ${i + 1}/${documentsToProcess.length} (ID: ${doc.id})...`);

        const cachedEmbeddingPath = path.join(RAW_EMBEDDINGS_CACHE_DIR, `${doc.id}.bin`);
        let embedding: number[] | null = await loadEmbeddingFromCache(cachedEmbeddingPath, EMBEDDING_DIMENSIONS);

        if (embedding) {
            // Optional: log cache hit
            // process.stdout.write(`\rLoaded embedding for document ${i + 1}/${documentsToProcess.length} (ID: ${doc.id}) from cache.`);
        } else {
            try {
                embedding = await getEmbedding(doc.text, extractor); // Changed: Pass extractor instead of tokenizer/model

                // Handle case where getEmbedding signalled failure by returning empty array
                if (!embedding || embedding.length === 0) {
                    console.warn(`\nWarning: Failed to generate a valid embedding for doc ${doc.id}. Skipping this document.`);
                    embedding = null;
                } else if (embedding.length !== EMBEDDING_DIMENSIONS) { // Double check final length
                    console.warn(`\nWarning: Embedding for doc ${doc.id} has unexpected final dimension ${embedding.length}, expected ${EMBEDDING_DIMENSIONS}. Skipping.`);
                    embedding = null; // Mark as null to skip
                } else {
                    // Save the newly generated and validated embedding to cache
                    await saveEmbeddingToCache(cachedEmbeddingPath, embedding);
                }
            } catch (error: any) {
                console.error(`\nError processing document ${doc.id} through pipeline: ${error.message}`);
                embedding = null; // Mark as null to skip
            }
        }

        if (embedding) { // Only proceed if embedding is valid (either from cache or newly generated)
            allEmbeddingsNumeric.push(embedding);
            allDocumentChunks.push({
                id: doc.id, // This is `district_CDSCode` or `school_CDSCode`
                text: doc.text, // Full text that was embedded
                metadata: {
                    type: doc.type,
                    cdsCode: doc.cdsCode,
                    name: doc.originalData.District || doc.originalData.School || 'N/A',
                    city: doc.originalData['Street City'] || 'N/A',
                    // You can add more fields from doc.originalData here if needed for the client
                }
            });
        }
    }
    process.stdout.write("\nDone generating embeddings.\n");

    if (allEmbeddingsNumeric.length === 0) {
        console.error("No valid embeddings were generated. Exiting.");
        return;
    }
    if (allEmbeddingsNumeric.length !== allDocumentChunks.length) {
        console.error("Mismatch between embeddings count and document chunks count. Exiting.");
        return;
    }

    // Convert to Float32Array for k-means and binary saving
    const allEmbeddingsF32: Float32Array[] = allEmbeddingsNumeric.map(emb => new Float32Array(emb));

    // --- Step 0.3: Clustering Embeddings ---
    if (allEmbeddingsF32.length < NUM_CLUSTERS_K) {
        console.warn(`Number of embeddings (${allEmbeddingsF32.length}) is less than K=${NUM_CLUSTERS_K}. Adjusting K.`);
        NUM_CLUSTERS_K = Math.max(1, allEmbeddingsF32.length); // Ensure K is at least 1
    }

    const { centroids, assignments } = await performKMeans(allEmbeddingsF32, NUM_CLUSTERS_K, allDocumentChunks);
    // centroids are Float32Array[], assignments is number[]

    // --- Step 0.4: Save Data Per Cluster and Centroids ---
    console.log('Saving clustered data...');
    const manifest = {
        model: EMBEDDING_MODEL_ID,
        dimensions: EMBEDDING_DIMENSIONS,
        clusterAlgorithm: 'ml-kmeans',
        k: NUM_CLUSTERS_K,
        centroidsFile: 'centroids.json', // Or .bin, based on final decision
        clusters: [] as any[],
    };

    // Save L2-normalized centroids
    // Option 1: Save as structured JSON (easier to inspect, contains IDs if we map them)
    // Option 2: Save as raw binary .bin (more compact) with an ordered ID list in manifest or separate JSON.
    // Current plan: "Save L2-normalized centroids (either as raw binary .bin with an ordered ID list, or as structured .json)"
    // Let's go with structured JSON for centroids for easier debugging for now.
    const centroidObjects = centroids.map((centroid, i) => ({
        clusterId: i,
        centroid: Array.from(centroid) // Convert Float32Array to number[] for JSON
    }));
    await saveJSON(path.join(OUTPUT_DIR, manifest.centroidsFile), centroidObjects);

    // Group documents by cluster and save
    const clustersData: { embeddings: Float32Array[], metadata: DocumentChunk[] }[] = Array.from({ length: NUM_CLUSTERS_K }, () => ({ embeddings: [], metadata: [] }));

    for (let i = 0; i < allDocumentChunks.length; i++) {
        const clusterIndex = assignments[i];
        if (clusterIndex >= 0 && clusterIndex < NUM_CLUSTERS_K) {
            clustersData[clusterIndex].embeddings.push(allEmbeddingsF32[i]);
            clustersData[clusterIndex].metadata.push(allDocumentChunks[i]); // Push the full DocumentChunk object
        } else {
            console.warn(`Warning: Document chunk ${allDocumentChunks[i].id} has invalid cluster assignment (${clusterIndex}). Skipping.`);
        }
    }

    for (let i = 0; i < NUM_CLUSTERS_K; i++) {
        const clusterDir = path.join(OUTPUT_DIR, `cluster_${i}`);
        await fs.mkdir(clusterDir, { recursive: true });

        const clusterEmbeddingsFilePath = path.join(clusterDir, 'embeddings.bin');
        await saveBinaryFloat32(clusterEmbeddingsFilePath, clustersData[i].embeddings);

        const clusterMetadataFilePath = path.join(clusterDir, 'metadata.json');
        await saveJSON(clusterMetadataFilePath, clustersData[i].metadata);
    }

    // Save manifest
    await saveJSON(OUTPUT_MANIFEST_PATH, manifest);

    console.log('Clustering and data saving completed.');
}

main();