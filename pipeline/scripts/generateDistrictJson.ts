import * as fsPromises from 'fs/promises';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse';

// --- Configuration ---
const SOURCE_CSV_FILENAME = 'School and District Data.csv'; // Adjust if your CSV name is different
const INPUT_CSV_PATH = path.resolve(process.cwd(), 'dist', 'pipeline', 'data', SOURCE_CSV_FILENAME);
const OUTPUT_DISTRICTS_JSON_PATH = path.resolve(process.cwd(), 'public', 'assets', 'districts.json');
const OUTPUT_SCHOOLS_JSON_PATH = path.resolve(process.cwd(), 'public', 'assets', 'schools_by_district.json');
const OUTPUT_DIR = path.dirname(OUTPUT_DISTRICTS_JSON_PATH);

// const PHOTON_API_URL = 'http://localhost:2322/api'; // URL for local Photon instance
const NOMINATIM_API_URL = 'http://localhost:8080/search'; // URL for local Nominatim instance

// --- Helper function for delay ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Helper function for Address Normalization ---
function normalizeStreetName(street: string | null | undefined): string | null {
    if (!street || typeof street !== 'string') return null;

    let normalized = street.trim();

    // Ordinal numbers (simple cases 1-10)
    const ordinals: { [key: string]: string } = {
        'First': '1st', 'Second': '2nd', 'Third': '3rd', 'Fourth': '4th', 'Fifth': '5th',
        'Sixth': '6th', 'Seventh': '7th', 'Eighth': '8th', 'Ninth': '9th', 'Tenth': '10th'
    };
    // Match whole words to avoid partial matches
    normalized = normalized.replace(/\b(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth|Ninth|Tenth)\b/gi, (match) => {
        const capitalizedMatch = match.charAt(0).toUpperCase() + match.slice(1).toLowerCase(); // Ensure consistent case for lookup
        return ordinals[capitalizedMatch] || match; // Replace if found, otherwise keep original
    });

    // Common Abbreviations (Add more as needed, be careful with case sensitivity if required)
    // Example: Replace full word with abbreviation
    // normalized = normalized.replace(/\bStreet\b/gi, 'St');
    // normalized = normalized.replace(/\bAvenue\b/gi, 'Ave');
    // normalized = normalized.replace(/\bRoad\b/gi, 'Rd');
    // normalized = normalized.replace(/\bBoulevard\b/gi, 'Blvd');
    // normalized = normalized.replace(/\bDrive\b/gi, 'Dr');
    // normalized = normalized.replace(/\bLane\b/gi, 'Ln');
    // normalized = normalized.replace(/\bPlace\b/gi, 'Pl');
    // normalized = normalized.replace(/\bCourt\b/gi, 'Ct');

    return normalized;
}

// --- Helper function to select best match from multiple results --- 
interface NominatimResult {
    lat: string;
    lon: string;
    display_name: string;
    name?: string; // Might not always be present
    class?: string;
    type?: string;
    // Add other potentially useful fields if needed
}

