import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';

// --- Configuration ---
const SOURCE_CSV_FILENAME = 'School and District Data.csv'; // Adjust if your CSV name is different
const INPUT_CSV_PATH = path.resolve(process.cwd(), 'dist', 'pipeline', 'data', SOURCE_CSV_FILENAME);
const OUTPUT_DISTRICTS_JSON_PATH = path.resolve(process.cwd(), 'public', 'assets', 'districts.json');
const OUTPUT_SCHOOLS_JSON_PATH = path.resolve(process.cwd(), 'public', 'assets', 'schools_by_district.json');
const OUTPUT_SLUGS_JSON_PATH = path.resolve(process.cwd(), 'public', 'assets', 'prerender-slugs.json');
const OUTPUT_DIR = path.dirname(OUTPUT_DISTRICTS_JSON_PATH);

// Columns to extract for the final JSON output
const DISTRICT_COLUMNS_TO_KEEP: string[] = [
    'CDS Code',
    'District',
    'County',
    'Status',
    'Entity Type',
    'Funding Type',
    'Street Address',
    'Street City',
    'Street State',
    'Street Zip',
    'Phone',
    'Website',
    'Low Grade',
    'High Grade',
    'Latitude',
    'Longitude'
];

const SCHOOL_COLUMNS_TO_KEEP: string[] = [
    'CDS Code',
    'School',
    'Street Address',
    'Street City',
    'Street State',
    'Street Zip',
    'Phone',
    'Website',
    'Low Grade',
    'High Grade',
    'Status',
    'Public Yes/No',
    'Educational Program Type',
    'Latitude',
    'Longitude'
];

// Define the expected CSV Headers based on the source structure
const CSV_HEADERS: string[] = [
    'Record Type', 'CDS Code', 'Federal District ID', 'Federal School ID', 'Federal Charter District ID', 'County', 'District', 'School', 'Status', 'Open Date', 'Closed Date', 'Charter Yes/No', 'Charter Number', 'Funding Type', 'Educational Program Type', 'Entity Type', 'Low Grade', 'High Grade', 'Virtual Instruction Type', 'Magnet Yes/No', 'Year Round Yes/No', 'Public Yes/No', 'Multilingual Yes/No', 'Website', 'Latitude', 'Longitude', 'Last Update', 'Street Address', 'Street City', 'Street State', 'Street Zip', 'Mailing Address', 'Mailing City', 'Mailing State', 'Mailing Zip', 'Phone', 'Phone Extension', 'Fax Number', 'Administrator Name', 'Administrator Phone', 'Administrator Phone Ext.'
];

// --- Helper Function for Slug Generation ---
function generateSlug(name: string, cdsCode: string): string {
    if (!name || name === 'No Data' || !cdsCode) {
        // Fallback to just CDS code if name is invalid
        return cdsCode;
    }
    const safeName = name
        .toLowerCase()
        .replace(/\s+/g, '-')       // Replace spaces with hyphens
        .replace(/[^-a-z0-9]/g, '') // Remove non-alphanumeric or hyphen characters
        .replace(/-+/g, '-')         // Replace multiple hyphens with single
        .replace(/^-|-$/g, '');      // Trim leading/trailing hyphens

    // Handle edge case where name becomes empty after sanitization
    return safeName ? `${safeName}-${cdsCode}` : cdsCode;
}

