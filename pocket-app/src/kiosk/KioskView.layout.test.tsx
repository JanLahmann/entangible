// @vitest-environment jsdom
/**
 * Task #48 fixes 3 + 4 (kiosk): the broadcast `layout.sidebar` docks the kiosk
 * aside left/right, and the `attract` mode shows the attract overlay immediately
 * (not only after the idle timer), dismissing it when the mode changes back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { Circuit } from '@qamposer/react';
import type { StateSnapshot } from '@shared/ws/stateSocket';

let snapshot: StateSnapshot;
vi.mock('./kioskSocket', () => ({
  useKioskState: () => snapshot,
  getKioskSocket: () => ({ getSnapshot: () => snapshot, send: () => true }),
  kioskStanding: (s: StateSnapshot) => (s.operator === true ? 'operator' : 'viewer'),
}));

import { KioskView } from './KioskView';

const bell: Circuit = {
  qubits: 5,
  gates: [
    { id: 'H-0', type: 'H', position: 0, qubit: 0 },
    { id: 'CX-1', type: 'CNOT', position: 1, control: 0, target: 1 },
  ],
} as Circuit;

function snap(layout: Record<string, unknown>): StateSnapshot {
  return {
    connectionState: 'open',
    lastSeq: 1,
    circuit: { type: 'circuit', seq: 1, circuit: bell, qasm: 'OPENQASM 2.0;', source: 'replay' },
    detection: { type: 'detection', fps: 30, board: { found: true, corners: 4, reprojectionErrorMm: 1 }, markers: [], warnings: [] },
    status: { type: 'status', camera: { kind: 'replay', connected: true }, backend: { enabled: false, healthy: false }, clients: 1 },
    layout: { type: 'layout', wires: 'compact', noise: 'off', ...layout },
  } as unknown as StateSnapshot;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('KioskView sidebar side', () => {
  it('docks the aside left when layout.sidebar === "left"', () => {
    snapshot = snap({ mode: 'composer', sidebar: 'left', panels: ['results'] });
    const { container } = render(<KioskView />);
    expect(container.querySelector('.bo-main.bo-side-left')).not.toBeNull();
  });

  it('keeps the default right dock otherwise', () => {
    snapshot = snap({ mode: 'composer', sidebar: 'right', panels: ['results'] });
    const { container } = render(<KioskView />);
    expect(container.querySelector('.bo-main')).not.toBeNull();
    expect(container.querySelector('.bo-side-left')).toBeNull();
  });
});

describe('KioskView camera panel (task #49)', () => {
  it('renders the operator-key-gated camera well when a keyed kiosk has the panel', () => {
    snapshot = { ...snap({ mode: 'composer', sidebar: 'right', panels: ['camera'] }), operator: true };
    const { container } = render(<KioskView />);
    const cam = container.querySelector('.bo-camera');
    expect(cam).not.toBeNull();
    const img = cam?.querySelector('img');
    expect(img?.getAttribute('src')).toContain('/debug/stream');
  });

  it('renders the camera in any mode (e.g. quantina) for a keyed kiosk', () => {
    snapshot = { ...snap({ mode: 'quantina', sidebar: 'right', panels: ['menu', 'camera'] }), operator: true };
    const { container } = render(<KioskView />);
    expect(container.querySelector('.bo-camera')).not.toBeNull();
  });

  it('renders nothing on a keyless kiosk even when panels include camera', () => {
    // No operator standing (keyless viewer): the stream must not surface at all,
    // and there is no placeholder that would leak its existence.
    snapshot = snap({ mode: 'composer', sidebar: 'right', panels: ['camera'] });
    const { container } = render(<KioskView />);
    expect(container.querySelector('.bo-camera')).toBeNull();
  });

  it('renders nothing for an operator kiosk when the panel is not enabled', () => {
    snapshot = { ...snap({ mode: 'composer', sidebar: 'right', panels: ['results'] }), operator: true };
    const { container } = render(<KioskView />);
    expect(container.querySelector('.bo-camera')).toBeNull();
  });
});

describe('KioskView attract mode', () => {
  it('shows the attract overlay immediately when the host mode is "attract"', () => {
    snapshot = snap({ mode: 'attract', sidebar: 'right', panels: [] });
    const { container } = render(<KioskView />);
    expect(container.querySelector('.ent-attract')).not.toBeNull();
  });

  it('does not show the attract overlay in an active mode', () => {
    snapshot = snap({ mode: 'composer', sidebar: 'right', panels: ['results'] });
    const { container } = render(<KioskView />);
    expect(container.querySelector('.ent-attract')).toBeNull();
  });
});
