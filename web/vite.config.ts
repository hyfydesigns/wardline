import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = 'http://127.0.0.1:4000';

// Proxy API, auth, health, and the WebSocket to the Fastify server in dev, so
// the browser talks to a single origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/auth': { target, changeOrigin: true },
      '/health': { target, changeOrigin: true },
      '/ws': { target, ws: true },
    },
  },
});