function selectBestMatch(
    results: NominatimResult[],
    targetStreetName: string | null,
    targetCity: string | null
): NominatimResult | null {
    if (!results || results.length === 0) return null;
    if (results.length === 1) return results[0]; // Only one result, return it

    console.log(`[SelectBestMatch] Analyzing ${results.length} results...`);

    const desiredClasses = ['highway'];
    const desiredTypes = ['residential', 'primary', 'secondary', 'tertiary', 'unclassified', 'living_street', 'road'];

    let bestMatch: NominatimResult | null = null;
    let bestScore = -1; // Lower score is better (or use priority levels)

    for (const result of results) {
        let currentScore = 100; // Start with a high score (lower is better)

        // Priority 1: Check Type/Class
        if (result.class && desiredClasses.includes(result.class) && result.type && desiredTypes.includes(result.type)) {
            currentScore -= 50; // Big bonus for being a road
        } else if (result.class === 'place' && (result.type === 'house' || result.type === 'building')) {
            currentScore -= 25; // Address point or building is also good
        } else if (result.class === 'boundary' || result.class === 'place') {
            currentScore += 50; // Penalize boundaries or broad places (like cities)
        }

        // Priority 2: Check Street Name Match (if targetStreetName provided)
        if (targetStreetName && result.name) {
            if (result.name.toLowerCase() === targetStreetName.toLowerCase()) {
                currentScore -= 30; // Strong bonus for exact name match
            } else if (result.name.toLowerCase().includes(targetStreetName.toLowerCase())) {
                currentScore -= 10; // Small bonus for partial match
            }
        }

        // Priority 3: Check City Name in Display Name (if targetCity provided)
        if (targetCity && result.display_name) {
            if (result.display_name.toLowerCase().includes(targetCity.toLowerCase())) {
                currentScore -= 5; // Minor bonus if city is mentioned
            }
        }

        console.log(`[SelectBestMatch] Result: ${result.display_name}, Score: ${currentScore}`);

        if (bestMatch === null || currentScore < bestScore) {
            bestScore = currentScore;
            bestMatch = result;
            console.log(`[SelectBestMatch] New best match found.`);
        }
    }

    // Basic threshold - avoid really bad matches if score is still high
    if (bestScore > 60 && results.length > 1) {
        console.warn("[SelectBestMatch] No sufficiently good match found among results.");
        return null;
    }

    console.log(`[SelectBestMatch] Final selected match: ${bestMatch?.display_name}`);
    return bestMatch;
}

// Define types for intermediate storage
interface DistrictRecord {
    [key: string]: any; // Keep flexible for now
    Latitude?: string | number | null;
    Longitude?: string | number | null;
    'Street Address'?: string;
    'Street City'?: string;
    'Street State'?: string;
    District?: string;
    'CDS Code'?: string;
    slug?: string;
}

interface SchoolRecord {
    [key: string]: any; // Keep flexible
    'CDS Code'?: string;
    School?: string;
    Website?: string;
}

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

// --- Helper function to check coordinates ---
function hasValidCoordinates(lat: string | number | null | undefined, lon: string | number | null | undefined): boolean {
    if (lat == null || lon == null || lat === 'No Data' || lon === 'No Data') return false;
    const latNum = parseFloat(String(lat));
    const lonNum = parseFloat(String(lon));
    // Basic check: is it a number, and within plausible bounds? Add 0 check.
    return !isNaN(latNum) && !isNaN(lonNum) && latNum !== 0 && lonNum !== 0 && latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180;
}

