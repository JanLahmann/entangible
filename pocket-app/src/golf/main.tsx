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
import { ensureStorage } from '../bundle/ensureStorage';
import { GolfApp } from './GolfApp';

// Storage that throws (opaque origin, disabled) → a page-lifetime memory store.
ensureStorage();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <GolfApp />
    </LangProvider>
  </StrictMode>,
);
