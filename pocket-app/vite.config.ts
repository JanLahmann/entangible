/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// The quantum engine and shared display logic live in the neutral top-level
// shared/ dir — one source of truth, no copies (docs/pocket.md). Vite must be
// allowed to read outside the pocket-app root; the `@quantum`/`@shared` aliases
// mirror tsconfig `paths`.
const sharedDir = resolve(here, '../shared');
const quantumDir = resolve(sharedDir, 'quantum');

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@quantum': quantumDir,
      '@shared': sharedDir,
    },
    // The shared/ dir sits outside this app's root and has no node_modules, so
    // value imports there (e.g. @testing-library/react in the moved component
    // tests, or React itself) must resolve from pocket-app/node_modules. dedupe
    // forces a single copy resolved from this app root.
    dedupe: ['react', 'react-dom', '@testing-library/react', '@testing-library/dom'],
  },
  server: {
    fs: {
      // Allow importing shared/* and the bundled Guide assets (test-board PNGs +
      // print kit PDF in ../examples) — both outside the app root. Assets are
      // processed and hashed into dist, so the deploy stays self-contained.
      allow: [here, sharedDir, resolve(here, '../examples')],
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // React + the qamposer editor change far less often than the app, so
        // they get their own long-lived chunk: a returning visitor (or a booth
        // after a release) re-downloads only the app part. Both are needed on
        // first paint either way — this adds no bytes to the initial load. The
        // rest of the splitting is React.lazy / import() in the code
        // (src/lazyChunks.test.ts).
        manualChunks(id) {
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|@qamposer[\\/]react)[\\/]/.test(id)) {
            return 'vendor';
          }
          return undefined;
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Pocket is the surviving app (Entangible One), so the co-located tests for
    // the shared engine + shared display logic run HERE, exactly once. The
    // display app's vitest `include` of `src/**` naturally excludes them.
    // Component tests under shared/quantum declare `@vitest-environment jsdom`
    // per-file (this suite defaults to node).
    include: [
      'tests/**/*.test.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
      '../shared/**/*.test.{ts,tsx}',
    ],
  },
});
