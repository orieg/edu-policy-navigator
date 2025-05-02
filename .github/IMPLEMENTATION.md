# Implementation Guide: Multi-District Policy Navigator & Chatbot

This document outlines the step-by-step process for building the Multi-District Policy Navigator website, using a **TypeScript/JavaScript-only stack**.

**Phase 1: Setup & Environment**

* **1.1. Create GitHub Repository:** (Same as before)
* **1.2. Setup Local Development Environment:**
    * Install Node.js (check `.node-version` if present) and `pnpm`.
    * Run `pnpm install` to install dependencies (defined in `package.json`).
* **1.3. Initialize Project Structure:**
    ```
    edu-policy-navigator/ # Renamed from srvusd-policy-navigator
    ├── .github/
    │   ├── workflows/
    │   │   └── data_pipeline.yml
    │   └── IMPLEMENTATION.md
    ├── pipeline/                  # Data pipeline scripts (TypeScript)
    │   ├── src/
    │   │   ├── scrapers/          # Scraper modules per source type
    │   │   │   ├── index.ts
    │   │   │   ├── simbliScraper.ts
    │   │   │   └── leginfoScraper.ts
    │   │   │   └── # Add more as needed
    │   │   ├── preprocess.ts
    │   │   ├── synthesize.ts
    │   │   ├── buildGraph.ts
    │   │   ├── schema.ts          # Potentially KuzuDB schema definition
    │   │   └── main.ts            # Main pipeline execution script
    │   ├── tsconfig.json
    │   └── config.json          # Configuration for districts/schools
    ├── public/                    # Static assets served directly (replaces frontend/)
    │   ├── index.html
    │   ├── css/
    │   │   └── style.css
    │   ├── js/                    # Compiled JS output from src/
    │   ├── assets/
    │   │   ├── db/
    │   │   │   └── manifest.json
    │   │   │   └── srvusd/
    │   │   │   │   └── policy_graph.db
    │   │   │   └── other_district/
    │   │   │       └── policy_graph.db
    │   │   └── wasm/              # KuzuDB/WebLLM files (or use CDN)
    │   │   └── data/              # Optional: Pre-exported JSON
    │   │       └── srvusd_policies.json
    │   │       └── other_district_policies.json
    ├── src/                       # Frontend source code (TypeScript)
    │   ├── main.ts                # Entry point for frontend logic
    │   ├── policyBrowser.ts
    │   ├── chatUi.ts
    │   ├── kuzudbHandler.ts
    │   ├── webllmHandler.ts
    │   ├── ragController.ts
    │   └── types.ts               # Shared types
    ├── .gitignore
    ├── LICENSE
    ├── README.md
    ├── PRD.md
    ├── package.json
    ├── pnpm-lock.yaml
    └── tsconfig.json              # Root TypeScript config (can extend)
    ```
* **1.4. Create Configuration File (`pipeline/config.json`):** (Structure remains the same, just moved)
    ```json
    [
      {
        "id": "srvusd",
        "name": "San Ramon Valley Unified School District",
        "policy_source_type": "simbli",
        "policy_url": "https://simbli.eboardsolutions.com/Policy/PolicyListing.aspx?S=36030429",
        "edcode_sections": ["48900-48927", "51000-51007"] // Example scope
      },
      {
        "id": "other_district",
        "name": "Another School District",
        "policy_source_type": "custom_website", // Requires a new scraper
        "policy_url": "http://example.com/policies",
        "edcode_sections": ["48900-48927"]
      }
      // Add more districts here
    ]
    ```
* **1.5. Setup Build Process:** Configure `tsconfig.json` for both `pipeline` and `src` (frontend) and potentially a build tool (like Vite, esbuild, or tsc directly) in `package.json` scripts to compile TypeScript to JavaScript (e.g., outputting to `public/js`).

**Phase 2: Data Pipeline Backend (Node.js/TypeScript)**

