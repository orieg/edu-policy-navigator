# Web Crawler Plan for Edu Policy Navigator

This document outlines the plan for implementing a web crawler to gather data from school district websites, California educational legislation sites, board websites, and school websites. The primary goal is to obtain clean Markdown content from these pages for later indexing with Kuzu and use in an LLM chat application.

## Key Requirements

*These requirements are based on the project goals outlined in `PRD.md`.*

*   **Target Sources:** Configurable list of school districts/educational entities (from a central configuration file, e.g., `districts_config.json`), their specific policy platform URLs (e.g., Simbli, custom websites), and the California Education Code (`leginfo.legislature.ca.gov`).
*   **Output Format:** Clean Markdown files for each crawled page/document.
*   **Downstream Use:** Indexing with KuzuDB (separate DB per district), powering an LLM chat interface (dynamically loading the relevant district's DB).
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

1.  **Section A: Crawler Tool Evaluation & Selection (Focus: `Crawl4AI`)**
    *   **Pre-requisite: Configuration & Scope Definition**
        *   [ ] Define and create a `districts_config.json` (or similar YAML/JSON file). This file will contain an array of objects, each representing a crawlable entity (district or school), including:
            *   An `identifier` (this will be the official CDS code for the district or school).
            *   An `entity_type` (e.g., "district", "school").
            *   A `displayName` (e.g., "San Ramon Valley Unified School District" or "Monte Vista High School").
            *   `seedUrls`: An array of objects, each specifying a starting URL for crawling (e.g., main website, policy portal) and associated:
                *   `source_category` (e.g., "general_website", "policy_simbli", "board_meetings").
                *   Specific `whitelisted_domains` for this seed URL (e.g., `["srvusd.org"]`, `["simbli.eboardsolutions.com"]`).
                *   Specific `url_patterns_to_include` (e.g., `["/policies/", "/board-docs/"]`).
                *   Specific `url_patterns_to_exclude` (e.g., `["/sports/scores/"]`).
                *   Crawl parameters for this source: `max_depth` (e.g., 2), `max_pages` (e.g., 50).
            *   `global_include_external`: `false` (applies to all seed URLs for this entity, usually `false`).
            *   **Note on Populating `districts_config.json`:** This file will be the source of truth for the crawler.
                *   [ ] **Initial population can leverage the existing `public/assets/districts.json` and `public/assets/schools_by_district.json` files.** A utility script can be created to transform entries from these files (extracting CDS Code for `identifier`, Name for `displayName`, `entity_type` based on the source file, and Website for an initial `seedUrls` entry) into a foundational `districts_config.json`.
                *   [ ] Manual curation will then be essential to:
                    *   Add specific **policy portal URLs** and other relevant seed URLs with their categories.
                    *   Define precise **whitelisted domains and URL patterns** for each seed URL.
                    *   Set appropriate **crawl parameters** (`max_depth`, `max_pages`) for each distinct seed URL/source.
        *   [ ] Define the primary seed URL for California Education Code: `https://leginfo.legislature.ca.gov/faces/codesTOCSelected.xhtml?tocCode=EDC`.
        *   [ ] Whitelist for Ed Code: `leginfo.legislature.ca.gov`. Define appropriate `max_depth` and `max_pages` for Ed Code.
    *   **Setup:** Pull and run the `Crawl4AI` Docker image.
        *   `docker pull unclecode/crawl4ai:latest` (or a specific stable version)
        *   `docker run -d -p 11235:11235 --name crawl4ai --shm-size=1g unclecode/crawl4ai:latest`
    *   **Initial Testing:**
        *   Use seed URLs from the `districts_config.json` for a couple of representative districts and the CA Education Code URL.
        *   Test different deep crawl strategies offered by `Crawl4AI` (e.g., `BFSDeepCrawlStrategy`, `BestFirstCrawlingStrategy` using `adeep_crawl` which allows asynchronous iteration of results), configuring them with `max_depth`, `max_pages`, and `include_external: false` as defined in `districts_config.json`.
        *   Implement and test `FilterChain` with `DomainFilter` (using whitelisted domains) and `URLPatternFilter` (e.g., to target `/policy/` paths or specific keywords in URLs) to ensure the crawler stays within the defined scope.
        *   Configure `Crawl4AI` (or the chosen crawler) to respect whitelisted domains/patterns for each source to prevent crawling external sites.
        *   Utilize `Crawl4AI`'s API (via `localhost:11235`) or CLI to crawl these pages. Use of `adeep_crawl` for deep crawls inherently supports streaming processing of results.
    *   **Output Analysis:**
        *   Critically examine the generated Markdown. `Crawl4AI` provides this via `result.markdown`, which may be a `MarkdownGenerationResult` object containing different versions:
            *   `raw_markdown`: Unfiltered conversion.
            *   `fit_markdown`: Processed to remove noise (if content filters are used).
            *   `markdown_with_citations` and `references_markdown`: For structured handling of links.
            We should evaluate which version (or combination) is most suitable.
        *   Assess cleanliness, structure, and completeness. Test different `DefaultMarkdownGenerator` options (e.g., `ignore_links`, `escape_html`, `body_width`) and `content_source` settings (`raw_html`, `cleaned_html`) to optimize the output for our needs.
        *   The primary source URL for a piece of content is available via `result.url` (final URL after redirects). Verify how other metadata (e.g., page `title` from `result.metadata.title` or a direct `result.title` attribute, crawl `depth`, relevance `score` from `result.metadata` or direct attributes) is available in the crawler's `CrawlResult` object. Since existing documentation reviewed does not confirm automatic frontmatter injection of metadata (like source URL, crawl date), our manifest file will be the definitive record for this.
        *   Evaluate the utility of `Crawl4AI`'s link citation feature (outputting `[text][1]` and a reference list) for traceability (PRD.md F4).
        *   Verify its suitability for Kuzu indexing (e.g., preservation of headings, lists, tables if important).
    *   **Usability Assessment:**
        *   Evaluate the ease of submitting crawl jobs (potentially iterating through `districts_config.json`).
        *   Determine how to manage lists of URLs and organize the output Markdown files based on the proposed storage structure (see Section C).
    *   **Decision Point:** Is `Crawl4AI` suitable? 
        *   **Success criteria:** Ability to reliably extract clean, structured Markdown from representative target sites; configurable control over scope and depth; straightforward extraction of necessary metadata (URL, title, etc.) via its API/result objects; manageable setup and integration effort for our use case.
        *   **Failure criteria:** Persistent issues with Markdown quality that cannot be rectified through configuration for Kuzu indexing; inability to effectively scope crawls to whitelisted domains/paths; insurmountable difficulties in setup, API interaction, or reliability for target sites.

2.  **Section B: Alternative Tool Evaluation (If `Crawl4AI` is not suitable)**
    *   **Option A: Evaluate Scrapy**
        *   **Setup:** Install Scrapy and `markdownify`. If needed for JavaScript, install `scrapy-playwright`.
        *   **Develop:** Create a simple Scrapy Spider to fetch pages. Implement an Item Pipeline to convert HTML to Markdown using `markdownify`.
        *   **Test:** Use the same sample URLs as in Section A.
        *   **Dockerize:** Create a Dockerfile for the Scrapy project.
        *   **Assess:** Compare complexity, output quality, and effort versus `Crawl4AI`.
        *   This is a fallback and should be approached with caution due to the potential for increasing complexity when handling diverse websites.

3.  **Section C: Chosen Crawler Integration & Deployment**
    *   Once a crawler solution is chosen and validated (from Section A or B):
        *   **Data Ingestion Script:** Develop a primary script (e.g., Node.js/TypeScript) that:
            *   Reads the `districts_config.json`.
            *   For each district and the Ed Code:
                *   Constructs the appropriate crawl commands/API calls for the chosen crawler, passing seed URLs and whitelisting rules.
                *   Invokes the crawler.
        *   **Output Storage and Organization:**
            *   Define a root directory for crawled data (e.g., `dist/pipeline/crawled_data/`).
            *   Implement a structured directory system for storing Markdown output:
                ```
                crawled_data/
                ├── education_code_ca/  # Standardized ID for CA Ed Code
                │   ├── DIV_1_PART_1_CHAP_1_SEC_1.md # Or other structured naming
                │   └── ...
                ├── [entity_identifier_1]/  # CDS code of the district or school
                │   ├── [domain_name_1]/      # e.g., srvusd.org (from a seedURL's domain)
                │   │   ├── page_slug_or_hash_1.md
                │   │   └── ...
                │   ├── [domain_name_2]/      # e.g., simbli.eboardsolutions.com (from another seedURL's domain)
                │   │   ├── page_slug_or_hash_from_simbli_1.md
                │   │   └── ...
                ├── [entity_identifier_2]/ # e.g., 01612590130167 (a school's CDS code)
                │   └── ...
                ```
            *   The `[entity_identifier]` will correspond to the `identifier` (CDS code) from `districts_config.json` for the district or school.
            *   Subdirectories under each `[entity_identifier]` will be named after the `domain_name` from which the content was sourced (derived from the specific seed URL being processed).
            *   File naming within these domain-specific directories should be consistent (e.g., derived from URL slugs, page titles, or a content hash if no other clear identifier exists) to ensure uniqueness and traceability.
            *   **Note on Content Categorization:** The initial crawling phase will focus on capturing content and organizing it by district and source domain. Granular categorization (e.g., distinguishing specific policy documents from general informational pages) might require additional heuristics during or after crawling and can be refined in a subsequent data processing phase. The crawler should attempt to preserve any obvious identifiers (like policy numbers in URLs or titles) in filenames or metadata where possible.
        *   **Manifest File Generation:**
            *   For each `[entity_identifier]` and `education_code_ca`, generate a local manifest file (e.g., `[entity_identifier]_manifest.jsonl` or `education_code_ca_manifest.jsonl`) within its respective top-level directory. Each line in this JSON Lines file would represent a crawled item and serve as the **primary record for linking saved content to its origin and associated metadata**:
                ```json
                {"source_url": "result.url (final URL after redirects)", "local_path": "path/to/saved_markdown.md", "crawl_timestamp": "iso_timestamp_of_crawl_execution", "title": "result.metadata.title or result.title (if available)", "source_type": "seedUrl.source_category (e.g., policy_simbli, general_website)", "entity_identifier": "[CDS_code_of_district_or_school]", "entity_type": "district/school (from config)", "content_hash": "sha256_of_markdown_content", "crawl_depth": 1, "relevance_score": 0.85, "error": null_or_error_message}
                ```
            *   The `source_url` will be obtained from the `CrawlResult.url` property. The `crawl_timestamp` will be recorded at the time of crawling. `title` (e.g., from `CrawlResult.metadata.title`), `crawl_depth`, `relevance_score` (if applicable), and other extracted metadata will be taken from the crawler's `CrawlResult` object if available. The `entity_identifier` and `entity_type` will come from the `districts_config.json` entry being processed. The `source_type` will derive from the `source_category` of the seed URL.
            *   Even if future investigations reveal a way to embed some metadata in Markdown frontmatter, this manifest provides a centralized and queryable record of all crawled items and their core attributes.
            *   A top-level manifest (`master_manifest.json`) could also be generated, listing all processed districts/entities and pointers to their individual data directories and local manifests. This aligns with F7 in `PRD.md`.
        *   **Automation Workflow:** Integrate the data ingestion script and crawler execution into the GitHub Action workflow defined in `PRD.md` (F7). This workflow will be triggered on a schedule or manually.
        *   Implement logging, monitoring, and robust error handling for the entire crawling and processing pipeline.

**Next Immediate Steps:**

*   Proceed with **Section A: Crawler Tool Evaluation & Selection (Focus: `Crawl4AI`)** as detailed above.
*   Document findings and the decision from the evaluation.

---

*The following sections outline detailed implementation workstreams for specific data sources and post-processing steps. These workstreams will need to be adapted based on the crawler tool selected and validated in Sections A/B/C above. If a general-purpose crawler like `Crawl4AI` is chosen, these steps will primarily involve configuring and running that crawler for each source, rather than building custom TypeScript/Playwright crawlers from scratch as initially drafted below, unless the chosen tool proves insufficient for a specific source.* 

## Detailed Workstream: California Education Code Data Acquisition

*   **Goal:** Download and structure the text of the California Education Code using the chosen crawler tool.
*   [ ] **Step 1.1: Tool Configuration for Ed Code**
    *   [ ] Create/update entry in `districts_config.json` for CA Ed Code, specifying seed URL, whitelisted domain (`leginfo.legislature.ca.gov`), `max_depth`, `max_pages`, and any specific URL patterns to target/avoid for Ed Code sections.
    *   [ ] If necessary, define specific `Crawl4AI` (or chosen tool) scraping/content selection strategies tailored for the Ed Code website structure (e.g., targeting main content blocks of sections, handling navigation if not through simple links).
*   [ ] **Step 1.2: Implement Invocation in Data Ingestion Script**
    *   [ ] Ensure the Data Ingestion Script (from Section C) correctly processes the Ed Code configuration and invokes the chosen crawler tool with the appropriate parameters.
*   [ ] **Step 1.3: Output Structuring & Manifest**
    *   [ ] Confirm output is saved to `crawled_data/education_code_ca/` as Markdown files.
    *   [ ] Verify `education_code_ca_manifest.jsonl` is correctly populated with source URLs (linking to specific sections on leginfo.legislature.ca.gov), local paths, titles (section numbers/names), and other metadata.
*   [ ] **Step 1.4: Review & Refine**
    *   [ ] Review a sample of crawled Ed Code Markdown files for accuracy and completeness.
    *   [ ] Refine crawler configuration (depth, page limits, content selectors for the chosen tool) if necessary.

## Detailed Workstream: District-Specific Data Acquisition (Example: SRVUSD)

*   **Goal:** Find and download policy documents and relevant web page text from configured district websites (e.g., SRVUSD using Simbli and their main site) using the chosen crawler tool.
*   [ ] **Step 2.1: Tool Configuration for District (e.g., SRVUSD)**
    *   [ ] Ensure SRVUSD (and other target districts) are fully configured in `districts_config.json` with unique IDs (CDS codes), seed URLs (Simbli, main website), whitelisted domains, URL patterns (e.g., for policy sections, board meeting pages), `max_depth`, and `max_pages`.
    *   [ ] Define specific `Crawl4AI` (or chosen tool) scraping/content selection strategies if needed for Simbli structure or the district's main website (e.g., handling AJAX-loaded policies on Simbli, identifying main content on various page layouts).
    *   [ ] Configure file download capabilities of the chosen crawler if PDFs/DOCX are hosted directly and need to be fetched (Crawl4AI has file downloading features).
*   [ ] **Step 2.2: Implement Invocation in Data Ingestion Script**
    *   [ ] Verify the Data Ingestion Script correctly processes each district's configuration.
*   [ ] **Step 2.3: Output Structuring & Manifest**
    *   [ ] Confirm output is saved to `crawled_data/[entity_identifier]/[domain_name]/` as Markdown (for HTML pages) or downloaded files (for PDFs/DOCX – note: these will need a separate text extraction step later).
    *   [ ] Verify `[entity_identifier]_manifest.jsonl` is correctly populated.
*   [ ] **Step 2.4: Review & Refine**
    *   [ ] Review crawled content from a sample district. Adjust configurations as needed.

## Detailed Workstream: Post-Crawling Pre-processing (for Kùzu & RAG)

*   **Goal:** Prepare crawled text (Markdown from web pages, extracted text from documents) for indexing in Kùzu and a vector store.
*   [ ] **Step 3.1: Parse Binary Files (if downloaded)**
    *   [ ] If the chosen crawler downloaded binary files (PDFs, DOCX), implement a script to extract raw text from these.
        *   Install necessary libraries (e.g., `pdf-parse`, `mammoth` for Node.js; or Python equivalents if the ingestion script is Python).
        *   This script would read the manifest to find downloaded binary files and output corresponding `.txt` or structured text files, potentially updating the manifest or creating a new one for these derived texts.
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