# Implementation Guide: Multi-District Policy Navigator & Chatbot

This document outlines the step-by-step process for building the Multi-District Policy Navigator website.

**Phase 1: Setup & Environment**

* **1.1. Create GitHub Repository:** (Same as before)
* **1.2. Setup Local Development Environment:** (Same as before)
* **1.3. Initialize Project Structure:**
    ```
    srvusd-policy-navigator/
    ├── .github/
    │   └── workflows/
    │       └── data_pipeline.yml
    ├── backend/
    │   ├── __init__.py
    │   ├── scrapers/             # Scraper modules per source type
    │   │   ├── __init__.py
    │   │   ├── simbli_scraper.py
    │   │   └── leginfo_scraper.py
    │   │   └── # Add more as needed
    │   ├── preprocess.py
    │   ├── synthesize.py
    │   ├── build_graph.py
    │   ├── schema.py
    │   ├── requirements.txt
    │   └── config.json         # Configuration for districts/schools
    ├── frontend/
    │   ├── index.html
    │   ├── css/
    │   │   └── style.css
    │   ├── js/
    │   │   ├── main.js
    │   │   ├── policy_browser.js
    │   │   ├── chat_ui.js
    │   │   ├── kuzudb_handler.js
    │   │   ├── webllm_handler.js
    │   │   └── rag_controller.js
    │   ├── assets/
    │   │   └── db/
    │   │       └── manifest.json # Lists available districts and DB paths
    │   │       └── srvusd/       # Example directory for one district
    │   │       │   └── policy_graph.db
    │   │       └── other_district/ # Example for another
    │   │           └── policy_graph.db
    │   │   └── wasm/             # KuzuDB/WebLLM files (or use CDN)
    │   │   └── data/             # Optional: Pre-exported JSON for browser
    │   │       └── srvusd_policies.json
    │   │       └── other_district_policies.json
    ├── .gitignore
    ├── LICENSE
    ├── README.md
    ├── PRD.md
    └── IMPLEMENTATION.md
    ```
* **1.4. Create Configuration File (`backend/config.json`):**
    ```json
    [
      {
        "id": "srvusd",
        "name": "San Ramon Valley Unified School District",
        "policy_source_type": "simbli",
        "policy_url": "[https://simbli.eboardsolutions.com/Policy/PolicyListing.aspx?S=36030429](https://simbli.eboardsolutions.com/Policy/PolicyListing.aspx?S=36030429)",
        "edcode_sections": ["48900-48927", "51000-51007"] // Example scope
      },
      {
        "id": "other_district",
        "name": "Another School District",
        "policy_source_type": "custom_website", // Requires a new scraper
        "policy_url": "[http://example.com/policies](http://example.com/policies)",
        "edcode_sections": ["48900-48927"]
      }
      // Add more districts here
    ]
    ```

**Phase 2: Data Pipeline Backend (Python Scripts)**

* **2.1. Refactor Scrapers (`backend/scrapers/`):**
    * Create separate scraper functions/classes for each `policy_source_type` (e.g., `sibli_scraper.py`, `leginfo_scraper.py`).
    * Main pipeline script will read `config.json` and call the appropriate scraper based on `policy_source_type` for each district, passing necessary URLs/parameters.
    * Scrapers should output data tagged with the district `id` (e.g., save to `raw_data/raw_srvusd.json`, `raw_data/raw_other_district.json`).
* **2.2. Update Preprocessor (`backend/preprocess.py`):**
    * Modify to read multiple raw input files based on `config.json`.
    * Process data for each district separately.
    * Ensure output chunks retain the district `id`.
    * Save processed data per district (e.g., `processed_data/processed_srvusd.json`).
* **2.3. Update Synthesizer (`backend/synthesize.py`):**
    * Modify to process data for each district defined in `config.json`.
    * Generate summaries based on the processed data for each district.
    * Save synthesized data per district (e.g., `synthesized_data/synthesized_srvusd.json`).
* **2.4. Update Graph Builder (`backend/build_graph.py`):**
    * Modify to iterate through each district in `config.json`.
    * For each district:
        * Define the output DB path using the district `id` (e.g., `db_output_path = f'./output_db/{district["id"]}/policy_graph.db'`). Create the directory if needed.
        * Initialize a *new* KuzuDB instance at that path: `db = kuzu.Database(db_output_path)`.
        * Connect and create the schema (schema is likely the same across districts).
        * Load *only the data* corresponding to the current district `id` from the synthesized data files into this specific KuzuDB instance.
    * After processing all districts, generate `manifest.json` listing districts and their relative DB paths (e.g., `{"srvusd": {"name": "San Ramon...", "dbPath": "assets/db/srvusd/policy_graph.db"}, ...}`).

**Phase 3: GitHub Action Workflow (`.github/workflows/data_pipeline.yml`)**

