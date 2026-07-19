// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { Circuit } from '@qamposer/react';
import type { StateSnapshot } from '@shared/ws/stateSocket';

// --- mock the live kiosk WS state hook so we can force a broadcast preset -----
let snapshot: StateSnapshot;
vi.mock('./kioskSocket', () => ({
  useKioskState: () => snapshot,
}));

import { KioskView } from './KioskView';

// A Bell circuit: an ideal peak on |00…⟩/|11…⟩; under a device preset it also
// leaks, so the paired histogram (legend + paired bars) has something to show.
const bell: Circuit = {
  qubits: 5,
  gates: [
    { id: 'H-0', type: 'H', position: 0, qubit: 0 },
    { id: 'CX-1', type: 'CNOT', position: 1, control: 0, target: 1 },
  ],
} as Circuit;

/** A connected composer snapshot with an optional broadcast noise preset. */
function composerSnapshot(noise?: string): StateSnapshot {
  return {
    connectionState: 'open',
    lastSeq: 1,
    circuit: { type: 'circuit', seq: 1, circuit: bell, qasm: 'OPENQASM 2.0;', source: 'replay' },
    detection: { type: 'detection', fps: 30, board: { found: true, corners: 4, reprojectionErrorMm: 1 }, markers: [], warnings: [] },
    status: { type: 'status', camera: { kind: 'replay', connected: true }, backend: { enabled: false, healthy: false }, clients: 1 },
    layout: {
      type: 'layout',
      mode: 'composer',
      sidebar: 'right',
      panels: ['results'],
      wires: 'compact',
      ...(noise !== undefined ? { noise } : {}),
    },
  } as unknown as StateSnapshot;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) })));
  window.history.replaceState({}, '', '/'); // no ?noise= override by default
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('KioskView noise model', () => {
  it('renders the paired histogram when the broadcast preset is on', () => {
    snapshot = composerSnapshot('heron');
    const { container } = render(<KioskView />);
    // Paired mode adds the ideal/with-noise legend + paired-bar wrappers.
    expect(container.querySelector('.bo-h-legend')).not.toBeNull();
    expect(container.querySelector('.bo-h-pair')).not.toBeNull();
  });

  it('stays ideal-only (no paired histogram) when the broadcast preset is off', () => {
    snapshot = composerSnapshot('off');
    const { container } = render(<KioskView />);
    expect(container.querySelector('.bo-h-legend')).toBeNull();
    expect(container.querySelector('.bo-h-pair')).toBeNull();
  });

  it('falls back to the ?noise= URL override when the host broadcasts no preset', () => {
    // An older host (layout without a noise field): the kiosk uses its local
    // ?noise= override instead — the paired histogram still shows.
    window.history.replaceState({}, '', '/?noise=eagle');
    snapshot = composerSnapshot(undefined);
    const { container } = render(<KioskView />);
    expect(container.querySelector('.bo-h-legend')).not.toBeNull();
  });

  it('a broadcast preset overrides the ?noise= URL override', () => {
    // URL says a preset, but the booth broadcasts 'off' → broadcast wins (off).
    window.history.replaceState({}, '', '/?noise=heron');
    snapshot = composerSnapshot('off');
    const { container } = render(<KioskView />);
    expect(container.querySelector('.bo-h-legend')).toBeNull();
  });
});
