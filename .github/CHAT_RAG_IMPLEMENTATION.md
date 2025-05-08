# Plan: In-Browser RAG with Pre-Computed Raw Binary Embeddings, Clusters & WebLLM Chat (JSON Metadata)

**Objective:** Implement a high-performance, lightweight Retrieval Augmented Generation (RAG) system entirely within the browser. This system will use:
1.  **Offline Pre-computation:**
    * Document embeddings (for the `Snowflake Arctic embed xs` model - 384 dimensions) stored as L2-normalized, **raw binary files (`.bin`)** per cluster.
    * Associated text chunks and original document IDs stored in companion **JSON metadata files** per cluster (`<cluster_id>_metadata.json`), maintaining order with embeddings.
    * L2-normalized cluster centroids, stored either as a **raw binary file (`.bin`)** or as structured **JSON**. 
2.  **Client-Side:**
    * **WebLLM** to generate L2-normalized embeddings *only for user queries* (using the `Snowflake Arctic embed xs` model, sourced from central configuration like `src/config/siteConfig.ts`).
    * A **Data Loader** to fetch and process the raw binary embedding files and their corresponding JSON metadata files, guided by a manifest.
    * A **lightweight vector search module** (custom TypeScript implementation) to perform efficient two-stage search (query vs. centroids, then query vs. documents in selected clusters using dot product on the L2-normalized vectors).
    * **WebLLM** for chat completions (using a model like `SmolLM-135M-Instruct-q0f16-MLC`, sourced from `src/config/siteConfig.ts`), augmented with retrieved context.
The data in the browser will be read-only after initial load.

**Core Client-Side Components (TypeScript):**
1.  WebLLM Engine (for Query Embedding).
2.  WebLLM Engine (for Chat).
3.  Pre-computed Data Loader (handles manifest, `.bin` embedding files, and `.json` metadata files).
4.  Lightweight Vector Search Logic (custom, optimized for pre-loaded, clustered, normalized binary data).
5.  RAG Pipeline (orchestrating the client-side flow).

**General Guidance for Client-Side Implementation:**
* All new client-side code should be written in **TypeScript**.
* Model IDs for WebLLM (both query embedding and chat) should be sourced from a central configuration file (e.g., `src/config/siteConfig.ts`).
* Minimize external dependencies. Only `@mlc-ai/web-llm` is expected. JSON metadata uses native `JSON.parse()`.
* Ensure all vector embeddings (document, centroid, and runtime query embeddings) are L2-normalized. Use **dot product** for similarity.
* Refer to the latest WebLLM documentation for exact API method names and configuration options.

---

## Phase 0: Offline Data Preparation (Pre-computation - Outputs for Client)

*(This phase is done beforehand by a separate pipeline, e.g., an enhanced `pipeline/scripts/generateEmbeddings.mjs`. The client-side agent needs to understand these output formats.)*

### Task 0.1: Document Chunking (Offline)
* Divide source documents (including processing `public/assets/districts.json` and `public/assets/schools_by_district.json`) into text chunks.
* Assign a unique ID to each chunk. **Use `CDSCode` (or similar unique identifier) as the `id` for chunks derived from school/district data.**
* **Output:** Internal list of `{ id: string, text: string }`.

### Task 0.2: Embedding Generation for Chunks (Offline)
* Using `Snowflake Arctic embed xs` (384 dimensions), generate embeddings for each text chunk.
* **Crucial:** L2-normalize each embedding vector.
* **Output:** L2-normalized `Float32Array` embeddings.

### Task 0.3: Clustering Embeddings (Offline)
* Apply K-Means to L2-normalized document embeddings. Determine `k` clusters.
* Calculate `k` L2-normalized centroid vectors (`Float32Array`s).
* Map each document chunk ID to its cluster ID.

### Task 0.4: Structuring and Saving Pre-computed Data (Offline)
* **For each cluster (e.g., `cluster_0`, ... `cluster_k-1`):**
    1.  **Embeddings File (`<cluster_id>_embeddings.bin`):**
        * Collect all L2-normalized `Float32Array` embeddings for this cluster.
        * Concatenate into a single flat `Float32Array`.
        * **Write the raw bytes of this flat array directly to the binary file.**
    2.  **Metadata File (`<cluster_id>_metadata.json`):**
        * Contains an array of objects, ordered identically to the embeddings in the corresponding `.bin` file.
        * Each object: `{ id: string (e.g., CDSCode), text: string (original chunk_text), any_other_metadata... }`.
        * **Format:** Standard JSON.
* **Cluster Centroids File:**
    * **Option A (Pure Raw Binary - Recommended for numerical data): `centroids_vectors.bin`**
        * Concatenate all L2-normalized `Float32Array` centroid vectors into a single flat `Float32Array`.
        * Write the raw bytes to this binary file.
        * The `manifest.json` needs the `centroidClusterIds` array (ordered list of `clusterId`s corresponding to the binary segments).
    * **Option B (Structured with IDs): `centroids_data.json`**
        * An array of objects: `{ clusterId: string, centroid: number[] (L2-normalized float values) }`.
        * **Format:** Standard JSON.
