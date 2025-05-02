import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync'; // Using sync for simplicity in a build script

// --- Configuration ---
const INPUT_CSV_FILENAME = 'School and District Data.csv';
const OUTPUT_JSON_FILENAME = 'districts.json';

// Input path should point to where convertXlsxToCsv script writes the file
const INPUT_CSV_PATH = path.resolve(process.cwd(), 'dist', 'pipeline', 'data', INPUT_CSV_FILENAME);
// Output path for the final JSON remains in public/assets
const OUTPUT_JSON_DIR = path.resolve(process.cwd(), 'public', 'assets');
const OUTPUT_JSON_PATH = path.join(OUTPUT_JSON_DIR, OUTPUT_JSON_FILENAME);

// Define columns we want to keep for the frontend display
const COLUMNS_TO_KEEP = [
    'CDS Code', 'County', 'District', 'Status', 'Open Date',
    'Charter Yes/No', 'Funding Type', 'Entity Type', 'Low Grade',
    'High Grade', 'Virtual Instruction Type', 'Website', 'Latitude', 'Longitude',
    'Street Address', 'Street City', 'Street State', 'Street Zip',
    'Mailing Address', 'Mailing City', 'Mailing State', 'Mailing Zip', 'Phone'
];

// !! IMPORTANT: Verify these column names match your actual CSV header !!
const DISTRICT_NAME_COLUMN = 'District';
const DISTRICT_ID_COLUMN = 'CDS Code';
const ENTITY_TYPE_COLUMN = 'Entity Type';
// ---

// New interface for the output structure
interface DistrictDetails {
    [key: string]: string | number | null; // Allow any relevant key from CSV
}

interface DistrictDataMap {
    [id: string]: DistrictDetails;
}

function generateDistrictJson(): void {
    console.log(`Reading input CSV: ${INPUT_CSV_PATH}`);
    if (!fs.existsSync(INPUT_CSV_PATH)) {
        console.error(`Error: Input CSV not found at ${INPUT_CSV_PATH}. Did you run 'pnpm run convert:xlsx'?`);
        process.exit(1);
    }

    try {
        const csvContent = fs.readFileSync(INPUT_CSV_PATH, { encoding: 'utf8' });

        // Explicitly define headers based on user input
        const headers = [
            'Record Type', 'CDS Code', 'Federal District ID', 'Federal School ID', 'Federal Charter District ID', 'County', 'District', 'School', 'Status', 'Open Date', 'Closed Date', 'Charter Yes/No', 'Charter Number', 'Funding Type', 'Educational Program Type', 'Entity Type', 'Low Grade', 'High Grade', 'Virtual Instruction Type', 'Magnet Yes/No', 'Year Round Yes/No', 'Public Yes/No', 'Multilingual Yes/No', 'Website', 'Latitude', 'Longitude', 'Last Update', 'Street Address', 'Street City', 'Street State', 'Street Zip', 'Mailing Address', 'Mailing City', 'Mailing State', 'Mailing Zip', 'Phone', 'Phone Extension', 'Fax Number', 'Administrator Name', 'Administrator Phone', 'Administrator Phone Ext.'
        ];

        const records = parse(csvContent, {
            columns: headers,
            skip_empty_lines: true,
            trim: true,
            from_line: 5 // Skip the first 4 lines, headers are defined above
        });

        // Change to map structure
        const districtsMap: DistrictDataMap = {};

        console.log(`Processing ${records.length} rows...`);

        // Check if expected columns exist as keys on the first record
        if (records.length > 0 && (!(DISTRICT_ID_COLUMN in records[0]) || !(DISTRICT_NAME_COLUMN in records[0]) || !(ENTITY_TYPE_COLUMN in records[0]))) {
            console.error(`Error: Parser did not create expected keys ('${DISTRICT_ID_COLUMN}', '${DISTRICT_NAME_COLUMN}', '${ENTITY_TYPE_COLUMN}') on the first record object.`);
            console.log("Keys found on first record:", Object.keys(records[0])); // Log keys again for comparison
            process.exit(1);
        }

        let processedCount = 0;
        for (const record of records) {
            const districtId = record[DISTRICT_ID_COLUMN];
            const districtName = record[DISTRICT_NAME_COLUMN];
            const entityType = record[ENTITY_TYPE_COLUMN];

            // Filter for unique districts/COEs
            if (districtId && districtName && entityType && (entityType.includes('District') || entityType.includes('County Office')) && !districtsMap[districtId]) {
                const details: DistrictDetails = {};
                COLUMNS_TO_KEEP.forEach(col => {
                    if (record[col] !== undefined && record[col] !== '') {
                        details[col] = record[col];
                    }
                });
                // Ensure the primary ID and Name are always present if the row matched
                details[DISTRICT_ID_COLUMN] = districtId;
                details[DISTRICT_NAME_COLUMN] = districtName;

                districtsMap[districtId] = details;
                processedCount++;
            }
        }

        // // No need to sort the map itself, frontend can sort the names for display
        // districts.sort((a, b) => a.name.localeCompare(b.name));

        if (!fs.existsSync(OUTPUT_JSON_DIR)) {
            console.log(`Creating output directory: ${OUTPUT_JSON_DIR}`);
            fs.mkdirSync(OUTPUT_JSON_DIR, { recursive: true });
        }

        fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(districtsMap, null, 2));
        console.log(`Successfully wrote details for ${processedCount} unique districts/COEs to ${OUTPUT_JSON_PATH}`);

    } catch (error) {
        console.error(`Error processing CSV or writing JSON:`, error);
        process.exit(1);
    }
}

generateDistrictJson(); 