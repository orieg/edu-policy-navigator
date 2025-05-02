# PRD: Multi-District Policy Navigator & Chatbot

**Version:** 1.1
**Date:** 2025-05-01

**1. Introduction/Overview**

This project aims to create an accessible, easy-to-understand resource for navigating policies and relevant education code sections for **multiple configurable school districts or educational entities**. It will be a static website featuring synthesized policy summaries and an AI-powered chat interface, **allowing users to select the specific district they are interested in**. The chat will utilize in-browser Retrieval-Augmented Generation (RAG) powered by WebLLM and KuzuDB WASM, allowing users to ask questions in natural language and receive contextually relevant answers based on the **selected district's policy data**. This ensures user privacy as processing happens client-side and optimizes resource usage by only loading relevant data. Data collection and site updates for all configured districts will be automated via GitHub Actions.

**2. Goals**

* **Goal 1: Improve Accessibility:** Make complex policies and education code easily understandable for parents, students, and staff **across multiple districts**.
* **Goal 2: Enhance Findability:** Allow users to quickly find relevant policy information for their **selected district** through structured browsing and natural language queries.
* **Goal 3: Ensure Privacy & Efficiency:** Implement a chat solution where user queries are processed entirely within their browser using WebLLM and KuzuDB WASM, **loading only the data for the selected district** to conserve resources. No user query data is sent to external servers for inference.
* **Goal 4: Maintain Accuracy & Traceability:** Provide synthesized information that accurately reflects the source documents and clearly links back to the original policy or code section for verification.
* **Goal 5: Automate Updates & Scalability:** Create a low-maintenance system where policy data for **all configured districts** can be refreshed and the website rebuilt automatically via scheduled GitHub Actions. Design for easy addition of new districts.

**3. Target Audience**

* Parents/Guardians, Students, Teachers, Staff, and Community Members **within the configured school districts**.

**4. Key Features**

* **F1: Static Website:** The entire application deployable on GitHub Pages.
* **F2: District/School Selection UI:** A clear mechanism (e.g., dropdown menu, initial selection page) for users to choose the district/school whose policies they want to view and query.
* **F3: Synthesized Policy Browser:** Dedicated section(s) presenting simplified summaries of Board Policies (BP), Administrative Regulations (AR), and relevant Education Code sections **specific to the selected district**.
* **F4: Source Linking:** Each synthesized summary must clearly link back to the specific original source document/section URL.
* **F5: Interactive Chat Interface:** A user-friendly chat window for asking questions about policies **within the context of the selected district**.
* **F6: In-Browser Graph RAG (Dynamic Loading):**
    * Utilizes KuzuDB WASM loaded in the browser.
    * **Dynamically loads the pre-built KuzuDB graph database file specific to the user's selected district.**
    * Uses WebLLM running locally in the browser for language understanding and generation.
    * Implements a Text-to-Cypher step (using WebLLM) to translate user questions into KuzuDB graph queries relevant to the loaded database schema.
    * Retrieves relevant context (policy text/summaries) from the **currently loaded KuzuDB instance**.
    * Generates answers (using WebLLM) based on the original question and retrieved context.
* **F7: Automated Data Pipeline (Multi-Source):** A GitHub Action workflow that:
    * Reads a configuration file listing districts/schools to process.
    * Scrapes policy data from **each configured source**.
    * Preprocesses and cleans the extracted text data for each source.
    * Generates synthesized summaries for each source (using an external LLM API during the *build process only*).
    * Builds **separate KuzuDB graph database files (`.db`)**, one for each configured district/school.
    * Generates a manifest file listing available districts and their corresponding database file paths.
    * Prepares all necessary static website assets (HTML, CSS, JS, WASM files, multiple DB files, manifest file).
    * Deploys the updated site to GitHub Pages.

**5. Data Sources**

