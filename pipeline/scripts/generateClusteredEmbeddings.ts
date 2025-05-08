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
const EMBEDDING_MODEL_ID = 'Snowflake/snowflake-arctic-embed-xs';
const EMBEDDING_DIMENSIONS = 384; // For Snowflake/snowflake-arctic-embed-xs
const MAX_CHUNK_LENGTH = 512; // Max tokens for the embedding model
let NUM_CLUSTERS_K = 10; // Default K, will be adjusted if less documents than K

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

// Helper function for mean pooling
async function meanPooling(last_hidden_state: Tensor, attention_mask: Tensor): Promise<Tensor> {
    // last_hidden_state: [batch_size, sequence_length, hidden_size]
    // attention_mask: [batch_size, sequence_length] (should be float32 by this point)

    const expanded_attention_mask = await attention_mask.unsqueeze(-1);
    if (!(expanded_attention_mask instanceof Tensor)) throw new Error("expanded_attention_mask is not a Tensor");

    const Padded_Embeddings = await (last_hidden_state as any).mul(expanded_attention_mask);
    if (!(Padded_Embeddings instanceof Tensor)) throw new Error("Padded_Embeddings is not a Tensor after mul operation");

    const sum_embeddings_tensor = await Padded_Embeddings.sum(1);
    if (!(sum_embeddings_tensor instanceof Tensor)) throw new Error("sum_embeddings_tensor is not a Tensor after sum operation");

    const sum_mask_tensor = await expanded_attention_mask.sum(1);
    if (!(sum_mask_tensor instanceof Tensor)) throw new Error("sum_mask_tensor is not a Tensor after sum operation");

    const clamped_sum_mask_tensor = await sum_mask_tensor.clamp(1e-9, Number.POSITIVE_INFINITY);
    if (!(clamped_sum_mask_tensor instanceof Tensor)) throw new Error("clamped_sum_mask_tensor is not a Tensor after clamp operation");

    // Manual division to avoid issues with Tensor.div()
    const sum_embeddings_data = await sum_embeddings_tensor.data as Float32Array;
    const clamped_sum_mask_data = await clamped_sum_mask_tensor.data as Float32Array;

    const batch_size = sum_embeddings_tensor.dims[0];
    const hidden_size = sum_embeddings_tensor.dims[1];

    if (clamped_sum_mask_tensor.dims.length === 2 && clamped_sum_mask_tensor.dims[0] !== batch_size && clamped_sum_mask_tensor.dims[1] !== 1) {
        throw new Error(`clamped_sum_mask_tensor has unexpected dimensions: ${clamped_sum_mask_tensor.dims}. Expected [${batch_size}, 1].`);
    }
    // If clamped_sum_mask_data is effectively [batch_size] (from a [batch_size, 1] tensor's .data)
    if (clamped_sum_mask_data.length !== batch_size) {
        throw new Error(`clamped_sum_mask_data length (${clamped_sum_mask_data.length}) does not match batch_size (${batch_size}). Original dims: ${clamped_sum_mask_tensor.dims}`);
    }

    const result_data = new Float32Array(batch_size * hidden_size);

    for (let i = 0; i < batch_size; ++i) {
        const mask_value = clamped_sum_mask_data[i]; // Each batch item has its own mask sum value
        if (mask_value === 0) {
            // This case should ideally be prevented by clamp(1e-9, ...), but as a safeguard:
            console.warn(`Warning: mask_value is zero for batch item ${i}. This might lead to NaN/Infinity if not for clamping.`);
        }
        for (let j = 0; j < hidden_size; ++j) {
            result_data[i * hidden_size + j] = sum_embeddings_data[i * hidden_size + j] / mask_value;
        }
    }

    return new Tensor('float32', result_data, sum_embeddings_tensor.dims);
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

async function getEmbedding(text: string, tokenizer: any, model: any): Promise<number[]> {
    const inputs = tokenizer(text, { padding: true, truncation: true, max_length: MAX_CHUNK_LENGTH, return_tensors: "pt" });

    let processedAttentionMask = inputs.attention_mask;

    if (processedAttentionMask.dtype !== 'float32') {
        const attentionMaskData = await processedAttentionMask.data;
        const newAttentionMaskTypedData = Float32Array.from(Array.from(attentionMaskData as any[]), (x: any) => Number(x));
        processedAttentionMask = new Tensor('float32', newAttentionMaskTypedData, processedAttentionMask.dims);
    }

    const { last_hidden_state } = await model(inputs);

    if (!(last_hidden_state instanceof Tensor)) {
        console.error(`Error: last_hidden_state is not a Tensor for document text (first 100 chars): "${text.substring(0, 100)}...". Type: ${typeof last_hidden_state}, Value:`, last_hidden_state);
        throw new Error('Embedding generation failed: last_hidden_state from model was not a Tensor.');
    }

    if (!(processedAttentionMask instanceof Tensor)) {
        console.error(`Error: processedAttentionMask is not a Tensor for document text (first 100 chars): "${text.substring(0, 100)}...". Type: ${typeof processedAttentionMask}, Value:`, processedAttentionMask);
        throw new Error('Embedding generation failed: processedAttentionMask was not a Tensor.');
    }

    const pooled = await meanPooling(last_hidden_state, processedAttentionMask);
    const pooledData = await pooled.data;
    const normalized = normalizeL2(pooledData as Float32Array);
    return Array.from(normalized);
}

async function performKMeans(embeddings: Float32Array[], k: number): Promise<{ centroids: Float32Array[], assignments: number[] }> {
    console.log(`Performing K-Means clustering with K=${k}...`);
    // Convert array of Float32Arrays to a 2D array of numbers for ml-kmeans
    const dataForKMeans = embeddings.map(emb => Array.from(emb));

    const kmeansResult = kmeans(dataForKMeans, k, { // Changed: Use kmeans (default import)
        initialization: 'kmeans++',
        maxIterations: 300, // Default is 300, can adjust
    });

    // Centroids from ml-kmeans are number[][], convert back to Float32Array[] and normalize.
    const normalizedCentroids = kmeansResult.centroids.map((centroidArray: number[]) => normalizeL2(new Float32Array(centroidArray)));

    console.log('K-Means clustering finished.');
    return { centroids: normalizedCentroids, assignments: kmeansResult.clusters };
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

    // Ensure output directory exists
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    // --- Step 0.1: Initialize Embedding Model ---
    console.log(`Initializing embedding model: ${EMBEDDING_MODEL_ID}`);
    const tokenizer = await AutoTokenizer.from_pretrained(EMBEDDING_MODEL_ID);
    const model = await AutoModel.from_pretrained(EMBEDDING_MODEL_ID);
    console.log('Embedding model initialized.');

    // --- Step 0.2: Embedding Generation & Normalization ---
    const allEmbeddingsNumeric: number[][] = []; // Store L2-normalized embeddings as number arrays
    const allDocumentChunks: DocumentChunk[] = []; // Store corresponding chunk data

    console.log(`Generating embeddings for ${documentsToProcess.length} documents...`);
    for (let i = 0; i < documentsToProcess.length; i++) {
        const doc = documentsToProcess[i];
        process.stdout.write(`\rEmbedding document ${i + 1}/${documentsToProcess.length} (ID: ${doc.id})...`);

        try {
            const embedding = await getEmbedding(doc.text, tokenizer, model); // Returns number[]
            if (embedding.length !== EMBEDDING_DIMENSIONS) {
                console.warn(`\nWarning: Embedding for doc ${doc.id} has dimension ${embedding.length}, expected ${EMBEDDING_DIMENSIONS}. Skipping.`);
                continue;
            }

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
        } catch (error: any) {
            console.error(`\nError generating embedding for document ${doc.id}: ${error.message}`);
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

    const { centroids, assignments } = await performKMeans(allEmbeddingsF32, NUM_CLUSTERS_K);
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

        const embeddingsPath = path.join(clusterDir, 'embeddings.bin');
        const metadataPath = path.join(clusterDir, 'metadata.json');

        if (clustersData[i].embeddings.length > 0) {
            await saveBinaryFloat32(embeddingsPath, clustersData[i].embeddings);
            // Save metadata (id, text chunk, other metadata) as JSON, ordered identically to embeddings
            // We are saving the full DocumentChunk object for each item in metadata
            await saveJSON(metadataPath, clustersData[i].metadata);

            manifest.clusters.push({
                clusterId: i,
                count: clustersData[i].metadata.length,
                embeddingsFile: `cluster_${i}/embeddings.bin`,
                metadataFile: `cluster_${i}/metadata.json`,
            });
        } else {
            console.log(`Cluster ${i} is empty. No files will be saved for this cluster.`);
            manifest.clusters.push({
                clusterId: i,
                count: 0,
                embeddingsFile: null,
                metadataFile: null,
            });
        }
    }

    // --- Step 0.5: Save Manifest File ---
    await saveJSON(OUTPUT_MANIFEST_PATH, manifest);
    console.log(`Manifest file saved to ${OUTPUT_MANIFEST_PATH}`);

    console.log('Offline pre-computation script finished successfully!');
}

main().catch(error => {
    console.error("Script failed:", error);
    process.exit(1);
}); 