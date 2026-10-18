/**
 * `defineAppBundle` — the Vite config of a single-game app bundle for the Fun
 * with Quantum iOS app (Quantum Golf: vite.golf.config.ts, docs/golf-bundle.md;
 * Quantum Runner: vite.runner.config.ts, docs/runner-bundle.md).
 *
 * Separate from vite.config.ts on purpose — the site build never sees these
 * plugins. Same aliases/dedupe as the site (one source for shared/), but:
 *   - entry `<name>.html` (src/<name>/main.tsx), emitted as index.html;
 *   - relative everything (`base: './'`), no public/ copy (no manifest, icons,
 *     robots — the host app owns all of that);
 *   - ONE classic IIFE script (no module loader, no modulepreload polyfill —
 *     which would `fetch()` — and no lazy chunks), so it loads from file:// and
 *     from a custom URL scheme alike;
 *   - every `:hover` rule moved under `@media (hover: hover)`;
 *   - LICENSE + THIRD_PARTY_NOTICES.txt generated into the output.
 * scripts/check-bundle.mjs --bundle <name> verifies the result.
 */
import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import site from '../vite.config';
import { appBundleOutput, guardLibraryHover, hoverOnlyWhereHover } from './appBundle';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface AppBundleOptions {
  /** Entry html in pocket-app/ (e.g. 'golf.html'). */
  readonly entryHtml: string;
  /** Output directory in pocket-app/ (e.g. 'dist-golf'). */
  readonly outDir: string;
  /** Product line heading THIRD_PARTY_NOTICES.txt. */
  readonly product: string;
}

export function defineAppBundle({ entryHtml, outDir, product }: AppBundleOptions): UserConfig {
  return defineConfig({
    base: './',
    publicDir: false,
    plugins: [
      react(),
      guardLibraryHover(),
      appBundleOutput({
        entryHtml,
        licensePath: resolve(appRoot, '../LICENSE'),
        product,
      }),
    ],
    resolve: site.resolve,
    server: site.server,
    css: {
      postcss: { plugins: [hoverOnlyWhereHover()] },
    },
    build: {
      outDir,
      emptyOutDir: true,
      // Fonts stay files (assets/), not base64 in the CSS.
      assetsInlineLimit: 0,
      modulePreload: false,
      // One stylesheet file, linked from index.html (an IIFE build would
      // otherwise inline the CSS into the script).
      cssCodeSplit: false,
      rollupOptions: {
        input: resolve(appRoot, entryHtml),
        output: {
          format: 'iife',
          inlineDynamicImports: true,
        },
      },
    },
  });
}
