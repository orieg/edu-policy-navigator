# Migration Plan: Vike to Astro (for SSG)

**Goal:** Migrate the project from Vike to Astro to enable robust Static Site Generation (SSG) for all pages, including individual district pages, resolving the Vike build issues and allowing deployment to GitHub Pages.

**Key:**
- [ ] To Do
- [x] Done
- [/] In Progress

---

## Phase 1: Astro Setup & Basic Configuration

- [x] **1.1: Install Astro:**
    - Run `pnpm add astro`.
- [x] **1.2: Create Astro Configuration:**
    - Create `astro.config.mjs` at the project root.
    - Add basic configuration (refer to Astro docs, likely minimal to start). Consider potential Vite config integrations if needed later.
      ```javascript
      import { defineConfig } from 'astro/config';

      // https://astro.build/config
      export default defineConfig({
          // If using Vite plugins shared between Vike and Astro, configure them here.
          // vite: { ... }
      });
      ```
- [x] **1.3: Update `package.json` Scripts:**
    - Modify `scripts` for Astro:
        - `dev`: `"astro dev"` (or keep `pnpm run prepare && astro dev` if data prep is needed)
        - `build`: `"astro build"` (or `pnpm run clean && pnpm run prepare && astro build`)
        - `preview`: `"astro preview"`
    - Remove old Vike-specific script parts if they are replaced by Astro commands.
- [x] **1.4: Add Astro TypeScript Config:**
    - Create `src/env.d.ts` for Astro's environment types:
      ```typescript
      /// <reference types="astro/client" />
      ```
    - Update `tsconfig.json`:
        - Ensure `"extends": "astro/tsconfigs/base"` is present or merge necessary settings.
        - Adjust `include` paths if necessary (`src/**/*`, `astro.config.mjs`).

## Phase 2: Project Restructuring

- [x] **2.1: Create Astro Directories:**
    - Create `src/pages/`
    - Create `src/layouts/`
    - Create `src/components/` (for reusable UI parts, if any)
    - Create `src/styles/`
    - Create `src/scripts/` (for client-side JS)
- [ ] **2.2: Move Existing Code:**
    - Move contents of the current `src/` (like `map.ts`, `search.ts`, `types.ts` etc.) into `src/scripts/`. Update internal imports within these files if needed.
    - Move global CSS (`pages/style.css`) into `src/styles/global.css`.
- [ ] **2.3: Verify `public/` Directory:**
    - Ensure all static assets needed at runtime (JSON data, GeoJSON boundaries, images, Leaflet assets if not bundled) remain in the `public/` directory. Astro serves this directory statically.

## Phase 3: Core Layout & Index Page

- [x] **3.1: Create Base Layout:**
    - Create `src/layouts/BaseLayout.astro`.
    - Replicate the HTML structure from `renderer/+onRenderHtml.ts` (doctype, html, head, body, header, footer, disclaimer).
    - Use Astro's `<slot />` component where the main page content should go.
    - Add props for `title` and `description` to the layout's frontmatter and use them in `<head>`.
    - Import and link the global CSS (`import '../styles/global.css';`).
      ```astro
      ---
      // src/layouts/BaseLayout.astro
      import '../styles/global.css';
      export interface Props {
          title?: string;
          description?: string;
      }
      const {
          title = 'Unofficial California Education Policies Navigator',
          description = 'Explore California K-12 school district data and policies.'
      } = Astro.props;
      ---
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta name="description" content={description} />
          <title>{title}</title>
          <!-- Link Leaflet CSS if not importing via JS -->
          <!-- <link rel="stylesheet" href="/leaflet/leaflet.css" /> -->
      </head>
      <body>
          <header>
              <h1><a href="/">{title}</a></h1>
              <!-- Breadcrumbs might need specific logic per page -->
          </header>
          <div class="disclaimer">
              <strong>Disclaimer:</strong> Data is based on publicly available sources...
          </div>
          <main id="page-view">
              <slot /> <!-- Page content goes here -->
          </main>
          <footer>
              <p>&copy; {new Date().getFullYear()} {title}. All rights reserved.</p>
          </footer>
          <!-- Leaflet JS if not importing via JS -->
          <!-- <script src="/leaflet/leaflet.js"></script> -->
          <!-- Client-side scripts specific to pages will be added in those pages -->
      </body>
      </html>
      ```