* **Configurable List:** The specific districts/schools and their data source URLs (e.g., Simbli, LegInfo, custom websites) will be defined in a configuration file within the repository. Examples:
    * SRVUSD Policy Listing (Simbli): `https://simbli.eboardsolutions.com/Policy/PolicyListing.aspx?S=36030429`
    * California Education Code (LegInfo): `https://leginfo.legislature.ca.gov/faces/codesTOCSelected.xhtml?tocCode=EDC` (Relevant sections)
    * California School District List (CDE): `https://www.cde.ca.gov/re/lr/do/schooldistrictlist.asp` (Provides downloadable lists [XLSX] of districts, potentially useful for programmatic discovery or validation of districts configured in the list above).
    * Wikipedia List of CA School Districts: `https://en.wikipedia.org/wiki/List_of_school_districts_in_California` (Alternative, potentially less structured list of districts).
    * California School Directory (CDE): `https://www.cde.ca.gov/SchoolDirectory/` (Provides search and downloadable data for schools/districts, including website info. A local export `CDESchoolDirectoryExport.xlsx` is available in the repo, which may be preferred for automation over the direct export link [which may require CAPTCHA]: `https://www.cde.ca.gov/SchoolDirectory/Export?exportType=ALLSD&format=E&tab=1&reqURL=%2FSchoolDirectory%2FExportSelect%3Fsearch%3D%26allSearch%3D%26tab%3D1%26order%3D0%26qdc%3D1520%26qsc%3D25998%26simpleSearch%3DY%26sax%3Dtrue&sax=true&sd1=on&sd2=on&sd3=on&sd48=on&sd4=on&sd5=on&sd6=on&sd7=on&sd8=on&sd9=on&sd11=on&sd12=on&sd13=on&sd14=on&sd15=on&sd17=on&sd18=on&sd19=on&sd20=on&sd21=on&sd22=on&sd47=on&sd50=on&sd51=on&sd52=on&sd53=on&sd23=on&sd24=on&sd25=on&sd26=on&sd27=on&sd28=on&sd29=on&sd30=on&sd31=on&sd32=on&sd33=on&sd35=on&sd36=on&sd37=on`)
    * *[Future District/School Source URL]*

**6. Technology Stack**

* **Frontend:** HTML, CSS, TypeScript, JavaScript (ES Modules)
* **LLM (In-Browser):** WebLLM (mlc-ai)
* **Graph DB (In-Browser):** KuzuDB WASM
* **Data Pipeline:** Python 3.x (for scraping, processing, graph building), KuzuDB Python Client, Configuration management (e.g., JSON/YAML parsing).
* **LLM (Synthesis - Build Time):** External LLM API (e.g., Google Gemini API, OpenAI API) via REST calls during GitHub Action execution.
* **Automation:** GitHub Actions
* **Hosting:** GitHub Pages
* **Development Environment:** Node.js (using pnpm), Python 3.x

**7. Non-Goals / Out of Scope (Initial Version)**

* Cross-district comparisons or queries within the chat interface (chat operates on one selected district's data at a time).
* Handling data beyond official policies and selected Ed Code for each district.
* User accounts, login, or personalized experiences.
* Saving chat history across browser sessions or district selections.
* Providing legal advice; a clear disclaimer is required.
* Advanced visualization of the policy graph for end-users.
* Support for browsers lacking adequate WebGPU or WebAssembly capabilities.
* Real-time updates; data freshness depends on the GitHub Action schedule.

**8. Success Metrics**

* **Pipeline Reliability:** Successful, automated completion rate of the GitHub Action data pipeline for *all configured districts* > 95%.
* **Website Performance:** Initial website load < 5s. **Dynamic loading of a selected district's KuzuDB file** and initialization clearly indicated and reasonably fast (target < 20s after selection for typical DB size).
* **Content Accuracy:** Spot checks confirm synthesized content accurately reflects source material and links are correct **for each district**.
* **Chat Relevance:** >80% of answers to a predefined set of test questions are deemed relevant and correctly based on the policy data **for the selected district**.
* **RAG Functionality:** Successful execution of the Text-to-Cypher -> KuzuDB Query -> Context Retrieval -> Answer Generation flow for >90% of test queries **on the correctly loaded database**.
* **Scalability:** Successfully adding and processing data for a new district requires only configuration changes and potentially scraper adjustments, without major architectural refactoring.

**9. Design Considerations**

* **District Selection:** Provide an intuitive and prominent UI for district selection. Clearly indicate which district's data is currently active.
* **Loading States:** Implement clear visual feedback during the initial load and when switching districts (e.g., loading the new KuzuDB file).
* **Clarity & Trust:** Clearly differentiate between synthesized summaries and original text. Prominently display links to original sources.
* **Simplicity:** Keep the UI clean, intuitive, and focused on browsing and chat for the selected context.
* **Responsiveness:** Ensure optimal viewing and usability on desktop, tablet, and mobile devices.
* **Error Handling:** Gracefully handle errors during scraping (in Action logs), dynamic data loading (user message), or chat processing (user message). Provide informative feedback.
* **Disclaimer:** Include a clear, visible disclaimer stating the tool provides informational summaries, is not legal advice, and users should consult original policies for official guidance.


