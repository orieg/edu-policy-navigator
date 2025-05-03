// pages/districts/@cdsCode/+onBeforeRender.ts
// Environment: server

import type { OnBeforeRenderAsync } from 'vike/types'
import fs from 'node:fs'
import path from 'node:path'

// Assume data files are in project_root/data/
const dataDir = path.resolve(process.cwd(), 'data');
const districtsPath = path.join(dataDir, 'districts.json');
const schoolsPath = path.join(dataDir, 'schools.json');

let districtsData: Record<string, any> | null = null;
let schoolsData: Record<string, any[]> | null = null;

// Load data only once when the server starts (or on first request)
function loadData() {
    if (!districtsData) {
        try {
            districtsData = JSON.parse(fs.readFileSync(districtsPath, 'utf-8'));
            console.log('[onBeforeRender] Loaded districts.json');
        } catch (e) {
            console.error('[onBeforeRender] Failed to load districts.json:', e);
            districtsData = {}; // Prevent repeated attempts on error
        }
    }
    if (!schoolsData) {
        try {
            schoolsData = JSON.parse(fs.readFileSync(schoolsPath, 'utf-8'));
            console.log('[onBeforeRender] Loaded schools.json');
        } catch (e) {
            console.error('[onBeforeRender] Failed to load schools.json:', e);
            schoolsData = {}; // Prevent repeated attempts on error
        }
    }
}

const onBeforeRender: OnBeforeRenderAsync = async (pageContext): ReturnType<OnBeforeRenderAsync> => {
    loadData(); // Ensure data is loaded

    const cdsCode = pageContext.routeParams?.cdsCode;
    if (!cdsCode) {
        // This shouldn't happen with correct routing, but handle defensively
        console.error('[onBeforeRender] No cdsCode found in route parameters.');
        return { pageContext: { pageProps: { district: null, schools: [], cdsCode: '' } } };
    }

    const district = districtsData?.[cdsCode] || null;
    if (!district) {
        console.warn(`[onBeforeRender] District not found for CDS Code: ${cdsCode}`);
        // Optionally: throw an error here to render a 404 page if configured
    }

    const districtPrefix = cdsCode.substring(0, 7);
    const schools = schoolsData?.[districtPrefix] || [];

    // Filter schools (example: active, public, non-homeschool, non-redacted)
    // Adapt this filter based on the exact criteria needed
    const filteredSchools = schools.filter(school => {
        const isActive = school.Status === 'Active';
        const isPublic = school['Public Yes/No'] === 'Y'; // Check property name
        const programType = (school['Educational Program Type'] as string)?.toLowerCase() || '';
        const schoolName = (school.School as string)?.toLowerCase() || '';
        const streetAddress = school['Street Address'] as string;
        const isHomeschoolProgram = programType === 'homeschool';
        const isHomeschoolName = schoolName === 'homeschool';
        const isAddressRedacted = streetAddress === 'Information Redacted';
        return isActive && isPublic && !isHomeschoolProgram && !isHomeschoolName && !isAddressRedacted;
    }).sort((a, b) => (a.School || '').localeCompare(b.School || ''));


    const pageProps = {
        district,
        schools: filteredSchools,
        cdsCode,
        title: district ? `${district.District} | District Details` : 'District Not Found'
    };

    return {
        pageContext: {
            pageProps
        }
    }
}

export default onBeforeRender; 