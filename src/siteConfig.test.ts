import { describe, it, expect } from 'vitest';
import { WEBSITE_NAME, WEBSITE_DESCRIPTION } from './siteConfig';

describe('Site Configuration', () => {
    it('should export the correct WEBSITE_NAME', () => {
        expect(WEBSITE_NAME).toBe("Unofficial California Education Policies Navigator");
    });

    it('should export the correct WEBSITE_DESCRIPTION', () => {
        expect(WEBSITE_DESCRIPTION).toBe("Explore California K-12 school district data and policies.");
    });
}); 