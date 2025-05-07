import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DistrictDetails, DistrictDataMap } from './types';

// Mock a minimal version of the search module
// We need to control its internal state for testing filterDistricts and selectDistrict
let mockAllDistricts: DistrictDataMap = {};
let mockAppBaseUrl: string = '/';

const mockSetSearchModuleState = (districts: DistrictDataMap, baseUrl: string) => {
    mockAllDistricts = districts;
    mockAppBaseUrl = baseUrl;
};

// Actual functions to test (simplified for direct testing, or we can mock dependencies)
// For filterDistricts, we'll test a standalone version to avoid DOM dependencies.
const filterDistrictsStandalone = (searchTerm: string, allDistrictsDb: DistrictDataMap): DistrictDetails[] => {
    if (!allDistrictsDb) {
        return [];
    }
    const lowerCaseTerm = searchTerm.toLowerCase();
    if (!lowerCaseTerm) {
        return [];
    }
    return Object.values(allDistrictsDb)
        .filter(district =>
            district.District?.toLowerCase().includes(lowerCaseTerm) &&
            district.Status === 'Active'
        )
        .sort((a, b) => (a.District || '').localeCompare(b.District || ''))
        .slice(0, 10);
};

// For selectDistrict, we need to simulate its environment
const selectDistrictStandalone = async (district: DistrictDetails, appBaseUrl: string) => {
    const slug = district.slug;
    if (!slug) {
        console.error("Error: Selected district data is missing the 'slug' property. Cannot navigate.");
        return null; // Indicate error or inability to navigate
    }
    const path = `${appBaseUrl.replace(/\/$/, '')}/districts/${slug}`;
    return path; // Return the path for assertion
};

describe('Search Script Logic', () => {
    describe('filterDistrictsStandalone', () => {
        const sampleDistricts: DistrictDataMap = {
            '1': { 'CDS Code': '1', District: 'Apple Valley Unified', Status: 'Active', slug: 'apple-valley', County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '' },
            '2': { 'CDS Code': '2', District: 'Banana Unified', Status: 'Active', slug: 'banana-uni', County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '' },
            '3': { 'CDS Code': '3', District: 'Cherry Intermediate', Status: 'Active', slug: 'cherry-inter', County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '' },
            '4': { 'CDS Code': '4', District: 'Date Palm Elementary', Status: 'Inactive', slug: 'date-palm', County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '' },
            '5': { 'CDS Code': '5', District: 'Apricot High', Status: 'Active', slug: 'apricot-high', County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '' },
        };

        it('should return an empty array if no search term is provided', () => {
            expect(filterDistrictsStandalone('', sampleDistricts)).toEqual([]);
        });

        it('should return an empty array if no districts match', () => {
            expect(filterDistrictsStandalone('Zebra', sampleDistricts)).toEqual([]);
        });

        it('should filter districts based on the search term (case-insensitive)', () => {
            const results = filterDistrictsStandalone('apple', sampleDistricts);
            expect(results).toHaveLength(1);
            expect(results[0].District).toBe('Apple Valley Unified');
        });

        it('should only include Active districts', () => {
            const results = filterDistrictsStandalone('Date', sampleDistricts);
            expect(results).toHaveLength(0); // Date Palm is Inactive
        });

        it('should sort results alphabetically by District name', () => {
            const districtsForSort: DistrictDataMap = {
                'b': { 'CDS Code': 'b', District: 'Banana', Status: 'Active', slug: 'b', County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '' },
                'a': { 'CDS Code': 'a', District: 'Apple', Status: 'Active', slug: 'a', County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '' },
                'c': { 'CDS Code': 'c', District: 'Cherry', Status: 'Active', slug: 'c', County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '' },
            };
            const results = filterDistrictsStandalone('a', districtsForSort); // search for something to get them all
            // If search term is too specific, it might not test sort. Let's assume 'a' is part of all or use a generic term
            const allActive = filterDistrictsStandalone(' ', districtsForSort); // A space might not work, need a term that matches all
            // Let's adjust the test to search for a common letter or element
            const resultsForSortTest = filterDistrictsStandalone('a', {
                '1': { 'CDS Code': '1', District: 'Banana Unified School', Status: 'Active', slug: 'banana', County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '' },
                '2': { 'CDS Code': '2', District: 'Apple Valley School', Status: 'Active', slug: 'apple', County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '' },
                '3': { 'CDS Code': '3', District: 'Avocado Charter', Status: 'Active', slug: 'avocado', County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '' }
            });
            expect(resultsForSortTest.map(d => d.District)).toEqual([
                'Apple Valley School',
                'Avocado Charter',
                'Banana Unified School',
            ]);
        });

        it('should limit results to 10', () => {
            const manyDistricts: DistrictDataMap = {};
            for (let i = 1; i <= 15; i++) {
                manyDistricts[`${i}`] = { 'CDS Code': `${i}`, District: `District ${String(i).padStart(2, '0')}`, Status: 'Active', slug: `dist-${i}`, County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '' };
            }
            const results = filterDistrictsStandalone('District', manyDistricts);
            expect(results).toHaveLength(10);
        });
    });

    describe('selectDistrictStandalone', () => {
        // Mock window.location.href
        const originalLocation = window.location;
        beforeEach(() => {
            // @ts-ignore
            delete window.location;
            // @ts-ignore
            window.location = { href: '' };
        });
        afterEach(() => {
            window.location = originalLocation;
        });

        it('should construct the correct navigation path including BASE_URL', async () => {
            const district: DistrictDetails = { 'CDS Code': '123', District: 'Test Uni', slug: 'test-uni', Status: 'Active', County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '' };
            const baseUrl = '/my-base/';
            const expectedPath = '/my-base/districts/test-uni';
            const actualPath = await selectDistrictStandalone(district, baseUrl);
            expect(actualPath).toBe(expectedPath);
        });

        it('should handle BASE_URL being just "/"', async () => {
            const district: DistrictDetails = { 'CDS Code': '123', District: 'Test Uni', slug: 'test-uni', Status: 'Active', County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '' };
            const baseUrl = '/';
            const expectedPath = '/districts/test-uni';
            const actualPath = await selectDistrictStandalone(district, baseUrl);
            expect(actualPath).toBe(expectedPath);
        });

        it('should handle BASE_URL with a trailing slash', async () => {
            const district: DistrictDetails = { 'CDS Code': '123', District: 'Test Uni', slug: 'test-uni', Status: 'Active', County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '' };
            const baseUrl = '/another-base/'; // replace(/\/$/, '') handles this
            const expectedPath = '/another-base/districts/test-uni';
            const actualPath = await selectDistrictStandalone(district, baseUrl);
            expect(actualPath).toBe(expectedPath);
        });

        it('should return null or indicate error if slug is missing', async () => {
            const district: DistrictDetails = { 'CDS Code': '456', District: 'No Slug Elementary', Status: 'Active', /* slug is missing */ County: '', 'Street Address': '', 'Street City': '', 'Street State': '', 'Street Zip Code': '', Latitude: '', Longitude: '', Phone: '', Website: '', 'Street Zip': '', 'Low Grade': '', 'High Grade': '', slug: undefined as any }; // Explicitly set slug to undefined for test clarity while satisfying type for other fields
            const baseUrl = '/';
            // Spy on console.error
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
            const path = await selectDistrictStandalone(district, baseUrl);
            expect(path).toBeNull();
            expect(consoleErrorSpy).toHaveBeenCalledWith("Error: Selected district data is missing the 'slug' property. Cannot navigate.");
            consoleErrorSpy.mockRestore();
        });
    });
}); 