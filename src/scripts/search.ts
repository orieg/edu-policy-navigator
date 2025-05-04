// src/search.ts

import type { DistrictDataMap, DistrictDetails, SchoolDetails, SchoolsByDistrictMap } from './types';
// Import map functions if search needs to trigger map updates (currently not used directly in search logic)
// import { updateMapForDistrict } from './map';

let filteredDistricts: DistrictDetails[] = [];
let highlightIndex = -1;

// Store references to DOM elements - will be fetched inside setupSearchHandlers
let searchInputEl: HTMLInputElement | null = null;
let resultsListEl: HTMLDivElement | null = null;
let infoDisplayEl: HTMLElement | null = null; // Keep for potential future use, though navigation is primary
let allDistricts: DistrictDataMap | null = null;
let allSchools: SchoolsByDistrictMap | null = null; // Keep for potential future use

function filterDistricts(searchTerm: string) {
    if (!allDistricts) {
        filteredDistricts = [];
        return;
    }
    const lowerCaseTerm = searchTerm.toLowerCase();
    if (!lowerCaseTerm) {
        filteredDistricts = [];
        return;
    }
    filteredDistricts = Object.values(allDistricts)
        .filter(district =>
            district.District?.toLowerCase().includes(lowerCaseTerm) &&
            district.Status === 'Active' // Example filter
        )
        .sort((a, b) => (a.District || '').localeCompare(b.District || ''))
        .slice(0, 10); // Limit results
}

function displayResults() {
    if (!resultsListEl) return;
    resultsListEl.innerHTML = ''; // Clear previous results
    highlightIndex = -1;

    if (filteredDistricts.length === 0) {
        resultsListEl.hidden = true;
        return;
    }

    filteredDistricts.forEach((district, index) => {
        const item = document.createElement('div');
        item.textContent = district.District;
        item.dataset.id = district['CDS Code'];
        item.role = 'option'; // Accessibility
        item.tabIndex = -1; // Allow focus via keyboard
        item.addEventListener('click', () => {
            selectDistrict(district);
        });
        item.addEventListener('mouseover', () => {
            updateHighlight(index);
        });
        resultsListEl?.appendChild(item);
    });
    resultsListEl.hidden = false;
}

async function selectDistrict(district: DistrictDetails) {
    if (!searchInputEl || !resultsListEl) return; // Removed infoDisplayEl check as it might not be needed for navigation

    const cdsCode = district['CDS Code'];
    const slug = district['slug']; // Get the slug from the district data

    console.log(`District selected: ${district.District}, Slug: ${slug}, CDS: ${cdsCode}`);

    if (!slug) {
        console.error("Error: Selected district data is missing the 'slug' property. Cannot navigate.");
        // Optionally display an error message to the user (e.g., in resultsListEl or a dedicated error area)
        if (resultsListEl) resultsListEl.innerHTML = '<p class="error">Could not generate link for the selected district.</p>';
        searchInputEl.value = district.District || ''; // Keep name in input
        // resultsListEl.hidden = true; // Keep results open to show error?
        filteredDistricts = [];
        return;
    }

    // Navigate to the pre-rendered district page using its slug
    window.location.href = `/districts/${slug}`;

    // Reset search state after navigation attempt
    searchInputEl.value = '';
    resultsListEl.hidden = true;
    filteredDistricts = [];
}

function updateHighlight(newIndex: number) {
    if (!resultsListEl) return;
    const items = resultsListEl.querySelectorAll('div[role="option"]');
    if (highlightIndex >= 0 && items[highlightIndex]) {
        items[highlightIndex].classList.remove('highlighted');
    }
    highlightIndex = newIndex;
    if (highlightIndex >= 0 && items[highlightIndex]) {
        items[highlightIndex].classList.add('highlighted');
        items[highlightIndex].scrollIntoView({ block: 'nearest' });
    }
}

function handleInput(event: Event) {
    const searchTerm = (event.target as HTMLInputElement).value;
    filterDistricts(searchTerm);
    displayResults();
}

function handleKeyDown(event: KeyboardEvent) {
    if (!resultsListEl || resultsListEl.hidden) return;
    const items = resultsListEl.querySelectorAll('div[role="option"]');
    if (items.length === 0) return;

    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            updateHighlight(highlightIndex < items.length - 1 ? highlightIndex + 1 : 0);
            break;
        case 'ArrowUp':
            event.preventDefault();
            updateHighlight(highlightIndex > 0 ? highlightIndex - 1 : items.length - 1);
            break;
        case 'Enter':
            event.preventDefault();
            if (highlightIndex >= 0 && filteredDistricts[highlightIndex]) {
                selectDistrict(filteredDistricts[highlightIndex]);
            }
            break;
        case 'Escape':
            resultsListEl.hidden = true;
            filteredDistricts = [];
            break;
    }
}

function handleBlur(event: FocusEvent) {
    // Use relatedTarget to check if focus moved within the results list
    const relatedTarget = event.relatedTarget as Node;
    if (!resultsListEl?.contains(relatedTarget)) {
        // Adding a small delay allows click events on results to fire before hiding
        setTimeout(() => {
            if (resultsListEl) resultsListEl.hidden = true;
        }, 150); // 150ms delay
    }
}


