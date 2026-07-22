// @vitest-environment jsdom
/**
 * Viewer policy (task #49): a connected booth viewer NEVER surfaces camera UI,
 * even when the booth's broadcast `panels` include `camera` — the camera panel
 * is an operator-key-gated KIOSK affordance, not a visitor-phone one. The
 * `cameraHidden` gate (true while connected or in manual mode) enforces this;
 * this pins `showCameraUi` so a future change can't weaken it.
 */
import { describe, it, expect } from 'vitest';
import { showCameraUi } from './App';

describe('showCameraUi', () => {
  it('hides camera UI while connected even when the camera panel is present', () => {
    // cameraHidden true (connected booth viewer) → hidden regardless of panel.
    expect(showCameraUi(true, true, false)).toBe(false);
    expect(showCameraUi(true, true, true)).toBe(false);
  });

  it('shows the camera panel only when the pipeline is the active source', () => {
    expect(showCameraUi(false, true, false)).toBe(true); // standalone + camera panel
    expect(showCameraUi(false, false, true)).toBe(true); // active local camera
    expect(showCameraUi(false, false, false)).toBe(false); // nothing to show
  });
});
