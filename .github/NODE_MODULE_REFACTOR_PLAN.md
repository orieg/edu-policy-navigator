# Plan: Refactor RAG & Chat to Independent Node.js Module

**Objective:** Refactor the existing WebLLM-based chat and RAG capabilities into a standalone, reusable Node.js module. This module will include a CLI for offline data processing (embedding, clustering, indexing) for **potentially multiple, distinct knowledge bases**, and a configurable UI chat widget for easy integration into various projects. The RAG system will be enhanced to support parallel semantic and keyword search with score fusion (Reciprocal Rank Fusion - RRF), operating on a **selected/configured knowledge base**.

**Selected Approach (based on 03-evaluate-options):** Approach A: "Monorepo with Internal Packages"

**Monorepo Structure:**
- `packages/core`: Environment-agnostic core RAG logic, WebLLM abstractions (including configurable chat model selection and flexible embedding model access), search services (semantic, keyword), RRF, data structures.
- `packages/cli`: Node.js CLI for offline processing, using `@my-rag/core`.
- `packages/ui-widget`: Framework-agnostic UI chat widget, using `@my-rag/core` (via Web Worker).

---

## Phase 0: Project Setup & Monorepo Configuration

**Goal:** Establish the monorepo structure and basic build tooling.

1.  **Initialize Monorepo:**
    *   **Tooling:** Use pnpm workspaces for dependency management and Turborepo for build orchestration and task running.
    *   **Action:**
        *   [ ] Initialize a new pnpm workspace root.
        *   [ ] Set up Turborepo configuration (`turbo.json`).
        *   [ ] Create initial directories: `packages/core`, `packages/cli`, `packages/ui-widget`.
2.  **Package Configuration:**
    *   **Action:** For each package (`core`, `cli`, `ui-widget`):
        *   [ ] Create a `package.json` file:
            *   [ ] Define `name` (e.g., `@my-rag/core`), `version`, `main`, `module`, `types` entry points.
            *   [ ] For `@my-rag/cli`, include a `bin` field.
            *   [ ] List initial dependencies (e.g., `typescript`).
        *   [ ] Create a `tsconfig.json` for TypeScript compilation, tailored for Node.js (cli, core-node) or browser (ui-widget, core-browser if needed).
3.  **Basic Build System:**
    *   **Tooling:** Use `tsup` for bundling/packaging each package (chosen for its simplicity and effectiveness with TypeScript projects, producing CJS and ESM outputs).
    *   **Action:**
        *   [ ] Add `tsup` as a dev dependency to each package.
        *   [ ] Create a basic `tsup.config.ts` for each package.
        *   [ ] Define build scripts in each package\'s `package.json` (e.g., `"build": "tsup"`).
        *   [ ] Configure Turborepo to manage the build pipeline across packages.
4.  **Linting and Formatting:**
    *   **Tooling:** ESLint, Prettier.
    *   **Action:**
        *   [ ] Set up shared ESLint and Prettier configurations at the monorepo root, extending them in individual packages if necessary.

---

## Phase 1: Develop `@my-rag/core` Package

**Goal:** Create a robust, environment-agnostic core RAG engine.

