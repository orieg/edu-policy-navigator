import L from 'leaflet'; // Import Leaflet
import { OpenStreetMapProvider } from 'leaflet-geosearch'; // Import Geosearch Provider

// --- DOM Elements ---
const searchInput = document.getElementById('district-search-input') as HTMLInputElement | null;
const resultsList = document.getElementById('district-results') as HTMLDivElement | null;
const infoDisplay = document.getElementById('info-display') as HTMLElement | null;

// --- Types ---
interface DistrictDetails {
    [key: string]: string | number | null;
    // Ensure these specific keys exist based on generateDistrictJson.ts
    'CDS Code': string;
    'District': string;
}

interface DistrictDataMap {
    [id: string]: DistrictDetails;
}

// --- State ---
let allDistricts: DistrictDataMap = {}; // Store all fetched district data
let filteredDistricts: DistrictDetails[] = []; // Store currently filtered districts
let selectedDistrictId: string | null = null;
let highlightIndex = -1; // For keyboard navigation
let mapInstance: L.Map | null = null; // Keep track of the map instance
const geoSearchProvider = new OpenStreetMapProvider(); // Instantiate provider

// --- Functions ---
async function fetchDistricts(): Promise<void> {
    console.log('Attempting to fetch districts...'); // Log start
    try {
        const response = await fetch('/assets/districts.json');
        console.log('Fetch response status:', response.status); // Log status
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        console.log('Fetched data (type):', typeof data); // Log data type
        // console.log('Fetched data (sample):', JSON.stringify(data).substring(0, 200)); // Uncomment for sample

        // Basic validation (check if it's an object)
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
            console.error('Validation failed: Data is not an object map.'); // Log validation fail
            throw new Error('Invalid district data format received (expected object map).');
        }
        console.log('Data validation passed.'); // Log validation pass
        allDistricts = data as DistrictDataMap;
        console.log(`Loaded data for ${Object.keys(allDistricts).length} districts.`);
        if (searchInput) {
            searchInput.removeAttribute('disabled'); // Enable input after data loads
            console.log('Search input enabled.'); // Log enabling
        } else {
            console.error('Search input element was null when trying to enable.');
        }
    } catch (error) {
        console.error("Failed to fetch, parse, or validate districts:", error); // Log error
        if (infoDisplay) {
            infoDisplay.innerHTML = '<p class="error">Error loading district list. Please try refreshing.</p>';
        }
        if (searchInput) {
            searchInput.disabled = true;
            console.log('Search input explicitly disabled due to error.'); // Log disabling
        }
    }
}

function filterDistricts(searchTerm: string) {
    const lowerCaseTerm = searchTerm.toLowerCase();
    if (!lowerCaseTerm) {
        filteredDistricts = []; // Show nothing if search is empty
        return;
    }

    // Convert map to array, filter, sort, and limit results
    filteredDistricts = Object.values(allDistricts)
        .filter(district => district.District.toLowerCase().includes(lowerCaseTerm) && district.Status === 'Active')
        .sort((a, b) => a.District.localeCompare(b.District))
        .slice(0, 10); // Limit to 10 results for performance/UI
}

function displayResults() {
    if (!resultsList) return;

    console.log('Displaying results for:', filteredDistricts.map(d => ({ id: d['CDS Code'], name: d.District })));

    // Clear previous results more explicitly
    while (resultsList.firstChild) {
        resultsList.removeChild(resultsList.firstChild);
    }
    highlightIndex = -1;

    if (filteredDistricts.length === 0) {
        console.log('No filtered districts to display.'); // Log empty case
        resultsList.hidden = true;
        return;
    }

    filteredDistricts.forEach((district, index) => {
        const item = document.createElement('div');
        item.textContent = district.District; // Display name
        item.dataset.id = district['CDS Code']; // Store ID
        item.addEventListener('click', () => {
            selectDistrict(district);
        });
        // Add mouseover event to update highlight index for consistency
        item.addEventListener('mouseover', () => {
            updateHighlight(index);
        });
        resultsList.appendChild(item);
    });

    // Log the number of items actually added
    console.log(`Added ${resultsList.childElementCount} items to the results list.`);

    resultsList.hidden = false;
}

function selectDistrict(district: DistrictDetails) {
    if (!searchInput || !resultsList) return;

    selectedDistrictId = district['CDS Code'];
    searchInput.value = district.District; // Update input field
    resultsList.hidden = true; // Hide results
    filteredDistricts = []; // Clear filter
    displayDistrictInfo(district); // Display the full info card
}

