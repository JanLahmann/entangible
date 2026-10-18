/**
 * Golf-only bundle ("Quantum Golf", docs/golf-bundle.md): `npm run build:golf`
 * → pocket-app/dist-golf/, embedded offline by the Fun with Quantum iOS app.
 *
 * Separate from vite.config.ts on purpose — the site build never sees these
 * plugins. Same aliases/dedupe as the site (one source for shared/), but:
 *   - entry golf.html (src/golf/main.tsx), emitted as index.html;
 *   - relative everything (`base: './'`), no public/ copy (no manifest, icons,
 *     robots — the host app owns all of that);
 *   - ONE classic IIFE script (no module loader, no modulepreload polyfill —
 *     which would `fetch()` — and no lazy chunks), so it loads from file:// and
 *     from a custom URL scheme alike;
 *   - every `:hover` rule moved under `@media (hover: hover)`;
 *   - LICENSE + THIRD_PARTY_NOTICES.txt generated into the output.
 * scripts/check-golf-bundle.mjs verifies the result.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import site from './vite.config';
import { golfBundleOutput, guardLibraryHover, hoverOnlyWhereHover } from './vite-plugins/golfBundle';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [
    react(),
    guardLibraryHover(),
    golfBundleOutput({
      entryHtml: 'golf.html',
      licensePath: resolve(here, '../LICENSE'),
      product: 'Quantum Golf (Entangible golf bundle)',
    }),
  ],
  resolve: site.resolve,
  server: site.server,
  css: {
    postcss: { plugins: [hoverOnlyWhereHover()] },
  },
  build: {
    outDir: 'dist-golf',
    emptyOutDir: true,
    // Fonts stay files (assets/), not base64 in the CSS.
    assetsInlineLimit: 0,
    modulePreload: false,
    // One stylesheet file, linked from index.html (an IIFE build would
    // otherwise inline the CSS into the script).
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(here, 'golf.html'),
      output: {
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
});
