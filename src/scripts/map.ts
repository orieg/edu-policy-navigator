// src/map.ts

import type { DistrictDetails, SchoolDetails } from './types';
import L from 'leaflet';
import proj4 from 'proj4';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { OpenStreetMapProvider } from 'leaflet-geosearch'; // Keep geosearch import
// import 'leaflet.markercluster';

// --- Extend Leaflet namespace for MarkerCluster ---
// This assumes leaflet.markercluster.js is loaded globally (e.g., via CDN)
// and attaches its functionality to the L object.
declare module 'leaflet' {
    // Define options interface if needed, or use L.MarkerClusterGroupOptions if provided by types
    interface MarkerClusterGroupOptions {
        // Add specific options here if you use them, e.g.:
        // showCoverageOnHover?: boolean;
        // zoomToBoundsOnClick?: boolean;
        // spiderfyOnMaxZoom?: boolean;
    }

    // Declare the function
    export function markerClusterGroup(options?: MarkerClusterGroupOptions): MarkerClusterGroup;

    // Declare the class extending LayerGroup
    export class MarkerClusterGroup extends LayerGroup {
        // Add methods used in the code if needed for stricter type checking
        addLayer(layer: Layer): this;
        // addLayers(layers: Layer[]): this;
        removeLayer(layer: Layer): this;
        // clearLayers(): this;
        getBounds(): LatLngBounds;
        getLayers(): Layer[]; // Added based on usage in console.log
    }
}
// --- End Namespace Extension ---

console.log('map.ts loaded'); // Add a log to confirm loading

// --- Initialize Geosearch Provider ---
const geoSearchProvider = new OpenStreetMapProvider();

// --- Marker Icons ---
const schoolIcon = L.divIcon({
    html: '🏫', // School emoji
    className: 'school-marker-icon', // CSS class for styling
    iconSize: undefined, // Let CSS control size
    iconAnchor: [12, 12] // Adjust anchor as needed based on CSS size
});

// --- Proj4 Configuration ---
// Define the source projection (likely EPSG:3857 based on previous use)
const SOURCE_PROJECTION = 'EPSG:3857';
proj4.defs(SOURCE_PROJECTION, '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs');
// Define the target projection (Leaflet standard)
const TARGET_PROJECTION = 'EPSG:4326';
proj4.defs(TARGET_PROJECTION, '+proj=longlat +datum=WGS84 +no_defs');

// --- Configuration ---
const TILE_LAYER_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_LAYER_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const DEFAULT_MAP_CENTER: L.LatLngTuple = [36.7783, -119.4179]; // Center of California
const DEFAULT_MAP_ZOOM = 6;

// --- State (Module Level) ---
// Keep track of map instances to avoid re-initialization
const mapInstances = new Map<string, L.Map>();
// Adjust state to track marker layers and cluster group separately
const layerGroups = new Map<string, { boundary?: L.LayerGroup, districtMarker?: L.LayerGroup, schoolCluster?: L.MarkerClusterGroup }>();

// --- Helper Functions ---

// Added from districtUtils.ts for client-side use
const formatAddress = (street: string, city: string, state: string, zip: string): string => {
    const parts = [street, city, state, zip].filter(p => p && p !== 'No Data');
    if (parts.length >= 3) return `${parts[0]}, ${parts[1]}, ${parts[2]} ${parts[3] || ''}`.trim();
    if (parts.length === 2) return `${parts[0]}, ${parts[1]}`;
    return parts[0] || 'Address Not Available';
}

function isValidCoordinate(lat: string | number | null | undefined, lon: string | number | null | undefined): lat is number | string {
    // Basic check: Ensure they are not null/undefined and can be parsed as numbers
    if (lat == null || lon == null) return false;
    const latNum = parseFloat(String(lat));
    const lonNum = parseFloat(String(lon));
    return !isNaN(latNum) && !isNaN(lonNum) && latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180;
}

function clearMapLayers(mapId: string) {
    const groups = layerGroups.get(mapId);
    const map = mapInstances.get(mapId);
    if (groups && map) {
        if (groups.boundary) { map.removeLayer(groups.boundary); }
        if (groups.districtMarker) { map.removeLayer(groups.districtMarker); }
        if (groups.schoolCluster) { map.removeLayer(groups.schoolCluster); } // Remove cluster group
        layerGroups.set(mapId, {}); // Clear stored groups
    }
}

// --- Exported Functions ---

/**
 * Initializes a Leaflet map on the given element ID if it doesn't exist.
 * Returns the existing or new map instance.
 * Renamed from getOrCreateMap for clarity.
 */
