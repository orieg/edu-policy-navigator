import { promises as fs } from 'fs';
import path from 'path';
import { pipeline, env } from '@xenova/transformers';

// Allow local models
env.allowLocalModels = true;
env.localModelPath = path.resolve(process.cwd(), 'models'); // Optional: if you have models stored locally

// Configuration
const INPUT_DISTRICTS_JSON_PATH = path.resolve(process.cwd(), 'public', 'assets', 'districts.json');
const INPUT_SCHOOLS_JSON_PATH = path.resolve(process.cwd(), 'public', 'assets', 'schools_by_district.json');
const OUTPUT_EMBEDDINGS_DIR = path.resolve(process.cwd(), 'public', 'embeddings');
const OUTPUT_EMBEDDINGS_JSON_PATH = path.join(OUTPUT_EMBEDDINGS_DIR, 'embedded_data.json');

// Import from shared config
import { WEBLLM_EMBEDDING_MODEL_ID as EMBEDDING_MODEL_ID } from '../../src/modelConfig.js';

/**
 * @param {import('@xenova/transformers').Pipeline} extractor
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
async function getEmbedding(extractor, text) {
    if (!text || text.trim() === '') {
        console.warn('Skipping embedding for empty text.');
        return null;
    }
    try {
        const output = await extractor(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    } catch (error) {
        console.error(`Error generating embedding for text: "${text.substring(0, 100)}...":`, error);
        return null;
    }
}

async function generateEmbeddings() {
    console.log('Starting embedding generation process...');

    // Check if embeddings file already exists
    try {
        await fs.access(OUTPUT_EMBEDDINGS_JSON_PATH);
        console.log(`Embeddings file already exists at ${OUTPUT_EMBEDDINGS_JSON_PATH}. Skipping generation.`);
        console.log('To force regeneration, delete the existing file and run this script again.');
        return; // Exit early
    } catch (error) {
        // File does not exist or is not accessible, proceed with generation
        console.log('Embeddings file not found, proceeding with generation...');
    }

    // 1. Ensure output directory exists
    try {
        await fs.mkdir(OUTPUT_EMBEDDINGS_DIR, { recursive: true });
        console.log(`Output directory ${OUTPUT_EMBEDDINGS_DIR} ensured.`);
    } catch (error) {
        console.error('Error creating output directory:', error);
        return;
    }

    // 2. Load Embedding Model
    let extractor;
    try {
        console.log(`Loading embedding model: ${EMBEDDING_MODEL_ID}`);
        // Set a higher progress update interval to reduce console noise for model download
        // Ensure pipelineParams exists before trying to access feature_extraction
        if (!env.pipelineParams) {
            env.pipelineParams = {};
        }
        env.pipelineParams.feature_extraction = { ...(env.pipelineParams.feature_extraction || {}), progress_interval: 300 };
        extractor = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, {
            progress_callback: (progress) => {
                if (progress.status === 'progress') {
                    console.log(`Model loading: ${progress.file} - ${Math.round(progress.progress)}%`);
                } else if (progress.status === 'done') {
                    console.log(`Model file ${progress.file} downloaded.`);
                } else {
                    console.log(`Model loading status: ${progress.status}${progress.file ? (' for ' + progress.file) : ''}`);
                }
            }
        });
        console.log('Embedding model loaded successfully.');
    } catch (error) {
        console.error('Error loading embedding model:', error);
        return;
    }

    const allEmbeddedRecords = [];

    try {
        // Read Districts
        console.log(`Reading districts from: ${INPUT_DISTRICTS_JSON_PATH}`);
        const districtsFileContent = await fs.readFile(INPUT_DISTRICTS_JSON_PATH, 'utf-8');
        const districtsData = JSON.parse(districtsFileContent);
        // Check if districtsData is an object, then get its values
        if (typeof districtsData !== 'object' || districtsData === null || Array.isArray(districtsData)) {
            console.error('Error: districtsData is not an object or is an array. Expected an object mapping CDS codes to district info. Check districts.json format.');
            return; // Exit if not an object
        }
        const districtList = Object.values(districtsData);
        console.log(`Found ${districtList.length} districts.`);

        // Read Schools by District
        console.log(`Reading schools from: ${INPUT_SCHOOLS_JSON_PATH}`);
        const schoolsFileContent = await fs.readFile(INPUT_SCHOOLS_JSON_PATH, 'utf-8');
        const schoolsByDistrictData = JSON.parse(schoolsFileContent);
        if (typeof schoolsByDistrictData !== 'object' || schoolsByDistrictData === null) {
            console.error('Error: schoolsByDistrictData is not an object. Check schools_by_district.json format.');
            return;
        }
        console.log(`School data loaded for ${Object.keys(schoolsByDistrictData).length} districts.`);

        // Process Districts
        for (const district of districtList) {
            // Filter out inactive districts
            if (district.Status !== 'Active') {
                console.log(`Skipping inactive district: ${district.District} (${district['CDS Code']})`);
                continue;
            }
            // Filter out redacted districts - REMOVED based on alignment with static page generation
            // if (district.District && district.District.toLowerCase().includes('information redacted')) {
            //     console.log(`Skipping redacted district: ${district.District} (${district['CDS Code']})`);
            //    continue;
            // }

            const districtName = district.District || 'Unknown District';
            const cdsCode = district['CDS Code'] || 'N/A';
            const county = district.County || 'N/A';
            const city = district['Street City'] || 'N/A';
            const streetAddress = district['Street Address']; // Get address
            const entityType = district['Entity Type'] || 'educational institution';
            const website = district.Website;

            // Narrative sentence construction for districts
            let districtText = `The ${districtName} (${cdsCode}) is a ${entityType}`;
            // Add address if available
            if (streetAddress && streetAddress !== 'No Data') {
                districtText += ` located at ${streetAddress} in ${city}, ${county} County, California.`;
            } else {
                districtText += ` located in ${city}, ${county} County, California.`;
            }
            // Add more relevant info if needed, e.g., funding type
            if (district['Funding Type'] && district['Funding Type'] !== 'No Data') {
                districtText += ` Funding Type: ${district['Funding Type']}.`;
            }

            console.log(`Embedding district: ${districtName} (${cdsCode})`);
            const embedding = await getEmbedding(extractor, districtText);
            if (embedding) {
                allEmbeddedRecords.push({
                    id: `district_${cdsCode}`,
                    type: "district",
                    text: districtText,
                    embedding: embedding,
                    metadata: {
                        cds_code: cdsCode,
                        name: districtName,
                        city: city,
                        county: county,
                        // Storing the whole district object might be large, decide if needed for display/retrieval
                        // For now, only essential metadata is stored directly.
                        // Consider adding website, phone if directly searchable or displayed from search results
                        website: district.Website,
                        phone: district.Phone,
                        original_data_subset: { // Include a subset of original data for quick reference
                            'District': districtName,
                            'CDS Code': cdsCode,
                            'County': county,
                            'Street City': city,
                            'Website': district.Website,
                            'Phone': district.Phone,
                            'Low Grade': district['Low Grade'],
                            'High Grade': district['High Grade']
                        }
                    }
                });
            }
        }

        // Process Schools
        for (const districtCds in schoolsByDistrictData) {
            const schoolsInDistrict = schoolsByDistrictData[districtCds];
            const parentDistrict = districtList.find(d => d['CDS Code'] === districtCds);
            const parentDistrictName = parentDistrict?.District || 'Unknown District';

            for (const school of schoolsInDistrict) {
                // Filter out inactive or non-public schools
                if (school.Status !== 'Active' || school['Public Yes/No'] !== 'Y') {
                    console.log(`Skipping inactive/non-public school: ${school.School} (${school['CDS Code']})`);
                    continue;
                }
                // Filter out redacted schools - REMOVED based on alignment with static page generation
                // if (school.School && school.School.toLowerCase().includes('information redacted')) {
                //    console.log(`Skipping redacted school: ${school.School} (${school['CDS Code']})`);
                //    continue;
                // }

                const schoolName = school.School || 'Unknown School';
                const schoolCdsCode = school['CDS Code'] || 'N/A';
                const schoolType = school['Educational Program Type'] || 'school'; // Default to generic term
                const schoolCity = school['Street City'] || 'N/A';
                const streetAddress = school['Street Address']; // Get address
                const lowGrade = school['Low Grade'];
                const highGrade = school['High Grade'];
                const website = school.Website;

                // Narrative sentence construction for schools
                let schoolText = `The ${schoolName} (${schoolCdsCode}) is a ${schoolType}`;
                // Add address if available
                if (streetAddress && streetAddress !== 'No Data') {
                    schoolText += ` located at ${streetAddress} in ${schoolCity}, California,`;
                } else {
                    schoolText += ` located in ${schoolCity}, California,`;
                }
                schoolText += ` and is part of the ${parentDistrictName} district (${districtCds}).`;

                if (lowGrade && highGrade && lowGrade !== 'No Data' && highGrade !== 'No Data') {
                    // Handle Adult/P grades more descriptively
                    if (lowGrade === 'P' && highGrade === 'Adult') {
                        schoolText += ` It serves a wide range of grade levels from Preschool through Adult education.`;
                    } else if (lowGrade === 'P') {
                        schoolText += ` It serves grades from Preschool to ${highGrade}.`;
                    } else if (highGrade === 'Adult') {
                        schoolText += ` It serves grades from ${lowGrade} through Adult education.`;
                    } else {
                        schoolText += ` It serves grades ${lowGrade} to ${highGrade}.`;
                    }
                } else if (lowGrade && lowGrade !== 'No Data') {
                    schoolText += ` It serves grade ${lowGrade} and potentially others.`;
                } else if (highGrade && highGrade !== 'No Data') {
                    schoolText += ` It serves up to grade ${highGrade}.`;
                }

                if (website && website !== 'No Data') {
                    schoolText += ` Its website is ${website}.`;
                }

                console.log(`Embedding school: ${schoolName} (${schoolCdsCode})`);
                const embedding = await getEmbedding(extractor, schoolText);
                if (embedding) {
                    allEmbeddedRecords.push({
                        id: `school_${schoolCdsCode}`,
                        type: "school",
                        text: schoolText,
                        embedding: embedding,
                        metadata: {
                            cds_code: schoolCdsCode,
                            name: schoolName,
                            city: schoolCity,
                            type: schoolType,
                            district_cds_code: districtCds,
                            district_name: parentDistrictName,
                            website: school.Website,
                            phone: school.Phone,
                            original_data_subset: { // Include a subset of original data
                                'School': schoolName,
                                'CDS Code': schoolCdsCode,
                                'Street City': schoolCity,
                                'Educational Program Type': schoolType,
                                'Low Grade': school['Low Grade'],
                                'High Grade': school['High Grade'],
                                'Website': school.Website,
                                'Phone': school.Phone
                            }
                        }
                    });
                }
            }
        }

        // Check for duplicate IDs before writing
        const idSet = new Set();
        const duplicates = [];
        for (const record of allEmbeddedRecords) {
            if (idSet.has(record.id)) {
                duplicates.push(record.id);
            }
            idSet.add(record.id);
        }

        if (duplicates.length > 0) {
            console.error(`\x1b[31mError: Found ${duplicates.length} duplicate IDs in generated data! Cannot write embeddings file.\x1b[0m`);
            console.error('Duplicate IDs:', duplicates.slice(0, 10)); // Show first 10 duplicates
            return; // Exit without writing the file
        }

        // Write Output JSON
        await fs.writeFile(OUTPUT_EMBEDDINGS_JSON_PATH, JSON.stringify(allEmbeddedRecords, null, 2));
        console.log(`Successfully generated ${allEmbeddedRecords.length} embeddings (checked for duplicates).`);
        console.log(`Embeddings written to: ${OUTPUT_EMBEDDINGS_JSON_PATH}`);

    } catch (error) {
        console.error('Error during data processing or file operations:', error);
    }

    console.log('Embedding generation process completed.');
}

// Run the generation process
generateEmbeddings().catch(console.error); 