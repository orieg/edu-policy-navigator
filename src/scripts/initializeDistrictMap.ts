// src/scripts/initializeDistrictMap.ts
import { updateMapForDistrict } from './map'; // Use relative path within scripts dir
import type { DistrictDetails, SchoolDetails } from './types';

// This function will be called from the Astro page script
export function initializeDistrictMapOnClient(districtData: DistrictDetails, schoolsData: SchoolDetails[]) {
    console.log('initializeDistrictMapOnClient started for:', districtData.District);

    const mapElementId = `info-map-${districtData && districtData['CDS Code'] ? districtData['CDS Code'] : 'default'}`;
    const mapElement = document.getElementById(mapElementId);

    if (mapElement && districtData) {
        console.log(`Initializing map via external script for ${districtData.District} on element #${mapElementId}`);
        try {
            // Ensure Leaflet CSS is loaded (handled globally via layout)
            updateMapForDistrict(mapElementId, districtData, schoolsData);
        } catch (error) {
            console.error(`Error calling updateMapForDistrict for ${mapElementId}:`, error);
            mapElement.innerHTML = '<p class="error">Failed to update map.</p>';
        }
    } else {
        if (!mapElement) console.error(`Map element #${mapElementId} not found for external script init.`);
        if (!districtData) console.error(`District data missing for external script map initialization.`);
    }
} 