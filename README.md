# Unofficial edu-policy-navigator

This project provides an accessible, easy-to-understand **unofficial** resource for navigating policies and relevant education code sections for multiple configurable school districts or educational entities. It's implemented as a static website with:

*   **District Selection:** Allows users to choose the specific district they are interested in.
*   **Synthesized Policy Summaries:** Presents simplified summaries of Board Policies (BP), Administrative Regulations (AR), and relevant Education Code sections for the selected district.
*   **AI Chat Interface:** An in-browser chat powered by WebLLM and KuzuDB WASM, allowing users to ask natural language questions and receive contextually relevant answers based *only* on the selected district's data. All processing happens client-side for privacy and efficiency.

The goal is to improve the accessibility and findability of policy information for parents, students, staff, and community members within the configured districts, while ensuring privacy and accuracy. Data collection and site updates are automated via GitHub Actions.

## Getting Started

This project uses [pnpm](https://pnpm.io/) for package management.

1.  **Install Dependencies:**
    ```bash
    pnpm install
    ```
2.  **(Optional) Prepare/Update Data:**
    If you need to refresh the district or school data from the source files (e.g., `CDESchoolDirectoryExport.xlsx`), run the data preparation script:
    ```bash
    pnpm run prepare:data
    ```
    *(Note: The necessary data JSON files are usually pre-committed in `public/assets/`)*
3.  **Run Development Server:**
    Starts a local development server with hot reloading.
    ```bash
    pnpm run dev
    ```
4.  **Build for Production:**
    Generates the static site in the `dist/` directory.
    ```bash
    pnpm run build
    ```
5.  **Preview Production Build:**
    Serves the contents of the `dist/` directory locally. Use this to test the final build before deployment.
    ```bash
    pnpm run preview
    ```

## Technology Stack

*   **Frontend Framework:** [Astro](https://astro.build/) (using Vite for bundling)
*   **Mapping Libraries:** [Leaflet](https://leafletjs.com/), [Proj4js](https://proj4js.org/), [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster), [leaflet-geosearch](https://github.com/smeijer/leaflet-geosearch)
*   **LLM (In-Browser):** WebLLM (mlc-ai)
*   **Graph DB (In-Browser):** KuzuDB WASM
*   **Data Pipeline:** TypeScript, GitHub Actions
*   **LLM (Synthesis - Build Time):** External LLM API
*   **Hosting:** GitHub Pages

## License

This project is licensed under the terms of the [LICENSE](LICENSE) file. 