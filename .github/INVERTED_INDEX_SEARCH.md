# Future Improvement Proposal: Adding Inverted Index for Full-Text Search to In-Browser RAG

**Date:** May 7, 2025
**Status:** Potential Enhancement (Post-MVP or Future Iteration)
**Context:** Current RAG system relies on semantic search via pre-computed vector embeddings (Snowflake Arctic embed xs) and clustered search (dot product on L2-normalized vectors). This proposal explores adding keyword-based full-text search capabilities using an inverted index on the document metadata's text strings.

## 1. Objective of Enhancement

To augment the existing semantic search with traditional keyword-based full-text search capabilities. This will allow users to retrieve documents based on the exact presence or frequency of specific terms, complementing the meaning-based retrieval of vector search. The goal is to enable a more robust hybrid search system.

## 2. Core Concept: Inverted Index

* An **inverted index** will be pre-computed offline. This index will map processed terms (keywords) to the documents (or document chunks) that contain them.
* Client-side, this index will be loaded and used to quickly find documents matching user query terms.

## 3. Key Components & Changes Required

### 3.1. Offline Pre-computation (Enhancements to `pipeline/scripts/generateEmbeddings.mjs` or similar)

* **A. Text Processing for Indexing:**
    * **Tokenization:** Implement a robust tokenizer to split document text into individual words/tokens. (Consider simple whitespace/punctuation splitting or a more advanced tokenizer).
    * **Normalization:**
        * Convert all tokens to lowercase.
        * **Stemming:** Implement or integrate a stemming algorithm (e.g., Porter Stemmer for English) to reduce words to their root form (e.g., "running" -> "run"). This is crucial for recall and index size.
        * **Stop Word Removal:** Define and filter out common, non-informative words (e.g., "the", "a", "is", "of").
* **B. Building the Inverted Index:**
    * **Structure:** A primary map (object in JavaScript) where:
        * `key`: Normalized and stemmed term.
        * `value`: A list of document IDs (or `clusterId` + `docIndexInCluster`) that contain this term.
    * **Optional for Advanced Scoring (e.g., BM25):**
        * Store term frequencies (TF) within the document lists (e.g., `term: { docId1: tf1, docId2: tf2, ... }`).
        * Store document frequencies (DF) for each term (i.e., how many documents contain the term).
        * Store the length (number of tokens) of each document.
        * Calculate and store the average document length over the corpus.
* **C. Output Files (New):**
    * **`inverted_index.json` (or `.msgpack`):** Contains the core inverted index (term -> docID list/map). MessagePack is recommended for compactness if the index becomes large.
    * **(Optional, for BM25/TF-IDF):**
        * `document_frequencies.json` (or `.msgpack`): Map of `term -> df_count`.
        * `document_lengths.json` (or `.msgpack`): Map of `docId -> length_in_tokens`.
        * `corpus_stats.json` (or `.msgpack`): Contains `totalDocuments` and `averageDocumentLength`.
* **D. Manifest Update:** The main `manifest.json` would need to point to these new index files.

### 3.2. Client-Side Implementation (TypeScript)

* **A. Data Loading (`src/lib/dataLoader.ts`):**
    * New functions to load the `inverted_index.json` and any optional scoring-related files (e.g., document frequencies, document lengths).
    * Store this data in an accessible way for the search service.
* **B. Full-Text Search Service (`src/lib/fullTextSearchService.ts` - New Module):**
    * **Initialization:** Takes the loaded inverted index data.
    * **Query Processing:**
        * Implement a client-side text processing function that mirrors the offline tokenization, lowercasing, stemming, and stop-word removal *exactly*.
    * **Search Logic:**
        * Accepts a user's text query.
        * Processes the query into normalized/stemmed terms.
        * For each processed query term, look up matching document IDs in the loaded inverted index.
        * Implement logic to combine results for multi-term queries (e.g., AND - intersection of doc ID lists; OR - union of doc ID lists).
    * **Scoring/Ranking (Tiered Approach Recommended):**
        1.  **Basic:** Rank by simple presence or count of query terms in documents.
        2.  **TF-IDF:** If TF and DF are pre-computed and loaded, implement TF-IDF scoring.
        3.  **BM25:** If all necessary components (TF, DF, doc lengths, avg doc length) are available, implement BM25 scoring for higher relevance ranking. This is more complex but often provides superior results for full-text search.