// --- Refactored Generic Geocoding Logic --- 
// Takes a record (District or School), field names, and an ID for logging
async function geocodeRecordWithFallbacks(
    record: { [key: string]: any }, // Generic record
    idForLog: string, // e.g., CDS Code or Name
    nameForLog: string, // e.g., District name or School name
    streetField: string,
    cityField: string,
    stateField: string
): Promise<{ success: boolean; isFallback: boolean; level: number }> {

    const rawStreet = record[streetField];
    const rawCity = record[cityField];
    const rawState = record[stateField];

    let geocodeSuccess = false;
    let isFallbackResult = false;
    let successLevel = 0;
    let lat: number | null = null;
    let lon: number | null = null;

    const logPrefix = `[Geocode][${idForLog}]`; // Use provided ID

    // --- Attempt 1: Raw Address --- 
    const rawAddressParts = [rawStreet, rawCity, rawState].filter(p => p && p !== 'No Data');
    if (rawAddressParts.length >= 2) {
        let rawAddress = rawAddressParts.join(', ');
        if (!rawAddress.trim().toUpperCase().endsWith(', CA') && rawState === 'CA') { rawAddress += ', CA'; }
        console.log(`${logPrefix} Attempt 1 (Raw) for ${nameForLog}: "${rawAddress}"`);
        try {
            await delay(50);
            const url = `${NOMINATIM_API_URL}?q=${encodeURIComponent(rawAddress)}&format=json&limit=1`;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Status ${response.status}`);
            const results = await response.json();
            if (results && Array.isArray(results) && results.length > 0 && results[0].lat && results[0].lon) {
                lat = parseFloat(results[0].lat);
                lon = parseFloat(results[0].lon);
                if (!isNaN(lat) && !isNaN(lon)) {
                    console.log(`${logPrefix} Success (Raw) for ${nameForLog}: [${lat}, ${lon}]`);
                    geocodeSuccess = true;
                    successLevel = 1;
                }
            }
        } catch (e: any) { console.warn(`${logPrefix} Attempt 1 (Raw) for ${nameForLog} failed: ${e.message}`); }
    }

    // --- Attempt 2: Normalized Address --- 
    const normalizedStreet = normalizeStreetName(rawStreet);
    const normalizedCity = typeof rawCity === 'string' ? rawCity.trim() : null;
    const normalizedState = typeof rawState === 'string' ? rawState.trim() : null;
    let normalizedAddress = '';

    if (!geocodeSuccess) {
        const normalizedAddressParts = [normalizedStreet, normalizedCity, normalizedState].filter(p => p && p !== 'No Data');
        if (normalizedAddressParts.length >= 2) {
            normalizedAddress = normalizedAddressParts.join(', ');
            if (!normalizedAddress.trim().toUpperCase().endsWith(', CA') && normalizedState === 'CA') { normalizedAddress += ', CA'; }

            // Avoid re-querying if normalized is same as raw and raw failed
            const rawAddressForCheck = rawAddressParts.join(', ') + (rawState === 'CA' && !rawAddressParts.join(', ').toUpperCase().endsWith(', CA') ? ', CA' : '');
            if (normalizedAddress !== rawAddressForCheck) {
                console.log(`${logPrefix} Attempt 2 (Normalized) for ${nameForLog}: "${normalizedAddress}"`);
                try {
                    await delay(50);
                    const url = `${NOMINATIM_API_URL}?q=${encodeURIComponent(normalizedAddress)}&format=json&limit=1`;
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`Status ${response.status}`);
                    const results = await response.json();
                    if (results && Array.isArray(results) && results.length > 0 && results[0].lat && results[0].lon) {
                        lat = parseFloat(results[0].lat);
                        lon = parseFloat(results[0].lon);
                        if (!isNaN(lat) && !isNaN(lon)) {
                            console.log(`${logPrefix} Success (Normalized) for ${nameForLog}: [${lat}, ${lon}]`);
                            geocodeSuccess = true;
                            successLevel = 2;
                            isFallbackResult = true; // Count normalization as a fallback
                        }
                    }
                } catch (e: any) { console.warn(`${logPrefix} Attempt 2 (Normalized) for ${nameForLog} failed: ${e.message}`); }
            } else {
                console.log(`${logPrefix} Skipping Attempt 2 (Normalized) as it's same as failed raw query for ${nameForLog}.`);
            }
        }
    }

    // --- Attempt 3: Normalized Street Name + City + State --- 
    const streetNameOnly = typeof normalizedStreet === 'string' ? normalizedStreet.replace(/^\d+\s+/, '').trim() : null;
    let fallbackAddress1 = '';
    if (!geocodeSuccess && streetNameOnly && normalizedCity && normalizedCity !== 'No Data') {
        const parts = [streetNameOnly, normalizedCity, normalizedState].filter(p => p && p !== 'No Data');
        fallbackAddress1 = parts.join(', ');
        if (!fallbackAddress1.trim().toUpperCase().endsWith(', CA') && normalizedState === 'CA') { fallbackAddress1 += ', CA'; }

        if (fallbackAddress1 !== normalizedAddress) { // Avoid re-query
            console.log(`${logPrefix} Attempt 3 (Norm Street+City+State) for ${nameForLog}: "${fallbackAddress1}"`);
            try {
                await delay(50);
                const url = `${NOMINATIM_API_URL}?q=${encodeURIComponent(fallbackAddress1)}&format=json&limit=5`;
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Status ${response.status}`);
                const results = await response.json();
                const bestMatch = selectBestMatch(results, streetNameOnly, normalizedCity);
                if (bestMatch && bestMatch.lat && bestMatch.lon) {
                    lat = parseFloat(bestMatch.lat);
                    lon = parseFloat(bestMatch.lon);
                    if (!isNaN(lat) && !isNaN(lon)) {
                        console.warn(`${logPrefix} Success (Fallback 1 - Street+City) for ${nameForLog}: [${lat}, ${lon}] (Selected: ${bestMatch.display_name})`);
                        geocodeSuccess = true;
                        successLevel = 3;
                        isFallbackResult = true;
                    }
                }
            } catch (e: any) { console.warn(`${logPrefix} Attempt 3 (Norm Street+City+State) for ${nameForLog} failed: ${e.message}`); }
        }
    }

    // --- Attempt 4 (Formerly 5): City + State --- 
    if (!geocodeSuccess && normalizedCity && normalizedCity !== 'No Data' && normalizedState === 'CA') {
        const fallbackAddress3 = `${normalizedCity}, ${normalizedState}`;
        // Avoid re-querying if this combination was already tried (unlikely here but good practice)
        const prevAttempts = [
            rawAddressParts.join(', ') + (rawState === 'CA' && !rawAddressParts.join(', ').toUpperCase().endsWith(', CA') ? ', CA' : ''),
            normalizedAddress,
            fallbackAddress1
        ];
        if (!prevAttempts.includes(fallbackAddress3)) {
            console.log(`${logPrefix} Attempt 4 (City+State): "${fallbackAddress3}"`); // Update log to Attempt 4
            try {
                await delay(50);
                const url = `${NOMINATIM_API_URL}?q=${encodeURIComponent(fallbackAddress3)}&format=json&limit=1`;
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Status ${response.status}`);
                const results = await response.json();
                if (results && Array.isArray(results) && results.length > 0 && results[0].lat && results[0].lon) {
                    lat = parseFloat(results[0].lat);
                    lon = parseFloat(results[0].lon);
                    if (!isNaN(lat) && !isNaN(lon)) {
                        console.warn(`${logPrefix} Success (Fallback 3 - City+State): [${lat}, ${lon}]`); // Keep log detail (Fallback 3)
                        geocodeSuccess = true;
                        successLevel = 4; // Update success level
                        isFallbackResult = true;
                    }
                }
            } catch (e: any) { console.warn(`${logPrefix} Attempt 4 (City+State) failed: ${e.message}`); } // Update log
        }
    }

    // Update record object if successful
    if (geocodeSuccess && lat !== null && lon !== null) {
        record.Latitude = lat;
        record.Longitude = lon;
    } else {
        // Log final failure only if the initial coordinates were invalid
        if (!hasValidCoordinates(record.Latitude, record.Longitude)) {
            console.error(`${logPrefix} All geocoding attempts failed for ${nameForLog}.`);
        }
        // Ensure coords are marked invalid if geocoding failed or was skipped
        record.Latitude = 'No Data';
        record.Longitude = 'No Data';
    }

    return { success: geocodeSuccess, isFallback: isFallbackResult, level: successLevel };
}

