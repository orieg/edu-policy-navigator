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

## License

This project is licensed under the terms of the [LICENSE](LICENSE) file. 