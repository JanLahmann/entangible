/**
 * Entry of the golf-only bundle (golf.html → dist-golf/index.html, built by
 * `npm run build:golf` with vite.golf.config.ts — docs/golf-bundle.md).
 *
 * Fonts are bundled (latin subset only — the copy is English and German), so
 * the page needs no network at all. Stylesheet order matches the site: tokens,
 * then pocket.css (pulled in here, not by App), then the bundle's own policy.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@shared/tokens.css';
import '../app/pocket.css';
import './golf.css';
import { LangProvider } from '@shared/i18n';
import { GolfApp } from './GolfApp';

/**
 * A web view whose storage throws (an opaque origin, storage disabled) would
 * otherwise crash on the editor library's unguarded theme read. Fall back to a
 * page-lifetime memory store: the game plays, it just forgets on reload.
 */
function ensureStorage(): void {
  try {
    window.localStorage.getItem('entangible.golf.probe');
  } catch {
    const mem = new Map<string, string>();
    const shim: Storage = {
      get length() {
        return mem.size;
      },
      clear: () => mem.clear(),
      getItem: (k) => mem.get(k) ?? null,
      key: (i) => [...mem.keys()][i] ?? null,
      removeItem: (k) => void mem.delete(k),
      setItem: (k, v) => void mem.set(k, String(v)),
    };
    Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
  }
}

ensureStorage();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <GolfApp />
    </LangProvider>
  </StrictMode>,
);
