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
2.  **Data Preparation & Geocoding (Required for `pnpm run prepare` or `pnpm run build:data`)**

    The data preparation step (`pnpm run prepare` or `pnpm run build:data`) requires a local geocoding service (Nominatim) running via Docker to find coordinates for districts and schools.

    *   **Install Docker:** Ensure you have Docker installed and running on your system.
    *   **Download California OSM Data:** Run the following command to download the required `california-latest.osm.pbf` file into the `./pipeline/data/` directory:
        ```bash
        pnpm run download:osm
        ```
    *   **Run the Nominatim Container:** Open a terminal and run the following command. This will download the `mediagis/nominatim` image (if not already present), start a container named `nominatim`, import the California data from `./pipeline/data` (this might take a while the first time), and expose the geocoding service on port 8080.
        ```bash
        pnpm run docker:nominatim
        ```
        Keep this terminal running while you execute the data preparation scripts (`pnpm run prepare` or `pnpm run build:data`).

3.  **Run Development Server:**
    Starts a local development server with hot reloading. Requires data to be prepared first (see step 2 or use pre-committed data).
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

## Testing

This project uses [Vitest](https://vitest.dev/) for unit and component testing. For more details on our testing strategy, tools, and coverage, please see the [TESTING_PLAN.md](TESTING_PLAN.md) document.

## License

This project is licensed under the terms of the [LICENSE](LICENSE) file.

## Embedding Pipeline

The project uses a pre-computation pipeline to generate and cluster document embeddings, which are then used by the client-side RAG system.

### Generating Embeddings

1.  **Prerequisites:** Ensure Node.js and pnpm are installed and project dependencies are up to date (`pnpm install`).
2.  **Run the generation script:**
    ```bash
    pnpm run build:embeddings
    ```
3.  **Process:** This command compiles and runs the `pipeline/scripts/generateClusteredEmbeddings.ts` script. It will:
    *   Load district and school data from `public/assets/`.
    *   Generate L2-normalized embeddings for each document using the `Snowflake/snowflake-arctic-embed-xs` model.
    *   Perform K-Means clustering on the embeddings (currently K=24, using kmeans++ initialization).
    *   Save the output to `public/embeddings/school_districts/`, including:
        *   `manifest.json`: Details about the generated files and parameters.
        *   `centroids.json`: L2-normalized cluster centroids.
        *   For each cluster (e.g., `cluster_0/`):
            *   `embeddings.bin`: Raw binary flat Float32Array of L2-normalized embeddings.
            *   `metadata.json`: Corresponding document metadata, ordered with embeddings.
    *   Individual raw embeddings are cached in `public/embeddings/.caches/school_districts/` to speed up re-runs if the source text hasn't changed.

### Validating Embeddings

1.  **Run the validation script:**
    ```bash
    pnpm run validate:embeddings
    ```
2.  **Process:** This command compiles and runs the `pipeline/scripts/validateEmbeddings.ts` script. It checks the integrity and correctness of the files generated by the `build:embeddings` script, including:
    *   Manifest structure and parameters.
    *   Centroid file structure, count, dimensions, and normalization.
    *   Existence and consistency of cluster metadata and embedding files.
    *   Correct embedding dimensions and L2 normalization in binary files.
    *   Absence of NaN/Infinity values in centroids and embeddings.

This provides a robust way to ensure the data fed into the client-side RAG is correct. 