* **3.1. Modify Job Steps:**
    * Add step to read `backend/config.json`.
    * Modify scraping, preprocessing, synthesis, and graph building steps to iterate based on the config (e.g., using Python script logic or potentially matrix strategy if applicable).
    * Ensure Python scripts correctly handle input/output paths based on district IDs.
    * **Copy Output:** Modify the copy step to move all generated district DB directories and the `manifest.json` file to the `frontend/assets/db/` directory.
        ```bash
        # Example - adjust based on actual output location of build_graph.py
        mkdir -p frontend/assets/db
        cp -r ./output_db/* frontend/assets/db/
        cp ./manifest.json frontend/assets/db/
        # Optional: Copy pre-exported JSON for browser
        # mkdir -p frontend/assets/data
        # cp ./browser_data/* frontend/assets/data/
        ```
    * Update artifact upload path if needed (still likely `./frontend`).

**Phase 4: Frontend Static Website (HTML, CSS, JavaScript)**

* **4.1. Update HTML (`frontend/index.html`):**
    * Add a district selector element near the top:
      `<select id="district-selector"><option value="">-- Select District --</option></select>`
    * Add specific loading indicators for district data loading:
      `<div id="district-loading-indicator" style="display: none;">Loading district data...</div>`
* **4.2. Update CSS (`frontend/css/style.css`):**
    * Style the `#district-selector` and `#district-loading-indicator`.
* **4.3. Update Main Orchestration (`frontend/js/main.js`):**
    * Global variable: `let currentDistrictId = null; let kuzuDb = null; let webLlmEngine = null;`
    * `async function initializeApp()`:
        * Fetch `assets/db/manifest.json`.
        * Populate `#district-selector` options based on the manifest.
        * Add event listener to `#district-selector`: `selector.addEventListener('change', handleDistrictChange);`
        * Initialize WebLLM *once*: `webLlmEngine = await webllm_handler.initWebLlm(...)`. Handle progress/errors.
        * Maybe load a default district or prompt user selection.
    * `async function handleDistrictChange(event)`:
        * `const selectedId = event.target.value;`
        * If `selectedId` is empty or same as `currentDistrictId`, return.
        * `currentDistrictId = selectedId;`
        * Show district loading indicator (`document.getElementById('district-loading-indicator').style.display = 'block';`).
        * Clear chat UI (`chat_ui.clearMessages()`) and policy browser content (`policy_browser.clearContent()`).
        * Get `dbPath` from the manifest based on `selectedId`.
        * **Re-initialize KuzuDB:** `kuzuDb = await kuzudb_handler.initKuzuDb(dbPath, progressCallback);` (Ensure `initKuzuDb` handles potential previous instances). Handle errors.
        * **Load Policy Browser Data:** `await policy_browser.loadDistrictData(currentDistrictId);` (Fetch corresponding JSON or query KuzuDB).
        * Hide district loading indicator. Add status message ("District '...' loaded.").
    * `async function handleChatSubmit(userQuery)`:
        * Check if `kuzuDb` and `webLlmEngine` are initialized. If not, show error.
        * Proceed with call to `rag_controller.processQuery(userQuery, kuzuDb, webLlmEngine, chat_ui.addMessage)`.
    * Call `initializeApp()` on script load/DOMContentLoaded.
* **4.4. Update KuzuDB Handler (`frontend/js/kuzudb_handler.js`):**
    * `initKuzuDb` must accept `dbPath` argument.
    * Consider if the KuzuDB WASM instance needs full re-initialization or just loading a new buffer. Test performance/memory implications. It might be necessary to fully reinstantiate if internal state doesn't clear properly.
* **4.5. Update Policy Browser (`frontend/js/policy_browser.js`):**
    * Implement `async function loadDistrictData(districtId)`: Fetch pre-exported JSON (e.g., `assets/data/${districtId}_policies.json`) or perform initial KuzuDB queries to populate the browser for the given `districtId`.
    * Implement `function clearContent()` to empty the browser display area.
* **4.6. Update Chat UI (`frontend/js/chat_ui.js`):**
    * Add `function clearMessages()` to remove all messages from the chat window.
* **4.7. Update RAG Controller (`frontend/js/rag_controller.js`):**
    * Core logic using the passed `kuzuDb` and `webLlmEngine` instances remains largely the same.
    * Prompts (Text-to-Cypher, Final Answer) might benefit from including the `currentDistrictId` or name if contextually useful, but the primary change is operating on the *correctly loaded* database instance.

**Phase 5: Deployment**

* **5.1. Configure GitHub Pages:** (Same as before)
* **5.2. Trigger Action:** (Same as before) - Verify it processes all configured districts and generates the manifest + separate DB files.
* **5.3. Verify Deployment:** Check logs. Access the site and test the district selector.

**Phase 6: Testing & Refinement**

* **6.1. Pipeline Testing:** Verify correct processing for *each* configured district. Check manifest and individual DB files.
* **6.2. Frontend Testing:**
    * Test initial load and district selection UI.
    * Test dynamic loading: Select a district, verify loading indicator, check console for DB loading logs, verify policy browser updates.
    * Test chat functionality *after* selecting a district. Verify answers are relevant to that district's data.
    * Test switching districts: Select District A, chat, select District B, chat again. Verify context switches correctly. Check for memory leaks in dev tools if re-initializing KuzuDB frequently.
* **6.3. Cross-Browser/Device Testing:** (Same as before)
* **6.4. Prompt Refinement:** (Same as before) - Ensure prompts work well generally across different district datasets.
* **6.5. Optimization:** Pay close attention to the performance impact of loading different KuzuDB files. Consider DB size limits for reasonable browser performance.


