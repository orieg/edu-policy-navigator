### Cluster Label / Theme Extraction – Approach Evaluation

Following internal guideline **03-evaluate-options**, we consider three ways to generate a **human-readable label** for every k-means cluster in `public/embeddings/school_districts`.

| ID | Approach | Key Steps | Resources / Dependencies | Risks & Drawbacks | Expected Benefits |
|----|----------|-----------|--------------------------|-------------------|-------------------|
| **A** | TF-IDF Top-Terms | 1. Load cluster metadata text. 2. Compute per-cluster TF-IDF scores. 3. Take top-k terms (excluding stop-words) as label.| Only `natural` / `wink-nlp` etc. in Node; no LLM calls.| Labels may be cryptic (IDs, addresses). No semantic grouping ("CA" vs "California").| Fast, deterministic, zero cost, no API keys.|
| **B** | LLM Summarisation | 1. Concatenate N sample documents from cluster. 2. Prompt local LLM (SmolLM2) or remote API to "Provide a short theme/label". | WebLLM or OpenAI (cost). | Quality varies with model; cost/latency. Prompt tuning needed.| Produces concise, readable label; can merge synonyms.|
| **C** | Hybrid (TF-IDF → LLM) **(recommended)** | 1. Run TF-IDF to pick top 10 keywords. 2. Feed those + sample docs to LLM, ask for a 2-5-word label. 3. Fallback to TF-IDF if LLM unavailable. | TF-IDF lib + local LLM (SmolLM2)––cheap, fast. | Adds both steps; still depends on LLM quality. | Captures salient terms while ensuring semantic readability.|

#### Evaluation Matrix

| Criterion (weight) | A TF-IDF | B LLM | C Hybrid |
|--------------------|---------|-------|---------|
| Relevance / clarity (40%) | 0.6 | 0.8 | **0.9** |
| Determinism (10%) | **1.0** | 0.4 | 0.8 |
| Implementation effort (20%) | **0.9** | 0.6 | 0.7 |
| Runtime cost & latency (15%) | **1.0** | 0.4 | 0.8 |
| Flexibility / future-proof (15%) | 0.7 | 0.9 | **0.9** |
| **Weighted Score** | **0.83** | 0.66 | **0.87** |

> Hybrid Approach **C** scores highest, balancing clarity with low cost.

---

## Selected Approach – Hybrid (TF-IDF → LLM)

### Why Chosen
* Produces human-friendly labels (LLM) but is guided by the cluster's top keywords, ensuring on-topic summaries.
* Local SmolLM2 models keep costs zero and data local; fallback to plain TF-IDF guarantees determinism.
* Adds only lightweight TF-IDF pass to existing data-loader pipeline.

### High-Level Implementation Plan
1. **TF-IDF Keyword Extraction (pipeline step)**
   * Re-use existing metadata reading logic.
   * For each cluster, build term frequency map (stop-word filtered).
   * Store top 10 terms per cluster.
2. **LLM Labelling Script (`pipeline/scripts/generateClusterLabels.ts`)**
   * For each cluster: prompt local LLM with the top terms + 3 sample document titles/snippets.
   * Prompt template: _"Given these keywords and snippets, return a short (≤5 words) theme describing the common topic."_
   * Save result to `cluster_labels.json` → `{ clusterId, label, keywords }`.
3. **Validate & Integrate**
   * Extend `validateClusterCohesion.ts` to load `cluster_labels.json` and display the label in the 4th column.
4. **UI / Worker consumption** (future)
   * When RAG context is retrieved, show cluster label alongside score.

### Milestones / Checkpoints
1. ✅  Add evaluation & plan (this file).
2. ⏳  Implement TF-IDF keyword extraction utility.
3. ⏳  Create LLM labelling script; test on SRVUSD clusters.
4. ⏳  Update validation & worker.
5. ⏳  UI display in `rag-test`. 