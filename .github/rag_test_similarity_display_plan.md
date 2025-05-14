# Implementation Plan: RAG Test Page Similarity Display

**_Note: This plan has been revised to better align with the client-centric architecture of `rag-test.astro`, pre-computation strategies, and the requirement for a single comprehensive comparison table._**

**Feature:** Display detailed similarity scores for RAG analysis on the `rag-test/` page.
**Selected Approach:** Hybrid (Server Data Fetching of pre-computed assets, Client-Side Query Embedding & Calculation/Rendering)

## Objective

For each cluster involved in a RAG process, display key similarity scores in a **single comprehensive table**. Rows will represent clusters, and columns will represent different query embedding techniques compared against cluster centroids. This allows for comparison of techniques to identify which best helps in identifying relevant clusters.

The table will show:
1.  Similarity: Original user query embedding ↔ Cluster centroid
2.  Similarity: Rule-based query embedding ↔ Cluster centroid
3.  Similarity: Average embedding (of rule-based + original query) ↔ Cluster centroid

Cluster centroids are pre-computed and served. The "Original User Query Embedding" will be generated client-side from user input. The "Rule-Based Query Embedding" may be pre-computed and served if static, or generated client-side if dynamic.

## Target File
- `src/pages/rag-test.astro`

## Example Output Structure

The following shows an example of the comprehensive table that will display similarity scores. This single table will have rows for each relevant cluster and columns for different similarity metrics and cluster context. The entire section containing this table might be made collapsible.

<table>
  <thead>
    <tr>
      <th>Cluster ID</th>
      <th>Context (e.g., Keywords / County Name)</th>
      <th>Sim (Original Query ↔ Centroid)</th>
      <th>Sim (Rule-Based Query ↔ Centroid)</th>
      <th>Sim (Average Query ↔ Centroid)</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>70</td>
      <td>contra, costa, mdusd, srvusd...</td>
      <td>0.7123</td>
      <td>0.8765</td>
      <td>0.8011</td>
    </tr>
    <tr>
      <td>7</td>
      <td>bernardino, sbcusd, san...</td>
      <td>0.6543</td>
      <td>0.7890</td>
      <td>0.7200</td>
    </tr>
    <tr>
      <td>60</td>
      <td>middle, valley, san, diego...</td>
      <td>0.6830</td>
      <td>0.9370</td>
      <td>0.8100</td>
    </tr>
    <!-- ... more clusters ... -->
  </tbody>
</table>

**Notes on the example output:**
*   **Rows:** Each row represents a cluster.
*   **Columns:**
    *   `Cluster ID`: The identifier for the cluster (from `centroids.json`).
    *   `Context`: Relevant keywords (from `cluster_keywords.json`) or other identifying information like `countyName` (from `manifest.json`) if available and mapped.
    *   `Sim (Original Query ↔ Centroid)`: Cosine similarity between the original user query embedding and the cluster centroid.
    *   `Sim (Rule-Based Query ↔ Centroid)`: Cosine similarity between the rule-based query embedding and the cluster centroid.
    *   `Sim (Average Query ↔ Centroid)`: Cosine similarity between the averaged query embedding and the cluster centroid.
*   The actual "Original User Query" string and "Rule-Based Query" string could be displayed elsewhere on the page (e.g., above the table) for overall context, rather than repeated in each table row.
*   Similarity scores are shown to four decimal places as an example (this precision is adjustable).

## Implementation Steps

### 1. Server-Side Logic (Astro Frontmatter in `src/pages/rag-test.astro`)

