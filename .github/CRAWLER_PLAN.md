# Web Crawler Plan for Edu Policy Navigator

This document outlines the plan for implementing a web crawler to gather data from school district websites, California educational legislation sites, board websites, and school websites. The primary goal is to obtain clean Markdown content from these pages for later indexing with Kuzu and use in an LLM chat application.

## Key Requirements

*   **Target Sources:** School district websites, CA ed legislation sites, board websites, school websites.
*   **Output Format:** Clean Markdown files for each crawled page.
*   **Downstream Use:** Indexing with KuzuDB, powering an LLM chat interface.
*   **Technical Preferences:**
    *   Ease of setup and reliability.
    *   Docker containerization for deployment.
    *   Leverage existing tools where possible.
    *   Simplicity in the overall solution.

## Crawler Tool Comparison

| Feature/Aspect         | Scrapy                                  | Heritrix                                  | Crawl4AI                                     | Custom Dev (Python + Libraries)              |
| :--------------------- | :-------------------------------------- | :---------------------------------------- | :------------------------------------------- | :-------------------------------------------- |
| **Primary Goal**       | Flexible Web Scraping                   | Web Archiving                             | LLM-Ready Content (Markdown)                 | Bespoke Solution                              |
| **Markdown Output**    | Via custom pipeline (e.g., +markdownify) | No (WARC output, needs post-processing)   | Core feature, "AI-ready"                     | Manual (e.g., +markdownify)                   |
| **JavaScript Handling**| Needs `scrapy-playwright`/`splash`      | Good, but part of complex setup           | Built-in (Playwright)                        | Manual integration (Playwright/Selenium)      |
| **Ease of Setup**      | Moderate                                | Difficult                                 | Easy to Moderate (Docker ready)              | Very Easy (for basic) to Hard (for advanced) |
| **Learning Curve**     | Moderate to High                        | Very High                                 | Low to Moderate                              | Low (for basic) to High (for features)        |
| **Docker Friendliness**| Good                                    | Possible, but complex instance            | Excellent (official images, API server)      | Excellent (simple to containerize script)     |
| **Reliability**        | High (mature)                           | Very High (for archival)                  | Good (active dev, modern stack)              | Depends on implementation                     |
| **Suitability for Project** | Potentially overkill, needs customization | Massive overkill                          | **Very Good Fit**                            | Good for simple, risky for diverse/complex    |

## Recommended Approach & Plan

Based on the comparison and project requirements, **`Crawl4AI`** is the recommended starting point.

**Reasoning:**

1.  **Directly Addresses Core Need:** `Crawl4AI` is specifically designed for producing Markdown suitable for AI applications, which aligns perfectly with the project's goal of feeding data into Kuzu and an LLM.
2.  **Modern Web Capabilities:** Its built-in Playwright integration should effectively handle JavaScript-rendered content common on modern websites, reducing the need for complex manual setup.
3.  **Docker and API:** The availability of official Docker images and a FastAPI server facilitates easy deployment and integration into the project's infrastructure.
4.  **Balance of Power and Simplicity:** It offers a rich feature set tailored for AI data extraction while aiming for ease of use for its primary function (URL to Markdown).
5.  **Avoids Reinventing the Wheel:** Provides robust crawling features out-of-the-box, saving development time and effort compared to a custom solution.

**Implementation Plan:**

1.  **Phase 1: Evaluate `Crawl4AI`**
    *   **Setup:** Pull and run the `Crawl4AI` Docker image.
        *   `docker pull unclecode/crawl4ai:latest` (or a specific stable version)
        *   `docker run -d -p 11235:11235 --name crawl4ai --shm-size=1g unclecode/crawl4ai:latest`
    *   **Initial Testing:**
        *   Use a small, diverse set of sample URLs from the target website categories (e.g., a school district homepage, a specific legislative bill page, a school board meeting agenda page).
        *   Utilize `Crawl4AI`'s API (via `localhost:11235`) or CLI (if preferred and simpler for initial tests) to crawl these pages.
    *   **Output Analysis:**
        *   Critically examine the generated Markdown.
        *   Assess its cleanliness, structure, and completeness.
        *   Verify its suitability for Kuzu indexing (e.g., preservation of headings, lists, tables if important).
        *   Investigate `Crawl4AI`'s documentation for options to customize Markdown generation or content filtering if the default output is not ideal.
    *   **Usability Assessment:**
        *   Evaluate the ease of submitting crawl jobs and retrieving results.
        *   Determine how to manage lists of URLs and organize the output Markdown files.
    *   **Decision Point:** Is `Crawl4AI` suitable? Does its Markdown output meet the quality and structural requirements? Is it reliable enough for the target sites?

2.  **Phase 2: Alternative Solutions (If `Crawl4AI` is not suitable)**
    *   **Option A: Evaluate Scrapy**
        *   **Setup:** Install Scrapy and `markdownify`. If needed for JavaScript, install `scrapy-playwright`.
        *   **Develop:** Create a simple Scrapy Spider to fetch pages. Implement an Item Pipeline to convert HTML to Markdown using `markdownify`.
        *   **Test:** Use the same sample URLs as in Phase 1.
        *   **Dockerize:** Create a Dockerfile for the Scrapy project.
        *   **Assess:** Compare complexity, output quality, and effort versus `Crawl4AI`.
    *   **Option B: Minimal Custom Script (Limited Scope)**
        *   Consider for very simple, static sites if other options prove too complex for basic needs.
        *   Use Python with `requests`/`httpx`, `BeautifulSoup`, and `markdownify`.
        *   This is a fallback and should be approached with caution due to the potential for increasing complexity when handling diverse websites.

3.  **Phase 3: Integration and Deployment**
    *   Once a crawler solution is chosen and validated:
        *   Develop scripts or processes to manage the input list of URLs/domains to crawl.
        *   Define a strategy for storing and organizing the output Markdown files.
        *   Integrate the crawler (likely its Docker container) into a scheduled workflow (e.g., a cron job, a CI/CD pipeline action, or an orchestrator like Airflow if the project scales).
        *   Implement logging, monitoring, and error handling for the crawling process.

**Next Immediate Steps:**

*   Proceed with **Phase 1: Evaluate `Crawl4AI`** as detailed above.
*   Document findings and the decision from the evaluation.

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