// Main setup function called from Astro page script
export function setupSearchHandlers(
    inputElementId: string,
    resultsElementId: string,
    // infoElementId: string, // Optional: ID for info display if needed
    districts: DistrictDataMap,
    schools: SchoolsByDistrictMap // Keep schools data if needed for future features
) {
    // Get elements by ID inside the function
    searchInputEl = document.getElementById(inputElementId) as HTMLInputElement;
    resultsListEl = document.getElementById(resultsElementId) as HTMLDivElement;
    // infoDisplayEl = document.getElementById(infoElementId);

    if (!searchInputEl || !resultsListEl) {
        console.error('Search input or results element not found. Search handlers not attached.');
        return;
    }

    // Store data globally within the module
    allDistricts = districts;
    allSchools = schools;

    searchInputEl.addEventListener('input', handleInput);
    searchInputEl.addEventListener('blur', handleBlur);
    searchInputEl.addEventListener('keydown', handleKeyDown);
    console.log('Search event listeners added.');
}


// Function to display district info - Kept for potential future use, but not primary for SSG nav
/*
export async function displayDistrictInfo(
    infoElement: HTMLElement, // Takes the element directly if called
    districtData: DistrictDetails,
    schoolsData: SchoolDetails[] // This data should already be filtered by +onBeforeRender
) {
    const districtName = districtData.District || 'N/A';
    const districtCdsCode = districtData['CDS Code'] || 'N/A';

    // Helper to format address (can be moved to utils)
    const formatAddress = (street: string, city: string, state: string, zip: string): string => {
        const parts = [street, city, state, zip].filter(p => p && p !== 'No Data');
        if (parts.length >= 3) return `${parts[0]}, ${parts[1]}, ${parts[2]} ${parts[3] || ''}`.trim();
        if (parts.length === 2) return `${parts[0]}, ${parts[1]}`;
        return parts[0] || 'Address Not Available';
    }

    // Helper to format website link (can be moved to utils)
    const formatWebsiteLink = (url: string): string => {
        if (!url || url === 'No Data') return 'Website Not Available';
        let href = url.trim();
        if (href.includes('.') && !href.startsWith('http') && !href.startsWith('//')) {
            href = `//${href}`;
        }
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    }

    const districtAddress = formatAddress(districtData['Street Address'], districtData['Street City'], districtData['Street State'], districtData['Street Zip']);
    const gradeSpan = (districtData['Low Grade'] && districtData['High Grade'] && districtData['Low Grade'] !== 'No Data' && districtData['High Grade'] !== 'No Data') ? `${districtData['Low Grade']} - ${districtData['High Grade']}` : 'N/A';
    const dashboardLink = `https://www.caschooldashboard.org/reports/gissearch/districts/${districtCdsCode}`;

    // Build school list HTML string using the PRE-FILTERED schoolsData from props
    let schoolsHtml = '<p>No active, public schools with valid coordinates found.</p>';
    if (schoolsData && schoolsData.length > 0) { // Use schoolsData directly
        schoolsHtml = '<ul class="school-list">';
        schoolsData.forEach((school) => { // Iterate over schoolsData
            const schoolCds = school['CDS Code'];
            const schoolGradeSpan = (school['Low Grade'] && school['High Grade'] && school['Low Grade'] !== 'No Data' && school['High Grade'] !== 'No Data') ? `(${school['Low Grade']} - ${school['High Grade']})` : '';
            const schoolAddress = formatAddress(school['Street Address'], school['Street City'], school['Street State'], school['Street Zip']);
            const schoolWebsiteLink = formatWebsiteLink(school.Website);
            const schoolDashboardLink = `https://www.caschooldashboard.org/reports/gissearch/schools/${schoolCds}`;
            const schoolCdeLink = `https://www.cde.ca.gov/schooldirectory/details?cdscode=${schoolCds}`;
            schoolsHtml += `
            <li key="${schoolCds}">
              <div class="school-name-grades"><strong>${school.School || 'Unknown School'}</strong> ${schoolGradeSpan}</div>
              <div class="school-links"><a href="${schoolDashboardLink}" target="_blank" rel="noopener noreferrer">Dashboard</a> | <a href="${schoolCdeLink}" target="_blank" rel="noopener noreferrer">CDE Profile</a> | ${schoolWebsiteLink}</div>
              <div class="school-address">${schoolAddress}</div>
            </li>
          `;
        });
        schoolsHtml += '</ul>';
    }

    // Generate combined HTML for the info display area
    const infoHtml = `
        <article class="district-page" data-cds-code="${districtCdsCode}">
          <div class="district-details-content"> 
            <div class="info-card">
              <h2>${districtName} (${districtCdsCode})</h2>
              <div class="dashboard-link"><a href="${dashboardLink}" target="_blank" rel="noopener noreferrer">View on CA School Dashboard</a></div>
              <p><strong>Status:</strong> ${districtData.Status || 'N/A'}</p>
              <p><strong>Type:</strong> ${districtData['Entity Type'] || 'N/A'}</p>
              <p><strong>Grades:</strong> ${gradeSpan}</p>
              <p><strong>Address:</strong> ${districtAddress}</p>
              <p><strong>Website:</strong> ${formatWebsiteLink(districtData.Website)}</p>
              <p><strong>Phone:</strong> ${districtData.Phone || 'N/A'}</p>
            </div>
            <div class="school-list-section">
              <h3>Active Public Schools (${schoolsData?.length || 0})</h3> <!-- Use schoolsData count -->
              ${schoolsHtml}
            </div>
          </div>
          <div class="district-map-container"> 
             <div id="info-map-${districtCdsCode}">Loading Map...</div>
          </div>
        </article>
    `;

    infoElement.innerHTML = infoHtml;
    console.log(`Updated info display for ${districtName}`);

    // --- Trigger Map Update --- 
    // This part is likely handled by the district page itself now
    // const mapElement = infoElement.querySelector<HTMLElement>(`#info-map-${districtCdsCode}`);
    // if (mapElement) {
    //     await updateMapForDistrict(mapElement.id, districtData, schoolsData);
    // } else {
    //     console.warn(`Map element #info-map-${districtCdsCode} not found after updating info display.`);
    // }
}
*/ 