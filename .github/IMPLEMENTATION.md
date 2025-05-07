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
    ├── public/                    # Static assets served directly by Astro
    │   ├── assets/
    │   │   ├── db/
    │   │   │   └── manifest.json
    │   │   │   └── srvusd/
    │   │   │   │   └── policy_graph.db
    │   │   │   └── other_district/
    │   │   │       └── policy_graph.db
    │   │   ├── boundaries/        # Directory for split GeoJSON boundaries
    │   │   │   └── <CDS_CODE>.geojson
    │   │   ├── districts.json     # List of districts for selector
    │   │   └── wasm/              # KuzuDB/WebLLM files (or use CDN)
    │   └── # Other static files (favicon, robots.txt, etc.)
    ├── src/                       # Frontend source code (Astro + TypeScript)
    │   ├── components/            # Reusable Astro/UI components (e.g., ChatWindow.astro, PolicyItem.astro)
    │   ├── layouts/               # Base page layouts (e.g., MainLayout.astro)
    │   ├── pages/                 # Astro pages (e.g., index.astro)
    │   ├── styles/                # CSS/SCSS files
    │   ├── lib/                   # Core logic modules (TypeScript)
    │   │   ├── kuzudbHandler.ts
    │   │   ├── webllmHandler.ts
    │   │   ├── ragController.ts
    │   │   ├── policyBrowserHelper.ts # Renamed/refactored from policyBrowser.ts
    │   │   ├── state.ts             # Optional: For managing shared state
    │   │   └── types.ts             # Shared types
    │   └── env.d.ts               # Astro environment types
    ├── .gitignore
    ├── LICENSE
    ├── README.md
    ├── PRD.md
    ├── astro.config.mjs           # Astro configuration file
    ├── package.json
    ├── pnpm-lock.yaml
    └── tsconfig.json              # Root TypeScript config (Astro typically handles this)
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
* **1.5. Setup Build Process:** Configure `tsconfig.json` for `pipeline`. Astro handles the frontend build configuration via `astro.config.mjs` and its own `tsconfig.json` (often extending the root one). Ensure `package.json` scripts include `astro dev`, `astro build`, `astro preview`.

**Phase 2: Data Pipeline Backend (Node.js/TypeScript)**

* **2.0. Convert Source XLSX to CSV (One-time or as needed):**
    * Ensure the `CDESchoolDirectoryExport.xlsx` file is present in the project root.
    * Run the conversion script: `pnpm run convert:xlsx`.
    * This generates CSV files (one per sheet) in the `pipeline/data/` directory.
* **2.1. Prepare District List for Frontend (Run after CSV conversion):**
    * Run the preparation script: `pnpm run prepare:districts`.
    * This reads `pipeline/data/School and District Data.csv` (verify CSV name and required columns like 'DistrictName', 'DistrictCode'), extracts unique districts, and writes a simplified list to `public/assets/districts.json`.
* **2.2. Split District Boundaries (Run after obtaining source GeoJSON):**
    * Place the large `district_boundaries.geojson` file (downloaded from data.ca.gov source) into `pipeline/data/`.
    * Run the splitting script: `pnpm run prepare:boundaries`.
    * This reads the large GeoJSON, iterates through features, and saves each district boundary as a separate file in `public/assets/boundaries/<CDS_CODE>.geojson`. Verify the CDS Code property name in the script matches the GeoJSON source.
* **2.3. Refactor Scrapers (`pipeline/src/scrapers/`):**
    * Create separate scraper functions/classes in TypeScript for each `policy_source_type`.
    * The main pipeline script (`pipeline/src/main.ts`) will read `config.json` and call the appropriate scraper based on `policy_source_type` for each district. Use libraries like `axios` or `node-fetch` for HTTP requests and `cheerio` or `jsdom` for HTML parsing if needed.
    * Scrapers should output data tagged with the district `id` (e.g., save intermediate JSON files).
* **2.4. Update Preprocessor (`pipeline/src/preprocess.ts`):**
    * Modify to read multiple raw input files based on `config.json`.
    * Process data for each district separately using TypeScript logic.
    * Ensure output chunks retain the district `id`.
    * Save processed data per district.
* **2.5. Update Synthesizer (`pipeline/src/synthesize.ts`):**
    * Modify to process data for each district defined in `config.json`.
    * Call the external LLM API (using `node-fetch` or `axios`) to generate summaries based on the processed data for each district.
    * Save synthesized data per district.
