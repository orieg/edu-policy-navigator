import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// https://astro.build/config
export default defineConfig({
    // If using Vite plugins shared between Vike and Astro, configure them here.
    vite: {
        plugins: [
            viteStaticCopy({
                targets: [
                    // Removed KuzuDB worker target
                ]
            })
        ]
    },
    integrations: [sitemap()],
    site: 'https://orieg.github.io/edu-policy-navigator',
    // base: '/edu-policy-navigator/', // Temporarily commented out for local dev worker path issues
    // outDir: 'dist', // This is the default, so not strictly needed
}); 