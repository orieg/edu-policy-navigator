import { test, expect } from '@playwright/test';

const DISTRICT_SLUG = 'san-ramon-valley-unified-07618040000000';
const DISTRICT_CDS_CODE = '07618040000000'; // Extracted for potential use in map ID

test.describe('District Page View', () => {
    test(`should load district page for ${DISTRICT_SLUG} and display map with markers`, async ({ page }) => {
        const districtPath = `districts/${DISTRICT_SLUG}`;
        const response = await page.goto(districtPath);

        // 1. Verify page loads successfully
        expect(response?.status(), `Page ${districtPath} should return a 2xx status.`).toBeLessThan(300);
        expect(response?.ok(), `Page ${districtPath} should load successfully.`).toBe(true);

        // 2. Check for the main heading (district name)
        const mainHeading = await page.locator('h2').first(); // Assuming district name is in an H2
        await expect(mainHeading, `District page ${districtPath} should have an H2 heading.`).toBeVisible();
        const headingText = await mainHeading.textContent();
        expect(headingText?.trim().toLowerCase(), `District page H2 heading should contain district name.`).toContain('san ramon valley');

        // 3. Check for the presence of the Leaflet map container element
        //    The map ID seems to be `info-map-${CDS_CODE}` based on previous logs.
        //    The element with the ID is THE leaflet container.
        const mapContainerLocator = page.locator(`#info-map-${DISTRICT_CDS_CODE}.leaflet-container`);
        await expect(mapContainerLocator, 'Leaflet map container with ID and class should be present.').toBeVisible();

        // 4. Check for the presence of school markers
        //    Leaflet markers are typically <img> tags with class 'leaflet-marker-icon' 
        //    or div elements with class 'leaflet-marker-icon' if using L.divIcon.
        //    They reside within the 'leaflet-marker-pane'.
        //    Wait for at least one marker to appear, allowing some time for map initialization and data loading.
        const markerPane = mapContainerLocator.locator('.leaflet-marker-pane');
        const firstMarker = markerPane.locator('.leaflet-marker-icon').first();

        await expect(firstMarker, 'At least one school marker should be visible on the map.')
            .toBeVisible({ timeout: 15000 }); // Increased timeout for map/marker loading

        // Optional: Count the number of markers if a specific count is expected (can be brittle)
        const allMarkers = await markerPane.locator('.leaflet-marker-icon').count();
        expect(allMarkers, 'There should be one or more school markers.').toBeGreaterThan(0);
        console.log(`Found ${allMarkers} school markers on the district map for ${DISTRICT_SLUG}.`);
    });
}); 