* **Manifest File (`manifest.json` in `public/embeddings/` or similar):**
    * A JSON file detailing the dataset structure.
        ```json
        {
          "embeddingModelId": "Snowflake/snowflake-arctic-embed-xs",
          "embeddingDimensions": 384,
          "centroidsFileFormat": "binary", // "binary" or "json"
          "centroidsFile": "centroids_vectors.bin", // Path if format is binary
          "centroidClusterIds": ["cluster_0", "cluster_1", "..."], // Required if format is binary
          // OR "centroidsDataFile": "centroids_data.json", // Path if format is json
          // metadataFileFormat field removed - assumed JSON
          "clusters": [
            { "clusterId": "cluster_0", "embeddingsFile": "cluster_0_embeddings.bin", "metadataFile": "cluster_0_metadata.json", "numEmbeddings": 1000 },
            { "clusterId": "cluster_1", "embeddingsFile": "cluster_1_embeddings.bin", "metadataFile": "cluster_1_metadata.json", "numEmbeddings": 1250 }
            // ...
          ]
        }
        ```

---

## Phase 0.5: Client-Side Code & Dependency Cleanup

*   **Goal:** Remove obsolete code and dependencies from previous RAG experiments before starting the new implementation.
*   **Actions:**
    1.  **Remove Dependencies:**
        *   `pnpm remove @xenova/transformers` (if its only purpose was client-side query embedding).
        *   Verify `@babycommando/entity-db`, `kuzu`, `kuzu-wasm` are removed from `package.json` / `pnpm-lock.yaml`.
    2.  **Delete Obsolete Files:**
        *   `src/lib/vectorDbHandler.ts` (if exists).
        *   `src/types/entity-db.d.ts` (if exists).
    3.  **Decide Fate of `src/lib/ragController.ts`:**
        *   **Option A (Recommended):** Delete `src/lib/ragController.ts`. A new `RAGManager.ts` will be created (Phase 3).
        *   **Option B:** Rename `ragController.ts` to `RAGManager.ts` and completely rewrite its internals later.
    4.  **Consolidate WebLLM Logic (`webllmHandler.ts` -> `WebLLMService.ts`):**
        *   Plan to either merge logic from `src/lib/webllmHandler.ts` into the new `src/lib/WebLLMService.ts` (and delete the old handler) OR rename `webllmHandler.ts` to `WebLLMService.ts` and expand it (Phase 1).

---

## Phase 1: Client-Side Setup and Initialization (TypeScript)

*(Starts AFTER Phase 0.5 Cleanup)*

### Task 1.1: Initialize WebLLM Engine for Query Embedding
* **Action:** Implement in `src/lib/webLLMService.ts`. Ensure `MLCEngine` is initialized with `Snowflake Arctic embed xs` (ID from `siteConfig.ts`). Generated query embeddings *must be L2-normalized* by client code after receiving from WebLLM.

### Task 1.2: Initialize WebLLM Engine for Chat Completions
* **Action:** Implement in `src/lib/webLLMService.ts` (e.g., `SmolLM-135M-Instruct-q0f16-MLC` from `siteConfig.ts`).

---

## Phase 2: Client-Side Data Loading and Vector Store Setup (TypeScript)

### Task 2.1: Define Client-Side Data Structures
* **File:** `src/types/vectorStore.d.ts` (or `vectorStore.types.ts`).
    ```typescript
    interface DocumentMetadata { id: string; text: string; /* ...other metadata */ }

    interface ClusterEmbeddingData { // Represents content of one <cluster_id>_embeddings.bin
      embeddingsFlatArray: Float32Array; // All embeddings for the cluster, flattened
      numEmbeddings: number; // Number of embeddings in this flat array
      dimensions: number; // e.g., 384
    }

    interface ClusterData {
      clusterId: string;
      embeddingData: ClusterEmbeddingData;
      metadata: DocumentMetadata[]; // Ordered to match embeddings (from .json)
    }

    interface ClusterCentroidData {
      clusterId: string;
      centroid: Float32Array; // L2-normalized
    }

    interface SearchResult {
        id: string;
        text: string;
        score: number;
        // ... any other metadata to display
    }

    interface ManifestClusterEntry { // Structure from manifest.json clusters array
        clusterId: string;
        embeddingsFile: string;
        metadataFile: string; // Assumed .json
        numEmbeddings: number;
    }

    interface ManifestData { // Structure of manifest.json
        embeddingModelId: string;
        embeddingDimensions: number;
        centroidsFileFormat: "binary" | "json";
        centroidsFile?: string; // Path if binary
        centroidClusterIds?: string[]; // Required if binary format
        centroidsDataFile?: string; // Path if json format
        // metadataFileFormat field removed
        clusters: ManifestClusterEntry[];
    }
    ```
* **Action:** Create/update type definitions.

