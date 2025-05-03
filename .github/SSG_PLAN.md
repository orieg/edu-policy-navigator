# **Static Site Generation (SSG) Plan using Vike**

**Goal:** Generate individual static HTML pages for each California school district by extending the existing Vite application using Vike. This aims to leverage the current Vite setup and TypeScript codebase while adding SSG (pre-rendering) capabilities for improved SEO and static hosting compatibility (e.g., GitHub Pages).

**Reasoning:** Vike integrates directly with Vite, offering SSR/SSG features without requiring a full framework change. This approach fits well with the existing vanilla TypeScript application, maintains Vite's HMR for development, and provides control over the rendering process.

## **Phase 1: Vike Setup & Configuration**

*   **Goal:** Install Vike and configure it within the existing Vite setup.
*   [x] **Step 1.1: Install Vike**
    *   [x] Run `pnpm add vike`.
*   [x] **Step 1.2: Configure Vite**
    *   [x] Update `vite.config.ts`.
    *   [x] Import `vike` from `vike/plugin`.
    *   [x] Add `vike()` to the `plugins` array.
    *   [x] Ensure Vite's `build.outDir` is set (e.g., `dist` - Vike manages subdirectories within it).
    *   [x] Remove any previous SSG/framework plugins if present.
*   [x] **Step 1.3: Update Package Scripts**
    *   [x] Modify `package.json` scripts:
        *   `dev`: `pnpm run prepare && vike dev` (Added prepare step)
        *   `build`: `pnpm run clean && pnpm run prepare && vite build` (Vike plugin handles build integration)
        *   `preview`: `vike preview` (To preview the production build).
        *   `prepare`: Ensure this script (e.g., `pnpm run convert:xlsx && pnpm run build:data && pnpm run build:boundaries`) places necessary JSON/GeoJSON data where Vike hooks can access it during the build (e.g., `public/assets/`).
*   [x] **Step 1.4: Basic Project Structure**
    *   [x] Create a `pages/` directory for Vike's file-based routing.
    *   [x] Create `renderer/` directory for Vike rendering hooks.

## **Phase 2: Rendering Hooks Implementation**

*   **Goal:** Define how Vike renders HTML pages and initializes client-side JavaScript.
*   [x] **Step 2.1: Create HTML Shell (`+onRenderHtml.ts`)**
    *   [x] Create `renderer/+onRenderHtml.ts`.
    *   [x] Define the basic HTML structure (`<html>`, `<head>`, `<body>`).
    *   [x] Use Vike's templating mechanisms (template literals, `dangerouslySkipEscape`) to include:
        *   Page title (`<title>${pageContext.title || 'Default Title'}</title>`).
        *   Meta description (Set in `+onBeforeRender`, accessed via `pageContext.pageProps.description`).
        *   Root element for client-side rendering (`<div id="page-view">${dangerouslySkipEscape(pageHtml)}</div>`).
        *   Links to CSS/JS assets (Vike handles injection).
        *   Inject pageProps for client hydration (`<script id="page-props" type="application/json">${dangerouslySkipEscape(JSON.stringify(pageProps || {}))}</script>`).
*   [x] **Step 2.2: Create Client Entry Point (`+onRenderClient.ts`)**
    *   [x] Create `renderer/+onRenderClient.ts`.
    *   [x] This becomes the main client-side JS entry point.
    *   [x] **CSS Handling:** Global CSS (`pages/style.css`) imported in relevant `+Page.ts` files. Vike/Vite handle injection.
    *   [x] Read initial page data if needed (e.g., parsing the JSON from the script tag, or reading data attributes set in `+Page.ts`). Map initialization currently uses data attributes.
    *   [x] Implement hydration/initialization logic: Initialize search, map, etc.
    *   [x] Adapt existing code (map initialization in `src/map.ts`, search handlers in `src/search.ts`) to be called from this client-side entry point.

## **Phase 3: Page Definition & Data Fetching (SSG)**

*   **Goal:** Define the structure for district pages and fetch data during the build for pre-rendering.
*   [x] **Step 3.1: Create Basic Pages**
    *   [x] Create `pages/index/+Page.ts` for the homepage.
    *   [x] Define the basic content/structure for the homepage component/rendering logic.
*   [x] **Step 3.2: Create Dynamic District Page Route**
    *   [x] Create `pages/districts/@districtSlug/+Page.ts` for dynamic district routes (using slugs).
    *   [x] This file defines the component structure/rendering logic for a single district page (info card, map placeholder, school list placeholder). It receives data via `pageContext.pageProps`.
