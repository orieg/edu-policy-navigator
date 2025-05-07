import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig({
    // root: __dirname, // Let Vite default to project root
    plugins: [
        // Remove Vike plugin usage
        // vike() 
    ],
    // publicDir: false, // Let Vike/Vite handle public dir defaults
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
    // server: { // Remove server.origin for now, Vike might handle it
    //     origin: 'http://localhost:5173'
    // },
    build: {
        // Standard output directory
        outDir: path.resolve(__dirname, 'dist'),
        emptyOutDir: true,
        // Vike likely manages manifest generation implicitly
        // manifest: true, // Remove explicit manifest setting
        rollupOptions: {
            // Vike handles input based on pages/
            // input: {
            //     main: path.resolve(__dirname, 'src/main.ts')
            // }
        }
    },
    // Add server configuration for watching
    server: {
        watch: {
            // Ignore the coverage directory
            ignored: ['**/coverage/**'],
        },
    },
}); 