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

    // Build keyword embedding by averaging vectors of all matching docs
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

    // Sort clusters by hit count desc
    const sorted = Object.entries(clusterHits).sort((a, b) => b[1] - a[1]);

    console.log(`Keyword "${keywordArg}" distribution across clusters:`);

    const totalHits = Object.values(clusterHits).reduce((sum, v) => sum + v, 0);
    if (totalHits === 0) {
        console.log('No documents containing the keyword were found in any cluster.');
        process.exit(0);
    }

    // Header
    console.log('\nCluster\tHits\t% of total\tCentroidSim\tKeywords');

    let primaryClusterId: number | null = null;
    let primaryHits = 0;

    for (const [cidStr, hits] of sorted) {
        const cid = Number(cidStr);
        const pct = ((hits / totalHits) * 100).toFixed(1);
        const centroidEntry = centroids.find(c => c.clusterId === cid);
        const sim = keywordEmbedding && centroidEntry
            ? cosineSimilarity(keywordEmbedding, centroidEntry.centroid).toFixed(3)
            : 'N/A';

        const kw = keywordsMap.get(cid)?.join(', ') || 'N/A';

        if (primaryClusterId === null) {
            primaryClusterId = cid;
            primaryHits = hits;
        }

        const star = cid === primaryClusterId ? '*' : ' ';
        console.log(`${star}${cid}\t${hits}\t${pct}%\t\t${sim}\t${kw}`);
    }

    // Dispersion warning
    const otherHits = totalHits - primaryHits;
    const dispersion = otherHits / totalHits; // fraction of matches outside primary cluster
    if (dispersion > 0.2) {
        console.warn(`\nWarning: ${(dispersion * 100).toFixed(1)}% of keyword occurrences are outside the primary cluster (>${(0.2 * 100)}% threshold). Cohesion may be low.`);
    }
})();