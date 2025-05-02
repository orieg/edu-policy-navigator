# Static Site Generation (SSG) Plan

**Goal:** Generate individual static HTML pages for each district within the `dist/` directory, linked from a main search/index page, suitable for deployment on platforms like GitHub Pages.

## Phase 1: Setup for Static Generation

*   **Goal:** Create the necessary files and structure for generating district pages.
*   [ ] **Step 1.1: Create Template File**
    *   [ ] Create directory: `pipeline/templates/`
    *   [ ] Create file: `pipeline/templates/district_page_template.html` (containing placeholders like `{{DISTRICT_NAME}}`, `{{SCHOOL_LIST_HTML}}`, `{{MAP_INIT_DATA}}`).
*   [ ] **Step 1.2: Create District Page JS**
    *   [ ] Create file: `src/district-page.ts` (This script reads embedded data `window.pageData = {{MAP_INIT_DATA}}` and initializes the map).
*   [ ] **Step 1.3: Create Page Generation Script**
    *   [ ] Create file: `pipeline/scripts/generateDistrictPages.ts`.
*   [ ] **Step 1.4: Install Templating Engine (Recommended)**
    *   [ ] Install Handlebars: `pnpm add -D handlebars @types/handlebars`

## Phase 2: Implement Page Generation Logic

*   **Goal:** Populate the generation script to create HTML files for each district.
*   [ ] **Step 2.1: Basic Generation Script Structure**
    *   [ ] In `generateDistrictPages.ts`: Setup imports (fs, path, Handlebars), define input/output paths.
    *   [ ] Read `public/assets/districts.json`.
    *   [ ] Read `pipeline/templates/district_page_template.html` content.
    *   [ ] Compile the Handlebars template.
*   [ ] **Step 2.2: District Iteration and Path Generation**
    *   [ ] Loop through active districts from `districts.json`.
    *   [ ] Implement a "slugify" function (e.g., `san-ramon-valley-unified-01612590000000`).
    *   [ ] Define the output path: `dist/districts/[district-slug]/index.html`.
    *   [ ] Ensure the output directory `dist/districts/[district-slug]/` exists (create if not).
*   [ ] **Step 2.3: Data Gathering per District**
    *   [ ] Inside the loop, for each district:
        *   Get district details.
        *   Read `public/assets/schools_by_district.json` (consider reading once outside the loop).
        *   Extract the relevant school list for the current district.
        *   Apply school filters (active, public, not homeschool, not redacted).
        *   Generate the HTML for the school list (`<ul>...</ul>`) using the filtered data and correct formatting.
        *   Prepare a `pageData` JSON object containing data needed by `district-page.ts` (district details, boundary path `/assets/boundaries/[CDS_CODE].geojson`, filtered school list with coordinates, etc.).
*   [ ] **Step 2.4: Template Population and Output**
    *   [ ] Define the context object for Handlebars, including:
        *   District details (`districtName`, `cdsCode`, `address`, etc.).
        *   Generated `schoolListHtml`.
        *   Stringified `pageData` JSON (`JSON.stringify(pageData)`).
        *   Paths to static assets (CSS, JS bundles - e.g., `/assets/district-page-....js`). *These paths might need adjustment after coordinating with Vite build output.* 
    *   [ ] Render the Handlebars template with the context.
    *   [ ] Write the resulting HTML to the district's `index.html` file.

## Phase 3: Adapt Search and Build Process

*   **Goal:** Modify the main page to be a search index and update the build process.
*   [ ] **Step 3.1: Refactor `main.ts` for Search Only**
    *   [ ] Remove map initialization and info display logic.
    *   [ ] Modify `selectDistrict` function to calculate the slug and redirect: `window.location.href = '/districts/[district-slug]/';`.
*   [ ] **Step 3.2: Update `public/index.html`**
    *   [ ] Remove `#info-display` and `#info-map` elements.
    *   [ ] Ensure it links to the correct `main.ts` JS bundle output by Vite (e.g., `/assets/index-....js`).
*   [ ] **Step 3.3: Modify Build Process (`package.json` & `vite.config.ts`)**
    *   [ ] Update `build` script in `package.json`: `pnpm run prepare && ts-node pipeline/scripts/generateDistrictPages.ts && vite build` (or similar sequence).
    *   [ ] Configure Vite (`vite.config.ts`):
        *   Set `build.outDir` to `'dist'`. 
        *   Ensure `root` is likely `.` (project root) or `public` depending on asset handling. If `public`, ensure `index.html` is copied correctly.
        *   Define entry points in `build.rollupOptions.input` for *both* `public/index.html` (or its JS `src/main.ts`) AND `src/district-page.ts`. Vite needs to process both scripts.
        *   Potentially use `build.manifest: true` and read the manifest in `generateDistrictPages.ts` to get the hashed asset paths (e.g., `/assets/district-page-a1b2c3d4.js`) to inject into the district HTML templates.
        *   Verify base path (`base: '/'`) is correct for GitHub Pages deployment (usually root).
*   [ ] **Step 3.4: Update `.gitignore`**
    *   [ ] Ensure `dist/` covers ignoring the generated district pages. (It should already). 