import * as kuzu from 'kuzu';
import * as fs from 'fs';
import * as path from 'path';

// Define paths (adjust relative paths as necessary based on script execution location)
const DB_OUTPUT_DIR = path.join(__dirname, '..', '..', 'public', 'kuzu_dbs');
const DB_NAME = 'main_data.db'; // Or use a district-specific naming convention if needed
const DB_PATH = path.join(DB_OUTPUT_DIR, DB_NAME);

const DISTRICT_JSON_PATH = path.join(__dirname, '..', '..', 'public', 'assets', 'districts.json');
const SCHOOL_JSON_PATH = path.join(__dirname, '..', '..', 'public', 'assets', 'schools_by_district.json');

// Define the KuzuDB Schema (matching ragController description)
const SCHEMA = {
    nodes: [
        {
            name: 'District',
            properties: [
                { name: 'cdsCode', type: 'STRING' },
                { name: 'name', type: 'STRING' },
                { name: 'county', type: 'STRING' },
                { name: 'status', type: 'STRING' },
                { name: 'entityType', type: 'STRING' },
                { name: 'streetAddress', type: 'STRING' },
                { name: 'city', type: 'STRING' },
                { name: 'state', type: 'STRING' },
                { name: 'zip', type: 'STRING' },
                { name: 'phone', type: 'STRING' },
                { name: 'website', type: 'STRING' },
                { name: 'lowGrade', type: 'STRING' },
                { name: 'highGrade', type: 'STRING' },
                { name: 'latitude', type: 'DOUBLE' },
                { name: 'longitude', type: 'DOUBLE' },
                { name: 'slug', type: 'STRING' },
            ],
            primaryKey: 'cdsCode'
        },
        {
            name: 'School',
            properties: [
                { name: 'cdsCode', type: 'STRING' },
                { name: 'name', type: 'STRING' },
                { name: 'type', type: 'STRING' },
                { name: 'status', type: 'STRING' },
                { name: 'isPublic', type: 'BOOLEAN' },
                { name: 'lowGrade', type: 'STRING' },
                { name: 'highGrade', type: 'STRING' },
                { name: 'streetAddress', type: 'STRING' },
                { name: 'city', type: 'STRING' },
                { name: 'state', type: 'STRING' },
                { name: 'zip', type: 'STRING' },
                { name: 'phone', type: 'STRING' },
                { name: 'website', type: 'STRING' },
                { name: 'latitude', type: 'DOUBLE' },
                { name: 'longitude', type: 'DOUBLE' },
            ],
            primaryKey: 'cdsCode' // Assuming School CDS Code is unique PK
        },
        // TODO: Add Policy and Document node definitions if they should be in this DB
    ],
    rels: [
        {
            name: 'BELONGS_TO',
            from: 'School',
            to: 'District'
            // Add properties if the relationship has any
        },
        // TODO: Add Policy/Document relationships if needed
    ]
};

// Helper to generate CREATE TABLE Cypher
function generateCreateTableCypher(nodeDef: any): string {
    const props = nodeDef.properties.map((p: any) => `${p.name} ${p.type}`).join(', ');
    const pk = nodeDef.primaryKey ? `, PRIMARY KEY (${nodeDef.primaryKey})` : '';
    return `CREATE NODE TABLE IF NOT EXISTS ${nodeDef.name}(${props}${pk});`;
}

// Helper to generate CREATE REL TABLE Cypher
function generateCreateRelTableCypher(relDef: any): string {
    const props = relDef.properties ? `(${relDef.properties.map((p: any) => `${p.name} ${p.type}`).join(', ')})` : '';
    return `CREATE REL TABLE IF NOT EXISTS ${relDef.name}(FROM ${relDef.from} TO ${relDef.to}${props});`;
}

