#!/usr/bin/env ts-node

/**
 * generateClusterLabels.ts
 * --------------------------------
 * Consumes `cluster_keywords.json` (output from extractClusterKeywords.ts)
 * and sample snippets from each cluster to generate a concise (≤5 words)
 * human-readable label for each cluster.
 *
 * The script first attempts to use an LLM (OpenAI or compatible) if
 * `OPENAI_API_KEY` (and optionally `OPENAI_BASE_URL`) environment variables
 * are set. If no key is found or the API call fails, it falls back to a
 * deterministic label derived from the top keywords (joined by space).
 *
 * Output: `cluster_labels.json` with shape
 *   [{ clusterId: number; label: string; keywords: string[]; method: 'llm'|'keywords' }]
 *
 * Usage:
 *   pnpm ts-node pipeline/scripts/generateClusterLabels.ts [--sample 3] [--model gpt-3.5-turbo]
 */

import { promises as fs } from 'fs';
import path from 'path';

const OUTPUT_DIR = path.resolve(process.cwd(), 'public', 'embeddings', 'school_districts');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'manifest.json');
const KEYWORDS_PATH = path.join(OUTPUT_DIR, 'cluster_keywords.json');
const DEFAULT_SAMPLE_DOCS = 3;
const DEFAULT_MODEL = 'gpt-3.5-turbo';

interface ManifestCluster {
    clusterId: number;
    metadataFile: string | null;
}
interface Manifest { clusters: ManifestCluster[]; }

interface ClusterKeywords { clusterId: number; keywords: string[]; }
interface ClusterLabel { clusterId: number; label: string; keywords: string[]; method: 'llm' | 'keywords'; }

async function readJSON<T>(filePath: string): Promise<T> {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
}

function parseArgs() {
    const args = process.argv.slice(2);
    const opts: Record<string, any> = { sample: DEFAULT_SAMPLE_DOCS, model: DEFAULT_MODEL };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--sample') opts.sample = Number(args[++i]);
        else if (args[i] === '--model') opts.model = args[++i];
    }
    return opts;
}

async function callOpenAI(model: string, prompt: string): Promise<string | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    try {
        const openaiModule = await import('openai');
        const { default: OpenAI } = openaiModule as any;
        const openai = new OpenAI({
            apiKey,
            baseURL: process.env.OPENAI_BASE_URL || undefined,
        });
        const chat = await openai.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: 'You are a helpful assistant that assigns concise thematic labels to document clusters.' },
                { role: 'user', content: prompt },
            ],
            temperature: 0.2,
            max_tokens: 16,
        });
        return chat.choices[0].message.content?.trim() || null;
    } catch (err) {
        console.warn('LLM call failed, falling back to keyword-based label:', (err as Error).message);
        return null;
    }
}

(async () => {
    const { sample, model } = parseArgs();

    const manifest = await readJSON<Manifest>(MANIFEST_PATH);
    const kwData = await readJSON<ClusterKeywords[]>(KEYWORDS_PATH);
    const kwMap = new Map<number, string[]>(kwData.map(k => [k.clusterId, k.keywords]));

    const results: ClusterLabel[] = [];

    for (const cl of manifest.clusters) {
        const keywords = kwMap.get(cl.clusterId) || [];
        let label: string | null = null;
        let method: 'llm' | 'keywords' = 'keywords';

        // Build prompt and attempt LLM label if API key present
        if (process.env.OPENAI_API_KEY) {
            const snippets: string[] = [];
            if (cl.metadataFile) {
                const docs: any[] = await readJSON<any[]>(path.join(OUTPUT_DIR, cl.metadataFile));
                for (let i = 0; i < Math.min(sample, docs.length); i++) {
                    const d = docs[i];
                    const title = d.title || '';
                    const snippet = (d.text || '').slice(0, 120).replace(/\s+/g, ' ');
                    snippets.push(`- ${title}: ${snippet}`);
                }
            }
            const prompt = `Given these keywords:\n${keywords.join(', ')}\n\nAnd these document snippets:\n${snippets.join('\n')}\n\nReturn a short (<=5 words) theme describing the common topic. Respond with only the label.`;
            label = await callOpenAI(model, prompt);
            if (label) method = 'llm';
        }

        // Fallback: simple keyword join
        if (!label) {
            label = keywords.slice(0, 3).join(' ').slice(0, 30);
        }

        results.push({ clusterId: cl.clusterId, label, keywords, method });
        console.log(`[${cl.clusterId}] ${label}`);
    }

    const outPath = path.join(OUTPUT_DIR, 'cluster_labels.json');
    await fs.writeFile(outPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`\nWrote labels for ${results.length} clusters → ${path.relative(process.cwd(), outPath)}`);
})(); 