export function initializeMap(mapElementId: string): L.Map {
    if (mapInstances.has(mapElementId)) {
        return mapInstances.get(mapElementId)!;
    }

    const mapElement = document.getElementById(mapElementId);
    if (!mapElement) {
        throw new Error(`Map element #${mapElementId} not found.`);
    }
    // Ensure the container isn't empty or just placeholder text
    mapElement.innerHTML = ''; // Clear any placeholder
    mapElement.style.height = '400px'; // Ensure container has height
    mapElement.style.width = '100%';

    const map = L.map(mapElementId).setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
    L.tileLayer(TILE_LAYER_URL, { attribution: TILE_LAYER_ATTRIBUTION }).addTo(map);

    mapInstances.set(mapElementId, map);
    layerGroups.set(mapElementId, {}); // Initialize layer groups for this map
    console.log(`Initialized map on #${mapElementId}`);
    return map;
}

/**
 * Reprojects GeoJSON feature coordinates.
 * Assumes the input feature has coordinates in SOURCE_PROJECTION.
 * Modifies the feature coordinates in place to TARGET_PROJECTION.
 * Handles both Polygon and MultiPolygon geometries.
 */
export function reprojectFeatureCoordinates(feature: Feature<Polygon | MultiPolygon>): Feature<Polygon | MultiPolygon> {
    if (!feature || !feature.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) {
        console.warn(`Skipping reprojection: Invalid feature or unsupported geometry type (${feature?.geometry?.type || 'N/A'}).`);
        return feature;
    }

    console.log(`Reprojecting coordinates for geometry type ${feature.geometry.type} from ${SOURCE_PROJECTION} to ${TARGET_PROJECTION}...`);

    const reprojectRing = (ring: number[][]) => {
        ring.forEach(point => { // Iterate through each coordinate pair [lon, lat]
            const [lon, lat] = point;
            try {
                const reprojected = proj4(SOURCE_PROJECTION, TARGET_PROJECTION).forward([lon, lat]);
                point[0] = reprojected[0]; // Update lon
                point[1] = reprojected[1]; // Update lat
            } catch (e) {
                console.error(`Error reprojecting point [${lon}, ${lat}]:`, e);
                // Decide how to handle point error: skip point? mark feature as invalid?
                // For now, we leave the original coordinates.
            }
        });
    };

    if (feature.geometry.type === 'Polygon') {
        // Polygon coordinates are [[lon, lat], ...]
        feature.geometry.coordinates.forEach(reprojectRing);
    } else if (feature.geometry.type === 'MultiPolygon') {
        // MultiPolygon coordinates are [[[lon, lat], ...], ...]
        feature.geometry.coordinates.forEach(polygon => {
            polygon.forEach(reprojectRing);
        });
    }

    return feature;
}

/**
 * Updates an existing map instance for a specific district:
 * - Clears previous layers.
 * - Fetches and displays the district boundary.
 * - Adds markers for the district office and schools.
 * - Fits the map view to the boundary/markers.
 */