1.  **Migrate Existing Core Logic & Introduce Embedding Service Abstraction:**
    *   **Files to Move/Adapt:**
        *   `src/lib/WebLLMService.ts` (including its management of prompt templates and **MLC chat model selection/initialization logic**, which should be preserved and made configurable. This service will focus on chat generation.)
        *   `src/lib/dataLoader.ts` (to be enhanced to load assets for a specific, configured knowledge base, potentially via different manifest files or base paths. Document embedding generation will be delegated to the new `EmbeddingService`).
        *   `src/lib/clusteredSearchService.ts` (semantic search, operating on data from the selected knowledge base)
        *   `src/lib/ragManager.ts` (initial version, to be enhanced to manage the active knowledge base configuration, WebLLM chat model choice, and utilize the `EmbeddingService` for query embeddings if needed client-side, or pass context for server-side embeddings during CLI operations.)
        *   `src/rag-testing/rag_worker.ts` (specifically the `performRuleBasedRephrase` function, associated stop word lists, common verb lists, and any other related utilities for query pre-processing)
        *   `src/utils/mathUtils.ts`
        *   `src/types/vectorStore.d.ts` and other relevant types.
        *   `pipeline/scripts/generateClusteredEmbeddings.ts` (specifically its logic for batch document embedding, including any API calling mechanisms to an external embedding server, for adaptation into the `EmbeddingService` remote API client).
    *   **Action:**
        *   [ ] Copy relevant files and adapt logic into `packages/core/src/`.
        *   [ ] Refactor to remove direct DOM/Node.js specific API dependencies where possible, or prepare for conditional exports/imports if necessary for isomorphic behavior.
        *   [ ] Ensure all paths and module imports are updated.
        *   **Design and Implement `EmbeddingService` in `packages/core/src/services/`:**
            *   [ ] Define an `EmbeddingService` interface (e.g., `generateEmbeddings(texts: string[], options?: EmbeddingOptions): Promise<number[][]>`).
            *   [ ] Create a browser-compatible implementation (for query embedding in `@my-rag/ui-widget`) using direct Transformers.js or similar WebLLM capabilities.
            *   [ ] Create Node.js-compatible implementations (for batch document embedding in `@my-rag/cli`):
                *   One for local/in-process model execution (e.g., using Transformers.js in Node.js, configurable model ID).
                *   One that acts as an HTTP client to a configurable external embedding API endpoint (e.g., for models served via `uvicorn`). **Adapt or reuse existing API client logic from `pipeline/scripts/generateClusteredEmbeddings.ts` for this purpose, including batching, error handling, etc.**
2.  **Implement Inverted Index Search (Keyword Search):**
    *   Based on `.github/INVERTED_INDEX_SEARCH.md`.
    *   **Action:**
        *   **Migrate and Extend Existing Text Processing Utilities:**
            *   [ ] Adapt the `tokenize` function and TF-IDF logic from `pipeline/scripts/extractClusterKeywords.ts` for general use in `packages/core/src/utils/`.
            *   [ ] Extend the existing tokenization (e.g., from `src/rag-testing/rag_worker.ts`) and ensure robust stop word removal (reuse/enhance `STOP_WORDS_EN` from `rag_worker.ts`).
            *   [ ] **Add a stemmer** (e.g., `porter-stemmer`) to `packages/core/src/utils/`. These utilities must be usable by both CLI (Node.js) and client-side (browser).
        *   [ ] Define data structures for the inverted index, document frequencies, document lengths in `packages/core/src/types/`.
        *   [ ] Create `FullTextSearchService.ts` in `packages/core/src/services/`:
            *   [ ] Handles loading pre-computed inverted index data (specific to the currently configured knowledge base).
            *   [ ] Processes queries (tokenize, stem, stop words using the migrated/extended utilities).
            *   [ ] Implements search logic (e.g., AND/OR for multi-term queries).
            *   [ ] Implements scoring: basic presence, TF-IDF, and BM25.
3.  **Implement Parallel Search & Reciprocal Rank Fusion (RRF), and LLM Answer Generation:**
    *   **Action:**
        *   [ ] Modify/Extend `RAGManager.ts` in `packages/core/src/services/`.
        *   `RAGManager` will orchestrate the full RAG pipeline:
            1.  [ ] Perform rule-based query rephrasing (using migrated logic from `rag_worker.ts`).
            2.  [ ] Generate query embedding using the browser-compatible `EmbeddingService` (if applicable, for semantic search component).
            3.  [ ] Conduct parallel searches using `ClusteredSearchService` (semantic) and `FullTextSearchService` (keyword) on the (rephrased) query and its embedding.
            4.  [ ] Implement RRF logic (either within `RAGManager` or a dedicated `FusionService.ts`) to combine and re-rank results from both search types.
            5.  [ ] Prepare the final context from fused search results and utilize the migrated `WebLLMService` to generate a user-facing answer, using the configured MLC chat model, and preserved or configured prompts.
