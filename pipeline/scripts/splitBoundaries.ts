import * as fs from 'fs';
import * as path from 'path';
import { Feature, FeatureCollection, GeoJsonObject } from 'geojson';

// --- Configuration ---
const INPUT_GEOJSON_FILENAME = 'DistrictAreas2324_-3875917646802882317.geojson'; // Updated filename

// Path to the input file in the project root
const INPUT_GEOJSON_PATH = path.resolve(process.cwd(), INPUT_GEOJSON_FILENAME);
// Output directory for individual boundary files
const OUTPUT_DIR = path.resolve(process.cwd(), 'public', 'assets', 'boundaries');

// !! IMPORTANT: Verify this property name matches your actual GeoJSON !!
const DISTRICT_ID_PROPERTY = 'CDSCode'; // Or CDScode, CDS_CODE, GEOID etc.
// ---

function splitBoundaries(): void {
    console.log(`Reading input GeoJSON: ${INPUT_GEOJSON_PATH}`);
    if (!fs.existsSync(INPUT_GEOJSON_PATH)) {
        console.error(`Error: Input GeoJSON not found at ${INPUT_GEOJSON_PATH}. Please download it first.`);
        process.exit(1);
    }

    try {
        const geoJsonContent = fs.readFileSync(INPUT_GEOJSON_PATH, { encoding: 'utf8' });
        const fullFeatureCollection = JSON.parse(geoJsonContent) as FeatureCollection;

        if (fullFeatureCollection.type !== 'FeatureCollection' || !Array.isArray(fullFeatureCollection.features)) {
            console.error('Error: Input file is not a valid GeoJSON FeatureCollection.');
            process.exit(1);
        }

        if (!fs.existsSync(OUTPUT_DIR)) {
            console.log(`Creating output directory: ${OUTPUT_DIR}`);
            fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        }

        let count = 0;
        for (const feature of fullFeatureCollection.features) {
            const districtId = feature.properties?.[DISTRICT_ID_PROPERTY];

            if (!districtId) {
                console.warn('Skipping feature without a valid ID property:', feature.properties);
                continue;
            }

            // Create a new GeoJSON object containing only this single feature
            // While just saving the feature might work, wrapping it makes it valid standalone GeoJSON
            const singleFeatureGeoJson: Feature = {
                type: 'Feature',
                properties: feature.properties,
                geometry: feature.geometry
            };

            // Sanitize ID for filename if necessary (replace slashes, etc.) - Basic example
            const filename = `${String(districtId).replace(/[^a-zA-Z0-9_-]/g, '_')}.geojson`;
            const outputFilePath = path.join(OUTPUT_DIR, filename);

            try {
                fs.writeFileSync(outputFilePath, JSON.stringify(singleFeatureGeoJson)); // No pretty print for smaller size
                count++;
                if (count % 100 === 0) {
                    process.stdout.write(`.`); // Progress indicator
                }
            } catch (writeError) {
                console.error(`\nError writing file ${outputFilePath}:`, writeError);
            }
        }

        console.log(`\nSuccessfully split and wrote ${count} district boundary files to ${OUTPUT_DIR}`);

    } catch (error) {
        console.error(`Error processing GeoJSON:`, error);
        process.exit(1);
    }
}

splitBoundaries(); 