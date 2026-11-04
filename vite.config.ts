import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Spotify rejects "localhost" redirect URIs, so serve on the loopback IP.
// `vite --mode mock` (npm run dev:mock) swaps Spotify for simulated test data.
export default defineConfig(({ mode }) => ({
    base: './',
    plugins: [VitePWA({
        registerType: 'autoUpdate',
        // standalone gives the home screen app its own storage, exempt from Safari's 7-day eviction
        manifest: { name: 'Cullture', short_name: 'Cullture', display: 'standalone', start_url: './', background_color: '#EEF0F5', theme_color: '#EEF0F5', icons: [] }
    })],
    define: { __MOCK__: JSON.stringify(mode === 'mock') },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true }
}));
