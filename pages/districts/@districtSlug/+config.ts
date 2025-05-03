import type { Config } from 'vike/types'
// Remove fs and path imports
// import fs from 'fs';
// import path from 'path';

// Import the pre-generated list of slugs from the JSON file
// Vite handles JSON imports directly.
// Add `"resolveJsonModule": true` to tsconfig.json compilerOptions if needed.
import districtSlugs from '../../../public/assets/prerender-slugs.json';

// Remove the loadDistrictsData function
/*
const loadDistrictsData = (): Record<string, { slug: string }> => {
    const filePath = path.resolve(process.cwd(), 'public/assets/districts.json'); // Ensure this path is correct
    try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const districtsData = JSON.parse(fileContent);
        // Ensure the loaded data has the expected structure (object with district objects containing slugs)
        if (typeof districtsData !== 'object' || districtsData === null) {
            throw new Error('Invalid districts.json format: not an object.');
        }
        // Optional: Add further validation if needed
        return districtsData;
    } catch (error) {
        console.error("Failed to load districts.json for prerendering:", error);
        return {}; // Return empty object on error
    }
};
*/

const config = {
    // Enable pre-rendering
    // Temporarily comment out prerender due to Vike bug
    /*
    prerender: () => {
        // Ensure the imported data is an array of strings
        if (!Array.isArray(districtSlugs) || districtSlugs.some(s => typeof s !== 'string')) {
            console.error("[Prerender] Invalid format for imported prerender-slugs.json. Expected string[].");
            return [];
        }

        if (districtSlugs.length === 0) {
            console.warn("No district slugs found in prerender-slugs.json.");
        }
        console.log(`[Prerender] Using ${districtSlugs.length} slugs from prerender-slugs.json.`);

        // Map the imported slugs to the format Vike expects
        return districtSlugs.map(slug => ({ districtSlug: slug })); // Use districtSlug parameter
    }
    */
}
export default config;

// title: 'Unofficial District Details' // Title is set dynamically in +onBeforeRender.ts
// We might need to add onBeforePrerender hook later if Vike
// cannot automatically discover all possible `cdsCode` values
// from the data source to generate all pages during build.