* **C. RAG Pipeline Modification (`src/lib/ragManager.ts`):**
    * The `retrieveRelevantDocuments` method will need to incorporate results from this new `FullTextSearchService` alongside the existing `ClusteredSearchService` (vector search).
    * **Hybrid Search Strategy:**
        * **Option 1 (Simple Filter/Boost):** Use keyword search as a pre-filter for semantic search, or use keyword matches to boost scores of semantically retrieved documents.
        * **Option 2 (Parallel Search & Score Fusion - Recommended for Best Quality):**
            * Perform vector search and full-text search independently.
            * Combine the ranked lists using a fusion algorithm like Reciprocal Rank Fusion (RRF) to produce a single, unified ranking. This requires normalized scores or ranks from both search methods.
            * RRF Formula (conceptual): For a document `d`, `RRF_Score(d) = Σ (1 / (k_rrf + rank_i(d)))` for each search method `i` where `d` appears. `k_rrf` is a constant (e.g., 60).
* **D. Web Worker Integration:**
    * Both the client-side query processing (tokenization, stemming) and the search/scoring logic of the `FullTextSearchService` should be offloaded to a Web Worker to prevent UI blocking, especially if BM25 or complex fusion is implemented.
* **E. Dependencies:**
    * A lightweight JavaScript stemming library (e.g., `porter-stemmer`) might be needed for both offline processing and client-side query processing to ensure consistency.

## 4. Impact Assessment

* **Benefits:**
    * Improved retrieval for queries where specific keywords are crucial.
    * Handles queries where semantic meaning is ambiguous but keywords are clear.
    * Provides a more comprehensive search experience (hybrid search).
    * Can help with "cold start" scenarios where query embeddings might not perfectly match document embeddings for niche terms.
* **Costs/Challenges:**
    * **Increased Offline Complexity:** Building and maintaining the inverted index and associated data (stemming, stop words, TF/IDF/BM25 components) adds significant work to the data preparation pipeline.
    * **Increased Client-Side Asset Size:** The inverted index file itself can be substantial (potentially hundreds of KB to several MBs, depending on corpus size and vocabulary after processing). Other metadata files for scoring also add to this. This impacts initial load time and browser storage.
    * **Increased Client-Side Computational Load:** Tokenizing/stemming queries, looking up in the index, calculating relevance scores (especially BM25), and fusing results, even in a Web Worker, adds CPU cycles.
    * **Increased Implementation Effort:** New services, data structures, and more complex RAG orchestration logic are required.
    * **Memory Management:** Loading and holding the inverted index in memory on the client needs careful consideration, though it's typically a one-time load.

## 5. Implementation Strategy (Phased Approach Recommended)

1.  **Phase 0.A (Offline):**
    * Implement robust text processing (tokenize, lowercase, stem, stop words).
    * Build a basic inverted index (term -> list of document IDs).
    * Output this index as `inverted_index.json` (or `.msgpack`).
2.  **Phase 0.B (Offline - Optional for basic keyword search, required for BM25):**
    * Enhance index to store Term Frequencies (TF).
    * Compute and store Document Frequencies (DF), document lengths, and average document length.
3.  **Phase 1.A (Client):**
    * Load the basic inverted index.
    * Implement client-side query processing (matching offline steps).
    * Implement basic keyword search (AND/OR logic, simple presence-based ranking).
    * Integrate into `RAGManager` with a simple hybrid strategy (e.g., show two separate lists of results or a basic sequential filter).
    * Ensure this runs in a Web Worker.
4.  **Phase 1.B (Client - Advanced Ranking):**
    * If Phase 0.B was done, load the additional scoring metadata.
    * Implement TF-IDF or (preferably) BM25 scoring in `FullTextSearchService`.
5.  **Phase 1.C (Client - Advanced Fusion):**
    * Implement a more sophisticated score fusion technique like Reciprocal Rank Fusion (RRF) in `RAGManager`.

## 6. Considerations for "Lightweight" Nature

* **Stemming & Stop Word List Size:** The choice of stemmer and the size of the stop word list will impact the client-side bundle if these are included directly. Pre-processing text extensively offline is key.
* **Inverted Index Size:** If the corpus is very large, the resulting index might challenge browser memory or initial load times. Strategies like sharding the index (if feasible and truly necessary) are far more complex. For most "reasonable" in-browser datasets, a well-processed index should be manageable.
* **Scoring Complexity:** BM25 is more computationally intensive than simple TF-IDF or presence checks. Start simpler if performance is a major concern on low-end devices.

## 7. Conclusion

Adding an inverted index for full-text search is a valuable enhancement that can significantly improve search relevance and user satisfaction for many query types. However, it comes with notable increases in complexity, client-side data size, and computational requirements. A phased implementation, starting with basic keyword matching and iteratively adding more sophisticated ranking and fusion, is recommended. Thorough testing on target devices will be crucial to ensure the "lightweight" and "low-resource" nature of the application is maintained.