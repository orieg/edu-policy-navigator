// pages/districts/@districtSlug/+onBeforeRender.ts
// Environment: server
// Function runs before page rendering, typically for data fetching.
// See https://vike.dev/onBeforeRender

import type { OnBeforeRenderAsync } from 'vike/types'
import type { DistrictDetails, SchoolsByDistrictMap, DistrictDataMap } from '../../../src/types' // Adjusted path
import fs from 'fs/promises'; // Use promises for async file reading
import path from 'path';

// --- Helper Functions to Load Data & Validate Coords ---

let cachedDistricts: DistrictDataMap | null = null;
let cachedSchools: SchoolsByDistrictMap | null = null;

// Add isValidCoordinate helper (copied from search.ts)
function isValidCoordinate(lat: string | number | null | undefined, lon: string | number | null | undefined): lat is number | string {
    // Basic check: Ensure they are not null/undefined and can be parsed as numbers
    if (lat == null || lon == null) return false;
    // Check for known invalid string values
    const latStr = String(lat).toLowerCase();
    const lonStr = String(lon).toLowerCase();
    if (latStr === 'no data' || lonStr === 'no data' || latStr.includes('redacted') || lonStr.includes('redacted')) {
        return false;
    }
    const latNum = parseFloat(String(lat));
    const lonNum = parseFloat(String(lon));
    return !isNaN(latNum) && !isNaN(lonNum) && latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180;
}

async function loadDistrictData(): Promise<DistrictDataMap> {
    if (cachedDistricts) return cachedDistricts;
    const filePath = path.resolve(process.cwd(), 'public/assets/districts.json');
    console.log(`[onBeforeRender] Loading district data from: ${filePath}`);
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        cachedDistricts = JSON.parse(fileContent);
        return cachedDistricts!;
    } catch (error) {
        console.error("[onBeforeRender] Error loading districts.json:", error);
        throw new Error("Could not load district data."); // Re-throw to fail the render
    }
}

async function loadSchoolsData(): Promise<SchoolsByDistrictMap> {
    if (cachedSchools) return cachedSchools;
    const filePath = path.resolve(process.cwd(), 'public/assets/schools_by_district.json');
    console.log(`[onBeforeRender] Loading schools data from: ${filePath}`);
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        cachedSchools = JSON.parse(fileContent);
        return cachedSchools!;
    } catch (error) {
        console.error("[onBeforeRender] Error loading schools_by_district.json:", error);
        throw new Error("Could not load school data."); // Re-throw to fail the render
    }
}

// --- onBeforeRender Hook ---

const onBeforeRender: OnBeforeRenderAsync = async (pageContext): ReturnType<OnBeforeRenderAsync> => {
    const { districtSlug } = pageContext.routeParams // Get slug from route
    console.log(`[onBeforeRender] Processing slug: ${districtSlug}`);

    if (!districtSlug) {
        // This case shouldn't happen with the current routing but good to check
        console.error('[onBeforeRender] Error: districtSlug parameter missing.');
        throw new Error("District slug missing."); // Or return an error page context
    }

    // Load all district and school data (uses caching)
    const allDistricts = await loadDistrictData();
    const allSchools = await loadSchoolsData();

    // Find the specific district by slug
    const districtData = Object.values(allDistricts).find(
        district => district.slug === districtSlug
    );

    if (!districtData) {
        console.warn(`[onBeforeRender] District not found for slug: ${districtSlug}`);
        // Handle district not found - Vike might automatically show a 404
        // or you can return a specific pageContext to render a custom 404
        // For now, let Vike handle it, but log the warning.
        // throw new Error("District not found."); // Could uncomment to force error page
        return {
            pageContext: {
                pageProps: {
                    district: null,
                    schools: [],
                    description: 'The requested school district could not be found.'
                },
                title: 'District Not Found',
                is404: true
            }
        };
    }

    console.log(`[onBeforeRender] Found district: ${districtData.District} (${districtData['CDS Code']})`);

    // Get schools for this district using its CDS code
    const districtCdsCode = districtData['CDS Code'];
    const rawSchoolsData = allSchools[districtCdsCode.substring(0, 7)] || []; // Use 7-digit prefix
    console.log(`[onBeforeRender] Found ${rawSchoolsData.length} raw schools for district ${districtCdsCode}`);

    // --- Filter Schools Server-Side --- 
    const filteredSchools = rawSchoolsData.filter(school =>
        school.Status === 'Active' &&
        String(school['Public Yes/No']).trim().toUpperCase() === 'Y' &&
        isValidCoordinate(school.Latitude, school.Longitude)
    );
    console.log(`[onBeforeRender] Filtered down to ${filteredSchools.length} active, public schools with coordinates.`);
    // --- End Filter ---

    // Define pageProps including description and FILTERED schools
    const pageProps = {
        district: districtData,
        schools: filteredSchools, // Pass the filtered list
        description: `Information and schools for ${districtData.District} in ${districtData.County || 'California'}. View address, website, grades, and map.`
    };

    return {
        pageContext: {
            pageProps,
            // Only return title here, description is now in pageProps
            title: `${districtData.District} - CA School District Info`
        }
    }
}

export default onBeforeRender; 