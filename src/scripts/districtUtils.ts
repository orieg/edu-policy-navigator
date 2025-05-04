import fs from 'node:fs/promises';
import path from 'node:path';
import type { DistrictDetails, SchoolDetails, DistrictDataMap, SchoolsByDistrictMap } from './types';

// --- Data Loading Helpers ---
export async function loadDistrictData(): Promise<DistrictDataMap> {
    const filePath = path.resolve(process.cwd(), 'public/assets/districts.json');
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(fileContent);
    } catch (error) {
        console.error("Error loading districts.json:", error);
        throw new Error("Could not load district data.");
    }
}

export async function loadSchoolsData(): Promise<SchoolsByDistrictMap> {
    const filePath = path.resolve(process.cwd(), 'public/assets/schools_by_district.json');
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(fileContent);
    } catch (error) {
        console.error("Error loading schools_by_district.json:", error);
        throw new Error("Could not load schools data.");
    }
}

// --- Validation Helper ---
export function isValidCoordinate(lat: string | number | null | undefined, lon: string | number | null | undefined): lat is number | string {
    if (lat == null || lon == null) return false;
    const latStr = String(lat).toLowerCase();
    const lonStr = String(lon).toLowerCase();
    if (latStr === 'no data' || lonStr === 'no data' || latStr.includes('redacted') || lonStr.includes('redacted')) return false;
    const latNum = parseFloat(String(lat));
    const lonNum = parseFloat(String(lon));
    return !isNaN(latNum) && !isNaN(lonNum) && latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180;
}

// --- Formatting Helpers ---
export const formatAddress = (street: string, city: string, state: string, zip: string): string => {
    const parts = [street, city, state, zip].filter(p => p && p !== 'No Data');
    if (parts.length >= 3) return `${parts[0]}, ${parts[1]}, ${parts[2]} ${parts[3] || ''}`.trim();
    if (parts.length === 2) return `${parts[0]}, ${parts[1]}`;
    return parts[0] || 'Address Not Available';
}

export const formatWebsiteLink = (url: string): string => {
    if (!url || url === 'No Data') return 'Website Not Available';
    let href = url.trim();
    if (href.includes('.') && !href.startsWith('http') && !href.startsWith('//')) {
        href = `//${href}`;
    }
    // Return just the href for use in Astro's <a href={href}> which handles escaping
    return href;
}

// --- HTML Rendering Helper (If complex, consider an Astro Component) ---
export function renderDistrictInfoHtml(district: DistrictDetails, schools: SchoolDetails[]): string {
    const cdsCode = district['CDS Code'] || 'unknown';
    if (!district) {
        return `<p>District data not found.</p>`;
    }

    const districtAddress = formatAddress(district['Street Address'], district['Street City'], district['Street State'], district['Street Zip']);
    const gradeSpan = (district['Low Grade'] && district['High Grade'] && district['Low Grade'] !== 'No Data' && district['High Grade'] !== 'No Data') ? `${district['Low Grade']} - ${district['High Grade']}` : 'N/A';
    const dashboardLink = `https://www.caschooldashboard.org/reports/gissearch/districts/${cdsCode}`;
    const cdeProfileLink = `https://www.cde.ca.gov/schooldirectory/details?cdscode=${cdsCode}`;
    const districtWebsiteHref = formatWebsiteLink(district.Website);

    let schoolsHtml = '<p>No active, public schools found matching criteria for this district.</p>';
    if (schools && schools.length > 0) {
        schoolsHtml = '<ul class="school-list">';
        schools.forEach((school: SchoolDetails) => {
            const schoolCds = school['CDS Code'];
            const schoolGradeSpan = (school['Low Grade'] && school['High Grade'] && school['Low Grade'] !== 'No Data' && school['High Grade'] !== 'No Data') ? `(${school['Low Grade']} - ${school['High Grade']})` : '';
            const schoolAddress = formatAddress(school['Street Address'], school['Street City'], school['Street State'], school['Street Zip']);
            const schoolWebsiteHref = formatWebsiteLink(school.Website);
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
                    ${school.Website !== 'No Data' ? `<a href="${schoolWebsiteHref}" target="_blank" rel="noopener noreferrer">${school.Website}</a>` : 'Website Not Available'}
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
                ${district.Website !== 'No Data' ? `<a href="${districtWebsiteHref}" target="_blank" rel="noopener noreferrer">${district.Website}</a>` : 'Website Not Available'}
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