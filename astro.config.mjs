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
                    {
                        src: 'node_modules/kuzu-wasm/kuzu_wasm_worker.js',
                        dest: '.'
                    }
                ]
            })
        ]
    },
    integrations: [sitemap()],
    site: 'https://orieg.github.io/edu-policy-navigator',
    base: '/edu-policy-navigator/',
    // outDir: 'dist', // This is the default, so not strictly needed
}); 