- [x] **3.2: Migrate Index Page:**
    - Create `src/pages/index.astro`.
    - Use the `BaseLayout`.
    - Fetch any necessary data (like for search initialization) in the frontmatter (similar logic to `pages/index/+onBeforeRender.ts`).
    - Include the search input HTML structure.
    - Add client-side script (`<script>`) to initialize search (see Phase 5).
      ```astro
      ---
      // src/pages/index.astro
      import BaseLayout from '../layouts/BaseLayout.astro';
      // Fetch initial data if needed
      const pageTitle = "Unofficial California Education Policies Navigator";
      const pageDescription = "Explore California K-12 school district data and policies.";
      ---
      <BaseLayout title={pageTitle} description={pageDescription}>
          <h1>Welcome!</h1>
          <div class="search-container">
              <input type="search" id="district-search" placeholder="Search districts..." />
              <ul id="search-results" hidden></ul>
          </div>
          <div id="info-display">
              <!-- District info will be loaded here or on district pages -->
          </div>
          <div id="map-container">
              <!-- Map might be initialized here or on district pages -->
              <div id="map">Loading Map...</div>
          </div>
      </BaseLayout>

      <script>
          // Import and run search setup
          import { setupSearchHandlers } from '../scripts/search';
          // Import and run map setup if needed on index
          // import { initializeMap } from '../scripts/map';

          // Pass fetched data if needed, e.g., via data attributes or inline JSON
          setupSearchHandlers();
          // initializeMap();
      </script>
      ```

## Phase 4: District Page Generation (SSG)

- [x] **4.1: Create Dynamic District Page:**
    - Create `src/pages/districts/[districtSlug].astro`. (The `[...]` denotes a dynamic route parameter).
- [x] **4.2: Implement `getStaticPaths`:**
    - In the frontmatter of `src/pages/districts/[districtSlug].astro`, define and export `getStaticPaths`.
    - This function will replace `+onBeforePrerenderStart.ts`.
    - Load the district slugs from `public/assets/prerender-params.json`.
