// @vitest-environment jsdom
/**
 * Kiosk booth-resilience surfaces:
 *  - warnings: the visitor footer shows only `kioskVisible` codes — the spare
 *    kit beside the board (`stray_tiles` / `stray_furniture`) is SILENT, while a
 *    tile between the wires (`off_grid`) still gets its friendly line;
 *  - camera lost (`status.camera.lost`): the camera pill turns red and says so.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import type { StateSnapshot } from '@shared/ws/stateSocket';
import type { DetectionWarning } from '@shared/ws/messages';
import { CAMERA_LOST_LABEL } from '@shared/display/warnings';

let snapshot: StateSnapshot;
vi.mock('./kioskSocket', () => ({
  useKioskState: () => snapshot,
  getKioskSocket: () => ({ getSnapshot: () => snapshot, send: () => true }),
  kioskStanding: (s: StateSnapshot) => (s.operator === true ? 'operator' : 'viewer'),
}));

import { KioskView } from './KioskView';

function snap(warnings: DetectionWarning[], lost?: boolean): StateSnapshot {
  return {
    connectionState: 'open',
    lastSeq: 1,
    circuit: {
      type: 'circuit',
      seq: 1,
      circuit: { qubits: 5, gates: [] },
      qasm: 'OPENQASM 2.0;',
      source: 'camera',
    },
    detection: {
      type: 'detection',
      fps: lost ? 0 : 30,
      board: { found: true, corners: 4, reprojectionErrorMm: 1 },
      markers: [],
      warnings,
    },
    status: {
      type: 'status',
      camera: { kind: 'cv2', name: 'cv2:0', connected: true, ...(lost === undefined ? {} : { lost }) },
      backend: { enabled: false, healthy: false },
      clients: 1,
    },
    layout: { type: 'layout', mode: 'composer', sidebar: 'right', panels: [], wires: 'compact' },
  } as unknown as StateSnapshot;
}

const STRAY_TILES: DetectionWarning = {
  code: 'stray_tiles',
  message: '5 gate tile(s) are not on the board; ignored. Only tiles inside the corner blocks are part of the circuit.',
};
const STRAY_FURNITURE: DetectionWarning = {
  code: 'stray_furniture',
  message: '2 board-furniture block(s) are not on the board; ignored.',
};
const OFF_GRID: DetectionWarning = {
  code: 'off_grid',
  message: 'Tile marker 30 (H) at board (120, 95) mm is on the board but on no qubit wire; excluded.',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('KioskView visitor warnings', () => {
  it('never shows the inventory beside the board', () => {
    snapshot = snap([STRAY_TILES, STRAY_FURNITURE]);
    const { container } = render(<KioskView />);
    const footer = container.querySelector('.bo-footer')!;
    expect(footer.classList.contains('has-warnings')).toBe(false);
    expect(footer.textContent).not.toMatch(/not on the board|beside the board|ignored/);
    expect(container.querySelector('.bo-warnicon')).toBeNull();
  });

  it('still shows a visitor warning, in friendly words, alongside silent strays', () => {
    snapshot = snap([STRAY_TILES, OFF_GRID]);
    const { container } = render(<KioskView />);
    const footer = container.querySelector('.bo-footer')!;
    expect(footer.classList.contains('has-warnings')).toBe(true);
    expect(footer.textContent).toContain('A tile is off the grid — slide it onto a cell.');
    expect(footer.textContent).not.toMatch(/Tile marker|mm|not on the board/);
  });
});

describe('KioskView camera pill', () => {
  it('reads the camera kind while frames flow (and on hosts without `lost`)', () => {
    snapshot = snap([]);
    const { container } = render(<KioskView />);
    expect(container.querySelector('.bo-pill.is-camera')?.textContent).toBe('cv2');
    expect(container.querySelector('.is-camera-lost')).toBeNull();
  });

  it('turns red with a plain line when the host reports the camera lost', () => {
    snapshot = snap([], true);
    const { container } = render(<KioskView />);
    const pill = container.querySelector('.bo-pill.is-camera-lost');
    expect(pill).not.toBeNull();
    expect(pill!.classList.contains('is-down')).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe(CAMERA_LOST_LABEL);
    expect(CAMERA_LOST_LABEL).toBe('Camera lost — check the cable');
  });
});
