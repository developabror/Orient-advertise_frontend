/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@components', replacement: path.resolve(__dirname, 'src/components') },
      { find: '@pages', replacement: path.resolve(__dirname, 'src/pages') },
      { find: '@hooks', replacement: path.resolve(__dirname, 'src/hooks') },
      { find: '@api', replacement: path.resolve(__dirname, 'src/api') },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
    ],
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  // Vitest config. Component/page tests need a DOM, so the default node
  // environment is overridden to jsdom; the setup file registers
  // @testing-library/jest-dom matchers and auto-cleans the DOM between tests.
  // Pure-logic tests (e.g. playlistsPage.helpers.test.ts) are unaffected — a
  // DOM is simply present but unused.
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // src/api/env.ts fails fast (throws) when these are unset, which would
    // abort module evaluation the moment any real resource module is imported
    // (the @components barrel pulls in src/api/http.ts → env.ts). Provide inert
    // placeholders so component/page tests can import the real component tree.
    env: {
      VITE_API_URL: 'http://localhost:8080',
      VITE_WS_URL: 'ws://localhost:8080/ws',
      // The product's canonical zone is Tashkent (UTC+5, no DST). Pin the test
      // worker's local clock to it so `datetime-local` → UTC serialization is
      // deterministic and matches real users' browsers (AssignContentDrawer
      // schedule conversion). Vitest applies this to process.env before the
      // suite runs; Node re-reads TZ on each Date operation.
      TZ: 'Asia/Tashkent',
    },
  },
});
