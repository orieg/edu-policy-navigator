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
    'Public Yes/No': string; // Add this field
    'Educational Program Type': string; // Add this field
    Latitude: string; // Add Latitude
    Longitude: string; // Add Longitude
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
let mapInstance: L.Map | null = null;
let boundaryLayer: L.GeoJSON | null = null;
let districtMarker: L.Marker | null = null; // Store district marker if created
let schoolMarkersLayer: L.LayerGroup | null = null; // Layer group for school markers
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

    // --- Clear Previous Map Layers --- 
    if (boundaryLayer) { boundaryLayer.remove(); boundaryLayer = null; }
    if (districtMarker) { districtMarker.remove(); districtMarker = null; } // Remove district marker
    if (schoolMarkersLayer) { schoolMarkersLayer.remove(); schoolMarkersLayer = null; } // Remove school markers
    if (mapInstance) {
        // Don't remove the map instance itself here, just clear layers
        // If we need to recreate, do it below mapElement check 
    } else {
        // If no map instance exists yet, we'll create it below
    }

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
    } else {
        // --- Explicitly remove old map instance before setTimeout ---
        if (mapInstance) {
            // console.log('[Map] Removing existing map instance.');
            mapInstance.remove();
            mapInstance = null; // Ensure it's null before re-initialization attempt
        }
        // --- End removal ---

        // --- Use setTimeout to ensure container is rendered before init ---
        setTimeout(() => {
            // If map instance doesn't exist, create it (it should always be null here now)
            if (!mapInstance) {
                try {
                    mapInstance = L.map(mapContainerId).setView([37.8, -122.4], 5); // Default view
                    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(mapInstance);
                    console.log('[Map] Base map instance and tile layer created.');
                    // --- Invalidate size immediately after adding tiles ---
                    mapInstance.invalidateSize();
                    // console.log('[Map] Called invalidateSize() immediately after tile layer add.');
                    // --- End invalidate size ---
                } catch (mapInitError) {
                    console.error('[Map] Critical error initializing map instance or tile layer:', mapInitError);
                    mapElement.innerHTML = '<p>Error initializing map.</p>';
                    mapInstance = null;
                }
            } else {
                // If it exists, maybe just clear popups?
                mapInstance.closePopup();
            }

            // Proceed with map updates ONLY if mapInstance is valid after potential initialization
            if (mapInstance) {
                // Initialize school markers layer group if map exists
                if (schoolMarkersLayer) { schoolMarkersLayer.remove(); } // Clear existing first
                schoolMarkersLayer = L.layerGroup().addTo(mapInstance);
                // console.log('[Map] Initialized school markers layer group.');

                // Clear any placeholder text/errors inside map div (do this *after* potential init error message)
                // Check if the innerHTML is the error message before clearing
                /* if (mapElement.innerHTML !== '<p>Error initializing map.</p>') {
                    mapElement.innerHTML = '';
                } */

                // --- ASYNCHRONOUS MAP UPDATE LOGIC MOVED HERE ---
                updateMapLayersAndContent(districtData, mapInstance, mapElement, schoolMarkersLayer);
                // --- END ASYNCHRONOUS MAP UPDATE LOGIC ---
            }
        }, 10); // 10ms delay
        // --- End setTimeout ---
    } // End if(mapElement)

    // --- School List HTML Generation (MOVED OUTSIDE setTimeout) ---
    // NOTE: The school list generation and appending needs to happen 
    // AFTER the map updates complete if it depends on map state,
    // or be independent. For now, let's keep it simple and append 
    // it after the main card HTML is set, but before map fully initializes.
    // We will need to refactor how school markers are added if we keep this structure.
    // TEMPORARY: Generate list HTML here, append later or handle markers differently.
    // Let's move the school list generation inside the map update function for simplicity.

    // infoDisplay.insertAdjacentHTML('beforeend', schoolsHtml); // REMOVED FROM HERE
}

