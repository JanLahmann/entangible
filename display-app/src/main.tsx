import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

// IBM Plex Sans (self-hosted via @fontsource) + monospace for diagnostics.
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';

import './styles.css';
import { BoothView } from './booth/BoothView';
import { DebugView } from './debug/DebugView';
import { CaptureView } from './capture/CaptureView';

const router = createBrowserRouter([
  { path: '/', element: <BoothView /> },
  { path: '/debug', element: <DebugView /> },
  { path: '/capture', element: <CaptureView /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