export async function updateMapForDistrict(
    mapElementId: string,
    districtData: DistrictDetails,
    schoolsData: SchoolDetails[]
): Promise<void> {
    console.log(`Updating map #${mapElementId} for ${districtData.District}`);

    let map: L.Map;
    try {
        // Use the newly renamed initializeMap function
        map = initializeMap(mapElementId);
    } catch (error) {
        console.error(`Failed to get or create map for ${mapElementId}:`, error);
        const mapElement = document.getElementById(mapElementId);
        if (mapElement) {
            mapElement.innerHTML = '<p class="error">Could not initialize map.</p>';
        }
        return;
    }

    clearMapLayers(mapElementId);

    const boundaryLayerGroup = L.layerGroup();
    const districtMarkerLayerGroup = L.layerGroup();
    const schoolClusterGroup = L.markerClusterGroup();

    layerGroups.set(mapElementId, {
        boundary: boundaryLayerGroup,
        districtMarker: districtMarkerLayerGroup,
        schoolCluster: schoolClusterGroup
    });

    boundaryLayerGroup.addTo(map);
    districtMarkerLayerGroup.addTo(map);
    schoolClusterGroup.addTo(map);

    let bounds = L.latLngBounds([]); // Initialize empty bounds

    // 1. Fetch and add boundary
    const cdsCode = districtData['CDS Code'];
    const boundaryUrl = `/assets/boundaries/${cdsCode}.geojson`;
    try {
        const response = await fetch(boundaryUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        // Fetch as any first to inspect it
        let geojsonData: any = await response.json();
        console.log(`[Debug] Fetched GeoJSON type: ${geojsonData?.type}, Geometry type: ${geojsonData?.geometry?.type}`); // Log type

        // Type assertion after checking/logging if needed, or pass directly to reproject which now handles types
        geojsonData = reprojectFeatureCoordinates(geojsonData as Feature<Polygon | MultiPolygon>); // Reproject here

        const boundaryLayer = L.geoJSON(geojsonData, {
            style: {
                color: "#007bff", // Blue
                weight: 2,
                opacity: 0.8,
                fillOpacity: 0.1
            }
        });
        boundaryLayerGroup.addLayer(boundaryLayer);
        bounds = boundaryLayer.getBounds(); // Set bounds to the boundary
        console.log(`Boundary loaded for ${cdsCode}`);

    } catch (error) {
        console.error(`Failed to load boundary GeoJSON for ${cdsCode} from ${boundaryUrl}:`, error);
        // Optionally display an error on the map element
        const mapElement = document.getElementById(mapElementId);
        if (mapElement && mapElement.innerHTML === '') { // Avoid overwriting map if it partially loaded
            mapElement.innerHTML = '<p class="warning">Could not load district boundary.</p>';
        }
    }

    // 2. Add District Office Marker

    // --- DEBUGGING: Log district data used for marker --- 

    console.log(`[Debug] District Data for Marker:`, {

        Latitude: districtData.Latitude,

        Longitude: districtData.Longitude,

        StreetAddress: districtData['Street Address'],

        StreetCity: districtData['Street City'],

        StreetState: districtData['Street State'],

        StreetZip: districtData['Street Zip']

    });

    // --- END DEBUGGING ---

    let districtMarkerCoords: L.LatLngTuple | null = null;

    const latString = districtData.Latitude as string;

    const lonString = districtData.Longitude as string;

    // Try parsing Lat/Lon first
    if (isValidCoordinate(latString, lonString)) {
        const lat = parseFloat(String(districtData.Latitude));
        const lon = parseFloat(String(districtData.Longitude));
        districtMarkerCoords = [lat, lon];
    }

    // If Lat/Lon invalid, try geocoding address

    const address = [districtData['Street Address'], districtData['Street City'], districtData['Street State'], districtData['Street Zip']].filter(p => p && p !== 'No Data').join(', ');

    // --- DEBUGGING: Log computed address --- 

    console.log(`[Debug] Computed Address for Geosearch: "${address}"`);

    // --- END DEBUGGING ---

    if (!districtMarkerCoords && address) {

        console.log(`[Map] District Lat/Lon invalid, attempting geosearch for: "${address}"`);

        try {
            const results = await geoSearchProvider.search({ query: address });
            if (results && results.length > 0) {
                districtMarkerCoords = [results[0].y, results[0].x];
                console.log(`[Map] Geosearch successful for district office.`);
            } else { // Add else block for logging when no results found
                console.log(`[Map] Geosearch for district office returned no results for: "${address}"`);
            }
        } catch (error) {
            console.warn(`[Map] Geosearch failed for district address "${address}":`, error);
        }
    }

    // Add marker if coordinates were found (either from data or geocoding)
    if (districtMarkerCoords) {
        const marker = L.marker(districtMarkerCoords, { // Use default icon
        }).bindPopup(`<b>${districtData.District} (Office)</b><br>${address || 'Address not available'}`);
        districtMarkerLayerGroup.addLayer(marker);
        if (!bounds.isValid()) { // If boundary failed, extend bounds with marker
            bounds.extend(districtMarkerCoords);
        } else {
            bounds.extend(districtMarkerCoords); // Always extend bounds
        }
        console.log("District office marker added.");
    }

    // 3. Add School Markers (using MarkerClusterGroup)
    if (schoolsData && schoolsData.length > 0) {
        schoolsData.forEach(school => {
            if (isValidCoordinate(school.Latitude, school.Longitude)) {
                const lat = parseFloat(String(school.Latitude));
                const lon = parseFloat(String(school.Longitude));
                // Format the school address using the helper function
                const schoolAddress = formatAddress(school['Street Address'], school['Street City'], school['Street State'], school['Street Zip']);
                const schoolMarker = L.marker([lat, lon], { icon: schoolIcon })
                    .bindPopup(`<b>${school.School || 'Unknown School'}</b><br>${schoolAddress}`); // Use address here
                schoolClusterGroup.addLayer(schoolMarker); // Add to cluster group
                bounds.extend([lat, lon]); // Extend bounds for each school
            }
        });
        console.log(`Added ${schoolClusterGroup.getLayers().length} school markers to cluster group.`);
    } else {
        console.log("No valid school data to add to map.");
    }

    // 4. Fit map view
    if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] }); // Add padding
        console.log("Map view fitted to bounds.");
    } else {
        // Fallback if no bounds could be determined (e.g., no boundary, no valid markers)
        map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
        console.log("No valid bounds found, using default map view.");
    }
}

// Potentially add other map-related utility functions here
// e.g., function to add custom icons, legends, etc. 