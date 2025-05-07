import { defineConfig, devices } from '@playwright/test';

const astroBasePath = '/edu-policy-navigator/'; // Your Astro site's base path, with trailing slash
const serverHost = (process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:4321').replace(/\/$/, ''); // Ensure serverHost has no trailing slash

const effectiveBaseURL = `${serverHost}${astroBasePath}`;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
    testDir: './e2e', // Directory for E2E test files
    /* Run tests in files in parallel */
    fullyParallel: true,
    /* Fail the build on CI if you accidentally left test.only in the source code. */
    forbidOnly: !!process.env.CI,
    /* Retry on CI only */
    retries: process.env.CI ? 2 : 0,
    /* Opt out of parallel tests on CI. */
    workers: process.env.CI ? 1 : undefined,
    /* Reporter to use. See https://playwright.dev/docs/test-reporters */
    reporter: 'html',
    /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
    use: {
        /* Base URL to use in actions like `await page.goto('/')`. 
           It will be prepended to relative paths, e.g., page.goto('/') will go to effectiveBaseURL */
        baseURL: effectiveBaseURL,

        /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
        trace: 'on-first-retry',
    },

    /* Configure projects for major browsers */
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },

        // Optionally configure other browsers
        // {
        //   name: 'firefox',
        //   use: { ...devices['Desktop Firefox'] },
        // },

        // {
        //   name: 'webkit',
        //   use: { ...devices['Desktop Safari'] },
        // },
    ],

    /* Run your local dev server before starting the tests */
    webServer: {
        command: 'pnpm run preview',
        // The URL Playwright will hit to check if the server is ready.
        // This should be a path that returns a 2xx status code on your preview server.
        // Since your site is at /edu-policy-navigator/, checking this directly is best.
        url: effectiveBaseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000, // 2 minutes timeout for server to start
        // stdout: 'pipe', // Or 'inherit' or 'ignore'
        // stderr: 'pipe',
    },
}); 