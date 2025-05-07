import { test, expect } from '@playwright/test';

// Pages to check for broken internal links
// Paths are relative to the baseURL configured in playwright.config.ts
const PAGES_TO_CHECK = [
    { name: 'Homepage', path: '' },
    { name: 'Guides Index', path: 'guides/' },
    { name: 'Academic Curriculum Guide', path: 'guides/academic-curriculum' },
    { name: 'School Safety Protocol Guide', path: 'guides/school-safety-respect-protocol' },
    { name: 'San Ramon Valley District Page', path: 'districts/san-ramon-valley-unified-07618040000000' },
];

test.describe('Internal Link Checker for Multiple Pages', () => {
    for (const pageInfo of PAGES_TO_CHECK) {
        test(`should check internal links on ${pageInfo.name} (${pageInfo.path}) for errors`, async ({ page, baseURL }) => {
            await page.goto(pageInfo.path);
            await page.waitForLoadState('networkidle');

            const allLinks = await page.locator('a[href]').evaluateAll((links: HTMLAnchorElement[]) =>
                links.map(link => link.href)
            );

            const internalLinks = allLinks.filter(href => {
                try {
                    const linkUrl = new URL(href, page.url()); // Resolve relative links against the current page's URL
                    const baseUrlObj = new URL(baseURL!);

                    // Consider a link internal if its origin matches the baseURL's origin.
                    // The subsequent fetch will determine if it's a valid page or a 404.
                    return linkUrl.origin === baseUrlObj.origin;
                } catch (error) {
                    // Ignore mailto:, tel:, etc. and invalid URLs
                    return false;
                }
            });

            const uniqueInternalLinks = [...new Set(internalLinks)];
            console.log(`Found ${uniqueInternalLinks.length} unique internal links to check on ${pageInfo.name} (${page.url()}).`);

            expect(uniqueInternalLinks.length, `Should find at least one internal link on ${pageInfo.name}`).toBeGreaterThan(0);

            for (const link of uniqueInternalLinks) {
                console.log(`Checking link on ${pageInfo.name}: ${link}`);
                let response;
                try {
                    response = await page.request.get(link, { failOnStatusCode: false });
                } catch (error) {
                    console.error(`Error requesting ${link} on page ${pageInfo.name}: ${error}`);
                    // If page.request.get() itself throws (e.g., network error for an absolute URL), treat as failure.
                    expect(true, `Request to ${link} (on ${pageInfo.name}) failed: ${error}`).toBe(false);
                    continue;
                }

                const status = response.status();
                expect(status, `Link ${link} (on ${pageInfo.name}) returned status ${status}`).toBeLessThan(400);
            }
        });
    }
}); 