// --- NEW Helper Function for Async Map Updates ---
async function updateMapLayersAndContent(
    districtData: DistrictDetails,
    mapInstance: L.Map,
    mapElement: HTMLElement,
    currentSchoolMarkersLayer: L.LayerGroup
) {
    const districtName = districtData.District || 'N/A';
    const districtCdsCode = districtData['CDS Code'] || 'N/A';
    const shortDistrictCdsCode = districtCdsCode.substring(0, 7);
    const addressParts = [districtData['Street Address'], districtData['Street City'], districtData['Street State'], districtData['Street Zip']].filter(part => part && part !== 'No Data').join(', ');

    // --- Clear Previous Map Layers (Boundary and District Marker) --- 
    if (boundaryLayer) { boundaryLayer.remove(); boundaryLayer = null; }
    if (districtMarker) { districtMarker.remove(); districtMarker = null; }

    let mapCoords: L.LatLngTuple | null = null;
    let mapZoom = 10;
    let foundBoundary = false;

    // --- Try adding boundary / district marker --- 
    // (Rest of the boundary fetching, reprojection, marker logic goes here)
    // ... (Copy logic from original function, lines approx 344-427) ...
    // --- Start copied logic ---
    // 1. Try boundary
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
                        // Add Address Marker 
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
                            districtMarker = L.marker(markerCoords)
                                .addTo(mapInstance)
                                .bindPopup(`<b>${districtName}</b><br>${addressParts || 'Address not available'}`);
                            console.log(`[Map] Added district address marker at [${markerCoords[0]}, ${markerCoords[1]}]`);
                        } else {
                            console.warn(`[Map] Could not determine coordinates for address marker for ${districtName}.`);
                        }
                    } else {
                        console.error(`[Map] Could not fit map to invalid bounds for ${districtCdsCode}.`);
                    }
                } else {
                    console.error(`[Map] Failed to reproject boundary for ${districtCdsCode}. Original feature:`, originalFeature);
                }
            } else {
                console.warn(`[Map] Boundary file not found or fetch failed (${response.status}): ${boundaryUrl}`);
            }
        } catch (error) {
            console.error(`[Map] Error fetching, parsing, or processing boundary file ${boundaryUrl}:`, error);
        }
    }

    // 2. Fallback to Lat/Lon 
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

    // 3. Fallback to geosearch 
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

    // Set view to district point 
    if (!foundBoundary && mapCoords) {
        mapInstance.setView(mapCoords, mapZoom);
        districtMarker = L.marker(mapCoords).addTo(mapInstance).bindPopup(districtName);
        mapInstance.invalidateSize();
    }

    // Final check 
    if (!foundBoundary && !mapCoords) {
        mapElement.innerHTML = '<p>District map location could not be determined.</p>';
    }
    // --- End copied logic ---

    // --- Generate and Append School List HTML (and Add School Markers) --- 
    let schoolsHtml = '';
    let schoolCountInList = 0;
    // Use the passed currentSchoolMarkersLayer
    if (shortDistrictCdsCode && allSchoolsByDistrict[shortDistrictCdsCode]) {
        const schoolsInDistrict = allSchoolsByDistrict[shortDistrictCdsCode]
            // ... (Copy filter/sort logic from original function, lines approx 434-449) ...
            // --- Start copied filter/sort ---
            .filter(school => {
                const isActive = school.Status === 'Active';
                const programType = (school['Educational Program Type'] as string)?.toLowerCase() || '';
                const schoolName = (school.School as string)?.toLowerCase() || ''; // Get lowercase school name
                const streetAddress = school['Street Address'] as string; // Get street address
                const isPublic = school['Public Yes/No'] === 'Y'; // Check if public

                const isHomeschoolProgram = programType === 'homeschool';
                const isHomeschoolName = schoolName === 'homeschool'; // Check if name is exactly "Homeschool"
                const isAddressRedacted = streetAddress === 'Information Redacted'; // Check for redacted address

                return isActive && isPublic && !isHomeschoolProgram && !isHomeschoolName && !isAddressRedacted; // Exclude non-public, homeschool, redacted
            })
            .sort((a, b) => a.School.localeCompare(b.School));
        // --- End copied filter/sort ---

        schoolCountInList = schoolsInDistrict.length;

        if (schoolCountInList > 0) {
            // Define a smaller icon for schools (optional)
            const schoolIcon = L.divIcon({
                html: '🏫',        // School emoji
                className: 'school-marker-icon', // Added CSS class
                iconSize: undefined, // Let CSS control size (use undefined instead of null)
                iconAnchor: [12, 12] // Adjust anchor based on final size if needed
            });

            // ... (Copy markerPromises, Promise.all, and marker adding loop, lines approx 454-599) ...
            // --- Start copied marker logic ---
            // Use Promise.all to handle potential async geocoding for markers
            const markerPromises = schoolsInDistrict.map(async (school) => {
                const schoolName = school.School;
                const schoolCdsCode = school['CDS Code'];
                const schoolAddress = [
                    school['Street Address'],
                    school['Street City'],
                    school['Street State'],
                    school['Street Zip']
                ].filter(part => part && part !== 'No Data').join(', ');
                const gradeSpan = (school['Low Grade'] && school['High Grade'] && school['Low Grade'] !== 'No Data' && school['High Grade'] !== 'No Data')
                    ? `(Grades: ${school['Low Grade']} - ${school['High Grade']})`
                    : '';
                const publicPrivateText = (school['Public Yes/No'] === 'Y') ? '(Public)' : (school['Public Yes/No'] === 'N') ? '(Private)' : '';
                let websiteLinkHtml = '';
                const websiteUrl = school.Website as string;
                if (websiteUrl && websiteUrl !== 'No Data') {
                    let href = websiteUrl.trim(); // Trim whitespace first

                    // Basic URL correction (add // if missing protocol)
                    if (href.includes('.') && !href.startsWith('http') && !href.startsWith('//')) {
                        href = `//${href}`;
                    }

                    // Final check if it looks like a usable URL
                    if (href.startsWith('http') || href.startsWith('//')) {
                        websiteLinkHtml = ` <a href="${href}" target="_blank" rel="noopener noreferrer" title="Visit school website">(Website)</a>`;
                    }
                }
                const dashboardLinkHtml = ` <a href="https://www.caschooldashboard.org/reports/${schoolCdsCode}/2024" target="_blank" rel="noopener noreferrer" title="View CA School Dashboard report">(Report Card)</a>`;
                const listItemHtml = `<li>
                                      <div>
                                        <strong>${schoolName}</strong> ${publicPrivateText} ${gradeSpan}
                                        ${websiteLinkHtml}
                                        ${dashboardLinkHtml}
                                      </div>
                                      <small>${schoolAddress || 'Address not available'}</small>
                                   </li>`;

                // --- Determine School Marker Coordinates --- 
                let schoolMarkerCoords: L.LatLngTuple | null = null;
                const schoolLatStr = school.Latitude as string;
                const schoolLonStr = school.Longitude as string;

                // 1. Try Lat/Lon from data
                if (schoolLatStr && schoolLonStr && schoolLatStr !== 'No Data' && schoolLonStr !== 'No Data') {
                    try {
                        const schoolLat = parseFloat(schoolLatStr);
                        const schoolLon = parseFloat(schoolLonStr);
                        if (!isNaN(schoolLat) && !isNaN(schoolLon)) {
                            schoolMarkerCoords = [schoolLat, schoolLon];
                        }
                    } catch (e) { /* warn */ }
                }

                // 2. Fallback to Geocoding address if Lat/Lon failed
                if (!schoolMarkerCoords && schoolAddress) {
                    console.log(`[Map] Lat/Lon invalid for school ${schoolName}, attempting geosearch for: "${schoolAddress}"`);
                    try {
                        const results = await geoSearchProvider.search({ query: schoolAddress });
                        if (results && results.length > 0) {
                            schoolMarkerCoords = [results[0].y, results[0].x];
                        }
                    } catch (error) { console.warn(`[Map] Geosearch failed for school address "${schoolAddress}":`, error); }
                }

                // Return marker coords and the generated HTML for this school
                return { coords: schoolMarkerCoords, html: listItemHtml, name: schoolName, address: schoolAddress };
            }); // End schoolsInDistrict.map

            // Wait for all potential geocoding lookups to finish
            const schoolMarkerData = await Promise.all(markerPromises);

            // --- Log the results after Promise.all ---
            // console.log('[Map] School marker data after Promise.all:', JSON.stringify(schoolMarkerData.map(d => ({ name: d.name, hasCoords: !!d.coords })), null, 2));
            // --- End Log ---

            // --- Now add markers and build final HTML list --- 
            schoolsHtml += '<div class="schools-list-container">';
            schoolsHtml += `<h3>Schools in ${districtName} (${schoolCountInList})</h3>`;
            schoolsHtml += '<ul class="schools-list">';

            // --- Log the layer group before looping ---
            // console.log('[Map] Attempting to add markers to layer:', currentSchoolMarkersLayer);
            // --- End Log ---

            schoolMarkerData.forEach(data => {
                schoolsHtml += data.html; // Append the pre-generated HTML

                // --- Log each school's data before adding marker ---
                // console.log(`[Map] Processing school for marker: ${data.name}, Coords: ${data.coords ? '[' + data.coords.join(', ') + ']' : 'null'}`);
                // --- End Log ---

                // Add marker if coordinates were found
                if (data.coords) {
                    L.marker(data.coords, { icon: schoolIcon })
                        .addTo(currentSchoolMarkersLayer) // Use the non-null reference
                        .bindPopup(`<b>${data.name}</b><br>${data.address || 'Address not available'}`);
                } else {
                    console.warn(`[Map] Could not determine coordinates for school marker: ${data.name}`);
                }
            });

            schoolsHtml += '</ul>';
            schoolsHtml += '</div>';

            // --- Force map update after adding markers --- 
            // console.log('[Map] Forcing invalidateSize() after adding school markers.');
            mapInstance.invalidateSize();
            // --- End map update ---
            // --- End copied marker logic ---

        } else {
            schoolsHtml = '<div class="schools-list-container"><p>No matching schools found for this district.</p></div>'; // Updated message
        }
    } else {
        schoolsHtml = '<div class="schools-list-container"><p>School data not available for this district.</p></div>'; // Updated message
    }

    // Append the schools HTML
    // Find the main info display container again (might be better to pass it)
    const infoDisplay = document.getElementById('info-display') as HTMLElement | null;
    if (schoolsHtml && infoDisplay) {
        // Check if a schools list already exists and replace it, otherwise append
        const existingSchoolList = infoDisplay.querySelector('.schools-list-container');
        if (existingSchoolList) {
            existingSchoolList.outerHTML = schoolsHtml;
        } else {
            infoDisplay.insertAdjacentHTML('beforeend', schoolsHtml);
        }
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