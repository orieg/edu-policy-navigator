import { describe, it, expect } from 'vitest';
import { SITE_CONFIG } from './siteConfig';

describe('Site Configuration', () => {
    it('should export the correct site title', () => {
        expect(SITE_CONFIG.title).toBe("Multi-District Policy Navigator");
    });

    it('should export the correct site description', () => {
        expect(SITE_CONFIG.description).toBe("An experimental tool to navigate and compare school district policies using AI.");
    });
}); 