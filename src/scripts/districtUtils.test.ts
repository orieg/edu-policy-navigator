import { describe, it, expect } from 'vitest';
import { isValidCoordinate, formatAddress, formatWebsiteLink } from './districtUtils';

describe('districtUtils', () => {
    describe('isValidCoordinate', () => {
        it('should return true for valid coordinates', () => {
            expect(isValidCoordinate(34.0522, -118.2437)).toBe(true);
            expect(isValidCoordinate('34.0522', '-118.2437')).toBe(true);
            expect(isValidCoordinate(0, 0)).toBe(true);
            expect(isValidCoordinate(90, 180)).toBe(true);
            expect(isValidCoordinate(-90, -180)).toBe(true);
        });

        it('should return false for invalid types or null/undefined', () => {
            expect(isValidCoordinate(null, -118.2437)).toBe(false);
            expect(isValidCoordinate(34.0522, undefined)).toBe(false);
            expect(isValidCoordinate(null, null)).toBe(false);
            expect(isValidCoordinate(undefined, undefined)).toBe(false);
        });

        it('should return false for out-of-range coordinates', () => {
            expect(isValidCoordinate(90.1, 0)).toBe(false);
            expect(isValidCoordinate(-90.1, 0)).toBe(false);
            expect(isValidCoordinate(0, 180.1)).toBe(false);
            expect(isValidCoordinate(0, -180.1)).toBe(false);
        });

        it('should return false for non-numeric strings or special "no data" strings', () => {
            expect(isValidCoordinate('abc', -118.2437)).toBe(false);
            expect(isValidCoordinate(34.0522, 'xyz')).toBe(false);
            expect(isValidCoordinate('No Data', -118.2437)).toBe(false);
            expect(isValidCoordinate(34.0522, 'NO DATA')).toBe(false);
            expect(isValidCoordinate('REDACTED', '123')).toBe(false);
            expect(isValidCoordinate('123', 'Redacted (Latitude)')).toBe(false);
        });
    });

    describe('formatAddress', () => {
        it('should format a full address correctly', () => {
            expect(formatAddress('123 Main St', 'Anytown', 'CA', '90210')).toBe('123 Main St, Anytown, CA 90210');
        });

        it('should handle missing zip code', () => {
            expect(formatAddress('456 Oak Ave', 'Somecity', 'NV', '')).toBe('456 Oak Ave, Somecity, NV');
            expect(formatAddress('456 Oak Ave', 'Somecity', 'NV', null as any)).toBe('456 Oak Ave, Somecity, NV');
        });

        it('should handle missing state and zip code', () => {
            expect(formatAddress('789 Pine Ln', 'Villagetown', '', '')).toBe('789 Pine Ln, Villagetown');
        });

        it('should handle only street and city', () => {
            expect(formatAddress('111 River Rd', 'Metropolis', '', '')).toBe('111 River Rd, Metropolis');
        });

        it('should handle only street', () => {
            expect(formatAddress('222 Hilltop Dr', '', '', '')).toBe('222 Hilltop Dr');
        });

        it('should return "Address Not Available" if all parts are empty or "No Data"', () => {
            expect(formatAddress('', '', '', '')).toBe('Address Not Available');
            expect(formatAddress('No Data', 'No Data', 'No Data', 'No Data')).toBe('Address Not Available');
        });

        it('should filter out "No Data" parts correctly', () => {
            expect(formatAddress('123 Main St', 'Anytown', 'No Data', '90210')).toBe('123 Main St, Anytown, 90210'); // Based on current logic this will make it two parts
            expect(formatAddress('No Data', 'Anytown', 'CA', '90210')).toBe('Anytown, CA 90210');
        });
    });

    describe('formatWebsiteLink', () => {
        it('should return "Website Not Available" for null, empty, or "No Data" url', () => {
            expect(formatWebsiteLink('')).toBe('Website Not Available');
            expect(formatWebsiteLink(null as any)).toBe('Website Not Available');
            expect(formatWebsiteLink('No Data')).toBe('Website Not Available');
        });

        it('should prepend "//" if missing protocol but contains a dot', () => {
            expect(formatWebsiteLink('www.example.com')).toBe('//www.example.com');
            expect(formatWebsiteLink('example.com')).toBe('//example.com');
        });

        it('should not change urls that already have http, https, or //', () => {
            expect(formatWebsiteLink('http://example.com')).toBe('http://example.com');
            expect(formatWebsiteLink('https://example.com')).toBe('https://example.com');
            expect(formatWebsiteLink('//example.com')).toBe('//example.com');
        });

        it('should trim whitespace from the url', () => {
            expect(formatWebsiteLink('  www.example.com  ')).toBe('//www.example.com');
            expect(formatWebsiteLink('  http://example.com  ')).toBe('http://example.com');
        });

        it('should not prepend "//" if no dot is present (could be an internal path)', () => {
            expect(formatWebsiteLink('/path/to/page')).toBe('/path/to/page');
            expect(formatWebsiteLink('internalpage')).toBe('internalpage');
        });
    });
}); 