function updateHighlight(newIndex: number) {
    if (!resultsList) return;
    const items = resultsList.querySelectorAll('div');
    if (highlightIndex >= 0 && items[highlightIndex]) {
        items[highlightIndex].classList.remove('highlighted');
    }
    highlightIndex = newIndex;
    if (highlightIndex >= 0 && items[highlightIndex]) {
        items[highlightIndex].classList.add('highlighted');
        // Optional: Scroll into view
        items[highlightIndex].scrollIntoView({ block: 'nearest' });
    }
}

function handleInput(event: Event) {
    const searchTerm = (event.target as HTMLInputElement).value;
    filterDistricts(searchTerm);
    displayResults();
}

function handleKeyDown(event: KeyboardEvent) {
    if (!resultsList || resultsList.hidden) return;
    const items = resultsList.querySelectorAll('div');
    if (items.length === 0) return;

    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault(); // Prevent cursor move
            updateHighlight(highlightIndex < items.length - 1 ? highlightIndex + 1 : 0);
            break;
        case 'ArrowUp':
            event.preventDefault(); // Prevent cursor move
            updateHighlight(highlightIndex > 0 ? highlightIndex - 1 : items.length - 1);
            break;
        case 'Enter':
            event.preventDefault();
            if (highlightIndex >= 0 && filteredDistricts[highlightIndex]) {
                selectDistrict(filteredDistricts[highlightIndex]);
            }
            break;
        case 'Escape':
            resultsList.hidden = true;
            filteredDistricts = [];
            break;
    }
}

function handleFocus() {
    // Optionally show recent/all results on focus, or just wait for input
    // if (searchInput && searchInput.value) {
    //   filterDistricts(searchInput.value);
    //   displayResults();
    // }
}

function handleBlur(event: FocusEvent) {
    // Delay hiding results to allow click event on results list to fire
    setTimeout(() => {
        // Check if the new focused element is inside the results list
        if (!resultsList?.contains(event.relatedTarget as Node)) {
            if (resultsList) resultsList.hidden = true;
        }
    }, 150);
}

