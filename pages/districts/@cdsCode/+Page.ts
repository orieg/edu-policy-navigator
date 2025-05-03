// pages/districts/@cdsCode/+Page.ts
// Environment: server/client

import type { PageProps } from './types'
import '../../style.css'

export { Page }

interface DistrictPageProps extends PageProps {
    district: any;
    schools: any[];
    cdsCode: string;
}

function Page(pageProps: DistrictPageProps) {
    const { district, schools, cdsCode } = pageProps

    if (!district) {
        return `<p>District data not found for CDS Code: ${cdsCode}</p>`
    }

    // Helper functions now return strings or string components
    const formatAddress = (street: string, city: string, state: string, zip: string): string => {
        const parts = [street, city, state, zip].filter(p => p && p !== 'No Data');
        if (parts.length >= 3) return `${parts[0]}, ${parts[1]}, ${parts[2]} ${parts[3] || ''}`.trim();
        if (parts.length === 2) return `${parts[0]}, ${parts[1]}`;
        return parts[0] || 'Address Not Available';
    }

    const formatWebsiteLink = (url: string): string => {
        if (!url || url === 'No Data') return 'Website Not Available';
        let href = url.trim();
        if (href.includes('.') && !href.startsWith('http') && !href.startsWith('//')) {
            href = `//${href}`;
        }
        // Use html escape for attributes potentially? For now, direct string.
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    }

    const districtAddress = formatAddress(district['Street Address'], district['Street City'], district['Street State'], district['Street Zip']);
    const gradeSpan = (district['Low Grade'] && district['High Grade'] && district['Low Grade'] !== 'No Data' && district['High Grade'] !== 'No Data') ? `${district['Low Grade']} - ${district['High Grade']}` : 'N/A';
    const dashboardLink = `https://www.caschooldashboard.org/reports/gissearch/districts/${cdsCode}`;

    // Build school list HTML string
    let schoolsHtml = '<p>No active, public schools found matching criteria for this district.</p>';
    if (schools && schools.length > 0) {
        schoolsHtml = '<ul class="school-list">';
        schools.forEach((school: any) => {
            const schoolCds = school['CDS Code'];
            const schoolGradeSpan = (school['Low Grade'] && school['High Grade'] && school['Low Grade'] !== 'No Data' && school['High Grade'] !== 'No Data') ? `(${school['Low Grade']} - ${school['High Grade']})` : '';
            const schoolAddress = formatAddress(school['Street Address'], school['Street City'], school['Street State'], school['Street Zip']);
            const schoolWebsiteLink = formatWebsiteLink(school.Website);
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
            ${schoolWebsiteLink}
          </div>
          <div class="school-address">
            ${schoolAddress}
          </div>
        </li>
      `;
        });
        schoolsHtml += '</ul>';
    }

    // Return the full page structure as an HTML string
    return `
    <article class="district-page" data-cds-code="${cdsCode}">
      <div class="info-card">
        <h2>${district.District || 'Unknown District'} (${cdsCode})</h2>
        <div class="dashboard-link">
           <a href="${dashboardLink}" target="_blank" rel="noopener noreferrer">View on CA School Dashboard</a>
        </div>
        <p><strong>Status:</strong> ${district.Status || 'N/A'}</p>
        <p><strong>Type:</strong> ${district['Entity Type'] || 'N/A'}</p>
        <p><strong>Grades:</strong> ${gradeSpan}</p>
        <p><strong>Address:</strong> ${districtAddress}</p>
        <p><strong>Website:</strong> ${formatWebsiteLink(district.Website)}</p>
        <p><strong>Phone:</strong> ${district.Phone || 'N/A'}</p>
      </div>

      <div id="info-map-${cdsCode}">Loading Map...</div>

      <div class="school-list-section">
        <h3>Schools in District (${schools?.length || 0})</h3>
        ${schoolsHtml}
      </div>
    </article>
  `;
}

// Define default title (can be set dynamically in +onBeforeRender) - MOVED to +config.ts
// export const title = 'Unofficial District Details' 