// src/map.ts

import type { DistrictDataMap, DistrictDetails, SchoolDetails } from './types';
import L from 'leaflet';
import proj4 from 'proj4';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { OpenStreetMapProvider } from 'leaflet-geosearch'; // Keep geosearch import
import 'leaflet.markercluster'; // Import the marker cluster library

// --- Extend Leaflet namespace for MarkerCluster ---
// This ensures TypeScript knows about L.markerClusterGroup
declare module 'leaflet' {
    interface MarkerClusterGroupOptions {
        showCoverageOnHover?: boolean;
        zoomToBoundsOnClick?: boolean;
        spiderfyOnMaxZoom?: boolean;
        // Add other options as needed
    }

    export function markerClusterGroup(options?: MarkerClusterGroupOptions): MarkerClusterGroup;
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
const mapInstances = new Map<string, L.Map>();
// Adjust state to track different layer types, including the new district cluster
const layerGroups = new Map<string, {
    boundary?: L.LayerGroup,
    districtOfficeMarker?: L.LayerGroup, // Keep for specific office marker if needed later
    schoolCluster?: L.MarkerClusterGroup, // For schools within a district
    districtCluster?: L.MarkerClusterGroup // NEW: For district markers on index page
}>();

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
        if (groups.districtOfficeMarker) { map.removeLayer(groups.districtOfficeMarker); }
        if (groups.schoolCluster) { map.removeLayer(groups.schoolCluster); }
        if (groups.districtCluster) { map.removeLayer(groups.districtCluster); } // Clear new district cluster
        layerGroups.set(mapId, {}); // Clear stored groups
    }
}

// --- Exported Functions ---

/**
 * Initializes a Leaflet map on the given element ID if it doesn't exist.
 * Sets default view and tile layer.
 * Returns the existing or new map instance.
 */
export function initializeMap(mapElementId: string): L.Map {
    if (mapInstances.has(mapElementId)) {
        console.log(`Returning existing map instance for #${mapElementId}`);
        return mapInstances.get(mapElementId)!;
    }

    const mapElement = document.getElementById(mapElementId);
    if (!mapElement) {
        throw new Error(`Map element #${mapElementId} not found.`);
    }
    mapElement.innerHTML = '';
    mapElement.style.height = '400px';
    mapElement.style.width = '100%';

    const map = L.map(mapElementId).setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
    L.tileLayer(TILE_LAYER_URL, { attribution: TILE_LAYER_ATTRIBUTION }).addTo(map);

    mapInstances.set(mapElementId, map);
    layerGroups.set(mapElementId, {}); // Initialize empty layer groups for this map
    console.log(`Initialized map on #${mapElementId}`);
    return map;
}

/**
 * NEW: Adds clustered markers for multiple districts to the map.
 * Used on the index page. Attempts geocoding if Lat/Lon are missing.
 */