* **2.0. Convert Source XLSX to CSV (One-time or as needed):**
    * Ensure the `CDESchoolDirectoryExport.xlsx` file is present in the project root.
    * Run the conversion script: `pnpm run convert:xlsx`.
    * This generates CSV files (one per sheet) in the `pipeline/data/` directory. These CSVs can then be used as input for subsequent pipeline steps.
* **2.1. Refactor Scrapers (`pipeline/src/scrapers/`):**
    * Create separate scraper functions/classes in TypeScript for each `policy_source_type`.
    * The main pipeline script (`pipeline/src/main.ts`) will read `config.json` and call the appropriate scraper based on `policy_source_type` for each district. Use libraries like `axios` or `node-fetch` for HTTP requests and `cheerio` or `jsdom` for HTML parsing if needed.
    * Scrapers should output data tagged with the district `id` (e.g., save intermediate JSON files).
* **2.2. Update Preprocessor (`pipeline/src/preprocess.ts`):**
    * Modify to read multiple raw input files based on `config.json`.
    * Process data for each district separately using TypeScript logic.
    * Ensure output chunks retain the district `id`.
    * Save processed data per district.
* **2.3. Update Synthesizer (`pipeline/src/synthesize.ts`):**
    * Modify to process data for each district defined in `config.json`.
    * Call the external LLM API (using `node-fetch` or `axios`) to generate summaries based on the processed data for each district.
    * Save synthesized data per district.
* **2.4. Update Graph Builder (`pipeline/src/buildGraph.ts`):**
    * Modify to iterate through each district in `config.json`.
    * For each district:
        * Define the output DB path using the district `id` (e.g., `dbOutputPath = \`./dist/pipeline/output_db/\${district.id}/policy_graph.db\``). Create the directory if needed.
        * Use the KuzuDB Node.js client (`kuzu` npm package): `const db = new kuzu.Database(dbOutputPath);`.
        * Connect: `const conn = new kuzu.Connection(db);`.
        * Create the schema using Cypher queries via `conn.query()`.
        * Load *only the data* corresponding to the current district `id` from the **generated CSV files (e.g., `pipeline/data/SheetName.csv`)** or synthesized data files into this specific KuzuDB instance using `conn.query()` with appropriate Cypher `LOAD CSV` or parameter binding.
    * After processing all districts, generate `manifest.json` listing districts and their relative DB paths (for the frontend, e.g., `assets/db/srvusd/policy_graph.db`). Save this manifest to a location accessible by the frontend build process (e.g., `./dist/pipeline/manifest.json`).

**Phase 3: GitHub Action Workflow (`.github/workflows/data_pipeline.yml`)**

* **3.1. Modify Job Steps:**
    * Setup Node.js environment using `actions/setup-node` (specify version, enable pnpm caching).
    * Install dependencies: `pnpm install --frozen-lockfile`.
    * Run pipeline build: `pnpm run build:pipeline` (or equivalent script from `package.json`).
    * Execute the pipeline: `pnpm run start:pipeline` (or `node ./dist/pipeline/main.js`).
    * **Copy Output:** Modify the copy step to move all generated district DB directories and the `manifest.json` file from the pipeline's output (e.g., `./dist/pipeline/output_db/*` and `./dist/pipeline/manifest.json`) to the `public/assets/db/` directory. Ensure the KuzuDB WASM files and WebLLM model files are also copied or fetched appropriately (e.g., place them in `public/assets/wasm`).
        ```yaml
        - name: Copy Pipeline Output to Public Assets
          run: |
            mkdir -p public/assets/db
            cp -r ./dist/pipeline/output_db/* public/assets/db/
            cp ./dist/pipeline/manifest.json public/assets/db/
            # Add steps to copy WASM/model files if needed
            # mkdir -p public/assets/wasm
            # cp ./path/to/kuzu.wasm public/assets/wasm/
            # cp ./path/to/webllm_model.wasm public/assets/wasm/
        ```
    * Configure the frontend build step (if separate): `pnpm run build:frontend`.
    * Update artifact upload path to `./public`.
    * Configure GitHub Pages action (`actions/deploy-pages`) to deploy from the `./public` directory/artifact.

