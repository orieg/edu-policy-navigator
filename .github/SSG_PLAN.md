# **Static Site Generation (SSG) Plan using Vike**

**Goal:** Generate individual static HTML pages for each California school district by extending the existing Vite application using Vike. This aims to leverage the current Vite setup and TypeScript codebase while adding SSG (pre-rendering) capabilities for improved SEO and static hosting compatibility (e.g., GitHub Pages).

**Reasoning:** Vike integrates directly with Vite, offering SSR/SSG features without requiring a full framework change. This approach fits well with the existing vanilla TypeScript application, maintains Vite's HMR for development, and provides control over the rendering process.

## **Phase 1: Vike Setup & Configuration**

*   **Goal:** Install Vike and configure it within the existing Vite setup.
*   [ ] **Step 1.1: Install Vike**
    *   [ ] Run `pnpm add vike`.
*   [ ] **Step 1.2: Configure Vite**
    *   [ ] Update `vite.config.ts`.
    *   [ ] Import `vike` from `vike/plugin`.
    *   [ ] Add `vike()` to the `plugins` array.
    *   [ ] Ensure Vite's `build.outDir` is set (e.g., `dist` - Vike manages subdirectories within it).
    *   [ ] Remove any previous SSG/framework plugins if present.
*   [ ] **Step 1.3: Update Package Scripts**
    *   [ ] Modify `package.json` scripts:
        *   `dev`: `vike dev`
        *   `build`: `pnpm run prepare && vike build` (**Note:** Use `vike build` which handles client & server/SSG builds).
        *   `preview`: `vike preview` (To preview the production build).
        *   `prepare`: Ensure this script (e.g., `pnpm run convert:xlsx && pnpm run prepare:districts && pnpm run prepare:boundaries`) places necessary JSON/GeoJSON data where Vike hooks can access it during the build (e.g., project root or a dedicated `data/` dir, accessible to Node.js).
*   [ ] **Step 1.4: Basic Project Structure**
    *   [ ] Create a `pages/` directory for Vike's file-based routing.
    *   [ ] Create `renderer/` directory for Vike rendering hooks.

## **Phase 2: Rendering Hooks Implementation**

*   **Goal:** Define how Vike renders HTML pages and initializes client-side JavaScript.
*   [ ] **Step 2.1: Create HTML Shell (`+onRenderHtml.js/.ts`)**
    *   [ ] Create `renderer/+onRenderHtml.js` (or `.ts`).
    *   [ ] Define the basic HTML structure (`<html>`, `<head>`, `<body>`).
    *   [ ] Use Vike's templating mechanisms (e.g., `dangerouslySkipEscape` for injecting HTML snippets, template literals) to include:
        *   Page title (`<title>${pageContext.title || 'Default Title'}</title>`).
        *   Meta description (`<meta name="description" content="${pageContext.description || ''}">`).
        *   Root element for client-side rendering (e.g., `<div id="page-view"></div>`).
        *   Links to CSS/JS assets (Vike handles injection).
        *   Initial page data/state needed for hydration (e.g., using `<script type="application/json" id="page-data">${JSON.stringify(pageContext.pageProps)}</script>`).
*   [ ] **Step 2.2: Create Client Entry Point (`+onRenderClient.js/.ts`)**
    *   [ ] Create `renderer/+onRenderClient.js` (or `.ts`).
    *   [ ] This becomes the main client-side JS entry point.
    *   [ ] **CSS Handling:** Verify how CSS is best handled. Importing global CSS here (`import '../path/to/style.css'`) might work but *could* cause a brief Flash of Unstyled Content (FOUC). Check if Vike/Vite automatically injects CSS `<link>` tags when CSS is imported in `.page.js` files or handled via standard Vite processing, which is often preferred.
    *   [ ] Read initial page data injected by `+onRenderHtml` (e.g., parsing the JSON from the script tag).
    *   [ ] Implement hydration logic: Find the root element and render/initialize the interactive parts (search, map, etc.) using the initial data. This replaces the core logic previously in `src/main.ts`.
    *   [ ] Adapt existing code from `src/main.ts` (map initialization, search handlers, event listeners) to work within this client-side hydration context, using the data passed from the server/SSG build.

## **Phase 3: Page Definition & Data Fetching (SSG)**

*   **Goal:** Define the structure for district pages and fetch data during the build for pre-rendering.
*   [ ] **Step 3.1: Create Basic Pages**
    *   [ ] Create `pages/index/+Page.js` (or `.page.js`) for the homepage.
    *   [ ] Define the basic content/structure for the homepage component/rendering logic.
*   [ ] **Step 3.2: Create Dynamic District Page Route**
    *   [ ] Create `pages/districts/@cdsCode/+Page.js` (or `.page.js`) for dynamic district routes.
    *   [ ] This file will define the component structure or rendering logic for a single district page (info card, map placeholder, school list placeholder). It will receive data via `pageContext.pageProps`.
