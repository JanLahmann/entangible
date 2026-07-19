import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-mono/400.css';
// Shared design tokens (SC2) — the single design-system source, loaded before
// pocket.css (imported by App) so :root custom properties resolve.
import '@shared/tokens.css';
import { App } from './app/App';
import { KioskView } from './kiosk/KioskView';
import { DebugView } from './debug/DebugView';
import { currentSurface } from './app/surface';

// Entangible One (U3): one app, three surfaces. The host serves this build at
// `/` (standalone/viewer/camera), `/?kiosk` (big-screen booth skin) and
// `/debug` (staff). The default standalone behavior is unchanged — the kiosk /
// debug surfaces are additive code paths selected only by URL.
function surfaceElement(): ReactElement {
  switch (currentSurface()) {
    case 'kiosk':
      return <KioskView />;
    case 'debug':
      return <DebugView />;
    default:
      return <App />;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{surfaceElement()}</StrictMode>,
);
