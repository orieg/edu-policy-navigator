#!/usr/bin/env node
// pipeline/scripts/generateClusteredEmbeddings.ts

// Note: Run this script from the project root directory.

import { pipeline, env, AutoTokenizer, AutoModel, Tensor } from "@huggingface/transformers";
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
let NUM_CLUSTERS_K = 64; // Default K, will be adjusted if less documents than K

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

        // Construct district acronym string
        const districtBaseAcronym = district.baseAcronym;
        const districtTypedAcronym = district.typedAcronym;
        let districtAcronymText = '';
        if (districtTypedAcronym && districtTypedAcronym !== 'No Data' && districtBaseAcronym && districtBaseAcronym !== 'No Data' && districtTypedAcronym !== districtBaseAcronym) {
            districtAcronymText = `${districtTypedAcronym}, ${districtBaseAcronym}`;
        } else if (districtTypedAcronym && districtTypedAcronym !== 'No Data') {
            districtAcronymText = districtTypedAcronym;
        } else if (districtBaseAcronym && districtBaseAcronym !== 'No Data') {
            districtAcronymText = districtBaseAcronym;
        }

        let districtText = `The ${districtName}${districtAcronymText ? ` (${districtAcronymText})` : ''} is a ${entityType}`;
        if (streetAddress && streetAddress !== 'No Data') {
            districtText += ` located at ${streetAddress} in ${city}, ${county} County, California.`;
        } else {
            districtText += ` located in ${city}, ${county} County, California.`;
        }
        if (district['Funding Type'] && district['Funding Type'] !== 'No Data') {
            districtText += ` Funding Type: ${district['Funding Type']}.`;
        }
        // Add Website if available
        const website = district.Website;
        if (website && website !== 'No Data') {
            districtText += ` Its website is ${website}.`;
        }

        // Add other characteristics for districts
        if (district['Charter Yes/No'] === 'Y') {
            districtText += ' This is a charter district.';
        }
        const virtualTypeDistrict = district['Virtual Instruction Type'];
        if (virtualTypeDistrict && virtualTypeDistrict !== 'No Data') {
            districtText += ` Offers ${virtualTypeDistrict.toLowerCase()} instruction.`; // aDDED toLowerCase()
        }
        if (district['Multilingual Yes/No'] === 'Y') {
            districtText += ' Offers multilingual programs.';
        }

        districtText += ` CDS Code: ${cdsCode}.`; // CDS Code at the end

        documents.push({
            id: cdsCode,
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
        const parentDistrictBaseAcronym = parentDistrict?.baseAcronym;
        const parentDistrictTypedAcronym = parentDistrict?.typedAcronym;
        const parentDistrictCounty = parentDistrict?.County;

        // Construct parent district acronym string
        let parentDistrictAcronymString = '';
        if (parentDistrictTypedAcronym && parentDistrictTypedAcronym !== 'No Data' && parentDistrictBaseAcronym && parentDistrictBaseAcronym !== 'No Data' && parentDistrictTypedAcronym !== parentDistrictBaseAcronym) {
            parentDistrictAcronymString = `${parentDistrictTypedAcronym}, ${parentDistrictBaseAcronym}`;
        } else if (parentDistrictTypedAcronym && parentDistrictTypedAcronym !== 'No Data') {
            parentDistrictAcronymString = parentDistrictTypedAcronym;
        } else if (parentDistrictBaseAcronym && parentDistrictBaseAcronym !== 'No Data') {
            parentDistrictAcronymString = parentDistrictBaseAcronym;
        }

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

            // Construct school's own acronym string
            const schoolBaseAcronym = school.baseAcronym;
            const schoolTypedAcronym = school.typedAcronym;
            let schoolAcronymText = '';
            if (schoolTypedAcronym && schoolTypedAcronym !== 'No Data' && schoolBaseAcronym && schoolBaseAcronym !== 'No Data' && schoolTypedAcronym !== schoolBaseAcronym) {
                schoolAcronymText = `${schoolTypedAcronym}, ${schoolBaseAcronym}`;
            } else if (schoolTypedAcronym && schoolTypedAcronym !== 'No Data') {
                schoolAcronymText = schoolTypedAcronym;
            } else if (schoolBaseAcronym && schoolBaseAcronym !== 'No Data') {
                schoolAcronymText = schoolBaseAcronym;
            }

            let schoolText = `The ${schoolName}${schoolAcronymText ? ` (${schoolAcronymText})` : ''} is a ${schoolType}`;
            if (streetAddress && streetAddress !== 'No Data') {
                schoolText += ` located at ${streetAddress} in ${schoolCity}, California.`;
            } else {
                schoolText += ` located in ${schoolCity}, California.`;
            }

            schoolText += ` It is part of the ${parentDistrictName} district${parentDistrictAcronymString ? ` (${parentDistrictAcronymString})` : ''}`;
            if (parentDistrictCounty && parentDistrictCounty !== 'No Data') {
                schoolText += `, in ${parentDistrictCounty} county.`;
            } else {
                schoolText += `.`;
            }

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

            // Add other characteristics for schools
            if (school['Charter Yes/No'] === 'Y') {
                schoolText += ' This is a charter school.';
            }
            if (school['Magnet Yes/No'] === 'Y') {
                schoolText += ' It is a magnet school.';
            }
            const virtualTypeSchool = school['Virtual Instruction Type'];
            if (virtualTypeSchool && virtualTypeSchool !== 'No Data') {
                schoolText += ` Offers ${virtualTypeSchool.toLowerCase()} instruction.`; // aDDED toLowerCase()
            }
            if (school['Year Round Yes/No'] === 'Y') {
                schoolText += ' Operates on a year-round calendar.';
            }
            if (school['Multilingual Yes/No'] === 'Y') {
                schoolText += ' Offers multilingual programs.';
            }

            schoolText += ` CDS Code: ${schoolCdsCode}.`; // CDS Code at the end

            documents.push({
                id: schoolCdsCode,
                type: 'school',
                cdsCode: schoolCdsCode,
                text: schoolText,
                originalData: { ...school, districtCdsCode: districtCdsKey, parentDistrictCounty }
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
        initialization: 'kmeans++',
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
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    await fs.mkdir(RAW_EMBEDDINGS_CACHE_DIR, { recursive: true });

    // Initialize the feature extraction pipeline
    console.log(`Initializing feature extraction pipeline with model: ${EMBEDDING_MODEL_ID}`);
    const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, {
        progress_callback: (progress: any) => {
            if (progress.status === 'progress') {
                // console.log(`  Model loading progress: ${progress.file} ${Math.round(progress.loaded / progress.total * 100)}%`);
            } else if (progress.status === 'ready') {
                console.log('  Feature extraction pipeline ready.');
            }
        }
    });
    console.log("Feature extraction pipeline initialized.");

    const documents = await loadAndPrepareData();
    if (documents.length === 0) {
        console.error("No documents found after loading and preparation. Exiting.");
        return;
    }

    console.log("Generating or loading embeddings for all documents...");
    const allEmbeddings: Float32Array[] = [];
    const allDocumentChunks: DocumentChunk[] = [];

    for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        const cacheFileName = `${doc.id.replace(/\//g, '_')}.emb.bin`; // Sanitize ID for filename
        const cacheFilePath = path.join(RAW_EMBEDDINGS_CACHE_DIR, cacheFileName);

        let embedding = await loadEmbeddingFromCache(cacheFilePath, EMBEDDING_DIMENSIONS);

        if (!embedding) {
            const generatedEmbedding = await getEmbedding(doc.text, extractor);
            if (generatedEmbedding && generatedEmbedding.length > 0) {
                embedding = generatedEmbedding;
                await saveEmbeddingToCache(cacheFilePath, embedding);
            } else {
                console.warn(`Failed to generate embedding for document ${doc.id}. Skipping.`);
                continue; // Skip this document if embedding fails
            }
        }

        if (embedding) {
            if (embedding.length !== EMBEDDING_DIMENSIONS) {
                console.warn(`Embedding for ${doc.id} has incorrect dimensions (${embedding.length}). Expected ${EMBEDDING_DIMENSIONS}. Skipping.`);
                continue;
            }
            // Check for NaN/Infinity in the final embedding before adding
            const float32Embedding = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
            if (Array.from(float32Embedding).some(val => isNaN(val) || !isFinite(val))) {
                console.error(`Embedding for document ID ${doc.id} contains NaN or Infinity values. Text: ${doc.text.substring(0, 100)}... Skipping.`);
                continue;
            }

            allEmbeddings.push(float32Embedding);
            allDocumentChunks.push({
                id: doc.id,
                text: doc.text,
                metadata: {
                    type: doc.type,
                    cdsCode: doc.cdsCode,
                    name: doc.originalData.District || doc.originalData.School || 'N/A',
                    city: doc.originalData['Street City'] || 'N/A',
                    ...doc.originalData // Spread original data for any other useful fields
                }
            });
        }
        if ((i + 1) % 100 === 0) {
            console.log(`Processed ${i + 1}/${documents.length} documents...`);
        }
    }

    if (allEmbeddings.length === 0) {
        console.error("No embeddings were successfully generated. Exiting.");
        return;
    }
    console.log(`Successfully generated/loaded ${allEmbeddings.length} embeddings with ${EMBEDDING_DIMENSIONS} dimensions.`);

    const { centroids, assignments } = await performKMeans(allEmbeddings, NUM_CLUSTERS_K, allDocumentChunks);

    if (centroids.length < NUM_CLUSTERS_K) {
        console.warn(`KMeans resulted in ${centroids.length} clusters, which is less than the requested K=${NUM_CLUSTERS_K}. Updating K.`);
        NUM_CLUSTERS_K = centroids.length;
    }
    if (NUM_CLUSTERS_K === 0 && allEmbeddings.length > 0) {
        console.error("KMeans failed to produce any clusters, but embeddings were present. Exiting.");
        return;
    }

    console.log(`Clustering complete. Found ${NUM_CLUSTERS_K} clusters.`);

    // -----------------------------
    // Static County Clustering Step
    // -----------------------------
    console.log('Generating static county-based clusters...');

    // Build mapping from county name -> list of document indices
    const countyToDocIndices: Record<string, number[]> = {};
    for (let idx = 0; idx < allDocumentChunks.length; idx++) {
        const meta = allDocumentChunks[idx].metadata as any;
        let county: string | undefined = undefined;
        if (meta.County && typeof meta.County === 'string' && meta.County !== 'No Data') {
            county = meta.County.trim();
        } else if (meta.parentDistrictCounty && typeof meta.parentDistrictCounty === 'string') {
            county = meta.parentDistrictCounty.trim();
        }
        if (!county) continue;
        if (!countyToDocIndices[county]) countyToDocIndices[county] = [];
        countyToDocIndices[county].push(idx);
    }

    let nextClusterId = NUM_CLUSTERS_K;

    // Prepare initial centroids array with k-means centroids
    const centroidsOutput: { clusterId: number; centroid: number[] }[] = centroids.map((centroid, index) => ({
        clusterId: index,
        centroid: Array.from(centroid)
    }));

    // Prepare manifest
    const manifestData = {
        embeddingModelId: EMBEDDING_MODEL_ID,
        embeddingDimensions: EMBEDDING_DIMENSIONS,
        clusterAlgorithm: "ml-kmeans+county",
        kValue: NUM_CLUSTERS_K, // only the k-means part
        centroidsFile: "centroids.json",
        clusters: [] as any[]
    };

    const countyNames = Object.keys(countyToDocIndices).sort();
    for (const county of countyNames) {
        const docIndices = countyToDocIndices[county];
        if (docIndices.length === 0) continue;

        const clusterDir = path.join(OUTPUT_DIR, `cluster_${nextClusterId}`);
        await fs.mkdir(clusterDir, { recursive: true });

        // Prepare embeddings & metadata arrays
        const clusterEmbeddings: Float32Array[] = [];
        const clusterMetadata: DocumentChunk[] = [];
        for (const docIdx of docIndices) {
            clusterEmbeddings.push(allEmbeddings[docIdx]);
            clusterMetadata.push(allDocumentChunks[docIdx]);
        }

        await saveBinaryFloat32(path.join(clusterDir, 'embeddings.bin'), clusterEmbeddings);
        await saveJSON(path.join(clusterDir, 'metadata.json'), clusterMetadata);

        // Compute centroid (mean of embeddings then L2 normalize)
        const centroidVec = new Float32Array(EMBEDDING_DIMENSIONS);
        for (const emb of clusterEmbeddings) {
            for (let d = 0; d < EMBEDDING_DIMENSIONS; d++) {
                centroidVec[d] += emb[d];
            }
        }
        for (let d = 0; d < EMBEDDING_DIMENSIONS; d++) {
            centroidVec[d] /= clusterEmbeddings.length;
        }
        const norm = Math.sqrt(centroidVec.reduce((sum, v) => sum + v * v, 0));
        if (norm > 0) {
            for (let d = 0; d < EMBEDDING_DIMENSIONS; d++) centroidVec[d] /= norm;
        }

        // Append centroid entry
        centroidsOutput.push({ clusterId: nextClusterId, centroid: Array.from(centroidVec) });

        // Append manifest entry
        manifestData.clusters.push({
            clusterId: nextClusterId,
            type: 'county',
            countyName: county,
            count: docIndices.length,
            embeddingsFile: `cluster_${nextClusterId}/embeddings.bin`,
            metadataFile: `cluster_${nextClusterId}/metadata.json`
        });

        console.log(`Saved county cluster ${nextClusterId} (${county}) with ${docIndices.length} docs.`);
        nextClusterId += 1;
    }

    const TOTAL_CLUSTERS = nextClusterId;
    console.log(`Total clusters (k-means + counties): ${TOTAL_CLUSTERS}`);

    // Now process k-means clusters for manifest and files
    for (let i = 0; i < NUM_CLUSTERS_K; i++) {
        const clusterDir = path.join(OUTPUT_DIR, `cluster_${i}`);
        await fs.mkdir(clusterDir, { recursive: true });

        const clusterIndices = assignments.reduce((acc, label, idx) => {
            if (label === i) acc.push(idx);
            return acc;
        }, [] as number[]);

        const clusterEmbeddings: Float32Array[] = [];
        const clusterMetadata: DocumentChunk[] = [];

        if (clusterIndices.length === 0) {
            console.warn(`Cluster ${i} has no documents assigned.`);
            await saveBinaryFloat32(path.join(clusterDir, "embeddings.bin"), []);
            await saveJSON(path.join(clusterDir, "metadata.json"), []);
        } else {
            for (const docIdx of clusterIndices) {
                clusterEmbeddings.push(allEmbeddings[docIdx]);
                clusterMetadata.push(allDocumentChunks[docIdx]);
            }
            await saveBinaryFloat32(path.join(clusterDir, "embeddings.bin"), clusterEmbeddings);
            await saveJSON(path.join(clusterDir, "metadata.json"), clusterMetadata);
        }

        manifestData.clusters.push({
            clusterId: i,
            type: 'kmeans',
            count: clusterIndices.length,
            embeddingsFile: clusterIndices.length > 0 ? `cluster_${i}/embeddings.bin` : null,
            metadataFile: clusterIndices.length > 0 ? `cluster_${i}/metadata.json` : null
        });
        console.log(`Saved data for k-means cluster ${i} with ${clusterIndices.length} embeddings.`);
    }

    // Save centroids after all clusters
    await saveJSON(path.join(OUTPUT_DIR, "centroids.json"), centroidsOutput);
    await saveJSON(OUTPUT_MANIFEST_PATH, manifestData);
    console.log("Process completed successfully.");
}

main().catch(error => {
    console.error("Error in main function:", error);
});