*   [ ] **Step 3.3: Implement Data Fetching (`+onBeforeRender.js/.ts`)**
    *   [ ] Create `pages/districts/@cdsCode/+onBeforeRender.js` (or `.ts`).
    *   [ ] This hook runs *before* rendering the page (at build time for SSG).
    *   [ ] Load the necessary data:
        *   Read `districts.json` and `schools_by_district.json` (ensure `prepare` script places them accessibly).
        *   Use `pageContext.routeParams.cdsCode` to get the specific district's CDS code.
        *   Find the district data (`districtData`) and corresponding school data (`schoolsData`).
    *   [ ] Return the fetched data and SEO metadata in the `pageContext`:
        ```javascript
        // Example structure to return
        return {
          pageContext: {
            pageProps: { // Data needed by the +Page component and potentially the client
              districtData,
              schoolsData
            },
            // SEO Metadata for +onRenderHtml
            title: `${districtData.District} - CA School District Info`,
            description: `Information and schools for ${districtData.District} in ${districtData.County}, California.`
          }
        }
        ```
*   [ ] **Step 3.4: Enable & Configure Pre-rendering (SSG)**
    *   [ ] Create `pages/districts/@cdsCode/+config.h.js`.
    *   [ ] Define the `prerender` export to enable SSG and provide the list of district codes to generate:
        ```javascript
        // pages/districts/@cdsCode/+config.h.js
        import fs from 'fs';
        import path from 'path';

        // Function to load districts.json data during build
        // Adjust path as necessary relative to this config file
        const loadDistrictsData = () => {
          const filePath = path.resolve(process.cwd(), 'public/assets/districts.json'); // Or wherever 'prepare' puts it
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          return JSON.parse(fileContent);
        };

        export default {
          prerender: () => {
            const districtsData = loadDistrictsData();
            // Map the keys (CDS codes) from the loaded data to the format Vike expects
            return Object.keys(districtsData).map(code => ({ cdsCode: code }));
          }
        }
        ```

## **Phase 4: Integrating Existing Logic & Assets**

*   **Goal:** Adapt the existing map, search, and UI logic to Vike's structure and ensure static assets are handled.
*   [ ] **Step 4.1: Adapt Component/Rendering Logic**
    *   [ ] Move/refactor UI rendering logic (info card, school list generation) into the respective `+Page.js` files (homepage, district page).
    *   [ ] Ensure these components/render functions receive data via `pageContext.pageProps` (populated by `+onBeforeRender`).
*   [ ] **Step 4.2: Adapt Client-Side Interactivity**
    *   [ ] Move/refactor map initialization, search input handling, event listeners, etc., from the old `src/main.ts` into `renderer/+onRenderClient.js`.
    *   [ ] Ensure this client code correctly reads and uses the initial data passed from the server/SSG build (e.g., from the JSON script tag created in `+onRenderHtml`).
*   [ ] **Step 4.3: Handle Static Assets**
    *   [ ] Place static assets (Leaflet library files if not using CDN, GeoJSON boundaries) in Vite's `public/` directory (e.g., `public/leaflet/`, `public/assets/boundaries/`). Vite copies these automatically to the output directory.
    *   [ ] Update paths in the code (e.g., in `+onRenderClient.js` map logic) to reference these paths correctly (e.g., `/leaflet/leaflet.css`, `/assets/boundaries/${cdsCode}.geojson`). Ensure they are root-relative paths.
    *   [ ] Update the `prepare:boundaries` script output path to target `public/assets/boundaries/`.

## **Phase 5: Testing & Verification**

*   **Goal:** Ensure the site works correctly in dev (with HMR) and production (pre-rendered static HTML).
*   [ ] **Step 5.1: Test Development Server (`vike dev`)**
    *   [ ] Run `pnpm run dev`.
    *   [ ] Verify the homepage loads.
    *   [ ] Test navigation/linking to a district page (if implemented).
    *   [ ] Verify JS/CSS load, HMR works for client-side code edits (`+onRenderClient.js`, related modules).
    *   [ ] Check browser console for errors.
*   [ ] **Step 5.2: Test Production Build (`vike build`)**
    *   [ ] Run `pnpm run build`.
    *   [ ] Inspect the build output directory (e.g., `dist/client/`).
    *   [ ] Verify the generation of static HTML files for districts (e.g., `dist/client/districts/12345.html`).
    *   [ ] Check the contents of a generated HTML file to ensure pre-rendered content and correct asset paths.
*   [ ] **Step 5.3: Test Preview Server (`vike preview`)**
    *   [ ] Run `pnpm run preview`.
    *   [ ] Access the site in the browser.
    *   [ ] Navigate to a district page (e.g., `/districts/12345`).
    *   [ ] **Verify SSG:** Use browser developer tools (View Source) to confirm the initial HTML response contains the district-specific content (info card, school list structure) *before* JavaScript runs.
    *   [ ] **Verify Hydration:** Confirm client-side JavaScript takes over correctly (map loads and becomes interactive, search input works).
    *   [ ] Test multiple district pages. 