// --- Main Function ---
async function generateJsonData() {
    console.log(`Starting data generation from: ${INPUT_CSV_PATH}`);

    if (!fs.existsSync(INPUT_CSV_PATH)) {
        console.error(`Error: Input CSV file not found at ${INPUT_CSV_PATH}`);
        console.error('Please ensure you have run the XLSX to CSV conversion first.');
        process.exit(1);
    }

    const fileContent = fs.readFileSync(INPUT_CSV_PATH, { encoding: 'utf8' });

    const districtsData: { [key: string]: any } = {};
    const schoolsByDistrictData: { [key: string]: any[] } = {};
    let recordCount = 0;
    let districtCount = 0;
    let schoolCount = 0;
    let processedRecordCount = 0; // Count records after skipping metadata

    // Wrap parser logic in a Promise
    await new Promise<void>((resolve, reject) => {
        const parser = parse(fileContent, {
            columns: CSV_HEADERS, // Use defined headers
            skip_empty_lines: true,
            trim: true,
            // from_line: 5 // REMOVED - read from start
            skip_records_with_empty_values: true, // Helps ignore potentially empty trailing lines
            // Use on_record to skip the first 4 data rows (assuming row 1 was headers)
            on_record: (record, { lines }) => {
                if (lines <= 4) { // Skip lines 1, 2, 3, 4 (header is line 1, metadata 2-4)
                    return null; // Discard the record
                }
                return record; // Keep the record
            }
        });

        parser.on('readable', () => {
            let record;
            while ((record = parser.read()) !== null) {
                processedRecordCount++;

                const recordType = record['Record Type'];
                const cdsCode = record['CDS Code'];
                if (!cdsCode) {
                    console.warn(`Skipping processed record ${processedRecordCount} due to missing CDS Code.`);
                    continue;
                }

                // Process Districts
                if ((recordType === 'District' || recordType === 'County Office') && !districtsData[cdsCode]) {
                    const districtDetails: { [key: string]: any } = {};
                    DISTRICT_COLUMNS_TO_KEEP.forEach(col => {
                        districtDetails[col] = record[col] !== undefined && record[col] !== null ? record[col] : 'No Data';
                    });

                    // Generate and add the slug
                    districtDetails['slug'] = generateSlug(districtDetails['District'], cdsCode);

                    districtsData[cdsCode] = districtDetails;
                    districtCount++;
                }

                // Process Schools
                if (recordType === 'School') {
                    const schoolDetails: { [key: string]: any } = {};
                    SCHOOL_COLUMNS_TO_KEEP.forEach(col => {
                        schoolDetails[col] = record[col] !== undefined && record[col] !== null ? record[col] : 'No Data';
                    });

                    // --- Correct SRVUSD Website URLs Here --- 
                    let website = schoolDetails.Website as string;
                    if (website && website !== 'No Data') {
                        website = website.trim();
                        const lowerWebsite = website.toLowerCase();
                        if (lowerWebsite.includes('srvusd.net') && lowerWebsite.startsWith('www.')) {
                            // Attempt to remove www. prefix carefully
                            const noPrefix = website.substring(4);
                            console.log(`[DataGen] Correcting SRVUSD URL: ${website} -> ${noPrefix}`);
                            website = noPrefix; // Update the website variable
                        }
                        schoolDetails.Website = website; // Store potentially corrected URL
                    }
                    // --- End URL Correction --- 

                    const districtCdsCode = cdsCode.substring(0, 7);
                    if (districtCdsCode.length === 7) {
                        if (!schoolsByDistrictData[districtCdsCode]) { schoolsByDistrictData[districtCdsCode] = []; }
                        schoolsByDistrictData[districtCdsCode].push(schoolDetails);
                        schoolCount++;
                    } else { console.warn(`Skipping school ${record.School} (CDS: ${cdsCode}) due to invalid district CDS code format.`); }
                }
            }
        });

        parser.on('error', (err) => {
            console.error("Error parsing CSV:", err.message);
            reject(err);
        });

        parser.on('end', () => {
            console.log(`Finished parsing. Total lines processed (excluding header/metadata): ${processedRecordCount}.`);
            console.log(`Found ${districtCount} unique districts/county offices.`);
            console.log(`Found ${schoolCount} schools associated with districts.`);
            resolve();
        });
    }); // End of Promise

    // --- Writing files AFTER parsing is complete --- 
    console.log('Parsing complete. Preparing to write output files...');

    // --- Add logging BEFORE writing --- 
    const districtKeys = Object.keys(districtsData);
    const schoolDistrictKeys = Object.keys(schoolsByDistrictData);
    console.log(`[Debug] districtsData contains ${districtKeys.length} keys.`);
    console.log(`[Debug] schoolsByDistrictData contains ${schoolDistrictKeys.length} keys.`);
    // Optionally log a small sample
    if (districtKeys.length > 0) {
        console.log('[Debug] Sample district entry:', JSON.stringify(districtsData[districtKeys[0]], null, 2));
    }
    if (schoolDistrictKeys.length > 0 && schoolsByDistrictData[schoolDistrictKeys[0]]?.length > 0) { // Add check for empty school array
        console.log('[Debug] Sample school entry:', JSON.stringify(schoolsByDistrictData[schoolDistrictKeys[0]][0], null, 2));
    }
    // --- End logging --- 

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        console.log(`Creating output directory: ${OUTPUT_DIR}`);
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    console.log('Directory checked. Proceeding with file writing...');

    // Extract slugs AFTER processing all districts
    const slugs = Object.values(districtsData).map(d => d.slug).filter(slug => slug);
    console.log(`[DataGen] Extracted ${slugs.length} slugs for prerender list.`);

    // Generate the structured parameters for the new file
    const prerenderParams = slugs.map(slug => ({ districtSlug: slug }));

    const districtsOutputPath = path.join(OUTPUT_DIR, 'districts.json');
    const schoolsOutputPath = path.join(OUTPUT_DIR, 'schools_by_district.json');
    const slugsOutputPath = path.join(OUTPUT_DIR, 'prerender-slugs.json'); // Keep old slugs file for now?
    const paramsOutputPath = path.join(OUTPUT_DIR, 'prerender-params.json'); // Path for the new params file

    try {
        await fsPromises.writeFile(districtsOutputPath, JSON.stringify(districtsData, null, 2));
        console.log(`Successfully wrote district data to: ${districtsOutputPath}`);
        await fsPromises.writeFile(schoolsOutputPath, JSON.stringify(schoolsByDistrictData, null, 2));
        console.log(`Successfully wrote school data to: ${schoolsOutputPath}`);
        await fsPromises.writeFile(slugsOutputPath, JSON.stringify(slugs, null, 2));
        console.log(`Successfully wrote prerender slug list to: ${slugsOutputPath}`);
        await fsPromises.writeFile(paramsOutputPath, JSON.stringify(prerenderParams, null, 2));
        console.log(`Successfully wrote prerender parameter list to: ${paramsOutputPath}`);
    } catch (error) {
        console.error("Error writing output files:", error);
        process.exit(1);
    }

    console.log("Data generation complete.");
}

// Execute the main function
generateJsonData().catch(error => {
    console.error("An unexpected error occurred during data generation:", error);
    process.exit(1);
}); 