// --- Display Logic ---
async function displayDistrictInfo(districtData: DistrictDetails) {
    if (!infoDisplay) return;

    const districtName = districtData.District || 'N/A';
    const cdsCode = districtData['CDS Code'] || 'N/A';

    let content = `<div class="info-card">
                     <h2>${districtName} (${cdsCode})</h2>`;

    // Add link to CA School Dashboard right below the header
    if (cdsCode !== 'N/A') {
        const dashboardUrl = `https://www.caschooldashboard.org/reports/${cdsCode}/2024`;
        content += `<div class="dashboard-link">
                       <a href="${dashboardUrl}" target="_blank" rel="noopener noreferrer">View CA School Dashboard Report (2024)</a>
                   </div>`;
    }

    content += `<div class="info-card-content">`; // Start grid container

    // --- Details Column --- 
    content += '<dl class="district-details">';

    // Helper function to add detail if value exists
    const addDetail = (label: string, value: string | number | null | undefined) => {
        if (value) {
            content += `<dt>${label}</dt><dd>${value}</dd>`;
        }
    };
    // Helper function for links
    const addLinkDetail = (label: string, value: string | null | undefined, url?: string) => {
        if (value) {
            let href = url || value;
            if (typeof href === 'string' && href.includes('.') && !href.startsWith('http') && !href.startsWith('//')) {
                href = `//${href}`;
            }
            if (typeof href === 'string' && (href.startsWith('http') || href.startsWith('//'))) {
                content += `<dt>${label}</dt><dd><a href="${href}" target="_blank" rel="noopener noreferrer">${value}</a></dd>`;
            } else {
                content += `<dt>${label}</dt><dd>${value}</dd>`; // Display as text if not valid URL
            }
        }
    };

    // Display selected details in a specific order
    addDetail('County', districtData.County);
    addDetail('Type', districtData['Entity Type']);
    addDetail('Status', districtData.Status);
    addDetail('Funding Type', districtData['Funding Type']);

    // Consolidate Address
    const addressParts = [
        districtData['Street Address'],
        districtData['Street City'],
        districtData['Street State'],
        districtData['Street Zip']
    ].filter(part => part).join(', '); // Join non-empty parts
    addDetail('Address', addressParts);

    // Consolidate Grades
    const lowGrade = districtData['Low Grade'];
    const highGrade = districtData['High Grade'];
    if (lowGrade && highGrade) {
        addDetail('Grade Span', `${lowGrade} - ${highGrade}`);
    }

    addDetail('Phone', districtData.Phone);
    addLinkDetail('Website', districtData.Website as string);

    content += '</dl>'; // End details list
    // --- End Details Column --- 

    // --- Map Column (Placeholder - actual map initialized later) --- 
    const mapContainerId = 'info-map';
    const latString = districtData.Latitude as string;
    const lonString = districtData.Longitude as string;
    const hasValidLatLonData = latString && lonString && latString !== 'No Data' && lonString !== 'No Data';
    let showMapContainer = hasValidLatLonData;
    let geosearchAttempted = false;

    if (!hasValidLatLonData && addressParts) { // Use consolidated address for check
        showMapContainer = true;
        geosearchAttempted = true;
    }

    if (showMapContainer) {
        // Add the map container div - CSS grid will place it
        content += `<div id="${mapContainerId}"></div>`;
    }
    // --- End Map Column --- 

    content += '</div>'; // End grid container
    content += '</div>'; // End info-card

    // Set the HTML content first
    infoDisplay.innerHTML = content;

    // --- Initialize or update map (logic remains the same) --- 
    if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
    }
    if (showMapContainer) {
        const mapElement = document.getElementById(mapContainerId);
        if (!mapElement) {
            console.error('Map container element not found after setting innerHTML.');
            return;
        }
        let mapCoords: L.LatLngTuple | null = null;
        let mapZoom = 13;
        if (hasValidLatLonData) {
            // ... (parse lat/lon logic - unchanged) ...
            try {
                const lat = parseFloat(latString);
                const lon = parseFloat(lonString);
                if (!isNaN(lat) && !isNaN(lon)) {
                    mapCoords = [lat, lon];
                } else {
                    console.warn(`Could not parse Lat/Lon numbers for ${districtName}:`, latString, lonString);
                }
            } catch (e) {
                console.error('Error parsing Lat/Lon:', e);
            }
        } else if (geosearchAttempted) {
            // Use consolidated address for geosearch query
            const addressQuery = addressParts; // Already built above
            console.log(`Attempting geosearch for ${districtName} with query: "${addressQuery}"`);
            try {
                const results = await geoSearchProvider.search({ query: addressQuery });
                if (results && results.length > 0) {
                    console.log('Geosearch successful:', results[0]);
                    mapCoords = [results[0].y, results[0].x];
                    mapZoom = 15;
                } else {
                    console.warn(`Geosearch returned no results for "${addressQuery}"`);
                }
            } catch (error) {
                console.error(`Geosearch failed for "${addressQuery}":`, error);
            }
        }
        if (mapCoords) {
            // ... (map initialization logic - unchanged) ...
            try {
                console.log(`Initializing map for ${districtName} at [${mapCoords[0]}, ${mapCoords[1]}]`);
                mapInstance = L.map(mapContainerId).setView(mapCoords, mapZoom);
                L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                }).addTo(mapInstance);
                L.marker(mapCoords).addTo(mapInstance)
                    .bindPopup(districtName);
            } catch (e) {
                console.error('Error initializing Leaflet map instance:', e);
            }
        } else {
            mapElement.innerHTML = '<p>Map location could not be determined.</p>';
        }
    }
}

// --- Initialization ---
async function initializeApp() {
    console.log('Initializing app...'); // Log init start
    if (!searchInput || !resultsList || !infoDisplay) {
        console.error('Required DOM elements not found:', { searchInput, resultsList, infoDisplay }); // Log missing elements
        return;
    }
    console.log('Required DOM elements found.');

    searchInput.disabled = true; // Disable until data loads
    console.log('Search input initially disabled.');
    await fetchDistricts(); // Fetch data first

    // Add event listeners
    searchInput.addEventListener('input', handleInput);
    searchInput.addEventListener('focus', handleFocus);
    searchInput.addEventListener('blur', handleBlur);
    searchInput.addEventListener('keydown', handleKeyDown);
    console.log('Event listeners added to search input.');

    // Initial message
    infoDisplay.innerHTML = '<p>Search for and select a district to see information.</p>';
    console.log('App initialization complete.'); // Log init end
}

// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', initializeApp);
document.addEventListener('DOMContentLoaded', initializeApp); 