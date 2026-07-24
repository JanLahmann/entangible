// @vitest-environment jsdom
/**
 * Kiosk graceful-fallback for the Quantum Runner mode (task #52). The booth has
 * no runner UI in v1: `runner` carries an empty panel preset, so a kiosk that
 * receives `layout.mode === 'runner'` must NOT crash — it falls back to its
 * composer-style stage (the circuit editor + an empty sidebar) and its mode pill
 * simply reads "runner".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
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

function runnerSnapshot(circuit: Circuit): StateSnapshot {
  return {
    connectionState: 'open',
    lastSeq: 1,
    circuit: { type: 'circuit', seq: 1, circuit, qasm: 'OPENQASM 2.0;', source: 'replay' },
    detection: { type: 'detection', fps: 30, board: { found: true, corners: 4, reprojectionErrorMm: 1 }, markers: [], warnings: [] },
    status: { type: 'status', camera: { kind: 'replay', connected: true }, backend: { enabled: false, healthy: false }, clients: 1 },
    // 'runner' with the empty preset the host broadcasts for this mode.
    layout: { type: 'layout', mode: 'runner', sidebar: 'right', panels: [], wires: 'compact' },
  } as unknown as StateSnapshot;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('KioskView runner mode (graceful fallback)', () => {
  it('does not crash and shows the composer-style stage + mode pill', () => {
    snapshot = runnerSnapshot(bell);
    const { container } = render(<KioskView />);
    // The circuit stage is still present (the composer-ish default).
    expect(container.querySelector('.bo-stage')).not.toBeNull();
    expect(container.querySelector('.bo-side')).not.toBeNull();
    // The mode pill simply reads "runner"; no runner game UI on the kiosk.
    expect(screen.getByText('runner')).toBeTruthy();
    expect(container.querySelector('.pk-runner')).toBeNull();
  });
});
