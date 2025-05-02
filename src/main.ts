import L from 'leaflet'; // Import Leaflet
import { OpenStreetMapProvider } from 'leaflet-geosearch'; // Import Geosearch Provider
import { GeoJsonObject, Feature } from 'geojson'; // Import GeoJSON type and Feature type

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
// let districtBoundariesGeoJson: GeoJsonObject | null = null; // REMOVED - Load on demand
let filteredDistricts: DistrictDetails[] = []; // Store currently filtered districts
let selectedDistrictId: string | null = null;
let highlightIndex = -1; // For keyboard navigation
let mapInstance: L.Map | null = null; // Keep track of the map instance
let boundaryLayer: L.GeoJSON | null = null; // Store the current boundary layer
const geoSearchProvider = new OpenStreetMapProvider(); // Instantiate provider

// --- Functions ---
async function fetchDistrictData() {
    console.log('Fetching districts data...');
    try {
        const districtsResponse = await fetch('/assets/districts.json');
        if (!districtsResponse.ok) throw new Error(`Districts fetch failed: ${districtsResponse.status}`);
        const districtsData = await districtsResponse.json();
        if (typeof districtsData !== 'object' || districtsData === null || Array.isArray(districtsData)) {
            throw new Error('Invalid district data format received (expected object map).');
        }
        allDistricts = districtsData as DistrictDataMap;
        console.log(`Loaded data for ${Object.keys(allDistricts).length} districts.`);
        searchInput?.removeAttribute('disabled');
        console.log('Search input enabled.');

    } catch (error) {
        console.error("Failed during data fetching:", error);
        if (infoDisplay) {
            infoDisplay.innerHTML = '<p class="error">Error loading initial data. Please try refreshing.</p>';
        }
        if (searchInput) searchInput.disabled = true;
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
        const url = `https://www.caschooldashboard.org/reports/${cdsCode}/2024`;
        content += `<div class="dashboard-link">
                       <a href="${url}" target="_blank" rel="noopener noreferrer">View CA School Dashboard Report (2024)</a>
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
    content += `<div id="${mapContainerId}"></div>`; // Always add container now
    content += '</div>'; // End grid container
    content += '</div>'; // End info-card

    // Set the HTML content
    infoDisplay.innerHTML = content;

    // --- Initialize or update map --- 
    const mapElement = document.getElementById(mapContainerId);
    if (!mapElement) {
        console.error('Map container element not found after setting innerHTML.');
        return;
    }

    // Remove previous map instance and boundary layer
    if (boundaryLayer) {
        boundaryLayer.remove();
        boundaryLayer = null;
    }
    if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
    }

    let mapCoords: L.LatLngTuple | null = null;
    let mapZoom = 10; // Default zoom slightly more out
    let foundBoundary = false;
    let districtFeature: Feature | null = null;

    // 1. Try fetching individual boundary file
    if (cdsCode !== 'N/A') {
        // Sanitize ID for filename match
        const filenameId = String(cdsCode).replace(/[^a-zA-Z0-9_-]/g, '_');
        const boundaryUrl = `/assets/boundaries/${filenameId}.geojson`;
        console.log(`Attempting to fetch boundary: ${boundaryUrl}`);
        try {
            const response = await fetch(boundaryUrl);
            if (response.ok) {
                districtFeature = await response.json() as Feature;
                if (districtFeature && districtFeature.type === 'Feature') {
                    console.log(`Found boundary feature for ${districtName}`);
                    mapInstance = L.map(mapContainerId); // Create map instance first
                    boundaryLayer = L.geoJSON(districtFeature, {
                        style: {
                            color: "#0056b3", // Border color
                            weight: 2,
                            opacity: 0.7,
                            fillColor: "#0056b3", // Fill color
                            fillOpacity: 0.1
                        }
                    }).addTo(mapInstance);
                    mapInstance.fitBounds(boundaryLayer.getBounds());
                    foundBoundary = true;
                } else {
                    console.warn(`Fetched boundary file ${boundaryUrl} is not a valid GeoJSON Feature.`);
                }
            } else {
                console.warn(`Boundary file not found or fetch failed (${response.status}): ${boundaryUrl}`);
            }
        } catch (error) {
            console.error(`Error fetching or parsing boundary file ${boundaryUrl}:`, error);
        }
    }

    // 2. Fallback to Lat/Lon if boundary fetch failed or wasn't attempted
    if (!foundBoundary) {
        const latString = districtData.Latitude as string;
        const lonString = districtData.Longitude as string;
        const hasValidLatLonData = latString && lonString && latString !== 'No Data' && lonString !== 'No Data';
        if (hasValidLatLonData) {
            try {
                const lat = parseFloat(latString);
                const lon = parseFloat(lonString);
                if (!isNaN(lat) && !isNaN(lon)) {
                    mapCoords = [lat, lon];
                    mapZoom = 13; // Zoom closer for point
                }
            } catch (e) { console.error('Error parsing Lat/Lon:', e); }
        }
    }

    // 3. Fallback to geosearch if other methods failed
    if (!foundBoundary && !mapCoords && addressParts) {
        const addressQuery = addressParts; // Declare before use
        console.log(`Attempting geosearch for ${districtName} with query: "${addressQuery}"`);
        try {
            const results = await geoSearchProvider.search({ query: addressQuery });
            if (results && results.length > 0) {
                console.log('Geosearch successful:', results[0]);
                mapCoords = [results[0].y, results[0].x];
                mapZoom = 15; // Zoom closer for geocoded point
            } else {
                console.warn(`Geosearch returned no results for "${addressQuery}"`);
            }
        } catch (error) {
            console.error(`Geosearch failed for "${addressQuery}":`, error);
        }
    }

    // Initialize point map if boundary wasn't shown but coords were found
    if (!foundBoundary && mapCoords) {
        try {
            console.log(`Initializing map for ${districtName} point at [${mapCoords[0]}, ${mapCoords[1]}]`);
            mapInstance = L.map(mapContainerId).setView(mapCoords, mapZoom);
            L.marker(mapCoords).addTo(mapInstance).bindPopup(districtName);
        } catch (e) {
            console.error('Error initializing Leaflet point map instance:', e);
        }
    }

    // Add base tiles if map was initialized
    if (mapInstance) {
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(mapInstance);
    } else {
        // Only show error if no map could be made at all
        mapElement.innerHTML = '<p>Map location could not be determined.</p>';
    }
}

// --- Initialization ---
async function initializeApp() {
    console.log('Initializing app...');
    if (!searchInput || !resultsList || !infoDisplay) {
        console.error('Required DOM elements not found:', { searchInput, resultsList, infoDisplay });
        return;
    }
    console.log('Required DOM elements found.');

    searchInput.disabled = true;
    console.log('Search input initially disabled.');
    await fetchDistrictData(); // Changed from fetchData

    // Add event listeners
    searchInput.addEventListener('input', handleInput);
    searchInput.addEventListener('focus', handleFocus);
    searchInput.addEventListener('blur', handleBlur);
    searchInput.addEventListener('keydown', handleKeyDown);
    console.log('Event listeners added to search input.');

    // Initial message
    infoDisplay.innerHTML = '<p>Search for and select a district to see information.</p>';
    console.log('App initialization complete.');
}

// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', initializeApp); 