import { test, expect } from '@playwright/test';

const GUIDE_PATHS = [
    'guides/', // Index page - make paths relative to baseURL
    'guides/academic-curriculum',
    'guides/school-safety-respect-protocol',
];

// This should ideally match how effectiveBaseURL is constructed in playwright.config.ts
// to ensure test expectations are consistent with what page.goto('/') would use.
const host = (process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4321').replace(/\/$/, '');
const astroBasePath = '/edu-policy-navigator/';
const EFFECTIVE_PLAYWRIGHT_BASE_URL = `${host}${astroBasePath}`;

test.describe('Guide Pages', () => {
    for (const relativePath of GUIDE_PATHS) {
        test(`should load guide page ${relativePath} successfully`, async ({ page }) => {
            // page.goto will use the baseURL from playwright.config.ts
            // If path starts with '/', it's relative to the host part of baseURL.
            // If path does not start with '/', it's relative to the full baseURL.
            // Since our GUIDE_PATHS are now like 'guides/academic-curriculum', 
            // they will be correctly appended to 'http://localhost:4321/edu-policy-navigator/'

            console.log(`Attempting to navigate to relative path: ${relativePath} (Playwright baseURL is: ${EFFECTIVE_PLAYWRIGHT_BASE_URL})`);

            let response;
            try {
                response = await page.goto(relativePath);
                console.log(`Successfully navigated. Final URL: ${page.url()}, Status: ${response?.status()}`);
            } catch (error) {
                console.error(`Error during page.goto(${relativePath}): ${error}. Current page URL: ${page.url()}`);
                throw error;
            }

            expect(response?.status(), `Page ${relativePath} (actual URL: ${page.url()}) should return a 2xx status.`).toBeLessThan(300);
            expect(response?.ok(), `Page ${relativePath} (actual URL: ${page.url()}) should load successfully.`).toBe(true);

            const mainHeading = await page.locator('h1').first();
            await expect(mainHeading, `Page ${relativePath} should have an H1 heading.`).toBeVisible();
            const headingText = await mainHeading.textContent();
            expect(headingText?.trim(), `Page ${relativePath} H1 heading should not be empty.`).not.toBe('');
        });
    }
}); 