**Phase 4: Frontend Static Website (TypeScript, HTML, CSS)**

* **4.1. Update HTML (`public/index.html`):**
    * Ensure it includes the compiled JavaScript entry point (e.g., `<script type="module" src="/js/main.js"></script>`).
    * Add district selector and loading indicators as previously defined.
* **4.2. Update CSS (`public/css/style.css`):** (Same as before)
* **4.3. Implement Frontend Logic (`src/*.ts` -> compiled to `public/js/*.js`):**
    * **`src/main.ts`:**
        * Import necessary handlers (`kuzudbHandler`, `webllmHandler`, `policyBrowser`, `chatUi`, `ragController`).
        * Global variables: `let currentDistrictId: string | null = null; let kuzuDb: KuzuDatabase | null = null; let webLlmEngine: WebLLMEngine | null = null;` (Use appropriate types from handlers/packages).
        * `async function initializeApp()`: Fetch `assets/db/manifest.json`, populate selector, add listener, initialize WebLLM (`webLlmEngine = await webllmHandler.init(...)`).
        * `async function handleDistrictChange(event: Event)`: Get selected ID, show loading, clear UI, get `dbPath`, re-initialize KuzuDB (`kuzuDb = await kuzudbHandler.init(dbPath, ...)`), load browser data (`await policyBrowser.loadDistrictData(currentDistrictId, kuzuDb)`), hide loading.
        * `async function handleChatSubmit(userQuery: string)`: Check initializations, call `ragController.processQuery(userQuery, kuzuDb!, webLlmEngine!, chatUi.addMessage)`.
        * Attach listeners and call `initializeApp()`.
    * **`src/kuzudbHandler.ts`:**
        * Use KuzuDB WASM bindings (e.g., import from the correct path/package).
        * `init` function takes `dbPath` and returns a KuzuDB instance/connection wrapper. Handle loading the DB file buffer (`fetch`).
    * **`src/webllmHandler.ts`:**
        * Use WebLLM library (e.g., `@mlc-ai/web-llm`).
        * `init` function initializes and returns the chat module/engine. Handle model loading progress.
    * **`src/policyBrowser.ts`:**
        * `loadDistrictData` function fetches initial data (either pre-exported JSON or via `kuzuDb` queries).
        * `clearContent` function.
    * **`src/chatUi.ts`:**
        * `addMessage`, `clearMessages` functions.
    * **`src/ragController.ts`:**
        * `processQuery` function takes query, kuzuDb, webLlmEngine, addMessage callback. Implements Text-to-Cypher (using `webLlmEngine`), KuzuDB query execution (using `kuzuDb`), and final answer generation (using `webLlmEngine`).
* **4.4 Ensure Type Safety:** Use TypeScript interfaces/types (`src/types.ts`) for data structures (manifest, policy data, etc.).

**Phase 5: Deployment**

* **5.1. Configure GitHub Pages:** Set source to deploy from GitHub Actions artifact.
* **5.2. Trigger Action:** Push changes to trigger the `data_pipeline.yml` workflow.
* **5.3. Verify Deployment:** Check Action logs for successful pipeline execution, frontend build, and deployment. Access the site and test thoroughly.

**Phase 6: Testing & Refinement**

* **6.1. Pipeline Testing:** Verify TypeScript pipeline execution, data processing, and DB generation for *each* configured district.
* **6.2. Frontend Testing:** Test district selection, dynamic loading (monitor network tab for DB file loading), chat functionality per district, context switching. Use browser dev tools to check for errors and performance.
* **6.3. Build/Toolchain:** Ensure the TypeScript compilation and build process works reliably.
* **6.4. Cross-Browser/Device Testing:** (Same as before)
* **6.5. Prompt Refinement:** (Same as before)
* **6.6. Optimization:** Focus on DB loading time and frontend performance.


