// renderer/+onRenderClient.ts
// Environment: client

import type { OnRenderClientAsync } from 'vike/types'
import L from 'leaflet'; // Import Leaflet
import 'leaflet/dist/leaflet.css'; // Import Leaflet CSS
import { OpenStreetMapProvider } from 'leaflet-geosearch'; // Import Geosearch
import proj4 from 'proj4'; // Import proj4

// Import global styles
import '../pages/style.css'

// Import feature modules
import { updateMapForDistrict } from '../src/map'
import { setupSearchHandlers } from '../src/search'
import type { DistrictDataMap, SchoolDetails, DistrictDetails, SchoolsByDistrictMap } from '../src/types'; // Added SchoolsByDistrictMap

// --- State (Client-Side) ---
// It's often better to manage state within specific modules (e.g., search.ts, map.ts)
// But we might need some top-level state or refs here.
let allDistrictsData: DistrictDataMap | null = null;
let allSchoolsData: Record<string, SchoolDetails[]> | null = null;

// --- Main Client Rendering Function ---
const onRenderClient: OnRenderClientAsync = async (pageContext):
    ReturnType<OnRenderClientAsync> => {
    const { Page, pageProps, isHydration } = pageContext

    console.log('Vike client runtime loaded.');
    if (isHydration) {
        console.log('Hydrating page...');
    }

    // --- Data Retrieval ---
    // Attempt to get initial data passed from the server for SSG pages
    let initialData: { district?: DistrictDetails, schools?: SchoolDetails[], cdsCode?: string } = {};
    try {
        const dataElement = document.getElementById('page-props');
        if (dataElement) {
            initialData = JSON.parse(dataElement.textContent || '{}');
            console.log('Initial page props retrieved:', initialData);
        } else {
            console.warn('Could not find page-props script tag for hydration.');
        }
    } catch (e) {
        console.error('Failed to parse page props for hydration:', e);
    }

    // Fetch global data needed for search (if not already passed) 
    // Consider doing this within the search module itself
    async function fetchGlobalData() {
        try {
            const [districtsRes, schoolsRes] = await Promise.all([
                fetch('/assets/districts.json'), // Corrected path
                fetch('/assets/schools_by_district.json') // Corrected path and filename
            ]);
            if (!districtsRes.ok || !schoolsRes.ok) throw new Error('Failed to fetch global data');
            allDistrictsData = await districtsRes.json();
            allSchoolsData = await schoolsRes.json();
            console.log('Global district and school data fetched.');
        } catch (error) {
            console.error('Failed to fetch global data:', error);
            // Handle error appropriately (e.g., disable search)
        }
    }
    await fetchGlobalData(); // Fetch data needed for search


    // --- DOM Element References ---
    const pageViewElement = document.getElementById('page-view')
    const searchInput = document.getElementById('district-search-input') as HTMLInputElement | null;
    const resultsList = document.getElementById('district-results') as HTMLDivElement | null;
    const infoDisplay = document.getElementById('info-display') as HTMLElement | null;
    const mapElement = pageViewElement?.querySelector('[id^="info-map-"]');

    if (!pageViewElement) {
        console.error('DOM element #page-view not found');
        return;
    }

    // --- Initialize Interactive Components --- 

    // Initialize search functionality (if elements exist)
    if (searchInput && resultsList && infoDisplay && allDistrictsData && allSchoolsData) {
        console.log('Initializing search...');
        setupSearchHandlers(searchInput, resultsList, infoDisplay, allDistrictsData, allSchoolsData);
        searchInput.disabled = false; // Enable search input now that data is ready
    } else {
        console.warn('Search elements or global data missing, search not initialized.');
        if (searchInput) searchInput.disabled = true;
    }

    // Initialize the map if the map element exists (likely on a district page)
    if (mapElement && initialData.district) { // Check if district data was passed for SSG
        console.log(`Updating map for element #${mapElement.id} with initial data...`);
        try {
            // Call updateMapForDistrict to handle initialization and data loading
            await updateMapForDistrict(mapElement.id, initialData.district, initialData.schools || []);
            console.log("Map update with initial data successful.");
            // No need to call displayDistrictInfo again here, as the page is already rendered server-side
        } catch (error) {
            console.error('Failed to initialize/update map with initial data:', error);
            if (mapElement) mapElement.innerHTML = '<p>Error loading map.</p>';
        }
    } else if (mapElement) {
        console.log('Map element found, but no initial district data provided (likely homepage or error).');
        // Display a placeholder or default state in the map div if needed
        mapElement.innerHTML = '<p>Search for a district to view map.</p>';
    } else {
        console.log('No map element found on this page.');
    }

    console.log('Client-side hydration/initialization complete.');
}

export default onRenderClient 