import { StrictMode, lazy, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
// Shared design tokens (SC2) — the single design-system source, loaded before
// pocket.css (imported by App) so :root custom properties resolve.
import '@shared/tokens.css';
import { App } from './app/App';
import { BootSplash, LazyBoundary } from './app/LazyBoundary';
import { currentSurface } from './app/surface';

// The kiosk and /debug surfaces are separate chunks (with kiosk.css / debug.css),
// so a visitor on `/` never downloads them. Keep them out of the static imports
// above — src/lazyChunks.test.ts guards the split.
const KioskView = lazy(() => import('./kiosk/KioskView'));
const DebugView = lazy(() => import('./debug/DebugView'));

// Entangible One (U3): one app, three surfaces. The host serves this build at
// `/` (standalone/viewer/camera), `/?kiosk` (big-screen booth skin) and
// `/debug` (staff). The default standalone behavior is unchanged — the kiosk /
// debug surfaces are additive code paths selected only by URL.
function surfaceElement(): ReactElement {
  switch (currentSurface()) {
    case 'kiosk':
      return (
        <LazyBoundary fallback={<BootSplash />} overlay>
          <KioskView />
        </LazyBoundary>
      );
    case 'debug':
      return (
        <LazyBoundary fallback={<BootSplash />} overlay>
          <DebugView />
        </LazyBoundary>
      );
    default:
      return <App />;
  }
}

// React replaces the static boot splash inside #root (index.html) on mount.
createRoot(document.getElementById('root')!).render(
  <StrictMode>{surfaceElement()}</StrictMode>,
);
