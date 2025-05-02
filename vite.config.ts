import { defineConfig } from 'vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
    root: 'public', // Keep root as public
    publicDir: 'public', // Directory for static assets (like index.html)
    resolve: {
        alias: {
            // Map absolute /src path to the project's src directory
            '/src': path.resolve(__dirname, 'src'),
        },
    },
    build: {
        outDir: path.resolve(__dirname, 'dist/frontend'), // Output directory relative to project root, not 'public' root
        emptyOutDir: true,
    }
    // We can add plugins and customizations here later if needed
}); 