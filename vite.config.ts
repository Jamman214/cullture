import { defineConfig } from 'vite';

// Spotify rejects "localhost" redirect URIs, so serve on the loopback IP.
export default defineConfig({
    base: './',
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true }
});
