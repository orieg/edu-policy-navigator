/// <reference types="vitest" />
import { getViteConfig } from 'astro/config';

export default getViteConfig({
    test: {
        /* for example, use globalThis out of the box */
        // globals: true,
        environment: 'jsdom', // Or 'happy-dom' for a lighter alternative if needed
        setupFiles: ['./tests/setup.ts'], // if you need setup files
        exclude: [
            'node_modules',
            'dist',
            '.idea',
            '.git',
            '.cache',
            'e2e/**', // Exclude Playwright E2E tests
            'coverage/**' // Exclude coverage output directory
        ],
        // include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    },
    // Define import.meta.env variables for tests
    define: {
        'import.meta.env.BASE_URL': '"/mock-base-from-config/"' // Note the double quotes for string literal
    }
}); 