- [x] **4.3: Implement Data Loading & Prop Passing (via `getStaticPaths`):**
    - In the frontmatter of `src/pages/districts/[districtSlug].astro`, define and export `getStaticProps`.
    - This function will replace `+onBeforeRender.ts`.
    - Load the data for the specific district based on the `districtSlug` parameter.
    - Return an object containing the `props` for the page template.
      ```astro
      ---
      // src/pages/districts/[districtSlug].astro
      import fs from 'node:fs/promises'; // Use Node fs for data loading at build time
      import path from 'node:path';
      import BaseLayout from '../../layouts/BaseLayout.astro';
      import type { DistrictDetails, SchoolsByDistrictMap, DistrictDataMap, SchoolDetails } from '../../scripts/types'; // Added SchoolDetails
      // Import helper functions if needed (isValidCoordinate, loadDistrictData, etc.)
      // Make sure helper paths are updated e.g., from '../../scripts/dataUtils' // Define loadDistrictData and loadSchoolsData helpers, or import them
      async function loadDistrictData(): Promise<DistrictDataMap> {
          const filePath = path.resolve(process.cwd(), 'public/assets/districts.json');
          try {
              const fileContent = await fs.readFile(filePath, 'utf-8');
              return JSON.parse(fileContent);
          } catch (error) {
              console.error("Error loading districts.json:", error);
              throw new Error("Could not load district data.");
          }
      }
      async function loadSchoolsData(): Promise<SchoolsByDistrictMap> {
         const filePath = path.resolve(process.cwd(), 'public/assets/schools_by_district.json');
         try {
             const fileContent = await fs.readFile(filePath, 'utf-8');
             return JSON.parse(fileContent);
         } catch (error) {
             console.error("Error loading schools_by_district.json:", error);
             throw new Error("Could not load schools data.");
         }
      }
      // Example isValidCoordinate (ensure it's defined or imported)
      function isValidCoordinate(lat: string | number | null | undefined, lon: string | number | null | undefined): lat is number | string {
          if (lat == null || lon == null) return false;
          const latStr = String(lat).toLowerCase();
          const lonStr = String(lon).toLowerCase();
          if (latStr === 'no data' || lonStr === 'no data' || latStr.includes('redacted') || lonStr.includes('redacted')) return false;
          const latNum = parseFloat(String(lat));
          const lonNum = parseFloat(String(lon));
          return !isNaN(latNum) && !isNaN(lonNum) && latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180;
      }


      // Define expected props passed from getStaticPaths
      export interface Props {
        district: DistrictDetails;
        schools: SchoolDetails[]; // Assuming schools are also fetched in getStaticPaths
      }

      // Astro function to generate static paths
      export async function getStaticPaths() {
          const paramsPath = path.resolve(process.cwd(), 'public/assets/prerender-params.json');
          const paramsData = await fs.readFile(paramsPath, 'utf-8');
          const prerenderParams = JSON.parse(paramsData);

          // Optional: Pre-load all district/school data here to pass as props
          const allDistricts = await loadDistrictData(); // Assuming loadDistrictData reads districts.json
          const allSchools = await loadSchoolsData(); // Assuming loadSchoolsData reads schools_by_district.json

          return prerenderParams.map((param) => {
              const districtSlug = param.districtSlug;
              const districtData = Object.values(allDistricts).find(d => d.slug === districtSlug);

              if (!districtData) {
                  console.warn(`[getStaticPaths] District not found for slug: ${districtSlug}. Skipping page.`);
                  return null; // Or handle differently
              }

              const districtCdsCode = districtData['CDS Code'];
              // Ensure CDS Code exists before substring
              const rawSchoolsData = districtCdsCode ? (allSchools[districtCdsCode.substring(0, 7)] || []) : [];
              // Add your filtering logic here
              const filteredSchools = rawSchoolsData.filter(school =>
                  school.Status === 'Active' &&
                  String(school['Public Yes/No']).trim().toUpperCase() === 'Y' &&
                  isValidCoordinate(school.Latitude, school.Longitude)
               );

              return {
                  params: { districtSlug: districtSlug },
                  props: {
                      district: districtData,
                      schools: filteredSchools,
                  },
              };
          }).filter(Boolean); // Remove null entries for districts not found
      }

      // Get props passed from getStaticPaths
      const { district, schools } = Astro.props;
      const districtName = district.District || 'Unknown District';
      const districtCdsCode = district['CDS Code'] || 'unknown';
      const pageTitle = `${districtName} - District Details`;
      const pageDescription = `Information and schools for ${districtName}.`;

      // Function to generate HTML for the district page (similar to +Page.ts)
      // Could be moved to a component: src/components/DistrictInfo.astro
      // Make sure formatAddress and formatWebsiteLink are defined or imported
        const formatAddress = (street: string, city: string, state: string, zip: string): string => {
            const parts = [street, city, state, zip].filter(p => p && p !== 'No Data');
            if (parts.length >= 3) return `${parts[0]}, ${parts[1]}, ${parts[2]} ${parts[3] || ''}`.trim();
            if (parts.length === 2) return `${parts[0]}, ${parts[1]}`;
            return parts[0] || 'Address Not Available';
        }
        const formatWebsiteLink = (url: string): string => {
            if (!url || url === 'No Data') return 'Website Not Available';
            let href = url.trim();
            if (href.includes('.') && !href.startsWith('http') && !href.startsWith('//')) {
            href = `//${href}`;
            }
            // Use html escape for attributes potentially? For now, direct string.
            // Using Astro's attribute syntax handles escaping: <a href={href} ...>
            // If generating raw HTML string, manual escaping might be needed for robustness.
            return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`; // Keep as string for set:html
        }

      function renderDistrictInfo(district: DistrictDetails, schools: SchoolDetails[]) {
            const cdsCode = (district && district['CDS Code']) || 'unknown';
            if (!district) {
                return `<p>District data not found for CDS Code: ${cdsCode}</p>`
            }

            const districtAddress = formatAddress(district['Street Address'], district['Street City'], district['Street State'], district['Street Zip']);
            const gradeSpan = (district['Low Grade'] && district['High Grade'] && district['Low Grade'] !== 'No Data' && district['High Grade'] !== 'No Data') ? `${district['Low Grade']} - ${district['High Grade']}` : 'N/A';
            const dashboardLink = `https://www.caschooldashboard.org/reports/gissearch/districts/${cdsCode}`;
            const cdeProfileLink = `https://www.cde.ca.gov/schooldirectory/details?cdscode=${cdsCode}`;

            let schoolsHtml = '<p>No active, public schools found matching criteria for this district.</p>';
            if (schools && schools.length > 0) {
                schoolsHtml = '<ul class="school-list">';
                schools.forEach((school: SchoolDetails) => { // Use SchoolDetails type
                const schoolCds = school['CDS Code'];
                const schoolGradeSpan = (school['Low Grade'] && school['High Grade'] && school['Low Grade'] !== 'No Data' && school['High Grade'] !== 'No Data') ? `(${school['Low Grade']} - ${school['High Grade']})` : '';
                const schoolAddress = formatAddress(school['Street Address'], school['Street City'], school['Street State'], school['Street Zip']);
                const schoolWebsiteLink = formatWebsiteLink(school.Website);
                const schoolDashboardLink = `https://www.caschooldashboard.org/reports/gissearch/schools/${schoolCds}`;
                const schoolCdeLink = `https://www.cde.ca.gov/schooldirectory/details?cdscode=${schoolCds}`;

                schoolsHtml += `
                    <li key="${schoolCds}">
                    <div class="school-name-grades">
                        <strong>${school.School || 'Unknown School'}</strong> ${schoolGradeSpan}
                    </div>
                    <div class="school-links">
                        <a href="${schoolDashboardLink}" target="_blank" rel="noopener noreferrer">Dashboard</a> |
                        <a href="${schoolCdeLink}" target="_blank" rel="noopener noreferrer">CDE Profile</a> |
                        ${schoolWebsiteLink}
                    </div>
                    <div class="school-address">
                        ${schoolAddress}
                    </div>
                    </li>
                `;
                });
                schoolsHtml += '</ul>';
            }

            return `
                <article class="district-page" data-cds-code="${cdsCode}">
                <div class="district-top-row">
                <div class="info-card">
                    <h2>${district.District || 'Unknown District'}</h2>
                    <div class="district-links">
                        <a href="${dashboardLink}" target="_blank" rel="noopener noreferrer">Dashboard</a> |
                        <a href="${cdeProfileLink}" target="_blank" rel="noopener noreferrer">CDE Profile</a> |
                        ${formatWebsiteLink(district.Website)}
                    </div>
                    <p><strong>Status:</strong> ${district.Status || 'N/A'}</p>
                    <p><strong>Type:</strong> ${district['Entity Type'] || 'N/A'}</p>
                    <p><strong>Grades:</strong> ${gradeSpan}</p>
                    <p><strong>Address:</strong> ${districtAddress}</p>
                    <p><strong>Phone:</strong> ${district.Phone || 'N/A'}</p>
                </div>

                    <div class="district-map-container">
                <div id="info-map-${cdsCode}">Loading Map...</div>
                    </div>
                </div>

                <div class="school-list-section">
                    <h3>Schools in District (${schools?.length || 0})</h3>
                    ${schoolsHtml}
                </div>
                </article>
            `;
      }

      const districtHtml = renderDistrictInfo(district, schools);
      ---
      <BaseLayout title={pageTitle} description={pageDescription}>
          <!-- Use Astro's set:html directive to render the HTML string -->
          <Fragment set:html={districtHtml} />

          <!-- Add client-side script for map initialization -->
          <script define:vars={{ districtData: district, schoolsData: schools }}>
              import { updateMapForDistrict } from '../../scripts/map';

              // districtData and schoolsData are passed from define:vars
              const mapElementId = `info-map-${districtData['CDS Code']}`;
              const mapElement = document.getElementById(mapElementId);

              if (mapElement) {
                  // Ensure Leaflet CSS is loaded (either globally via layout or imported here)
                  // import 'leaflet/dist/leaflet.css';
                  updateMapForDistrict(mapElementId, districtData, schoolsData);
              } else {
                  console.error(`Map element #${mapElementId} not found.`);
              }
          </script>
      </BaseLayout>
      ```

## Phase 5: Client-Side Script Integration

- [x] **5.1: Adapt Map Initialization:**
    - Modify `src/scripts/map.ts` (`updateMapForDistrict`).
    - Ensure it can be called from Astro page `<script>` tags.
    - Pass necessary data (`districtData`, `schoolsData`, `mapElementId`) using `define:vars` in the `<script>` tag as shown above.
    - Ensure Leaflet library and CSS are loaded (either via global layout or imported directly in the script).
- [x] **5.2: Adapt Search Initialization:**
    - Modify `src/scripts/search.ts` (`setupSearchHandlers`).
    - Ensure it's called from the index page (`src/pages/index.astro`) script tag.
    - Make sure it correctly fetches necessary data (`districts.json`, `schools_by_district.json`) relative to the `public/` directory (e.g., `fetch('/assets/districts.json')`).
    - Update the navigation logic in `selectDistrict` to use standard `window.location.href` pointing to the static paths (e.g., `/districts/${slug}`).
- [x] **5.3: Handle Other Client-Side JS:**
    - Review any other JS initialization logic that was in `renderer/+onRenderClient.ts` and integrate it into the relevant Astro page or component scripts.

## Phase 6: Testing & Refinement

- [x] **6.1: Test Development Server:**
    - Run `pnpm run dev`.
    - Verify the index page loads and search/map components initialize (if included on index).
    - Navigate to a few district pages and verify content, layout, and map functionality.
    - Debug any console errors or rendering issues.
- [x] **6.2: Test Production Build:**
    - Run `pnpm run build`.
    - Check the output in the `dist/` folder. Ensure `dist/index.html` and `dist/districts/[districtSlug]/index.html` files are generated.
    - Verify the build command completes without errors.
- [ ] **6.3: Test Built Site Locally:**
    - Run `pnpm run preview`.
    - Open the preview URL.

## Phase 7: Cleanup

- [ ] **7.1: Remove Vike Files & Dependencies:**
    - Delete the old `pages/` directory (Vike structure).
    - Delete the `renderer/` directory.
    - Delete `types/vike.d.ts`.
    - Run `pnpm remove vike vike-types` (or similar, check exact package names).
    - Remove Vike plugin from `vite.config.ts` if it exists and isn't needed by Astro's Vite integration.
- [ ] **7.2: Remove Old Configs/Scripts:**
    - Clean up any leftover configuration or scripts related solely to Vike.

--- 