### Objective: Implement Client-Side Hybrid Search with a Precomputed, Sharded Full-Text Inverted Index

This plan outlines creating and using a full-text search system where a global inverted index is precomputed offline, potentially sharded for client-side efficiency, and then used in a hybrid search setup combined with existing vector search capabilities using Reciprocal Rank Fusion (RRF) for re-ranking. This approach is independent of how vector search indexes/clusters are managed.

**Assumptions:**
* An existing vector search mechanism (potentially using clustered embeddings) is in place or planned.
* Offline processing capabilities are available.
* The client can perform text processing (tokenization, stemming, stop-word removal) consistently with offline steps.

---
**Phase 1: Offline Pre-computation & Asset Generation (Full-Text Search Component)**
---

1.  **Text Processing Configuration:**
    * **Define Pipeline:** Establish a consistent text processing pipeline:
        * Tokenization strategy (e.g., whitespace/punctuation, or a more advanced method).
        * Lowercase conversion.
        * Stop word list (e.g., for English).
        * Stemming algorithm (e.g., Porter Stemmer).
    * This pipeline MUST be replicable client-side.

2.  **Build Global Inverted Index & Document Metadata:**
    * For each document in your entire corpus:
        * Apply the defined text processing pipeline to its searchable text fields to get processed terms.
        * Record Term Frequencies (TF) for each processed term within the document.
        * Store document length (number of processed tokens).
    * **Global Inverted Index Construction:**
        * Structure: `Map<string (processedTerm), Map<string (documentId), number (termFrequencyInDoc)>>`
        * This maps each unique processed term in the corpus to the documents containing it and the term's frequency in those documents.
    * **Document Frequency (DF) Calculation:**
        * Structure: `Map<string (processedTerm), number (numberOfDocumentsContainingTerm)>`
    * **Corpus Statistics:**
        * Calculate `totalDocuments` in the corpus.
        * Calculate `averageDocumentLength` (average number of processed tokens per document).

3.  **Output File Generation:**
    * **A. Sharded Inverted Index:**
        * **Strategy:** If the global inverted index is too large for a single client-side load, shard it alphabetically by processed term (e.g., `inverted_index_shard_a.json`, `inverted_index_shard_b.json`, ..., or `inverted_index_shard_aa-ad.json`, etc.). Each shard file contains a portion of the global inverted index.
        * **Content:** Each shard file will have the structure: `Map<string (processedTerm), Map<string (documentId), number (termFrequencyInDoc)>>` for terms falling into that shard's range.
        * **Alternative (if total index is small):** A single `inverted_index.json` file.
    * **B. Document Frequencies File:**
        * `document_frequencies.json` (or `.msgpack`): `Map<string (term), number (df_count)>`.
    * **C. Document Lengths File:**
        * `document_lengths.json` (or `.msgpack`): `Map<string (docId), number (length_in_tokens)>`.
    * **D. Corpus Statistics File:**
        * `corpus_stats.json` (or `.msgpack`): `{ totalDocuments: number, averageDocumentLength: number }`.
    * **E. Document Store (Optional but Recommended):**
        * A way to fetch document details (title, snippet) by `documentId`. This might be part of your existing data loading or a separate `doc_store.json` (potentially sharded if very large, e.g., by `docId` prefix).
    * **F. Manifest Update:** An updated `manifest.json` (or equivalent) to list paths to these new full-text search asset files/shards.

---
**Phase 2: Client-Side Implementation (TypeScript)**
---

1.  **Load Core Full-Text Search Metadata:**
    * On application load (or on-demand if preferred), fetch and parse:
        * `document_frequencies.json`
        * `document_lengths.json`
        * `corpus_stats.json`
    * Store these in memory for use by the search service.

