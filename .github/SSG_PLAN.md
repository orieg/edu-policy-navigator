# Static Site Generation (SSG) Plan using Eleventy (11ty)

**Goal:** Generate individual static HTML pages for each district using the Eleventy static site generator, linked from a main search/index page, suitable for deployment on platforms like GitHub Pages.

**Reasoning:** The previous manual SSG approach proved complex to manage, especially regarding asset handling and development server integration. Eleventy provides a more robust and standardized framework for this task.

## Phase 1: Eleventy Setup & Configuration

*   **Goal:** Install Eleventy and set up basic configuration.
*   [ ] **Step 1.1: Install Eleventy**
    *   [ ] Run `pnpm add -D @11ty/eleventy`.
*   [ ] **Step 1.2: Create Configuration File**
    *   [ ] Create `.eleventy.js` in the project root.
    *   [ ] Configure input directory (e.g., `src` or a dedicated `11ty_src` directory).
    *   [ ] Configure output directory (e.g., `dist`).
    *   [ ] Configure data directory (e.g., `_data`).
    *   [ ] Configure includes/layouts directory (e.g., `_includes`).
    *   [ ] Choose and configure a templating engine (e.g., Nunjucks `.njk`).

## Phase 2: Data Integration

*   **Goal:** Make district and school data available to Eleventy templates.
*   [ ] **Step 2.1: Create Global Data Files**
    *   [ ] Create directory: `[input_dir]/_data/` (e.g., `src/_data/`).
    *   [ ] Create `[input_dir]/_data/districts.js` that loads and potentially processes `public/assets/districts.json`. It should export the data keyed by CDS code.
    *   [ ] Create `[input_dir]/_data/schoolsByDistrict.js` that loads and potentially processes `public/assets/schools_by_district.json`. It should export data keyed by the 7-digit district prefix.
    *   [ ] (Optional) Consider combining these into a single data file or processing them for easier access in templates.

## Phase 3: Templating & Page Generation

*   **Goal:** Create the templates necessary to generate the district pages.
*   **Note:** It is crucial to replicate the existing UI/UX from the previous dynamic implementation. The final generated pages should look and feel the same, incorporating the info card, school list, and map container structure established earlier.
*   [ ] **Step 3.1: Create Base Layout**
    *   [ ] Create layout file: `[input_dir]/_includes/layout.njk` (or chosen engine).
    *   [ ] Move the common HTML structure (head, header, footer, asset links) from the old template (`pipeline/templates/district_page_template.html`, now deleted, refer to git history if needed) into this layout, ensuring it matches the structure of `public/index.html` where applicable (header, footer).
    *   [ ] Include placeholders for title and main content (`{{ title }}`, `{{ content | safe }}`).
*   [ ] **Step 3.2: Create District Page Template**
    *   [ ] Create file: `[input_dir]/district.njk` (or similar).
    *   [ ] Use Eleventy's pagination feature to iterate over the `districts` data from `_data`.
        *   `pagination.data`: `districts`
        *   `pagination.size`: `1`
        *   `pagination.alias`: `districtItem`
    *   [ ] Define the permalink structure: `/districts/{{ districtItem.key | slugify }}/index.html` (Requires adding a `slugify` filter to Eleventy config).
    *   [ ] Set the layout: `layout: layout.njk`.
    *   [ ] Populate the template content using `districtItem.value` (which holds the district details) and accessing the `schoolsByDistrict` global data (using the first 7 digits of `districtItem.key`).
    *   [ ] Replicate the info card, school list generation (possibly using loops/macros in the chosen templating language), and map container (`<div id="info-map"></div>`) structure precisely to match the previous look.
    *   [ ] Embed necessary data for the client-side map script (using a data attribute or similar, passing `districtItem.value` and filtered schools).
*   [ ] **Step 3.3: Add Slugify Filter**
    *   [ ] Define the `slugify` logic (similar to previous attempts) in `.eleventy.js` using `eleventyConfig.addFilter("slugify", function(...) {...});`.

## Phase 4: Asset Handling

*   **Goal:** Ensure CSS, JavaScript, and static assets (boundaries, Leaflet files) are correctly handled and linked.
*   **Option A (Simpler): 11ty Passthrough Copy**
    *   [ ] Configure `.eleventy.js` to copy static directories (`public/assets`, `public/css`, `public/leaflet`, `src` for JS) directly to the `dist` folder using `addPassthroughCopy`.
    *   [ ] Templates will link directly to these copied paths (e.g., `/assets/boundaries/...`, `/css/style.css`, `/src/district-page.js`).
    *   [ ] Note: This bypasses Vite's bundling/hashing for JS/CSS in the final output.
*   **Option B (More Advanced): Integrate Vite**
    *   [ ] Use a plugin like `vite-plugin-eleventy` or manually coordinate builds.
    *   [ ] Configure Vite to build assets (JS/CSS) with hashing.
    *   [ ] Configure Eleventy to read Vite's manifest file (similar to our previous attempt) to get correct hashed asset paths for templates.
    *   [ ] (Recommended starting point: Option A for simplicity, switch to B if needed).
*   [ ] **Step 4.1: Choose and Implement Asset Strategy** (Start with Option A)
    *   [ ] Add necessary `addPassthroughCopy` calls to `.eleventy.js`.
    *   [ ] Ensure template links point to the expected copied paths in `dist`.

## Phase 5: Script Updates

*   **Goal:** Update `package.json` scripts for the new workflow.
*   [ ] **Step 5.1: Update Build Script**
    *   [ ] Modify `build`: `pnpm run clean && pnpm run prepare && npx @11ty/eleventy`.
*   [ ] **Step 5.2: Update Dev Script**
    *   [ ] Modify `dev`: `pnpm run clean:dev-districts && pnpm run prepare && npx @11ty/eleventy --serve`.
    *   [ ] Remove the `dev:prepare` and `clean:dev-districts` scripts (11ty handles its own output cleaning and serving).
*   [ ] **Step 5.3: Remove Obsolete Scripts/Config**
    *   [ ] Remove `build:ssg` script.
    *   [ ] Consider removing `pipeline/scripts/generateDistrictPages.ts` and `pipeline/templates/district_page_template.html` once 11ty templates are working.
    *   [ ] Adjust Vite config (`vite.config.ts`) if it's no longer needed for building `district-page.ts` (depends on Asset Handling choice).

## Phase 6: Testing & Verification

*   **Goal:** Ensure the generated site works correctly in both dev and production builds.
*   [ ] **Step 6.1: Test Development Server**
    *   [ ] Run `pnpm run dev`.
    *   [ ] Verify main search page loads.
    *   [ ] Verify navigating to `/districts/[slug]/` serves the correct page with content and working map/styles.
    *   [ ] Check browser console for errors.
*   [ ] **Step 6.2: Test Production Build**
    *   [ ] Run `pnpm run build`.
    *   [ ] Inspect the `dist` directory for correct structure and files.
    *   [ ] Use a local static server (e.g., `npx http-server dist`) or `pnpm run preview` (if Vite is still configured for previewing `dist`) to test the built site.
    *   [ ] Verify pages load correctly with hashed assets (if using Vite integration). 