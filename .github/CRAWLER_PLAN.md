# Data Crawling and Pre-processing Plan

## Phase 1: California Education Code Crawler

*   **Goal:** Download and structure the text of the California Education Code.
*   [ ] **Step 1.1: Setup & Dependencies**
    *   [ ] Create script file: `pipeline/scripts/crawlEdCode.ts`.
    *   [ ] Install Playwright: `pnpm add -D playwright`
    *   [ ] Install Playwright browsers: `pnpm exec playwright install`
*   [ ] **Step 1.2: Site Analysis & Strategy**
    *   [ ] Analyze `leginfo.legislature.ca.gov` for Education Code structure (Divisions, Sections, etc.).
    *   [ ] Identify CSS selectors for navigation links, section titles, and section content.
    *   [ ] Define crawling strategy (e.g., recursive TOC traversal).
*   [ ] **Step 1.3: Implement Basic Crawler**
    *   [ ] Implement Playwright logic in `crawlEdCode.ts` to launch browser.
    *   [ ] Navigate to the main Education Code TOC page.
    *   [ ] Extract and log top-level division/part links.
    *   [ ] Refine logic to recursively follow links to individual section pages.
    *   [ ] On section pages, extract section identifier (e.g., "Section 12345") and text content.
    *   [ ] Implement basic error handling (navigation, timeouts).
*   [ ] **Step 1.4: Structure Output**
    *   [ ] Create output directory: `dist/pipeline/crawled_data/ed_code/`.
    *   [ ] Define output format (e.g., JSON Lines) for each section (ID, title, URL, text).
    *   [ ] Implement saving logic for crawled sections into the defined format.
*   [ ] **Step 1.5: Add Script to `package.json`**
    *   [ ] Add `"crawl:edcode": "ts-node pipeline/scripts/crawlEdCode.ts"` to `scripts`.

## Phase 2: SRVUSD Website & Policy Crawler

*   **Goal:** Find and download policy documents and relevant web page text from the SRVUSD website.
*   [ ] **Step 2.1: Setup**
    *   [ ] Create script file: `pipeline/scripts/crawlSrvusd.ts`.
    *   *(Playwright dependency already handled in Phase 1)*
*   [ ] **Step 2.2: Initial Target & Link Discovery**
    *   [ ] Get SRVUSD website URL (from `districts.json` or hardcode).
    *   [ ] Implement Playwright logic to navigate to the homepage.
    *   [ ] Extract all `<a>` tags.
    *   [ ] Filter links to identify potential policy pages or documents (keywords, paths like `/policy/`, file types like `.pdf`).
    *   [ ] Log candidate URLs.
*   [ ] **Step 2.3: Recursive Crawling & Content Handling**
    *   [ ] Define and implement a crawl depth limit.
    *   [ ] Implement logic to visit candidate URLs (within domain and depth limit).
    *   [ ] **HTML Pages:** Extract main text content using appropriate selectors.
    *   [ ] **PDF/DOCX:** Implement file download logic using Playwright.
*   [ ] **Step 2.4: Structure Output**
    *   [ ] Create output directory: `dist/pipeline/crawled_data/srvusd/`.
    *   [ ] Implement saving logic: `.txt` for HTML content, original format for downloads.
    *   [ ] Create a manifest file (`srvusd_manifest.jsonl`?) logging source URLs and saved file paths.
*   [ ] **Step 2.5: Add Script to `package.json`**
    *   [ ] Add `"crawl:srvusd": "ts-node pipeline/scripts/crawlSrvusd.ts"` to `scripts`.

## Phase 3: Post-Crawling Pre-processing (for Kùzu & RAG)

*   **Goal:** Prepare crawled text for indexing in Kùzu (structure) and a vector store (semantic search).
*   [ ] **Step 3.1: Parse Binary Files**
    *   [ ] Install text extraction libraries (e.g., `pdf-parse`, `mammoth`).
    *   [ ] Implement logic to process downloaded PDFs and DOCXs from Phase 2, extracting raw text.
*   [ ] **Step 3.2: Text Chunking**
    *   [ ] Choose and implement a text chunking strategy (e.g., fixed size, recursive character splitting).
    *   [ ] Process all extracted text (Ed Code, SRVUSD pages, parsed documents) into smaller chunks.
*   [ ] **Step 3.3: Consolidation & Metadata**
    *   [ ] Design a unified data structure (e.g., JSON Lines) for text chunks, including unique IDs, source metadata (URL, document type, section ID), and the text content.
    *   [ ] Consolidate all processed chunks into this structure.
*   [ ] **Step 3.4: Loading (Conceptual)**
    *   [ ] *(Future)* Generate embeddings for text chunks.
    *   [ ] *(Future)* Load embeddings and chunk text into a vector store.
    *   [ ] *(Future)* Design Kùzu schema incorporating document/chunk metadata and relationships.
    *   [ ] *(Future)* Prepare CSVs based on Kùzu schema and load metadata/relationships. 