2.  **Full-Text Search Service (`FullTextSearchService.ts` - New or Enhanced):**
    * **A. Client-Side Text Processing:**
        * Implement a function that replicates the offline text processing pipeline (tokenize, lowercase, stem, stop words) *exactly*.
    * **B. Query Processing:**
        * Accepts a user's raw text query.
        * Applies the client-side text processing pipeline to get processed query terms.
    * **C. Selective Index Shard Loading:**
        * Based on the processed query terms, determine which inverted index shard files are needed (e.g., if a query term starts with 'c', load `inverted_index_shard_c.json`).
        * Asynchronously fetch and cache these required shard(s). If a shard is already loaded, use the cached version.
    * **D. Search Logic:**
        * Initialize a map to store candidate documents and their scores.
        * For each processed query term:
            * Look up the term in the relevant loaded inverted index shard(s).
            * Retrieve the list/map of `documentId`s and their `termFrequencyInDoc` for that term.
            * For each `documentId`, update its score in the candidate map using a chosen ranking algorithm.
    * **E. Scoring/Ranking (BM25 Recommended):**
        * Implement BM25 scoring using the loaded TFs (from inverted index shards), DFs, document lengths, and corpus stats.
        * BM25 Formula: `score(doc, query) = Σ ( IDF(term_i) * ( TF(term_i, doc) * (k1 + 1) ) / ( TF(term_i, doc) + k1 * (1 - b + b * (|doc| / avgDocLength)) ) )` for each `term_i` in the query.
            * `k1` and `b` are BM25 parameters (e.g., k1=1.2 to 2.0, b=0.75).
            * `IDF(term) = log( (totalDocs - DF(term) + 0.5) / (DF(term) + 0.5) + 1 )`.
    * **F. Output:** Return a ranked list of `documentId`s with their BM25 scores.

3.  **RAG Pipeline Modification (`RAGManager.ts` or equivalent):**
    * **A. Parallel Retrieval:**
        * When a user query comes in:
            1.  Perform vector search (using your existing clustered or non-clustered semantic search method) to get a ranked list of semantic results (`{docId, vectorScore}`).
            2.  Simultaneously, call the `FullTextSearchService` to get a ranked list of full-text search results (`{docId, bm25Score}`).
    * **B. Score Normalization (Optional but helpful for some fusion methods):**
        * If the score ranges from vector search and BM25 are very different, consider normalizing them (e.g., min-max scaling) before fusion, though RRF is less sensitive to this.
    * **C. Reciprocal Rank Fusion (RRF):**
        * Combine the two ranked lists (semantic and full-text) using RRF.
        * For each document `d` appearing in one or both lists:
            `RRF_Score(d) = (1 / (k_rrf + rank_semantic(d))) + (1 / (k_rrf + rank_fulltext(d)))`
            * If a document is not in a list, its contribution from that list is 0 (or its rank is considered infinity).
            * `k_rrf` is a constant (e.g., 60).
        * Sort documents by their final `RRF_Score` in descending order.
    * **D. Result Presentation:**
        * Fetch full document details for the top N fused results using the `documentId`s and the (potentially sharded) document store.
        * Display these to the user.

4.  **Web Worker Integration:**
    * Offload computationally intensive client-side tasks to a Web Worker:
        * Client-side query text processing.
        * Loading and parsing of index shards.
        * BM25 score calculation.
        * Potentially the RRF fusion logic if dealing with very long lists.

---
**Phase 3: Iteration & Optimization**
---

1.  **Tune BM25 Parameters:** Experiment with `k1` and `b` values for BM25 to optimize relevance for your dataset.
2.  **Tune RRF `k_rrf` Constant:** Adjust the `k_rrf` constant to balance the influence of semantic vs. full-text search results.
3.  **Evaluate Sharding Strategy:** If alphabetical sharding leads to very uneven shard sizes or many small file requests, consider alternative term sharding (e.g., by term hash, or more granular alphabetical ranges).
4.  **Caching:** Implement robust caching for fetched index shards and document store parts to minimize redundant network requests.
5.  **Performance Profiling:** Use browser developer tools to identify and optimize bottlenecks in client-side processing and data handling.

**Advantages:**
* Provides robust hybrid search by combining semantic and keyword strengths.
* Full-text search index is independent of vector search clustering.
* Selective loading of inverted index shards improves client-side performance for large vocabularies.

**Challenges:**
* Increased complexity in offline asset generation (sharded index).
* Managing dynamic loading and combining of index shards on the client.
* Ensuring consistent text processing between offline and client-side.
