/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// The quantum engine is imported straight from the display app — one source of
// truth, no copies (docs/pocket.md). Vite must be allowed to read outside the
// pocket-app root, and the `@quantum/*` alias mirrors tsconfig `paths`.
const quantumDir = resolve(here, '../display-app/src/quantum');

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@quantum': quantumDir,
    },
  },
  server: {
    fs: {
      // Allow importing display-app/src/quantum/* (outside the app root).
      allow: [here, resolve(here, '../display-app')],
    },
  },
  build: {
    outDir: 'dist',
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
  },
});
