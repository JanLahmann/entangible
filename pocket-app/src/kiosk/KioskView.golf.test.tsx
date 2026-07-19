// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import type { Circuit } from '@qamposer/react';
import type { StateSnapshot } from '@shared/ws/stateSocket';

// --- mock the live kiosk WS state hook so we can force golf mode + a circuit --
let snapshot: StateSnapshot;
vi.mock('./kioskSocket', () => ({
  useKioskState: () => snapshot,
}));

import { KioskView } from './KioskView';

const bell: Circuit = {
  qubits: 5,
  gates: [
    { id: 'H-0', type: 'H', position: 0, qubit: 0 },
    { id: 'CX-1', type: 'CNOT', position: 1, control: 0, target: 1 },
  ],
} as Circuit;

function golfSnapshot(circuit: Circuit): StateSnapshot {
  return {
    connectionState: 'open',
    lastSeq: 1,
    circuit: { type: 'circuit', seq: 1, circuit, qasm: 'OPENQASM 2.0;', source: 'replay' },
    detection: { type: 'detection', fps: 30, board: { found: true, corners: 4, reprojectionErrorMm: 1 }, markers: [], warnings: [] },
    status: { type: 'status', camera: { kind: 'replay', connected: true }, backend: { enabled: false, healthy: false }, clients: 1 },
    layout: { type: 'layout', mode: 'golf', sidebar: 'right', panels: ['scorecard', 'minicircuit', 'results'], wires: 'compact' },
  } as unknown as StateSnapshot;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('KioskView golf mode', () => {
  it('renders the golf sidebar: scorecard + Bloch view once connected', () => {
    snapshot = golfSnapshot(bell);
    const { container } = render(<KioskView />);

    // Scorecard header names the level and its qubit count.
    expect(screen.getByText(/Scorecard · level 1\/5/)).toBeTruthy();
    expect(screen.getByText(/Level 1 — Superposition/)).toBeTruthy();

    // Level 1 plays the Bloch view (its structural panel is present).
    expect(container.querySelector('.bo-bloch')).not.toBeNull();
    // The mode pill reflects golf.
    expect(screen.getByText('golf')).toBeTruthy();
  });

  it('swaps out the composer panels for the golf sidebar', () => {
    snapshot = golfSnapshot(bell);
    render(<KioskView />);
    // 'results' from the preset is still allowed through (histogram present).
    expect(document.querySelector('.bo-side')).not.toBeNull();
  });

  it('shows the connect-pending screen before the socket opens', () => {
    snapshot = { connectionState: 'connecting', lastSeq: null } as StateSnapshot;
    const { container } = render(<KioskView />);
    expect(container.querySelector('.bo--pending')).not.toBeNull();
    expect(screen.getByText(/Connecting to the booth/)).toBeTruthy();
  });
});
