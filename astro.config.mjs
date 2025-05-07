import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
    // If using Vite plugins shared between Vike and Astro, configure them here.
    // vite: { ... }
    integrations: [sitemap()],
    site: 'https://orieg.github.io/edu-policy-navigator',
    base: '/edu-policy-navigator/',
    // outDir: 'dist', // This is the default, so not strictly needed
}); 