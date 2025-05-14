#!/usr/bin/env ts-node

/**
 * extractClusterKeywords.ts
 * --------------------------------
 * Compute TF-IDF scores for tokens inside each k-means cluster and emit the
 * top-N keywords per cluster. The resulting file will later be consumed by an
 * LLM labelling step.
 *
 * Usage:
 *   pnpm ts-node pipeline/scripts/extractClusterKeywords.ts [topK]
 *
 * The script writes `cluster_keywords.json` next to the embeddings output
 * directory, with the shape:
 *   [{ clusterId: number, keywords: string[] }]
 */

import { promises as fs } from 'fs';
import path from 'path';

const OUTPUT_DIR = path.resolve(process.cwd(), 'public', 'embeddings', 'school_districts');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const DEFAULT_TOP_K = 10;

interface ManifestCluster {
    clusterId: number;
    metadataFile: string | null;
    count: number;
}
interface Manifest { clusters: ManifestCluster[]; }

interface ClusterKeywords { clusterId: number; keywords: string[]; }

// A very small English stop-word list – can be expanded later.
const STOP_WORDS = new Set([
    'the', 'and', 'is', 'in', 'of', 'to', 'a', 'for', 'on', 'with', 'by', 'at', 'from', 'an', 'as', 'that', 'this', 'it', 'be', 'are', 'was', 'were', 'or', 'but', 'not', 'have', 'has', 'had', 'may', 'can', 'will', 'would', 'could', 'should', 'all', 'any', 'each', 'other', 'more', 'most', 'such'
]);

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ') // remove punctuation
        .split(/\s+/)
        .filter(t => t.length > 2 && !STOP_WORDS.has(t));
}

async function readJSON<T>(filePath: string): Promise<T> {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
}

(async () => {
    const topK = Number(process.argv[2]) || DEFAULT_TOP_K;

    const manifest = await readJSON<Manifest>(MANIFEST_PATH);

    // Aggregations
    const clusterTF: Record<number, Map<string, number>> = {};
    const docFreq: Map<string, number> = new Map();
    let totalDocs = 0;

    for (const cl of manifest.clusters) {
        if (!cl.metadataFile) continue;

        const metaPath = path.join(OUTPUT_DIR, cl.metadataFile);
        const docs: any[] = await readJSON<any[]>(metaPath);

        if (!clusterTF[cl.clusterId]) clusterTF[cl.clusterId] = new Map();
        const tfMap = clusterTF[cl.clusterId];

        for (const doc of docs) {
            totalDocs += 1;
            const textParts: string[] = [];
            if (doc.title) textParts.push(doc.title);
            if (doc.text) textParts.push(doc.text);
            const tokens = tokenize(textParts.join(' '));

            // Update TF counts for cluster
            for (const tok of tokens) {
                tfMap.set(tok, (tfMap.get(tok) || 0) + 1);
            }

            // Update DF – count unique tokens per document
            const uniqueTokens = new Set(tokens);
            for (const tok of uniqueTokens) {
                docFreq.set(tok, (docFreq.get(tok) || 0) + 1);
            }
        }
    }

    // Compute TF-IDF & select top keywords per cluster
    const result: ClusterKeywords[] = [];

    for (const [cidStr, tfMap] of Object.entries(clusterTF)) {
        const cid = Number(cidStr);
        const scored: Array<{ term: string; score: number }> = [];

        tfMap.forEach((tf, term) => {
            const df = docFreq.get(term) || 1;
            const idf = Math.log((totalDocs) / df);
            const score = tf * idf;
            scored.push({ term, score });
        });

        scored.sort((a, b) => b.score - a.score);
        const keywords = scored.slice(0, topK).map(s => s.term);
        result.push({ clusterId: cid, keywords });
    }

    // Write output file
    const outPath = path.join(OUTPUT_DIR, 'cluster_keywords.json');
    await fs.writeFile(outPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`Wrote top ${topK} keywords for ${result.length} clusters → ${path.relative(process.cwd(), outPath)}`);
})(); 