export function addDistrictMarkersToMap(
    mapElementId: string,
    districtsData: DistrictDataMap
) {
    const map = mapInstances.get(mapElementId);
    if (!map) {
        console.error(`Map instance #${mapElementId} not found for adding district markers.`);
        return;
    }

    const groups = layerGroups.get(mapElementId) || {};

    // Clear previous district cluster if it exists
    if (groups.districtCluster) {
        map.removeLayer(groups.districtCluster);
    }

    const districtClusterGroup = L.markerClusterGroup({
        // Optional: configure marker cluster options here
        // showCoverageOnHover: false,
        // zoomToBoundsOnClick: true,
    });

    let validMarkers = 0;
    const createdMarkers: L.Marker[] = []; // Initialize an array to collect markers

    // Process districts sequentially to avoid rate-limiting during geocoding
    for (const cdsCode of Object.keys(districtsData)) {
        const district = districtsData[cdsCode];
        let marker: L.Marker | null = null;

        // Try Lat/Lon first
        if (isValidCoordinate(district.Latitude, district.Longitude)) {
            const lat = parseFloat(String(district.Latitude));
            const lon = parseFloat(String(district.Longitude));
            marker = L.marker([lat, lon]);
            validMarkers++;
        } else {
            // Geocoding is now done server-side during data generation.
            // If coordinates are STILL invalid here, log a warning.
            console.warn(`[Map Index] Skipping marker for ${district.District} (${cdsCode}) due to missing/invalid coordinates in pre-processed data.`);
        }

        // If marker was created, add popup and add to our collection
        if (marker) {
            // Use the slug from the district data for the link
            const slug = district.slug || cdsCode; // Fallback to cdsCode if slug is somehow missing
            // Ensure the path matches the actual page route: /districts/ not /district/
            const popupContent = `<b>${district.District}</b><br><a href="/districts/${slug}/">View Details</a>`;
            marker.bindPopup(popupContent);
            createdMarkers.push(marker); // Add the created marker to the array
        }
        // No need to return null anymore
    } // End of for loop

    // Now add all collected markers to the cluster group
    if (createdMarkers.length > 0) {
        districtClusterGroup.addLayers(createdMarkers); // Use addLayers for efficiency
        map.addLayer(districtClusterGroup);
        groups.districtCluster = districtClusterGroup;
        layerGroups.set(mapElementId, groups);
        console.log(`Added ${createdMarkers.length} district markers (incl. geocoded) to cluster group on map #${mapElementId}.`);
        // Optional: Fit map bounds to the cluster group
        // map.fitBounds(districtClusterGroup.getBounds());
    } else {
        console.warn(`No valid district markers found (incl. geocoded) to add to map #${mapElementId}.`);
        groups.districtCluster = undefined;
        layerGroups.set(mapElementId, groups);
    }
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
 * Updates an existing map instance for a specific district view:
 * - Clears previous layers (including general district clusters).
 * - Fetches and displays the district boundary.
 * - Adds markers for the district office and schools (clustered).
 * - Fits the map view to the boundary/markers.
 */
export async function updateMapForDistrict(
    mapElementId: string,
    districtData: DistrictDetails,
    schoolsData: SchoolDetails[]
): Promise<void> {
    console.log(`Updating map #${mapElementId} for specific district: ${districtData.District}`);

    let map: L.Map;
    try {
        map = initializeMap(mapElementId); // Ensures map exists
    } catch (error) {
        console.error(`Failed to get or create map for ${mapElementId}:`, error);
        // Handle error display if needed
        return;
    }

    clearMapLayers(mapElementId); // Clear ALL previous layers

    const boundaryLayerGroup = L.layerGroup();
    const districtOfficeMarkerLayerGroup = L.layerGroup(); // Renamed from districtMarkerLayerGroup
    const schoolClusterGroup = L.markerClusterGroup(); // Cluster schools

    // Store the specific layers for this district view
    layerGroups.set(mapElementId, {
        boundary: boundaryLayerGroup,
        districtOfficeMarker: districtOfficeMarkerLayerGroup,
        schoolCluster: schoolClusterGroup
    });

    boundaryLayerGroup.addTo(map);
    districtOfficeMarkerLayerGroup.addTo(map); // Add office marker layer
    schoolClusterGroup.addTo(map); // Add school cluster layer

    let bounds = L.latLngBounds([]);
    let hasValidLayers = false; // Track if we add anything valid to fit bounds

    // 1. Fetch and add boundary
    const cdsCode = districtData['CDS Code'];
    const boundaryUrl = `/assets/boundaries/${cdsCode}.geojson`;
    try {
        const response = await fetch(boundaryUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        let geojsonData: any = await response.json();
        geojsonData = reprojectFeatureCoordinates(geojsonData as Feature<Polygon | MultiPolygon>);

        const boundaryLayer = L.geoJSON(geojsonData, {
            style: { color: "#007bff", weight: 2, opacity: 0.8, fillOpacity: 0.1 }
        });
        boundaryLayerGroup.addLayer(boundaryLayer);
        bounds.extend(boundaryLayer.getBounds()); // Extend bounds
        hasValidLayers = true;
        console.log(`Boundary loaded for ${cdsCode}`);
    } catch (error) {
        console.error(`Failed to load boundary GeoJSON for ${cdsCode}:`, error);
    }

    // 2. Add District Office Marker (if coordinates are valid)
    if (isValidCoordinate(districtData.Latitude, districtData.Longitude)) {
        const lat = parseFloat(String(districtData.Latitude));
        const lon = parseFloat(String(districtData.Longitude));
        const officeMarker = L.marker([lat, lon]);
        const officePopupContent = `<b>${districtData.District} (Office)</b><br>${formatAddress(
            String(districtData.Street ?? ''),
            String(districtData.City ?? ''),
            String(districtData.State ?? ''),
            String(districtData.Zip ?? '')
        )}`;
        officeMarker.bindPopup(officePopupContent);
        districtOfficeMarkerLayerGroup.addLayer(officeMarker); // Add to specific layer
        bounds.extend(officeMarker.getLatLng()); // Extend bounds
        hasValidLayers = true;
    }

    // 3. Add School Markers (clustered)
    let validSchoolMarkers = 0;
    schoolsData.forEach(school => {
        if (isValidCoordinate(school.Latitude, school.Longitude)) {
            const lat = parseFloat(String(school.Latitude));
            const lon = parseFloat(String(school.Longitude));
            const schoolMarker = L.marker([lat, lon], { icon: schoolIcon });
            const schoolPopupContent = `<b>${school.School}</b><br>${formatAddress(
                String(school.Street ?? ''),
                String(school.City ?? ''),
                String(school.State ?? ''),
                String(school.Zip ?? '')
            )}`;
            schoolMarker.bindPopup(schoolPopupContent);
            schoolClusterGroup.addLayer(schoolMarker); // Add to cluster group
            validSchoolMarkers++;
        }
    });

    if (validSchoolMarkers > 0) {
        console.log(`Added ${validSchoolMarkers} school markers to cluster group.`);
        bounds.extend(schoolClusterGroup.getBounds()); // Extend bounds based on cluster
        hasValidLayers = true;
    } else {
        console.log(`No valid school markers found for ${districtData.District}.`);
    }

    // 4. Fit map view
    if (hasValidLayers && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20] }); // Add some padding
    } else if (isValidCoordinate(districtData.Latitude, districtData.Longitude)) {
        // Fallback: Center on district office if boundary failed but office coords are valid
        map.setView([parseFloat(String(districtData.Latitude)), parseFloat(String(districtData.Longitude))], 12); // Zoom in a bit
    } else {
        // Fallback: Geocode district name if no boundary or valid coordinates found
        console.warn(`No valid boundary or coordinates for ${districtData.District}. Attempting geocode.`);
        try {
            const results = await geoSearchProvider.search({ query: `${districtData.District}, California` });
            if (results && results.length > 0) {
                map.setView([results[0].y, results[0].x], 10); // Use geocoded location
            } else {
                console.warn(`Geocoding failed for ${districtData.District}. Keeping default view.`);
                // Keep default map view if geocoding fails
            }
        } catch (geoError) {
            console.error('Geocoding error:', geoError);
            // Keep default map view on geocoding error
        }
    }
}

// Optional: Add a function to explicitly clear the map if needed externally
export function clearMap(mapElementId: string) {
    console.log(`Explicitly clearing map #${mapElementId}`);
    clearMapLayers(mapElementId);
    // Maybe reset view?
    // const map = mapInstances.get(mapElementId);
    // if (map) { map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM); }
}

// Potentially add other map-related utility functions here
// e.g., function to add custom icons, legends, etc. 