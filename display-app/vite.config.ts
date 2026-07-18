/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The host serves everything from a single HTTPS origin (default :8443).
// In dev, Vite proxies the API/WS/debug paths to the host so the display app
// can run under `vite` while talking to a locally-running host.
//
// For dev convenience run the host with TLS disabled (`--no-tls`), so the proxy
// targets plain http/ws on :8443. `secure: false` additionally tolerates a
// self-signed cert if the host is run with TLS enabled.
const HOST_HTTP = 'http://localhost:8443';
const HOST_WS = 'ws://localhost:8443';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: HOST_WS, ws: true, secure: false },
      '/api': { target: HOST_HTTP, changeOrigin: true, secure: false },
      '/debug': { target: HOST_HTTP, changeOrigin: true, secure: false },
      '/qamposer-api': { target: HOST_HTTP, changeOrigin: true, secure: false },
    },
  },
  build: {
    outDir: 'dist',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