* **2.6. Update Graph Builder (`pipeline/src/buildGraph.ts`):**
    * Modify to iterate through each district in `config.json`.
    * For each district:
        * Define the output DB path using the district `id` (e.g., `dbOutputPath = \`./dist/pipeline/output_db/\${district.id}/policy_graph.db\``). Create the directory if needed.
        * Use the KuzuDB Node.js client (`kuzu` npm package).
        * Connect and create schema/load data for the *specific district*.
    * After processing all districts, generate `manifest.json` listing districts and their relative DB paths (e.g., `assets/db/srvusd/policy_graph.db`). Save this manifest to the pipeline output (e.g., `./dist/pipeline/manifest.json`). The GitHub Action will copy this to the correct `public/assets/db/` location later. **Also ensure the `districts.json` generated in step 2.1 is placed or copied into `public/assets/`.**

**Phase 3: GitHub Action Workflow (`.github/workflows/data_pipeline.yml`)**

* **3.1. Modify Job Steps:**
    * Setup Node.js environment using `actions/setup-node` (specify version, enable pnpm caching).
    * Install dependencies: `pnpm install --frozen-lockfile`.
    * **Prepare Data:** Run `pnpm run prepare` (which includes `convert:xlsx`, `prepare:districts`, and `prepare:boundaries`). Assumes source XLSX and GeoJSON are present.
    * Run pipeline build: `pnpm run build:pipeline` (or equivalent script from `package.json`).
    * Execute the pipeline: `pnpm run start:pipeline` (or `node ./dist/pipeline/main.js`).
    * **Copy Output:** Modify the copy step to move generated district DB directories, the `manifest.json`, and `districts.json` from the pipeline's output/prepared locations to `public/assets/`. Ensure boundary files are also placed correctly in `public/assets/boundaries/`. Copy necessary WASM/model files to `public/assets/wasm`.
        ```yaml
        - name: Copy Pipeline Output to Public Assets
          run: |
            mkdir -p public/assets/db public/assets/boundaries
            cp -r ./dist/pipeline/output_db/* public/assets/db/ # Copy district DBs
            cp ./dist/pipeline/manifest.json public/assets/db/  # Copy manifest
            # Ensure districts.json from prepare step is in public/assets/
            cp pipeline/data/districts.json public/assets/districts.json # Adjust source path if needed
            # Ensure boundary files from prepare step are in public/assets/boundaries/
            cp pipeline/data/boundaries/* public/assets/boundaries/ # Adjust source path if needed
            # Add steps to copy WASM/model files if needed
        ```
    * Configure the frontend build step: `pnpm run build` (assuming this runs `astro build`). Astro build automatically includes files from `public/`.
    * Update artifact upload path to `./dist` (Astro's default build output directory).
    * Configure GitHub Pages action (`actions/deploy-pages`) to deploy from the `./dist` artifact.

**Phase 4: Frontend Static Website (Astro, TypeScript)**

* **4.1. Update Astro Components/Pages (`src/`):**
    * Define base layouts in `src/layouts/` (e.g., `MainLayout.astro`) including common head elements, navigation, footer.
    * Create the main page in `src/pages/` (e.g., `index.astro`). This page will contain the primary UI elements:
        * District selector (populates from `/assets/districts.json`).
        * Map display area (integrating Leaflet).
        * Policy browsing section.
        * **NEW**: An expandable chat widget component that, when clicked, reveals the main chat interface.
    * Develop reusable UI components in `src/components/` (e.g., `DistrictSelector.astro`, `MapDisplay.astro`, `PolicyBrowser.astro`).
        * **MODIFY**: `ChatWindow.astro`: Ensure this component is suitable for embedding within the expandable widget and handles chat interactions.
        * **NEW**: `ExpandableChatWidget.astro`: This component will display a small, clickable icon. On click, it will expand to display the `ChatWindow.astro` component. It will manage its own open/closed state.
    * Integrate the `ExpandableChatWidget.astro` into `MainLayout.astro` or relevant pages.
* **4.2. Update CSS (`src/styles/`):** Use global CSS or component-scoped styles as preferred. Ensure styling for the collapsed and expanded states of the chat widget.
* **4.3. Implement Frontend Logic (Client-side Scripts & Modules in `src/lib/`):**
    * **State Management:** Decide on a state management approach if needed (e.g., simple module state in `src/lib/state.ts`, Astro Stores, or Nano Stores) to hold `currentDistrictId`, `kuzuDb` instance, `webLlmEngine` instance, loading states, etc.
        * **NEW**: The `ExpandableChatWidget.astro` will manage its own open/closed state, but consider if this state needs to be shared globally.
    * **Initialization (`index.astro` or layout script):**
        * Fetch `/assets/db/manifest.json` on initial load.
        * Populate the district selector.
        * Add event listener to the selector.
        * Initialize WebLLM (`webLlmEngine = await webllmHandler.init(...)` from `src/lib/webllmHandler.ts`). Trigger this early but manage loading state.
    * **District Change Handler (in `DistrictSelector.astro` or `index.astro` script):**
        * Get selected district ID and update global state (`currentDistrictId`).
        * Show loading indicators.
        * Clear previous district's UI elements (policy browser, chat).
        * Retrieve the corresponding `dbPath` from the manifest.
        * Re-initialize KuzuDB (`kuzuDb = await kuzudbHandler.init(dbPath, ...)` from `src/lib/kuzudbHandler.ts`). Update global state.
        * Fetch and display the specific district boundary (`/assets/boundaries/<CDS_CODE>.geojson`).
        * Load data for the policy browser (`await policyBrowserHelper.loadDistrictData(currentDistrictId, kuzuDb)`).
        * Hide loading indicators.
    * **NEW: Expandable Chat Widget Logic (in `ExpandableChatWidget.astro` script):**
        * Implement client-side script to handle click events on the chat icon/button.
        * Toggle the visibility and/or size of the embedded `ChatWindow.astro` component.
        * Use CSS transitions or animations for a smooth user experience.
        * Manage focus when the widget opens (e.g., to the chat input) and closes.
        * Ensure the widget is accessible (keyboard navigation, ARIA attributes if needed).
    * **Chat Interaction (`ChatWindow.astro` script):**
        * Get user input.
        * Call `ragController.processQuery(userQuery, kuzuDb!, webLlmEngine!, addMessageCallback)` from `src/lib/ragController.ts`. Ensure `kuzuDb` and `webLlmEngine` are initialized and passed correctly from the shared state or props.
    * **`src/lib/kuzudbHandler.ts`:** (Similar logic as before) Use KuzuDB WASM bindings. `init` function takes `dbPath`, fetches the DB file, and returns a KuzuDB instance/wrapper.
    * **`src/lib/webllmHandler.ts`:** (Similar logic as before) Use WebLLM library. `init` function initializes and returns the engine. Handle progress.
    * **`src/lib/policyBrowserHelper.ts`:** Refactored logic for fetching/displaying policy data, likely called by the main page/component after KuzuDB is ready for the selected district. Takes `kuzuDb` instance.
    * **`src/lib/ragController.ts`:** (Similar logic as before) Implements Text-to-Cypher, KuzuDB query, and answer generation logic, taking `kuzuDb` and `webLlmEngine` instances.
* **4.4 Ensure Type Safety:** Use TypeScript interfaces/types (`src/lib/types.ts`) consistently across modules and components. Leverage Astro's TypeScript integration.

**Phase 5: Deployment**

* **5.1. Configure GitHub Pages:** Set source to deploy from GitHub Actions artifact.
* **5.2. Trigger Action:** Push changes to trigger the `data_pipeline.yml` workflow.
* **5.3. Verify Deployment:** Check Action logs for successful pipeline execution, frontend build, and deployment. Access the site and test thoroughly.

**Phase 6: Testing & Refinement**

* **6.1. Pipeline Testing:** Verify data prep steps (CSV conversion, district JSON, boundary splitting) execute correctly.
* **6.2. Frontend Testing:** Test district selection, dynamic loading (monitor network tab for DB file loading), chat functionality per district, context switching. Use browser dev tools to check for errors and performance.
* **6.3. Build/Toolchain:** Ensure the Astro build process (`astro build`) works reliably and integrates the TypeScript modules correctly.
* **6.4. Cross-Browser/Device Testing:** (Same as before)
* **6.5. Prompt Refinement:** (Same as before)
* **6.6. Optimization:** Focus on DB loading time and frontend performance.


