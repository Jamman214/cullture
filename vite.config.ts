import { defineConfig } from 'vite';

// Spotify rejects "localhost" redirect URIs, so serve on the loopback IP.
// `vite --mode mock` (npm run dev:mock) swaps Spotify for simulated test data.
export default defineConfig(({ mode }) => ({
    base: './',
    define: { __MOCK__: JSON.stringify(mode === 'mock') },
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true }
}));
