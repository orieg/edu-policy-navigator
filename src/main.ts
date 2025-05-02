import L from 'leaflet'; // Import Leaflet
import { OpenStreetMapProvider } from 'leaflet-geosearch'; // Import Geosearch Provider
import { GeoJsonObject, Feature, Point, Polygon, MultiPolygon } from 'geojson'; // Import GeoJSON type and geometry types
import proj4 from 'proj4'; // Import proj4

// --- proj4 Configuration ---
// Define the projections we'll use
proj4.defs('EPSG:3857', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs');
proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');

// Create a transformation function
const transform3857To4326 = proj4('EPSG:3857', 'EPSG:4326');

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

// Add type for School Details
interface SchoolDetails {
    [key: string]: string | number | null;
    // Ensure these specific keys exist based on generateDistrictJson.ts
    'CDS Code': string;
    'School': string;
    'Status': string; // For filtering
}

// Add type for the schools data structure
interface SchoolsByDistrictMap {
    [districtCdsCode: string]: SchoolDetails[];
}

// --- State ---
let allDistricts: DistrictDataMap = {};
let allSchoolsByDistrict: SchoolsByDistrictMap = {}; // <-- Add state for schools
let filteredDistricts: DistrictDetails[] = []; // Store currently filtered districts
let selectedDistrictId: string | null = null;
let highlightIndex = -1; // For keyboard navigation
let mapInstance: L.Map | null = null; // Keep track of the map instance
let boundaryLayer: L.GeoJSON | null = null; // Store the current boundary layer
const geoSearchProvider = new OpenStreetMapProvider(); // Instantiate provider

// --- Functions ---
async function fetchAppData() { // Rename from fetchDistrictData
    console.log('Fetching app data (districts and schools)...');
    try {
        // Fetch districts
        const districtsResponse = await fetch('/assets/districts.json');
        if (!districtsResponse.ok) throw new Error(`Districts fetch failed: ${districtsResponse.status}`);
        const districtsData = await districtsResponse.json();
        if (typeof districtsData !== 'object' || districtsData === null || Array.isArray(districtsData)) {
            throw new Error('Invalid district data format received.');
        }
        allDistricts = districtsData as DistrictDataMap;
        console.log(`Loaded data for ${Object.keys(allDistricts).length} districts.`);

        // Fetch schools
        const schoolsResponse = await fetch('/assets/schools_by_district.json');
        if (!schoolsResponse.ok) throw new Error(`Schools fetch failed: ${schoolsResponse.status}`);
        const schoolsData = await schoolsResponse.json();
        if (typeof schoolsData !== 'object' || schoolsData === null || Array.isArray(schoolsData)) {
            throw new Error('Invalid schools data format received.');
        }
        allSchoolsByDistrict = schoolsData as SchoolsByDistrictMap;
        console.log(`Loaded school data for ${Object.keys(allSchoolsByDistrict).length} districts.`);

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

// --- Helper Function for Reprojection ---
function reprojectFeatureCoordinates(feature: Feature): Feature | null {
    if (!feature || !feature.geometry) return null;

    const geometry = feature.geometry;
    let transformedCoordinates: any[] = []; // Use any[] for flexibility

    try {
        if (geometry.type === 'Polygon') {
            transformedCoordinates = (geometry.coordinates as number[][][]).map(ring =>
                ring.map(point => transform3857To4326.forward(point as [number, number]))
            );
        } else if (geometry.type === 'MultiPolygon') {
            transformedCoordinates = (geometry.coordinates as number[][][][]).map(polygon =>
                polygon.map(ring =>
                    ring.map(point => transform3857To4326.forward(point as [number, number]))
                )
            );
        } else {
            console.warn(`[Reproject] Unsupported geometry type: ${geometry.type}`);
            return null; // Don't process other types for now
        }

        // Create a *new* feature object with the same properties but transformed geometry
        const transformedFeature: Feature = {
            ...feature, // Copy properties
            geometry: {
                ...geometry, // Copy geometry type
                coordinates: transformedCoordinates, // Use transformed coordinates
            } as Polygon | MultiPolygon // Assert the correct geometry type
        };
        return transformedFeature;

    } catch (error) {
        console.error("[Reproject] Error during coordinate transformation:", error, "Original feature:", feature);
        return null;
    }
}

// --- Display Logic ---
async function displayDistrictInfo(districtData: DistrictDetails) {
    if (!infoDisplay) return;
    const districtName = districtData.District || 'N/A';
    const districtCdsCode = districtData['CDS Code'] || 'N/A'; // 14-digit code
    const shortDistrictCdsCode = districtCdsCode.substring(0, 7); // 7-digit code for school lookup

    // --- Generate District Info Card HTML (unchanged) ---
    let districtCardHtml = `<div class="info-card"><h2>${districtName} (${districtCdsCode})</h2>`;
    if (districtCdsCode !== 'N/A') { const url = `https://www.caschooldashboard.org/reports/${districtCdsCode}/2024`; districtCardHtml += `<div class="dashboard-link"><a href="${url}" target="_blank" rel="noopener noreferrer">View CA School Dashboard Report (2024)</a></div>`; }
    districtCardHtml += `<div class="info-card-content">`;
    districtCardHtml += '<dl class="district-details">';
    const addDetail = (label: string, value: any) => { if (value && value !== 'No Data') { districtCardHtml += `<dt>${label}</dt><dd>${value}</dd>`; } };
    const addLinkDetail = (label: string, value: any, url?: string) => {
        if (value && value !== 'No Data') {
            let href = url || value;
            if (typeof href === 'string' && href.includes('.') && !href.startsWith('http') && !href.startsWith('//')) {
                href = `//${href}`;
            }
            if (typeof href === 'string' && (href.startsWith('http') || href.startsWith('//'))) {
                districtCardHtml += `<dt>${label}</dt><dd><a href="${href}" target="_blank" rel="noopener noreferrer">${value}</a></dd>`;
            } else {
                districtCardHtml += `<dt>${label}</dt><dd>${value}</dd>`;
            }
        }
    };
    addDetail('County', districtData.County); addDetail('Type', districtData['Entity Type']); addDetail('Status', districtData.Status); addDetail('Funding Type', districtData['Funding Type']);
    const addressParts = [districtData['Street Address'], districtData['Street City'], districtData['Street State'], districtData['Street Zip']].filter(part => part && part !== 'No Data').join(', '); addDetail('Address', addressParts);
    const lowGrade = districtData['Low Grade']; const highGrade = districtData['High Grade']; if (lowGrade && highGrade && lowGrade !== 'No Data' && highGrade !== 'No Data') { addDetail('Grade Span', `${lowGrade} - ${highGrade}`); }
    addDetail('Phone', districtData.Phone); addLinkDetail('Website', districtData.Website as string);
    districtCardHtml += '</dl>';
    const mapContainerId = 'info-map';
    districtCardHtml += `<div id="${mapContainerId}"></div>`;
    districtCardHtml += '</div></div>'; // End grid and card

    // --- Set District Card HTML First --- 
    infoDisplay.innerHTML = districtCardHtml;

    // --- Initialize or update map --- 
    const mapElement = document.getElementById(mapContainerId);
    if (!mapElement) {
        console.error('[Map] Map container element not found after setting innerHTML.');
        // Don't return here, we still want to show schools if possible
    } else {
        mapElement.innerHTML = ''; // Clear any previous message
        // Remove previous map instance and boundary layer
        if (boundaryLayer) { boundaryLayer.remove(); boundaryLayer = null; }
        if (mapInstance) { mapInstance.remove(); mapInstance = null; }
        mapInstance = null; // Ensure it's null before trying to create
        let mapCoords: L.LatLngTuple | null = null;
        let mapZoom = 10;
        let foundBoundary = false;
        let districtFeature: Feature | null = null;

        // --- Initialize Map Instance FIRST ---
        try {
            mapInstance = L.map(mapContainerId).setView([37.8, -122.4], 5);
            L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(mapInstance);
            console.log('[Map] Base map instance and tile layer created.');
        } catch (mapInitError) {
            console.error('[Map] Critical error initializing map instance or tile layer:', mapInitError);
            mapElement.innerHTML = '<p>Error initializing map.</p>';
            mapInstance = null; // Ensure mapInstance is null if init failed
        }

        // --- Try to add boundary or fallback (only if mapInstance exists) ---
        if (mapInstance) {
            // 1. Try fetching individual boundary file
            if (districtCdsCode !== 'N/A') {
                const filenameId = String(districtCdsCode).replace(/[^a-zA-Z0-9_-]/g, '_');
                const boundaryUrl = `/assets/boundaries/${filenameId}.geojson`;
                try {
                    const response = await fetch(boundaryUrl);
                    if (response.ok) {
                        const originalFeature = await response.json() as Feature;
                        const reprojectedFeature = reprojectFeatureCoordinates(originalFeature);
                        if (reprojectedFeature) {
                            boundaryLayer = L.geoJSON(reprojectedFeature, { style: { color: "#0056b3", weight: 2, opacity: 0.7, fillColor: "#0056b3", fillOpacity: 0.1 } }).addTo(mapInstance);
                            const bounds = boundaryLayer.getBounds();
                            if (bounds.isValid()) {
                                mapInstance.fitBounds(bounds);
                                mapInstance.invalidateSize();
                                foundBoundary = true;
                                // Add Address Marker (unchanged logic)
                                let markerCoords: L.LatLngTuple | null = null;
                                const latString = districtData.Latitude as string;
                                const lonString = districtData.Longitude as string;
                                const hasValidLatLonData = latString && lonString && latString !== 'No Data' && lonString !== 'No Data';

                                if (hasValidLatLonData) {
                                    try {
                                        const lat = parseFloat(latString);
                                        const lon = parseFloat(lonString);
                                        if (!isNaN(lat) && !isNaN(lon)) {
                                            markerCoords = [lat, lon];
                                        }
                                    } catch (e) { console.warn('[Map] Error parsing Lat/Lon for marker:', e); }
                                }

                                // If Lat/Lon invalid or missing, try geocoding the address
                                if (!markerCoords && addressParts) {
                                    console.log(`[Map] Lat/Lon invalid for marker, attempting geosearch for: "${addressParts}"`);
                                    try {
                                        const results = await geoSearchProvider.search({ query: addressParts });
                                        if (results && results.length > 0) {
                                            markerCoords = [results[0].y, results[0].x];
                                        }
                                    } catch (error) { console.warn(`[Map] Geosearch failed for marker address "${addressParts}":`, error); }
                                }

                                // Add the marker if coordinates were found
                                if (markerCoords) {
                                    L.marker(markerCoords)
                                        .addTo(mapInstance)
                                        .bindPopup(`<b>${districtName}</b><br>${addressParts || 'Address not available'}`);
                                    console.log(`[Map] Added address marker at [${markerCoords[0]}, ${markerCoords[1]}]`);
                                } else {
                                    console.warn(`[Map] Could not determine coordinates for address marker for ${districtName}.`);
                                }
                            } else {
                                console.error(`[Map] Could not fit map to invalid bounds for ${districtCdsCode}.`);
                                // Proceed to fallbacks
                            }
                        } else {
                            console.error(`[Map] Failed to reproject boundary for ${districtCdsCode}. Original feature:`, originalFeature);
                            // Proceed to fallbacks
                        }
                    } else {
                        console.warn(`[Map] Boundary file not found or fetch failed (${response.status}): ${boundaryUrl}`);
                    }
                } catch (error) {
                    console.error(`[Map] Error fetching, parsing, or processing boundary file ${boundaryUrl}:`, error);
                }
            }

            // 2. Fallback to Lat/Lon if boundary not found/added/reprojected/fitted
            if (!foundBoundary) {
                console.log('[Map] Boundary not shown, attempting Lat/Lon fallback.');
                const latString = districtData.Latitude as string;
                const lonString = districtData.Longitude as string;
                const hasValidLatLonData = latString && lonString && latString !== 'No Data' && lonString !== 'No Data';
                if (hasValidLatLonData) {
                    try {
                        const lat = parseFloat(latString);
                        const lon = parseFloat(lonString);
                        if (!isNaN(lat) && !isNaN(lon)) {
                            mapCoords = [lat, lon];
                            mapZoom = 13;
                        }
                    } catch (e) { console.error('Error parsing Lat/Lon:', e); }
                }
            }

            // 3. Fallback to geosearch if needed
            if (!foundBoundary && !mapCoords && addressParts) {
                const addressQuery = addressParts;
                console.log(`[Map] No boundary or Lat/Lon, attempting geosearch for: "${addressQuery}"`);
                try {
                    const results = await geoSearchProvider.search({ query: addressQuery });
                    if (results && results.length > 0) {
                        mapCoords = [results[0].y, results[0].x];
                        mapZoom = 15;
                    } else {
                        console.warn(`Geosearch returned no results for "${addressQuery}"`);
                    }
                } catch (error) {
                    console.error(`[Map] Geosearch failed for "${addressQuery}":`, error);
                }
            }

            // Set view to point if boundary wasn't found but coords were
            if (!foundBoundary && mapCoords) {
                try {
                    console.log(`[Map] Setting view to point for ${districtName} at [${mapCoords[0]}, ${mapCoords[1]}]`);
                    mapInstance.setView(mapCoords, mapZoom);
                    L.marker(mapCoords).addTo(mapInstance).bindPopup(districtName);
                    mapInstance.invalidateSize(); // Invalidate after setView
                } catch (e) { console.error('[Map] Error setting view/marker for point:', e); }
            }

            // Final check if map couldn't be positioned
            if (!foundBoundary && !mapCoords) {
                console.log('[Map] No boundary or point location found.');
                mapElement.innerHTML = '<p>Map location could not be determined.</p>';
            }
        } // End if(mapInstance)
    } // End if(mapElement)

    // --- Generate and Append School List HTML --- 
    let schoolsHtml = '';
    if (shortDistrictCdsCode && allSchoolsByDistrict[shortDistrictCdsCode]) {
        const schoolsInDistrict = allSchoolsByDistrict[shortDistrictCdsCode]
            .filter(school => school.Status === 'Active')
            .sort((a, b) => a.School.localeCompare(b.School));

        if (schoolsInDistrict.length > 0) {
            schoolsHtml += '<div class="schools-list-container">';
            schoolsHtml += `<h3>Schools in ${districtName} (${schoolsInDistrict.length})</h3>`;
            schoolsHtml += '<ul class="schools-list">';
            schoolsInDistrict.forEach(school => {
                const schoolName = school.School;
                const schoolCdsCode = school['CDS Code']; // Full 14-digit code
                const schoolAddress = [
                    school['Street Address'],
                    school['Street City'],
                    school['Street State'],
                    school['Street Zip']
                ].filter(part => part && part !== 'No Data').join(', ');
                const gradeSpan = (school['Low Grade'] && school['High Grade'] && school['Low Grade'] !== 'No Data' && school['High Grade'] !== 'No Data')
                    ? `(Grades: ${school['Low Grade']} - ${school['High Grade']})`
                    : '';

                // --- Add Website Link --- 
                let websiteLinkHtml = '';
                const websiteUrl = school.Website as string;
                if (websiteUrl && websiteUrl !== 'No Data') {
                    let href = websiteUrl;
                    // Basic URL correction (add // if missing protocol)
                    if (href.includes('.') && !href.startsWith('http') && !href.startsWith('//')) {
                        href = `//${href}`;
                    }
                    if (href.startsWith('http') || href.startsWith('//')) {
                        websiteLinkHtml = ` <a href="${href}" target="_blank" rel="noopener noreferrer" title="Visit school website">(Website)</a>`;
                    }
                }
                // --- End Website Link --- 

                // --- Add Dashboard Link --- 
                const dashboardUrl = `https://www.caschooldashboard.org/reports/${schoolCdsCode}/2024`;
                const dashboardLinkHtml = ` <a href="${dashboardUrl}" target="_blank" rel="noopener noreferrer" title="View CA School Dashboard report">(Report Card)</a>`;
                // --- End Dashboard Link --- 

                schoolsHtml += `<li>
                                  <div>
                                    <strong>${schoolName}</strong> ${gradeSpan}
                                    ${websiteLinkHtml}
                                    ${dashboardLinkHtml}
                                  </div>
                                  <small>${schoolAddress || 'Address not available'}</small>
                               </li>`;
            });
            schoolsHtml += '</ul>';
            schoolsHtml += '</div>';
        } else {
            schoolsHtml = '<div class="schools-list-container"><p>No active schools found for this district.</p></div>';
        }
    } else {
        // Optional message if no school data exists
    }

    // Append the schools HTML
    if (schoolsHtml) {
        infoDisplay.insertAdjacentHTML('beforeend', schoolsHtml);
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
    await fetchAppData(); // <-- Use renamed function

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