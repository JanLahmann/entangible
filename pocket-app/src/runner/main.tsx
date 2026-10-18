/**
 * Entry of the runner-only bundle (runner.html → dist-runner/index.html, built
 * by `npm run build:runner` with vite.runner.config.ts — docs/runner-bundle.md).
 *
 * Fonts are bundled (latin subset only — the copy is English and German), so
 * the page needs no network at all. Stylesheet order: tokens, then the
 * bundle's own base + shell (runner.css); the game's own runnerGame.css comes
 * with RunnerGame. No pocket.css: the runner needs none of the site layout.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@shared/tokens.css';
import './runner.css';
import { LangProvider } from '@shared/i18n';
import { ensureStorage } from '../bundle/ensureStorage';
import { RunnerApp } from './RunnerApp';

// Storage that throws (opaque origin, disabled) → a page-lifetime memory store.
ensureStorage();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <RunnerApp />
    </LangProvider>
  </StrictMode>,
);