4.  **Configuration & Debug Mode:**
    *   **Action:**
        *   [ ] Design how the **active knowledge base** is configured for `RAGManager` (e.g., path to a specific manifest file, or a base URL/path for data assets).
        *   [ ] Design how **MLC chat model selection (e.g., model ID, model specific initialization parameters)**, LLM parameters (temperature, top_k, top_p), and prompt content (system prompts, rule-based rephrasing prompts, final answer generation prompts) are passed to and utilized by `WebLLMService` and `RAGManager`.
        *   **Design configuration for the `EmbeddingService` (especially for CLI/Node.js context):**
            *   [ ] Mode of operation (e.g., "local_transformers", "remote_api").
            *   [ ] For "local_transformers": embedding model ID, device preferences (cpu/gpu if applicable).
            *   [ ] For "remote_api": API endpoint URL, batch size, authentication details (if any).
        *   [ ] Implement a robust debug mode in `RAGManager` (and underlying services) that can emit intermediate results (e.g., original query, rephrased query, query embedding, individual search results before fusion, fused results, context chunks, prompts sent to LLM, selected MLC model) via callbacks or an event emitter system. This system should also support emitting events for UI states like initialization progress.
5.  **API Design & Exports:**
    *   **Action:**
        *   [ ] Define clear public APIs for `@my-rag/core`, including `EmbeddingService` and `WebLLMService`.
        *   [ ] Ensure necessary classes, functions, and types are exported from the package\'s entry point.
6.  **Unit & Integration Tests:**
    *   **Tooling:** Vitest (or Jest).
    *   **Action:**
        *   [ ] Write tests for critical components: text processing, `EmbeddingService` (both local and remote client if implemented), search algorithms, RRF, data loading utilities, `WebLLMService` (including chat model switching), `RAGManager` orchestration.

---

## Phase 2: Develop `@my-rag/cli` Package

**Goal:** Create a CLI tool for all offline data pre-computation tasks.

1.  **CLI Framework:**
    *   **Tooling:** `yargs` or `commander` for argument parsing and command structure.
    *   **Action:**
        *   [ ] Set up the chosen CLI framework in `packages/cli/src/index.ts`.
2.  **Migrate & Adapt Offline Pipeline Scripts:**
    *   **Source Scripts:** Existing scripts in `pipeline/scripts/` (e.g., `generateClusteredEmbeddings.ts`, `validateEmbeddings.ts`, `validateClusterCohesion.ts`, `extractClusterKeywords.ts`).
    *   **Action:**
        *   [ ] Refactor these scripts into modular CLI commands (e.g., `my-rag generate-embeddings --kb-name kb1`, `my-rag build-index --kb-name kb1`, `my-rag validate-data --kb-name kb1 [specific_validation_type]`).
        *   These commands will:
            *   [ ] Utilize the Node.js-compatible `EmbeddingService` from `@my-rag/core` for generating document embeddings, configured via CLI arguments/config file (specifying local model, remote API endpoint, etc.).
            *   [ ] Use other `@my-rag/core` utilities for text processing, clustering logic (if applicable after embedding), and inverted index construction, all targeting a specific knowledge base\'s data.
            *   [ ] Handle file system operations (reading source documents/JSON, writing pre-computed assets like `.bin` files, `.json` metadata, inverted index files, typically organized per knowledge base).
            *   [ ] Manage configuration (e.g., paths, embedding model configuration, clustering parameters, knowledge base identifiers) via CLI arguments or a config file.
        *   [ ] Update `manifest.json` (which itself would be specific to a knowledge base) to include paths to these new index files.