// --- Main Function ---
async function generateJsonData() {
    // --- Add File Existence Check --- 
    if (fs.existsSync(OUTPUT_DISTRICTS_JSON_PATH) && fs.existsSync(OUTPUT_SCHOOLS_JSON_PATH)) {
        console.log("Output JSON files already exist. Skipping data generation.");
        console.log(` - ${OUTPUT_DISTRICTS_JSON_PATH}`);
        console.log(` - ${OUTPUT_SCHOOLS_JSON_PATH}`);
        // Exit successfully without running the rest of the script
        // Note: In some build systems, you might return instead of exiting
        process.exit(0);
    }
    // --- End File Existence Check --- 

    console.log(`Starting data generation from: ${INPUT_CSV_PATH}`);

    if (!fs.existsSync(INPUT_CSV_PATH)) {
        console.error(`Error: Input CSV file not found at ${INPUT_CSV_PATH}`);
        console.error('Please ensure you have run the XLSX to CSV conversion first.');
        process.exit(1);
    }

    const fileContent = fs.readFileSync(INPUT_CSV_PATH, { encoding: 'utf8' });

    // --- Temporary storage during parsing --- 
    const tempDistricts: DistrictRecord[] = [];
    const tempSchools: SchoolRecord[] = [];
    // --- End temporary storage ---

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

                // --- Add Skipping Conditions --- 
                const status = record['Status'];
                if (status !== 'Active') {
                    console.warn(`[Skip] Skipping record ${processedRecordCount} (CDS: ${cdsCode}) due to Status: ${status}`);
                    continue; // Skip to next record
                }

                const streetAddress = record['Street Address'];
                if (typeof streetAddress === 'string' && streetAddress.toLowerCase().includes('information redacted')) {
                    console.warn(`[Skip] Skipping record ${processedRecordCount} (CDS: ${cdsCode}) due to redacted address.`);
                    continue; // Skip to next record
                }
                // --- End Skipping Conditions --- 

                // Process Districts (Store temporarily)
                if ((recordType === 'District' || recordType === 'County Office')) {
                    // Check if district already added to avoid duplicates if CSV has multiple district rows
                    if (!tempDistricts.some(d => d['CDS Code'] === cdsCode)) {
                        const districtDetails: DistrictRecord = {};
                        DISTRICT_COLUMNS_TO_KEEP.forEach(col => {
                            districtDetails[col] = record[col] !== undefined && record[col] !== null ? record[col] : 'No Data';
                        });
                        // Ensure name passed to slug is a string
                        const districtName = typeof districtDetails['District'] === 'string' ? districtDetails['District'] : '';
                        districtDetails['slug'] = generateSlug(districtName, cdsCode);
                        tempDistricts.push(districtDetails);
                        // districtCount++; // Count later after geocoding
                    }
                }

                // Process Schools (Store temporarily)
                if (recordType === 'School') {
                    const schoolDetails: SchoolRecord = {};
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

                    tempSchools.push(schoolDetails);
                    // schoolCount++; // Count later
                }
            }
        });

        parser.on('error', (err) => {
            console.error("Error parsing CSV:", err.message);
            reject(err);
        });

        parser.on('end', () => {
            console.log(`Finished parsing. Total lines processed (excluding header/metadata): ${processedRecordCount}.`);
            resolve();
        });
    }); // End of Promise

    // --- Geocode Districts AFTER parsing --- 
    console.log(`Parsing complete. Starting geocoding for ${tempDistricts.length} potential districts...`);
    const geocodedDistricts: { [key: string]: DistrictRecord } = {};
    let districtGeocodeSuccessCount = 0;
    let districtGeocodeFallbackSuccessCount = 0;

    for (const district of tempDistricts) {
        const cdsCode = district['CDS Code'] || 'UNKNOWN_DISTRICT';
        const districtName = district['District'] || 'Unknown District';

        if (!hasValidCoordinates(district.Latitude, district.Longitude)) {
            // Call the refactored geocoding function for districts
            const geocodeResult = await geocodeRecordWithFallbacks(
                district,
                cdsCode,
                districtName,
                'Street Address',
                'Street City',
                'Street State'
            );
            if (geocodeResult.success) {
                districtGeocodeSuccessCount++;
                if (geocodeResult.isFallback) {
                    districtGeocodeFallbackSuccessCount++;
                }
            }
        }

        // Always add district (potentially geocoded or not) to the final map
        geocodedDistricts[cdsCode] = district;
    }
    console.log(`District geocoding finished. Successes: ${districtGeocodeSuccessCount} (incl. ${districtGeocodeFallbackSuccessCount} fallback).`);

    // --- Geocode Schools AFTER districts --- 
    console.log(`Starting geocoding for ${tempSchools.length} potential schools...`);
    let schoolGeocodeSuccessCount = 0;
    let schoolGeocodeFallbackSuccessCount = 0;

    for (const school of tempSchools) {
        const schoolName = school['School'] || 'Unknown School';
        // Use School Name for logging if CDS code is missing/not unique for schools
        const idForLog = school['CDS Code'] || schoolName;

        if (!hasValidCoordinates(school.Latitude, school.Longitude)) {
            // Call the refactored geocoding function for schools
            const geocodeResult = await geocodeRecordWithFallbacks(
                school,
                idForLog,
                schoolName,
                'Street Address', // Assuming same field names as districts
                'Street City',
                'Street State'
            );
            if (geocodeResult.success) {
                schoolGeocodeSuccessCount++;
                if (geocodeResult.isFallback) {
                    schoolGeocodeFallbackSuccessCount++;
                }
            }
        }
    }
    console.log(`School geocoding finished. Successes: ${schoolGeocodeSuccessCount} (incl. ${schoolGeocodeFallbackSuccessCount} fallback).`);

    // --- Process Schools AFTER geocoding both districts and schools --- 
    const districtCount = Object.keys(geocodedDistricts).length;
    const schoolsByDistrictData: { [key: string]: any[] } = {};
    let schoolCount = 0;

    // --- Add Debugging Logs --- 
    console.log(`[SchoolLink Debug] Starting school linking. tempSchools size: ${tempSchools.length}`);
    console.log(`[SchoolLink Debug] geocodedDistricts size: ${Object.keys(geocodedDistricts).length}`);
    let schoolsChecked = 0;
    // --- End Debugging Logs --- 

    for (const school of tempSchools) {
        const cdsCode = school['CDS Code'];
        if (!cdsCode) {
            console.warn("[SchoolLink] Skipping school due to missing CDS Code:", school);
            continue;
        }
        const districtCdsPrefix = cdsCode.substring(0, 7);
        // Construct the full 14-digit district CDS code key used in geocodedDistricts
        const districtCdsKey = `${districtCdsPrefix}0000000`;

        // --- Add Debugging Logs --- 
        if (schoolsChecked < 5) { // Log details for the first 5 schools checked
            // Update log to show the key being used for lookup
            console.log(`[SchoolLink Debug #${schoolsChecked + 1}] School CDS: ${cdsCode}, District Key: ${districtCdsKey}, District Exists: ${!!geocodedDistricts[districtCdsKey]}`);
        }
        schoolsChecked++;
        // --- End Debugging Logs --- 

        // Use the constructed districtCdsKey for lookup
        if (districtCdsPrefix.length === 7 && geocodedDistricts[districtCdsKey]) { // Check if district exists using the full key
            if (!schoolsByDistrictData[districtCdsKey]) { schoolsByDistrictData[districtCdsKey] = []; } // Use the full key for grouping too
            schoolsByDistrictData[districtCdsKey].push(school);
            schoolCount++;
        } else {
            // Don't warn if district just doesn't exist, but warn if format wrong
            if (districtCdsPrefix.length !== 7) {
                console.warn(`[SchoolLink] Skipping school ${school.School} (CDS: ${cdsCode}) due to invalid district CDS code prefix format.`);
            } else if (!geocodedDistricts[districtCdsKey]) {
                // Log only if the district was expected but not found
                console.warn(`[SchoolLink] District key ${districtCdsKey} not found in geocodedDistricts for school ${school.School} (CDS: ${cdsCode}).`);
            }
        }
    }
    console.log(`Processed ${schoolCount} schools linked to valid districts.`);

    // --- Writing files AFTER geocoding and school processing --- 
    console.log('Data processing complete. Preparing to write output files...');

    // --- Add logging BEFORE writing --- 
    const districtKeys = Object.keys(geocodedDistricts);
    const schoolDistrictKeys = Object.keys(schoolsByDistrictData);
    console.log(`[Debug] districtsData contains ${districtKeys.length} keys.`);
    console.log(`[Debug] schoolsByDistrictData contains ${schoolDistrictKeys.length} keys.`);
    // Optionally log a small sample
    if (districtKeys.length > 0) {
        console.log('[Debug] Sample district entry:', JSON.stringify(geocodedDistricts[districtKeys[0]], null, 2));
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
    const slugs = Object.values(geocodedDistricts).map(d => d.slug).filter(slug => slug);
    console.log(`[DataGen] Extracted ${slugs.length} slugs for prerender list.`);

    // Generate the structured parameters for the new file
    const prerenderParams = slugs.map(slug => ({ districtSlug: slug }));

    const districtsOutputPath = path.join(OUTPUT_DIR, 'districts.json');
    const schoolsOutputPath = path.join(OUTPUT_DIR, 'schools_by_district.json');
    const paramsOutputPath = path.join(OUTPUT_DIR, 'prerender-params.json'); // Path for the new params file

    try {
        await fsPromises.writeFile(districtsOutputPath, JSON.stringify(geocodedDistricts, null, 2));
        console.log(`Successfully wrote district data to: ${districtsOutputPath}`);
        await fsPromises.writeFile(schoolsOutputPath, JSON.stringify(schoolsByDistrictData, null, 2));
        console.log(`Successfully wrote school data to: ${schoolsOutputPath}`);
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