*   [x] **Step 3.3: Implement Data Fetching (`+onBeforeRender.ts`)**
    *   [x] Create `pages/districts/@districtSlug/+onBeforeRender.ts`.
    *   [x] This hook runs *before* rendering the page (at build time for SSG, or on request in dev/SSR).
    *   [x] Load the necessary data:
        *   Read `districts.json` and `schools_by_district.json` from `public/assets/`.
        *   Use `pageContext.routeParams.districtSlug` to get the specific district's slug.
        *   Find the district data (`districtData`) by slug and corresponding school data (`schoolsData`) by CDS code prefix.
        *   Filter schools server-side based on criteria (Active, Public, valid coords).
    *   [x] Return the fetched data and SEO metadata in the `pageContext`:
        ```typescript
        // Example structure returned
        return {
          pageContext: {
            pageProps: { // Data needed by the +Page component and potentially the client
              district: districtData,
              schools: filteredSchools,
              description: `Information and schools for ${districtData.District}...`
            },
            // SEO Metadata for +onRenderHtml
            title: `${districtData.District} - ${districtData['Entity Type']}` // Updated title format
          }
        }
        ```
*   [ ] **Step 3.4: Enable & Configure Pre-rendering (SSG)**
    *   [x] Create `pages/districts/@districtSlug/+config.ts`.
    *   [ ] **Currently Disabled:** The `prerender` export is commented out due to an internal Vike bug ([vike@0.4.229][Bug]) related to imports within the `prerender` function context when processing the generated `prerender-slugs.json`. Needs further investigation or a Vike update.
    *   [ ] **(Intended Logic)** Define the `prerender` export to enable SSG and provide the list of district slugs to generate:
        ```typescript
        // pages/districts/@districtSlug/+config.ts
        import fs from 'fs/promises';
        import path from 'path';

        // Helper function to load generated slugs
        async function loadSlugs(): Promise<string[]> {
            const filePath = path.resolve(process.cwd(), 'public/assets/prerender-slugs.json');
            try {
                const fileContent = await fs.readFile(filePath, 'utf-8');
                return JSON.parse(fileContent);
            } catch (error) {
                console.error("Failed to load slugs for prerendering:", error);
                return [];
            }
        }

        export default {
          prerender: async () => {
            const slugs = await loadSlugs();
            return slugs.map(slug => ({ districtSlug: slug }));
          }
          // Other config like title can also live here
          // title: 'Default District Title' // If needed
        }
        ```
    *   [x] Ensure `build:data` script generates `public/assets/prerender-slugs.json`.

## **Phase 4: Integrating Existing Logic & Assets**

*   **Goal:** Adapt the existing map, search, and UI logic to Vike's structure and ensure static assets are handled.
*   [x] **Step 4.1: Adapt Component/Rendering Logic**
    *   [x] Move/refactor UI rendering logic (info card, school list generation) into the respective `+Page.ts` files (homepage, district page).
    *   [x] Ensure these components/render functions receive data via `pageContext.pageProps` (populated by `+onBeforeRender`).
*   [x] **Step 4.2: Adapt Client-Side Interactivity**
    *   [x] Move/refactor map initialization (`src/map.ts`), search input handling (`src/search.ts`), event listeners, etc., to be called from `renderer/+onRenderClient.ts`.
    *   [x] Ensure this client code correctly initializes using data available (e.g., from data attributes set in `+Page.ts` based on `pageProps`).
*   [x] **Step 4.3: Handle Static Assets**
    *   [x] Place static assets (GeoJSON boundaries) in Vite's `public/` directory (e.g., `public/assets/boundaries/`). Leaflet/MarkerCluster installed via pnpm.
    *   [x] Update paths in the code (e.g., in `src/map.ts`) to reference these paths correctly (e.g., `/assets/boundaries/${cdsCode}.geojson`). Ensure they are root-relative paths.
    *   [x] Update the `build:boundaries` script output path to target `public/assets/boundaries/`.

## **Phase 5: Testing & Verification**

*   **Goal:** Ensure the site works correctly in dev (with HMR) and production (pre-rendered static HTML).
*   [x] **Step 5.1: Test Development Server (`vike dev`)**
    *   [x] Run `pnpm run dev`.
    *   [x] Verify the homepage loads.
    *   [x] Test search and navigation to a district page.
    *   [x] Verify JS/CSS load, map initialization, school filtering. HMR works.
    *   [x] Check browser console for errors.
    *   [ ] **Note:** District pages are currently rendered on-demand (SSR/CSR) in dev due to disabled `prerender` config.
*   [x] **Step 5.2: Test Production Build (`vite build`)**
    *   [x] Run `pnpm run build`.
    *   [x] Inspect the build output directory (`dist/`).
    *   [ ] **Verify:** Static HTML files for districts are **NOT** generated in `dist/client/districts/` because `prerender` is disabled. Only the index page and assets are built statically.
    *   [x] Check build logs for errors.
*   [x] **Step 5.3: Test Preview Server (`vike preview`)**
    *   [x] Run `pnpm run preview`.
    *   [x] Access the site in the browser.
    *   [x] Navigate to a district page (e.g., `/districts/some-slug-12345`).
    *   [ ] **Verify SSG:** Use browser developer tools (View Source). The initial HTML response contains **server-rendered** content, not statically pre-rendered content for district pages.
    *   [x] **Verify Hydration:** Confirm client-side JavaScript takes over correctly (map loads and becomes interactive, search input works).
    *   [x] Test multiple district pages and 404 handling. 