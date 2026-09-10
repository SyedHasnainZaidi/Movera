import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,

    /**
     * Same-origin proxy to the other two services.
     *
     * Needed to share the app through a single tunnel. The browser normally
     * talks to three origins - the page on :5173, the API on :3000 and the
     * pose WebSocket on :8000 - and only the first of those is reachable
     * through one tunnel. A visitor's browser would resolve the other two
     * against THEIR machine and find nothing.
     *
     * Routing everything through the dev server collapses that to one origin,
     * which also removes CORS and third-party-cookie questions entirely.
     *
     * Inert during normal local development: the frontend keeps using absolute
     * localhost URLs from .env unless those are switched to relative paths.
     */
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false, // keep the browser's Origin for the CORS allowlist
      },
      '/ws/session': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
        changeOrigin: false,
      },
    },

    /**
     * Host-header allowlist.
     *
     * Vite rejects requests whose Host it does not recognise, which is what
     * makes a tunnelled dev server answer "Blocked request". Opened only when
     * VITE_ALLOW_TUNNEL is set, so ordinary local development keeps the
     * protection rather than having it disabled permanently for one demo.
     */
    allowedHosts: process.env.VITE_ALLOW_TUNNEL ? true : undefined,
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
  },
});
