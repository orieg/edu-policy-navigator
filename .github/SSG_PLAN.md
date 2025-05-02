# Static Site Generation (SSG) Plan using Hugo & Vite

**Goal:** Generate individual static HTML pages for each California school district using the Hugo static site generator, integrated with Vite for JavaScript/CSS bundling and development. This approach aims for simplicity while leveraging Hugo's speed for content generation and Vite's modern frontend tooling.

**Reasoning:** Previous attempts with manual scripts and Eleventy encountered complexities. Hugo is known for its performance and content management capabilities, while `vite-hugo-plugin` simplifies the integration with Vite's development server and asset bundling.

## Phase 1: Setup & Configuration

*   **Goal:** Install Hugo, configure Vite with `vite-hugo-plugin`, and establish project structure.
*   [ ] **Step 1.1: Install Hugo**
    *   [ ] Follow official Hugo installation instructions for your OS (e.g., `brew install hugo` on macOS). Verify installation with `hugo version`.
*   [ ] **Step 1.2: Install Vite Hugo Plugin**
    *   [ ] Run `pnpm add -D vite-hugo-plugin`.
*   [ ] **Step 1.3: Configure Vite**
    *   [ ] Update `vite.config.ts`.
    *   [ ] Import `hugoPlugin` from `vite-hugo-plugin`.
    *   [ ] Add `hugoPlugin()` to the `plugins` array. Configure `appDir` (project root) and `hugoOutDir` (Hugo's publish directory, default `public`).
    *   [ ] Ensure Vite's `build.outDir` is set appropriately (e.g., `dist` or `public/dist`) to avoid conflicts with Hugo's output. The plugin handles coordination.
    *   [ ] *Note: The `vite-hugo-plugin` aims to manage the Hugo process within the Vite dev server (`pnpm run dev`), simplifying development builds.*
*   [ ] **Step 1.4: Establish Hugo Project Structure**
    *   [ ] Create standard Hugo directories:
        *   `content/`: For Markdown content files (if any). District data will likely be handled as Data Templates.
        *   `data/`: For data files (JSON, YAML, TOML). Our processed district/school JSON will go here.
        *   `layouts/`: For Hugo HTML templates (.html).
        *   `static/`: For static assets Hugo should copy directly (e.g., large pre-processed files, maybe boundaries).
        *   `assets/`: For assets processed by Hugo Pipes (or potentially by Vite if configured). We'll primarily use Vite for JS/CSS.
    *   [ ] Create Hugo config file (`hugo.toml` or `hugo.yaml`). Define `baseURL`, `title`, etc. Set `publishDir = "public"` (or match `hugoOutDir` in Vite config).
    *   [ ] **Permalink Strategy:** Configure Hugo's permalinks in `hugo.toml` or define output paths within the template logic to create `/districts/{CDS_CODE}/index.html`. This might involve creating dummy content files or using specific layout types. Research Hugo Data Templates for the best approach.
    *   [ ] *Research Hugo Data Templates (see [Hugo Docs: Data Templates](https://gohugo.io/templates/data-templates/)) for the best approach to generate pages from `data/districts.json`.*
    *   [ ] *Research Hugo permalink options (see [Hugo Docs: Permalinks](https://gohugo.io/content-management/urls/#permalinks)) or headless bundles for creating the desired URL structure.*
    *   [ ] Embed necessary data for the client-side script (map, schools) into the HTML (e.g., data attributes).

## Phase 2: Data Integration

*   **Goal:** Make district and school data accessible to Hugo templates.
*   [ ] **Step 2.1: Place Processed Data**
    *   [ ] Ensure the `prepare` script (`pipeline/scripts/generateDistrictJson.ts`) outputs `districts.json` and `schools_by_district.json` into the Hugo `data/` directory (e.g., `data/districts.json`, `data/schools.json`).
    *   [ ] Update `pipeline/scripts/generateDistrictJson.ts` output paths if necessary.

## Phase 3: Templating & Page Generation (Hugo)**

*   **Goal:** Create Hugo templates to generate district pages using the data files.
*   [ ] **Step 3.1: Create Base Layout**
    *   [ ] Create Hugo base layout: `layouts/_default/baseof.html`.
    *   [ ] Define common HTML structure (head, header, footer). Include blocks for `title` and `main` content.
    *   [ ] **Crucially:** Link to Vite-processed CSS and JS using Hugo's `resources.Get` and potentially reading Vite's manifest file for hashed filenames in production builds. The `vite-hugo-plugin` *might* assist with this, or manual setup might be needed. Start simple, linking to expected dev paths first.
*   [ ] **Step 3.2: Create District List/Index Page (Optional)**
    *   [ ] Create `layouts/index.html` to list districts or provide search functionality.
*   [ ] **Step 3.3: Create District Single Page Template**
    *   [ ] Hugo generates pages based on content files or data. We'll use a Data Template approach.
    *   [ ] Create `layouts/_default/list.html` or a custom layout that ranges over the data.
    *   [ ] Use Hugo's `range` function to iterate over `site.Data.districts`.
    *   [ ] For each district, generate the HTML structure (info card, school list placeholder, map placeholder) using the district data (`{{ .Value }}`) and accessing school data (`{{ index site.Data.schools (.Key | substr 0 7) }}`).
    *   [ ] **Permalink Strategy:** Configure Hugo's permalinks in `hugo.toml` or define output paths within the template logic to create `/districts/{CDS_CODE}/index.html`. This might involve creating dummy content files or using specific layout types. Research Hugo Data Templates for the best approach.
    *   [ ] Embed necessary data for the client-side script (map, schools) into the HTML (e.g., data attributes).

## Phase 4: Asset Handling & JS Library (Vite)**

*   **Goal:** Use Vite to bundle JavaScript (TypeScript), CSS, and other frontend assets.
*   [ ] **Step 4.1: Configure Vite Entry Points**
    *   [ ] Define entry points in `vite.config.ts` for main JS/CSS (e.g., `src/main.ts`, `src/style.css`).
    *   [ ] Ensure `src/` contains the TypeScript code for the map, navigation, chatbot, etc.
*   [ ] **Step 4.2: Link Assets in Hugo Templates**
    *   [ ] In `layouts/_default/baseof.html`, link to the Vite entry CSS and JS.
    *   [ ] **Development:** Links might be direct (e.g., `/src/main.ts`). Vite dev server handles this via the plugin.
    *   [ ] **Production:** Need to link to the hashed, bundled files in Vite's output directory. This requires reading `manifest.json` generated by `vite build`. Hugo templates need logic to find the correct filenames. (Example: Check `vite-hugo-plugin` docs or Hugo forums for manifest integration techniques).
    *   [ ] *This production linking often involves creating a Hugo partial template to read `manifest.json`.*
*   [ ] **Step 4.3: Handle Static Assets (Boundaries, etc.)**
    *   [ ] Place large, static assets not processed by Vite (like GeoJSON boundaries) in Hugo's `static/` directory. Hugo will copy them directly to `public/`.
    *   [ ] Link to these from templates or JS using their final path (e.g., `/assets/boundaries/...`).

## Phase 5: Script Updates**

*   **Goal:** Update `package.json` scripts for the Hugo + Vite workflow.
*   [ ] **Step 5.1: Update/Create Dev Script**
    *   [ ] `dev`: `vite` (The `vite-hugo-plugin` should trigger Hugo builds within the Vite dev server).
*   [ ] **Step 5.2: Update/Create Build Script**
    *   [ ] `build`: `pnpm run clean && pnpm run prepare && hugo --minify && vite build` (Run Hugo first, then Vite build. Order might depend on manifest generation/reading).
    *   [ ] Adjust `clean` script to remove Hugo's `public` and potentially Vite's `dist` folder.
*   [ ] **Step 5.3: Add Prepare Script (if needed)**
    *   [ ] Ensure `prepare` script (`pnpm run build:data`) correctly generates JSON into Hugo's `data/` directory.
    *   [ ] `prepare`: `pnpm run build:data` (Assuming `build:data` calls `generateDistrictJson.ts`).

## Phase 6: Testing & Verification**

*   **Goal:** Ensure the site works correctly in dev and production.
*   [ ] **Step 6.1: Test Development Server**
    *   [ ] Run `pnpm run dev`.
    *   [ ] Verify Hugo pages are generated and served correctly by Vite.
    *   [ ] Check JS/CSS are loaded and functional (HMR should work).
    *   [ ] Test navigation to a district page.
*   [ ] **Step 6.2: Test Production Build**
    *   [ ] Run `pnpm run build`.
    *   [ ] Inspect Hugo's output (`public/`) and Vite's output (e.g., `public/dist/`).
    *   [ ] Verify HTML links to correctly hashed JS/CSS bundles.
    *   [ ] Use a local static server (`npx http-server public`) to test the final site. 