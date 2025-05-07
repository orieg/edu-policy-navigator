/// <reference types="vitest" />
import { getViteConfig } from 'astro/config';

export default getViteConfig({
    test: {
        /* for example, use globalThis out of the box */
        // globals: true,
        environment: 'jsdom', // Or 'happy-dom' for a lighter alternative if needed
        // setupFiles: ['./tests/setup.ts'], // if you need setup files
        // include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
        // exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],
    },
}); 