*   **1.1. Access Pre-computed Data:**
    *   [ ] **Cluster Centroids:** In the Astro frontmatter, fetch/load all relevant cluster centroids from pre-computed files (e.g., from `public/embeddings/school_districts/centroids.json`). Each centroid object in the resulting array should contain at least a `clusterId` (number) and its `vector` (array of numbers).
    *   [ ] **(Optional) Cluster Contextual Data:**
        *   [ ] Consider reading `public/embeddings/school_districts/manifest.json` to map `clusterId` (from centroids) to `countyName` or other relevant fields if clusters represent counties or similar entities.
        *   [ ] Consider reading `public/embeddings/school_districts/cluster_keywords.json` to associate top keywords with each `clusterId`. This data, if fetched, should be structured for easy lookup by `clusterId` (e.g., an object where keys are `clusterId`s).
    *   [ ] **(Optional) Static Rule-Based Query Embedding:** If a *static* rule-based query is used for comparison (i.e., the rule doesn't change based on user input), load its pre-computed embedding from a file (e.g., `public/embeddings/static_rule_query_embedding.json`). This embedding should be an array of numbers. If the rule-based query is dynamic or its embedding is better generated client-side, this step is handled on the client.
*   **1.2. Pass Data to Client:**
    *   [ ] Structure the loaded data (e.g., `clusterCentroidsData`, `clusterContextData` (if any), and optionally `staticRuleQueryEmbedding`) into a JavaScript object.
    *   [ ] Pass this object to the client-side script. Astro's `define:vars` directive in a `<script>` tag is suitable for this: `<script define:vars={{ clusterCentroidsData, clusterContextData, staticRuleQueryEmbedding }}>`.

### 2. Client-Side Logic (JavaScript in `<script>` tag in `src/pages/rag-test.astro`)

*   **2.1. Initialize Client-Side Embedding Model:**
    *   [ ] Ensure Transformers.js (or the chosen client-side ML library) is initialized and capable of generating embeddings. This might involve setting up a feature-extraction pipeline (e.g., `const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');`). This setup might already exist or need to be added/verified in `rag-test.astro`.
*   **2.2. Helper Functions:**
    *   [ ] Implement `cosineSimilarity(vecA, vecB)`:
        ```javascript
        function cosineSimilarity(vecA, vecB) {
            if (!vecA || !vecB || vecA.length === 0 || vecA.length !== vecB.length) return 0;
            let dotProduct = 0;
            let normA = 0;
            let normB = 0;
            for (let i = 0; i < vecA.length; i++) {
                dotProduct += vecA[i] * vecB[i];
                normA += vecA[i] * vecA[i];
                normB += vecB[i] * vecB[i];
            }
            if (normA === 0 || normB === 0) return 0; // Avoid division by zero
            return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        }
        ```
    *   [ ] Implement `averageEmbeddings(vecA, vecB)`:
        ```javascript
        function averageEmbeddings(vecA, vecB) {
            if (!vecA || !vecB || vecA.length !== vecB.length) return [];
            const result = new Array(vecA.length);
            for (let i = 0; i < vecA.length; i++) {
                result[i] = (vecA[i] + vecB[i]) / 2;
            }
            return result;
        }
        ```
*   **2.3. Data Retrieval & User Input Processing Trigger:**
    *   [ ] Retrieve the pre-computed data (e.g., `clusterCentroidsData`, `clusterContextData`, `staticRuleQueryEmbedding`) passed from the server (defined via `define:vars`).
    *   [ ] This logic should trigger after a user submits a query (and the RAG process has identified relevant clusters, or for all clusters if for general testing).
    *   [ ] Obtain the current "original user query" string from the appropriate input field on the page.
    *   [ ] Obtain or define the "rule-based query" string.
*   **2.4. Generate Required Embeddings Client-Side:**
    *   [ ] **Original User Query Embedding:** Asynchronously generate the embedding for the "original user query" string using the initialized client-side embedding model.
        ```javascript
        // Example: const originalUserQueryEmbedding = (await embedder(userQueryString, { pooling: 'mean', normalize: true })).data;
        ```
    *   **Rule-Based Query Embedding:**
        *   [ ] If `staticRuleQueryEmbedding` was provided by the server, use it directly.
        *   Else (if the rule-based query is dynamic or its embedding was not pre-computed):
            1.  [ ] Use/construct the rule-based query string (obtained in 2.3).
            2.  [ ] Asynchronously generate its embedding using the client-side model, similar to the original user query.
*   **2.5. DOM Manipulation for Display (Likely within an async function due to embedding generation):**
    *   [ ] Ensure all necessary embeddings (original user query, rule-based query) are generated before proceeding.
    *   [ ] Identify or create a container element in the HTML for the similarity results table (e.g., `<div id="ragSimilarityTableContainer"></div>`).
    *   [ ] Clear any previous table from this container.
    *   [ ] Create the main `<table>` element and its `<thead>` with column headers: "Cluster ID", "Context", "Sim (Original Query ↔ Centroid)", "Sim (Rule-Based Query ↔ Centroid)", "Sim (Average Query ↔ Centroid)".
    *   [ ] Create the `<tbody>` element for the table.
    *   [ ] Iterate through each `cluster` in `clusterCentroidsData` (or a subset of clusters relevant to the current RAG results):
        *   Let `clusterCentroidVector = cluster.vector;`
        *   Let `clusterId = cluster.clusterId;`
        *   Attempt to get `contextualInfoString` (e.g., county name or a comma-separated string of top keywords) from `clusterContextData` using `clusterId`. Default to "N/A" if not found.
        *   Let `originalQueryEmbedding` be the vector generated in step 2.4.
        *   Let `ruleBasedQueryEmbedding` be the vector obtained in step 2.4.
        *   [ ] **Calculate Average Query Embedding:** `avgQueryEmbedding = averageEmbeddings(originalQueryEmbedding, ruleBasedQueryEmbedding);`
        *   [ ] **Calculate Similarities:**
            *   [ ] `sim_original_to_centroid = cosineSimilarity(originalQueryEmbedding, clusterCentroidVector);`
            *   [ ] `sim_rule_to_centroid = cosineSimilarity(ruleBasedQueryEmbedding, clusterCentroidVector);`
            *   [ ] `sim_average_to_centroid = cosineSimilarity(avgQueryEmbedding, clusterCentroidVector);`
        *   [ ] **Create Table Row (`<tr>`):**
            *   Create `<td>` elements for `clusterId`, `contextualInfoString`, `sim_original_to_centroid.toFixed(4)`, `sim_rule_to_centroid.toFixed(4)`, and `sim_average_to_centroid.toFixed(4)`.
            *   Append these `<td>` elements to the `<tr>`.
        *   [ ] Append the new `<tr>` to the `<tbody>`.
    *   [ ] Append the complete `<table>` (with header and body) to the `ragSimilarityTableContainer`.
    *   [ ] (Optional) If the `ragSimilarityTableContainer` itself is part of a larger collapsible section (e.g., `<details>`), ensure that is handled.

### 3. Styling (CSS)

*   **3.1. Add/Utilize Styles:**
    *   [ ] Leverage existing styles in `rag-test.astro` for tables (`#similarityResultsArea table` or similar), adapting as necessary for the new comprehensive table.
    *   [ ] Ensure the new table is clear, readable, and fits the page's aesthetic. Consider table layout for width if context strings are long.

## Milestones/Checkpoints

1.  **Milestone 1: Server-Side Data Preparation & Transfer**
    *   [ ] Astro frontmatter script in `src/pages/rag-test.astro` correctly loads cluster centroids (and static rule-based query embedding and any contextual cluster data, if applicable) from files.
    *   [ ] Successfully pass this pre-computed data to the client-side script via `define:vars`.
    *   *Verification:* [ ] Log the received pre-computed data (centroids, static rule embedding, context data) on the client-side console upon page load.
2.  **Milestone 2: Client-Side Setup & Core Calculations**
    *   [ ] Client-side embedding model (e.g., via Transformers.js) is initialized and functional.
    *   [ ] Successfully generate an embedding for a sample "original user query" string client-side.
    *   [ ] Successfully obtain/generate the "rule-based query" embedding client-side (either from server-passed static data or client-side generation).
    *   [ ] `cosineSimilarity` and `averageEmbeddings` JavaScript functions are implemented correctly.
    *   [ ] For at least one sample cluster, using the client-generated/obtained query embeddings, correctly calculate the three required similarity scores against the cluster's centroid.
    *   [ ] Dynamically create and append a single table row to a test table structure, showing these scores, the `clusterId`, and any context.
    *   *Verification:* [ ] Inspect the DOM for the new table row. [ ] Console log generated embeddings and the calculated similarity scores to verify correctness.
3.  **Milestone 3: Full Dynamic Rendering & Integration**
    *   [ ] Integrate the display logic to trigger after a user query and RAG processing (or as appropriate for the page flow).
    *   [ ] Loop through all relevant/selected clusters and render rows in the main similarity table, displaying `clusterId`, any available mapped contextual information, and all three similarity scores.
    *   *Verification:* [ ] Test with multiple queries. Ensure the main table is populated correctly with all relevant cluster rows and data is updated/cleared appropriately between queries.
4.  **Milestone 4: Styling and Refinement**
    *   [ ] Apply/refine CSS for good readability and user experience, ensuring consistency with the page, and that the table is usable.
    *   [ ] Test overall layout.
    *   *Verification:* [ ] Visual inspection and usability check. 