3.  **New CLI Commands for Inverted Index:**
    *   **Action:**
        *   [ ] Create a command `my-rag build-keyword-index` that uses `@my-rag/core` to:
            *   [ ] Process text from documents (leveraging the migrated and extended text processing utilities like tokenization, stemming, stop word removal) for a specific knowledge base.
            *   [ ] Build the inverted index (term -> docID list/map) for that knowledge base.
            *   [ ] Compute and save TF, DF, document lengths, and corpus stats if BM25 is targeted (potentially adapting logic from `src/rag-testing/rag_worker.ts` for BM25 variables and `pipeline/scripts/extractClusterKeywords.ts` for TF-IDF concepts) for that knowledge base.
        *   [ ] Output files: `inverted_index.json`, `document_frequencies.json`, `document_lengths.json`, `corpus_stats.json` (these would be relative to the specific knowledge base\'s data directory).
4.  **New CLI Command: Query Analysis / RAG Diagnostics:**
    *   **Goal:** Provide a CLI tool to analyze how a specific query interacts with a given knowledge base, similar to the diagnostic capabilities in `rag-test`.
    *   **Action:**
        *   [ ] Create a command `my-rag analyze-query --kb-name <kb_identifier> --query "<your test query>" [options...]`.
        *   This command will leverage `@my-rag/core`\'s `RAGManager` and its debug capabilities (and potentially its configurable `EmbeddingService` for query embedding if needed for the analysis) to:
            *   [ ] Perform rule-based rephrasing.
            *   [ ] Execute parallel semantic and keyword searches.
            *   [ ] Perform score fusion (RRF).
        *   [ ] Output detailed intermediate steps and results, such as:
            *   Original query.
            *   Rephrased query (if applicable).
            *   Query embedding (if generated).
            *   Top N semantic search hits (document ID, content snippet, score, cluster ID if applicable).
            *   Top N keyword search hits (document ID, content snippet, score).
            *   List of fused documents before being passed to the LLM.
            *   Optionally, allow overriding parameters like `topK` or **specifying a temporary MLC model ID for this analysis**.
        *   This tool is primarily for developers/maintainers for diagnostics and tuning.
5.  **CLI Entry Point:**
    *   **Action:**
        *   [ ] Ensure the `bin` field in `packages/cli/package.json` points to the compiled CLI entry script.
6.  **Documentation:**
    *   **Action:**
        *   [ ] Add a README for `@my-rag/cli` explaining installation and usage of each command, including validation, analysis tools, and **configuration of embedding generation (local vs. remote API)**.

---

## Phase 3: Develop `@my-rag/ui-widget` Package

**Goal:** Create a configurable, embeddable chat widget.

1.  **Widget Technology:**
    *   **Choice:** Web Component (using a library like Lit, or vanilla Custom Elements) for maximum portability and framework-agnosticism.
    *   **Action:**
        *   [ ] Set up the basic structure for the Web Component in `packages/ui-widget/src/`.
2.  **Web Worker for Core Logic:**
    *   **Action:**
        *   [ ] Create a Web Worker script (`packages/ui-widget/src/rag.worker.ts`) that imports and initializes the RAG engine from `@my-rag/core` (including the browser-compatible `EmbeddingService` for query embedding and `WebLLMService` for chat).
        *   [ ] The worker will handle all computationally intensive tasks: data loading (via `fetch` proxied by the worker if needed), query embedding, search, RRF, and chat generation (using the configured MLC chat model).
        *   [ ] Implement message passing between the Web Component (main thread) and the `rag.worker.ts` for queries, configurations (including MLC chat model ID), LLM responses, status updates, and debug information.
3.  **UI Implementation (Web Component):**
    *   **Action:**
        *   [ ] Develop the HTML structure and CSS for the chat widget (query input with Enter-to-send/Shift+Enter for newline, message display area, send button, thinking/loading indicators).
        *   [ ] Implement distinct visual styling for different message types (user, ai, system, loading, error), drawing inspiration from `src/components/ChatWindow.astro` if applicable.
        *   [ ] Ensure clear display of initialization progress (e.g., "Initializing...", progress details, "Ready", error states) by subscribing to events/callbacks from `@my-rag/core`.
        *   [ ] Implement properties/attributes for configuring the widget (e.g., `manifest-url` or `kb-config-url` pointing to a knowledge base specific manifest, `mlc-model-id` for WebLLM chat model selection, `initial-prompt` for AI greeting, LLM parameters. Embedding model config for UI is usually implicit via browser `EmbeddingService`).
        *   [ ] Handle user interactions (e.g., sending messages, disabling input during processing) and dispatch events.
        *   [ ] Implement focus management (e.g., focusing on input when widget becomes active).
        *   [ ] Display intermediate results/logs if debug mode is enabled.
4.  **Styling:**
    *   **Action:**
        *   [ ] Allow for basic styling via CSS custom properties or shadow DOM parts for users to customize the look and feel.
5.  **API for Integration:**
    *   **Action:**
        *   [ ] Define how the Web Component is instantiated (`<my-rag-widget>`) and configured via attributes/properties.
6.  **Example Usage:**
    *   **Action:**
        *   [ ] Create a simple HTML file within `packages/ui-widget/examples/` demonstrating how to use and configure the widget.

7.  **Illustrative Instantiation & Configuration (Conceptual Example for Plan Clarity):**
    *   **Purpose:** To provide a clear target for the widget\'s ease of use. The actual implementation will be in the example HTML file and documentation.
    *   **Conceptual HTML Snippet:**
        ```html
        <!DOCTYPE html>
        <html>
        <head>
            <title>RAG Chat Widget Test</title>
            <!-- The widget bundle would be served from the ui-widget package or a CDN -->
            <script type="module" src="path/to/@my-rag/ui-widget/dist/my-rag-widget.js"></script>
        </head>
        <body>
            <h1>My Application</h1>

            <my-rag-widget
                manifest-url="/path/to/data/my_knowledge_base_1/manifest.json"
                mlc-model-id="SmolLM2-135M-Instruct-q0f16-MLC"
                initial-prompt="Hello! Ask me anything about our documents."
                llm-temperature="0.7"
                top-k="5"
                enable-debug="false"
                theme-primary-color="#333"
            ></my-rag-widget>

            <script>
                const widget = document.querySelector('my-rag-widget');
                widget.addEventListener('llm-response', (event) => {
                    console.log('LLM Response:', event.detail.response);
                });
                widget.addEventListener('error', (event) => {
                    console.error('Widget Error:', event.detail.error);
                });
            </script>
        </body>
        </html>
        ```
    *   **Note:** Attributes like `manifest-url`, `mlc-model-id`, `llm-temperature`, `enable-debug`, `theme-primary-color` are examples of potential configuration options. The exact attributes and event names will be finalized during development.

---

## Phase 4: Integration, Testing, Documentation & Publishing

**Goal:** Ensure all parts work together, document thoroughly, and prepare for distribution.

1.  **Integration with `edu-policy-navigator` (Testbed):**
    *   **Action:**
        *   [ ] Modify `edu-policy-navigator`\'s `package.json` to use the local monorepo packages (e.g., via `pnpm link` or workspace protocol).
        *   [ ] Replace the existing RAG implementation in `src/` with the new `@my-rag/ui-widget`.
            *   [ ] **Decommission Superseded Code:** Once the new widget is integrated, identify and remove or archive the now-redundant RAG-specific code from `src/lib/`, `src/components/ChatWindow.astro` (if fully replaced), and direct RAG logic within `src/rag-testing/` to avoid confusion and ensure the project relies solely on the new module for these functionalities.
        *   [ ] Update `rag-test.astro` to leverage the new widget and its enhanced debug capabilities for full end-to-end testing.
        *   [ ] Use `@my-rag/cli` to generate the necessary data assets for `edu-policy-navigator` (testing both local and remote API embedding generation if feasible).
            *   [ ] **Archive Old Pipeline Scripts:** Once `@my-rag/cli` is the standard, archive or remove the original scripts in the `pipeline/scripts/` directory to prevent accidental use.
2.  **End-to-End Testing:**
    *   **Action:**
        *   [ ] Test the CLI for correct data generation across different configurations, including different embedding model access methods (local/remote if both implemented).
        *   [ ] Test the UI widget in `edu-policy-navigator` and standalone examples for functionality, responsiveness, debug mode, and configurability (including MLC chat model switching).
        *   [ ] Verify parallel search, RRF, and keyword search (including BM25 if implemented) are working as expected.
3.  **Documentation:**
    *   **Action:**
        *   [ ] Write a comprehensive README for the monorepo root.
        *   [ ] Finalize READMEs for `@my-rag/core`, `@my-rag/cli`, and `@my-rag/ui-widget` detailing their APIs, architecture, usage, and configuration options (including MLC chat model selection and **embedding service configuration for CLI**).
        *   [ ] Include guides on:
            *   Using the CLI to prepare data for a new project, including how to configure embedding model access (local vs. remote API).
            *   Integrating and configuring the `@my-rag/ui-widget` in different environments (e.g., vanilla HTML, Astro, React).
4.  **Publishing Strategy:**
    *   **Action:**
        *   [ ] Set up `npm` publishing configurations in each package\'s `package.json` that is meant to be distributed (likely `@my-rag/core`, `@my-rag/cli`, `@my-rag/ui-widget`).
        *   [ ] Use Turborepo or pnpm to manage versioning and publishing of the packages.

---
## Milestones (High-Level)

These milestones will be marked as complete ([x]) as the primary tasks within them are achieved.

1.  **[ ] M1: Monorepo & Core Foundation:**
    *   [ ] Monorepo structure with pnpm/Turborepo is functional.
    *   [ ] Basic build system for `core`, `cli`, `ui-widget` packages operational.
    *   [ ] `@my-rag/core`: Existing RAG logic (semantic search, WebLLMService for chat, `EmbeddingService` abstraction, dataLoader) migrated and refactored. Basic API defined. Unit tests for migrated logic.
2.  **[ ] M2: CLI - Semantic Data Pipeline:**
    *   [ ] `@my-rag/cli`: CLI commands for generating existing semantic search data (embeddings via configurable `EmbeddingService`, clusters, manifest) using `@my-rag/core` are functional.
3.  **[ ] M3: Core - Keyword Search & RRF:**
    *   [ ] `@my-rag/core`: Inverted index data structures and `FullTextSearchService` (with basic keyword matching and BM25) implemented.
    *   [ ] `@my-rag/core`: `RAGManager` updated for parallel semantic/keyword search (using query embeddings from `EmbeddingService`) and RRF. Debug mode for intermediate results functional.
    *   [ ] Unit/integration tests for keyword search and RRF.
4.  **[ ] M4: CLI - Keyword Index Pipeline & Diagnostics:**
    *   [ ] `@my-rag/cli`: New CLI commands for building and saving inverted index and related BM25 data using `@my-rag/core`.
    *   [ ] `@my-rag/cli`: Query Analysis / RAG Diagnostics tool (`my-rag analyze-query`) is functional.
5.  **[ ] M5: UI Widget - Initial Version:**
    *   [ ] `@my-rag/ui-widget`: Basic Web Component structure.
    *   [ ] Web Worker setup for `@my-rag/core` is operational (using browser `EmbeddingService` for queries, `WebLLMService` for chat).
    *   [ ] Widget can send queries to the worker, receive responses, and display them. Basic LLM parameter configuration (including MLC chat model ID). Debug mode display for intermediate results.
6.  **[ ] M6: E2E Integration & Testing:**
    *   [ ] `edu-policy-navigator` successfully uses `@my-rag/cli` for data generation (testing different embedding configurations) and `@my-rag/ui-widget` for its chat interface.
    *   [ ] Full E2E testing of the RAG pipeline (semantic, keyword, RRF), CLI, and UI widget (including model switching).
7.  **[ ] M7: Documentation & Publishing Prep:**
    *   [ ] Comprehensive READMEs for all packages and the monorepo.
    *   [ ] Usage guides for CLI (including embedding service config) and UI widget (including how to configure MLC chat models).
    *   [ ] Publishing workflow established.

This detailed plan should provide a good roadmap for the refactoring project. 