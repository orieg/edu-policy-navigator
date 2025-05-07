import { test, expect } from '@playwright/test';

// Ensure this matches or is derived from your playwright.config.ts
const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4321';

test.describe('Internal Link Checker', () => {
    test('should check internal links on the homepage for 404s', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle'); // Wait for network to be idle

        const allLinks = await page.locator('a[href]').evaluateAll((links: HTMLAnchorElement[]) =>
            links.map(link => link.href)
        );

        const internalLinks = allLinks.filter(href => {
            try {
                const url = new URL(href);
                // Check if the origin matches the base URL's origin, or if it's a relative path
                return url.origin === new URL(BASE_URL).origin || !url.protocol.startsWith('http');
            } catch (error) {
                // Invalid URL, could be mailto: or tel: etc., ignore
                return false;
            }
        });

        // Deduplicate links to avoid checking the same URL multiple times
        const uniqueInternalLinks = [...new Set(internalLinks)];

        console.log(`Found ${uniqueInternalLinks.length} unique internal links to check on the homepage.`);

        for (const link of uniqueInternalLinks) {
            console.log(`Checking link: ${link}`);
            let response;
            try {
                // For relative links, Playwright's page.request will correctly use the baseURL from the page context
                // For absolute internal links, it will use them as is.
                response = await page.request.get(link, { failOnStatusCode: false });
                // For a more robust check if page.goto was preferred for some links:
                // await page.goto(link, { waitUntil: 'domcontentloaded' });
                // const status = page. ಸುಮಾರು().status();
                // expect(status, `Link ${link} should not be a 404 or error page`).toBe(200);
            } catch (error) {
                console.error(`Error navigating to ${link}: ${error}`);
                // If request.get itself throws (e.g. network error), we treat it as a failure
                expect(true, `Request to ${link} failed: ${error}`).toBe(false);
                continue;
            }

            const status = response.status();
            // Allow redirects (3xx) but fail on client (4xx) or server (5xx) errors.
            // Note: 204 No Content is also a valid success for some scenarios.
            expect(status, `Link ${link} returned status ${status}`).toBeLessThan(400);
        }
    });
}); 