async function main() {
    console.log('Starting KuzuDB generation...');

    // Ensure output directory exists
    if (!fs.existsSync(DB_OUTPUT_DIR)) {
        fs.mkdirSync(DB_OUTPUT_DIR, { recursive: true });
        console.log(`Created output directory: ${DB_OUTPUT_DIR}`);
    }

    // Delete existing DB file if it exists
    if (fs.existsSync(DB_PATH)) {
        fs.unlinkSync(DB_PATH);
        console.log(`Deleted existing database file: ${DB_PATH}`);
    }

    // Create and connect to the database
    const db = new kuzu.Database(DB_PATH);
    const conn = new kuzu.Connection(db);
    console.log(`Connected to KuzuDB database at: ${DB_PATH}`);

    try {
        // Create Schema
        console.log('Creating schema...');
        for (const nodeDef of SCHEMA.nodes) {
            const cypher = generateCreateTableCypher(nodeDef);
            console.log(`Executing: ${cypher}`);
            await conn.query(cypher);
        }
        for (const relDef of SCHEMA.rels) {
            const cypher = generateCreateRelTableCypher(relDef);
            console.log(`Executing: ${cypher}`);
            await conn.query(cypher);
        }
        console.log('Schema creation complete.');

        // Load Data
        console.log('Loading data...');

        // --- Load Districts --- 
        console.log(`Loading districts from ${DISTRICT_JSON_PATH}...`);
        const districtData = JSON.parse(fs.readFileSync(DISTRICT_JSON_PATH, 'utf-8'));
        let districtCount = 0;
        for (const cdsCode in districtData) {
            const district = districtData[cdsCode];
            // Basic validation/cleaning
            if (!district || typeof district !== 'object') continue;
            const params: Record<string, any> = {
                p_cdsCode: cdsCode,
                p_name: district['District'] || '',
                p_county: district['County'] || '',
                p_status: district['Status'] || '',
                p_entityType: district['Entity Type'] || '',
                p_streetAddress: district['Street Address'] || '',
                p_city: district['Street City'] || '',
                p_state: district['Street State'] || '',
                p_zip: district['Street Zip'] || '',
                p_phone: district['Phone'] || '',
                p_website: district['Website'] || '',
                p_lowGrade: district['Low Grade'] || '',
                p_highGrade: district['High Grade'] || '',
                p_latitude: parseFloat(district['Latitude']) || 0.0,
                p_longitude: parseFloat(district['Longitude']) || 0.0,
                p_slug: district['slug'] || ''
            };

            const createCypher = `CREATE (d:District { 
                cdsCode: $p_cdsCode, name: $p_name, county: $p_county, status: $p_status,
                entityType: $p_entityType, streetAddress: $p_streetAddress, city: $p_city, 
                state: $p_state, zip: $p_zip, phone: $p_phone, website: $p_website, 
                lowGrade: $p_lowGrade, highGrade: $p_highGrade, latitude: $p_latitude, 
                longitude: $p_longitude, slug: $p_slug 
            });`;

            try {
                await conn.query(createCypher, params);
                districtCount++;
            } catch (err) {
                console.error(`Error inserting district ${cdsCode}:`, err);
                console.error('Data:', district);
                console.error('Params:', params);
            }
        }
        console.log(`Loaded ${districtCount} districts.`);

        // --- Load Schools and Relationships --- 
        // NOTE: schools_by_district.json is large, consider streaming/chunking if memory is an issue
        console.log(`Loading schools from ${SCHOOL_JSON_PATH}...`);
        const schoolDataByDistrict = JSON.parse(fs.readFileSync(SCHOOL_JSON_PATH, 'utf-8'));
        let schoolCount = 0;
        let relCount = 0;
        for (const districtCdsCode in schoolDataByDistrict) {
            const schools = schoolDataByDistrict[districtCdsCode];
            if (!Array.isArray(schools)) continue;

            for (const school of schools) {
                if (!school || typeof school !== 'object' || !school['CDS Code']) continue;
                const schoolParams: Record<string, any> = {
                    p_cdsCode: school['CDS Code'],
                    p_name: school['School'] || '',
                    p_type: school['Educational Program Type'] || '',
                    p_status: school['Status'] || '',
                    p_isPublic: (school['Public Yes/No'] === 'Y'),
                    p_lowGrade: school['Low Grade'] || '',
                    p_highGrade: school['High Grade'] || '',
                    p_streetAddress: school['Street Address'] || '',
                    p_city: school['Street City'] || '',
                    p_state: school['Street State'] || '',
                    p_zip: school['Street Zip'] || '',
                    p_phone: school['Phone'] || '',
                    p_website: school['Website'] || '',
                    p_latitude: parseFloat(school['Latitude']) || 0.0,
                    p_longitude: parseFloat(school['Longitude']) || 0.0,
                };

                const createSchoolCypher = `CREATE (s:School { 
                    cdsCode: $p_cdsCode, name: $p_name, type: $p_type, status: $p_status,
                    isPublic: $p_isPublic, lowGrade: $p_lowGrade, highGrade: $p_highGrade,
                    streetAddress: $p_streetAddress, city: $p_city, state: $p_state, 
                    zip: $p_zip, phone: $p_phone, website: $p_website, 
                    latitude: $p_latitude, longitude: $p_longitude 
                });`;

                const createRelCypher = `
                    MATCH (s:School {cdsCode: $schoolCds}), (d:District {cdsCode: $districtCds}) 
                    CREATE (s)-[r:BELONGS_TO]->(d);
                `;
                const relParams = { schoolCds: school['CDS Code'], districtCds: districtCdsCode };

                try {
                    await conn.query(createSchoolCypher, schoolParams);
                    schoolCount++;
                    await conn.query(createRelCypher, relParams);
                    relCount++;
                } catch (err) {
                    console.error(`Error inserting school ${school['CDS Code']} or its relationship:`, err);
                    console.error('School Data:', school);
                    console.error('School Params:', schoolParams);
                    console.error('Rel Params:', relParams);
                }
            }
        }
        console.log(`Loaded ${schoolCount} schools and created ${relCount} BELONGS_TO relationships.`);

        // --- TODO: Load Policy/Document Data if needed --- 

        console.log('Data loading complete.');

    } catch (err) {
        console.error('Error during KuzuDB generation:', err);
    } finally {
        // Important to close the database connection properly
        // db.close(); // Check nodejs API for proper closing/shutdown
        console.log('KuzuDB generation process finished.');
    }
}

main(); 