### Task 2.2: Implement Data Loader for Raw Binary and JSON Metadata
* **Module:** `src/lib/dataLoader.ts`.
* **Functionality:**
    1.  `async function loadManifest(url: string): Promise<ManifestData>`.
    2.  `async function loadCentroids(manifest: ManifestData, basePath: string = ''): Promise<ClusterCentroidData[]>`:
        * Handles loading based on `manifest.centroidsFileFormat` (binary slicing or JSON parsing via `response.json()`).
    3.  `async function loadSingleClusterData(clusterManifestEntry: ManifestClusterEntry, embeddingDimensions: number, basePath: string = ''): Promise<ClusterData>`:
        * Handles `.bin` embeddings (`ArrayBuffer` -> `Float32Array`).
        * Handles `.json` metadata (`response.json()`).
    4.  `async function loadAllRAGData(manifestUrl: string): Promise<{ centroids: ClusterCentroidData[], clustersData: Map<string, ClusterData>, embeddingDimensions: number, embeddingModelId: string }>`.
* **Action:** Implement `DataLoader.ts`. Use native JSON parsing for metadata.

### Task 2.3: Implement Lightweight Vector Search Logic
* **Module:** `src/lib/clusteredSearchService.ts`.
* **Class:** `ClusteredSearchService`.
    * `constructor(centroids: ClusterCentroidData[], clustersData: Map<string, ClusterData>, embeddingDimensions: number)`
    * `dotProduct(vecA: Float32Array, vecB: Float32Array): number` (ensure inputs are normalized).
    * `findTopKClusters(queryEmbedding: Float32Array, topM: number): ClusterCentroidData[]`.
    * `searchInCluster(queryEmbedding: Float32Array, clusterData: ClusterData, topKPerCluster: number): SearchResult[]`: (Details on slicing flat binary array as before).
* **Action:** Implement `ClusteredSearchService.ts`.

---

## Phase 3: RAG Pipeline Implementation (Client-Side, TypeScript)

* **Module:** `src/lib/ragManager.ts`.

### Task 3.1: Query Embedding
* **Action:** Implement `async getQueryEmbedding(query: string): Promise<Float32Array>` (gets embedding from `webLLMService` and L2-normalizes it).

### Task 3.2: Two-Stage Document Retrieval
* **Action:** Implement `async retrieveRelevantDocuments(...)` using `ClusteredSearchService`.

### Task 3.3: Augment Prompt & Generate Response
* **Action:** Implement `async getRagResponse(...)` using `webLLMService` (chat engine).

---

## Phase 4: User Interface & Integration (Initial Testbed, TypeScript)

### Task 4.1: Basic UI
* **Action:** Create `public/rag_test.html`.

### Task 4.2: Integrate RAG with UI (Web Workers)
* **Action:** Implement `public/rag_test_main.ts`. Ensure computationally intensive client-side tasks (query embedding, `findTopKClusters`, and especially `searchInCluster` within `retrieveRelevantDocuments`) are offloaded to Web Workers.

---

## Phase 5: Testing and Refinement (Initial Testbed)

### Task 5.1: Core Functionality Testing
* **Action:** Test data loading, binary parsing, normalization, search, RAG.

### Task 5.2: Performance & UX
* **Action:** Profile and optimize.

---

## Phase 6: Integration with Astro Chat Widget (TypeScript)

### Task 6.1: Integrate Custom RAG into `ExpandableChatWidget.astro`
* **Action:** Adapt widget's client script to use the new `RAGManager`, `DataLoader`, etc. Ensure Web Worker usage for intensive tasks. Manage loading states via `progressCallback`.

### Task 6.2: Context Switching / District ID (If Applicable)
* Consider how `currentDistrictId` might influence data loading or filtering if needed in the future.

---

## Phase 7: Final Touches & System-Wide Testing (Astro Widget)

### Task 7.1: Ensure Responsiveness of Astro Widget.
### Task 7.2: Accessibility Review & Enhancements.
### Task 7.3: Full End-to-End RAG and UI Testing.

---

**Next Steps (Focus Areas):**

1.  **Offline Pipeline Enhancement (Phase 0):** Output L2-normalized embeddings in per-cluster `.bin` files, ordered metadata (**JSON**), L2-normalized centroids (as `.bin` with ID mapping in manifest, or structured **JSON**), and `manifest.json`.
2.  **Client-Side Cleanup (Phase 0.5):** Remove old code/dependencies.
3.  **Implement Client-Side RAG Core (Phases 1-3 in TypeScript):** `WebLLMService`, `VectorStoreTypes.ts`, `DataLoader.ts`, `ClusteredSearchService.ts`, `RAGManager.ts`.
4.  **Basic UI Testing with Web Workers (Phases 4-5):** Test core logic and performance.
5.  **Astro Integration (Phase 6):** Integrate into `ExpandableChatWidget.astro`.
6.  **Final Testing & Polish (Phase 7):** Comprehensive E2E testing.

---

**General Testing Guidance (Client-Side):**
* Use browser developer tools extensively.
* Validate data integrity after loading from binary/JSON files.
* Verify correct slicing and interpretation of flat binary embedding arrays.

---

**Phase X: Potential Enhancements & Long-Term Considerations (Post-MVP)**
* Progressive data loading for very many clusters (if not all data is loaded upfront).
* Browser HTTP caching strategies for static assets.
* Further vector quantization exploration (e.g., scalar quantization to int8) for even smaller footprints if quality trade-off is acceptable (would require offline changes and client adaptation).