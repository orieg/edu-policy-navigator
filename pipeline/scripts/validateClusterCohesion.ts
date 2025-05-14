#!/usr/bin/env ts-node

/**
 * validateClusterCohesion.ts
 * --------------------------------
 * Quick utility to check how documents that contain a given keyword/string
 * are distributed across k-means clusters.  This helps spot cases where
 * documents that logically belong together (e.g. all schools of the same
 * district) end up scattered among clusters, which hurts clustered search.
 *
 * Usage:
 *   pnpm ts-node pipeline/scripts/validateClusterCohesion.ts SRVUSD
 *
 * The script prints a table of clusterId → hit count and highlights the
 * primary cluster (highest count) vs. outliers. Exit code is 0 even if
 * dispersion is detected – this script is informational.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { pipeline, env, Tensor } from '@huggingface/transformers';

const OUTPUT_DIR = path.resolve(process.cwd(), 'public', 'embeddings', 'school_districts');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');

interface ManifestCluster {
    clusterId: number;
    metadataFile: string | null;
    embeddingsFile?: string | null;
    count: number;
}
interface Manifest {
    clusters: ManifestCluster[];
    centroidsFile?: string;
}

interface CentroidEntry { clusterId: number; centroid: number[]; }

async function readJSON<T>(filePath: string): Promise<T> {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
}

function usage() {
    console.log('Usage: validateClusterCohesion <keyword>');
    process.exit(1);
}

function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function l2Distance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        sum += diff * diff;
    }
    return Math.sqrt(sum);
}

(async () => {
    const keywordArg = process.argv[2];
    if (!keywordArg) usage();
    const keyword = keywordArg.toLowerCase();

    const manifest = await readJSON<Manifest>(MANIFEST_PATH);

    const clusterHits: Record<number, number> = {};
    const keywordVectorIndices: Record<number, number[]> = {}; // clusterId -> list of doc indices containing keyword

    // Load centroids
    const centroidsPath = path.join(OUTPUT_DIR, manifest.centroidsFile || 'centroids.json');
    let centroids: CentroidEntry[] = [];
    try {
        centroids = await readJSON<CentroidEntry[]>(centroidsPath);
    } catch {
        console.warn('Could not load centroids file; similarity column will be N/A');
    }

    // Load per-cluster keywords if present
    const keywordsPath = path.join(OUTPUT_DIR, 'cluster_keywords.json');
    let keywordsMap: Map<number, string[]> = new Map();
    try {
        const kwArr = await readJSON<{ clusterId: number; keywords: string[] }[]>(keywordsPath);
        keywordsMap = new Map(kwArr.map(k => [k.clusterId, k.keywords]));
    } catch {
        console.warn('Could not load cluster_keywords.json; keywords column will be N/A');
    }

    for (const cl of manifest.clusters) {
        const cid = cl.clusterId;
        clusterHits[cid] = 0;
        if (!cl.metadataFile) continue; // empty cluster

        const metaPath = path.join(OUTPUT_DIR, cl.metadataFile);
        const docs: any[] = await readJSON<any[]>(metaPath);

        for (const doc of docs) {
            const text: string = doc.text || '';
            if (text.toLowerCase().includes(keyword)) {
                clusterHits[cid] += 1;
                if (!keywordVectorIndices[cid]) keywordVectorIndices[cid] = [];
                keywordVectorIndices[cid].push(docs.indexOf(doc));
            }
        }
    }

    // Initialize embedding extractor for keyword embedding
    const EMB_MODEL_ID = 'Snowflake/snowflake-arctic-embed-xs';
    env.allowLocalModels = true;
    let extractor: any = null;
    try {
        console.log(`Loading embedding model ${EMB_MODEL_ID} for keyword similarity...`);
        extractor = await pipeline('feature-extraction', EMB_MODEL_ID, {
            progress_callback: () => { }
        });
        console.log('Embedding model loaded.');
    } catch (err) {
        console.warn('Could not load embedding model; KeywordSim column will be N/A', (err as Error).message);
    }

    // Build keyword embedding by averaging vectors of all matching docs (Doc-based embedding)
    let keywordEmbedding: number[] | null = null;
    const embeddingDim = centroids.length > 0 ? centroids[0].centroid.length : 0;

    if (embeddingDim > 0) {
        let sumVec = new Array(embeddingDim).fill(0);
        let totalVecs = 0;

        for (const cl of manifest.clusters) {
            const indices = keywordVectorIndices[cl.clusterId];
            if (!indices || indices.length === 0 || !cl.embeddingsFile) continue;

            const embPath = path.join(OUTPUT_DIR, cl.embeddingsFile);
            const buf = await fs.readFile(embPath);
            const floatArr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
            for (const idx of indices) {
                const start = idx * embeddingDim;
                for (let d = 0; d < embeddingDim; d++) {
                    sumVec[d] += floatArr[start + d];
                }
                totalVecs += 1;
            }
        }

        if (totalVecs > 0) {
            keywordEmbedding = sumVec.map(v => v / totalVecs);
        }
    }

    // Build embedding directly from keyword using model (Keyword vector)
    let keywordVectorFromModel: number[] | null = null;
    if (extractor) {
        try {
            const output = await extractor(keywordArg, { pooling: 'mean', normalize: true });
            if (output instanceof Tensor) {
                keywordVectorFromModel = Array.from((await output.data) as Float32Array);
            }
        } catch (err) {
            console.warn('Failed to compute keyword embedding via model:', (err as Error).message);
        }
    }

    // Sort clusters by hit count desc
    const sorted = Object.entries(clusterHits).sort((a, b) => b[1] - a[1]);

    console.log(`Keyword "${keywordArg}" distribution across clusters:`);

    const totalHits = Object.values(clusterHits).reduce((sum, v) => sum + v, 0);
    if (totalHits === 0) {
        console.log('No documents containing the keyword were found in any cluster.');
        process.exit(0);
    }

    // Header with new column
    console.log('\n' +
        'Cluster'.padEnd(8) +
        'Docs'.padStart(6) +
        'Hits'.padStart(6) +
        '%Total'.padStart(8) +
        'DocSim'.padStart(9) +
        'KeySim'.padStart(9) +
        'DocL2'.padStart(9) +
        'KeyL2'.padStart(9) +
        ' Keywords');

    let primaryClusterId: number | null = null;
    let primaryHits = 0;

    // Track best clusters per metric
    let bestDocSim = { id: -1, val: -Infinity };
    let bestKeySim = { id: -1, val: -Infinity };
    let bestDocL2 = { id: -1, val: Infinity };
    let bestKeyL2 = { id: -1, val: Infinity };

    for (const [cidStr, hits] of sorted) {
        const cid = Number(cidStr);
        const pct = ((hits / totalHits) * 100).toFixed(1);
        const centroidEntry = centroids.find(c => c.clusterId === cid);
        const sim = keywordEmbedding && centroidEntry
            ? cosineSimilarity(keywordEmbedding, centroidEntry.centroid).toFixed(3)
            : 'N/A';

        const totalDocsInCluster = manifest.clusters.find(c => c.clusterId === cid)?.count ?? 0;
        let kwSim: string | 'N/A' = 'N/A';
        let docL2: string | 'N/A' = 'N/A';
        let keyL2: string | 'N/A' = 'N/A';
        if (keywordVectorFromModel && centroidEntry) {
            kwSim = cosineSimilarity(keywordVectorFromModel, centroidEntry.centroid).toFixed(3);
            keyL2 = l2Distance(keywordVectorFromModel, centroidEntry.centroid).toFixed(3);
        }
        if (keywordEmbedding && centroidEntry) {
            docL2 = l2Distance(keywordEmbedding, centroidEntry.centroid).toFixed(3);
        }
        const kw = keywordsMap.get(cid)?.join(', ') || 'N/A';

        if (primaryClusterId === null) {
            primaryClusterId = cid;
            primaryHits = hits;
        }

        const star = cid === primaryClusterId ? '*' : ' ';
        const row =
            (star + cid).padEnd(8) +
            String(totalDocsInCluster).padStart(6) +
            String(hits).padStart(6) +
            (pct + '%').padStart(8) +
            sim.toString().padStart(9) +
            kwSim.toString().padStart(9) +
            docL2.toString().padStart(9) +
            keyL2.toString().padStart(9) +
            ' ' + kw;

        // update best trackers
        const docSimNum = parseFloat(sim.toString());
        if (!isNaN(docSimNum) && docSimNum > bestDocSim.val) bestDocSim = { id: cid, val: docSimNum };

        const keySimNum = kwSim === 'N/A' ? NaN : parseFloat(kwSim.toString());
        if (!isNaN(keySimNum) && keySimNum > bestKeySim.val) bestKeySim = { id: cid, val: keySimNum };

        const docL2Num = docL2 === 'N/A' ? NaN : parseFloat(docL2.toString());
        if (!isNaN(docL2Num) && docL2Num < bestDocL2.val) bestDocL2 = { id: cid, val: docL2Num };

        const keyL2Num = keyL2 === 'N/A' ? NaN : parseFloat(keyL2.toString());
        if (!isNaN(keyL2Num) && keyL2Num < bestKeyL2.val) bestKeyL2 = { id: cid, val: keyL2Num };

        console.log(row);
    }

    // Summary of algorithmic selections
    console.log('\nAlgorithmic best matches:');
    if (bestDocSim.id !== -1) console.log(`  Highest DocSim  → Cluster ${bestDocSim.id} (cos=${bestDocSim.val.toFixed(3)})`);
    if (bestKeySim.id !== -1) console.log(`  Highest KeySim  → Cluster ${bestKeySim.id} (cos=${bestKeySim.val.toFixed(3)})`);
    if (bestDocL2.id !== -1 && bestDocL2.val !== Infinity) console.log(`  Lowest  DocL2   → Cluster ${bestDocL2.id} (L2=${bestDocL2.val.toFixed(3)})`);
    if (bestKeyL2.id !== -1 && bestKeyL2.val !== Infinity) console.log(`  Lowest  KeyL2   → Cluster ${bestKeyL2.id} (L2=${bestKeyL2.val.toFixed(3)})`);

    // Legend / Column descriptions
    console.log('\nColumn descriptions:');
    console.log('  Cluster  – cluster ID (* indicates highest hit count).');
    console.log('  Docs     – total documents in the cluster (from manifest).');
    console.log('  Hits     – documents containing the keyword.');
    console.log('  %Total   – Hits as percentage of all keyword matches.');
    console.log('  DocSim   – cosine similarity between cluster centroid and the averaged embedding of all keyword-hit docs (higher is closer).');
    console.log('  KeySim   – cosine similarity between cluster centroid and the embedding of the keyword string itself.');
    console.log('  DocL2    – Euclidean distance between centroid and doc-mean embedding (lower is closer).');
    console.log('  KeyL2    – Euclidean distance between centroid and keyword embedding.');
    console.log('  Keywords – top TF-IDF keywords for the cluster (if available).');

    // Dispersion warning
    const otherHits = totalHits - primaryHits;
    const dispersion = otherHits / totalHits; // fraction of matches outside primary cluster
    if (dispersion > 0.2) {
        console.warn(`\nWarning: ${(dispersion * 100).toFixed(1)}% of keyword occurrences are outside the primary cluster (>${(0.2 * 100)}% threshold). Cohesion may be low.`);
    }
})();