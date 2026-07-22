// @vitest-environment jsdom
/**
 * Task #49 (/debug): the Layout card's panel list offers the operator-key-gated
 * `camera` panel, and toggling it sends a `select_layout` that appends `camera`
 * (staff opt in per session; it is in no mode's preset).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import type { Circuit } from '@qamposer/react';

let dbgSnap: unknown;
const sendMessage = vi.fn((_msg?: unknown) => true);
vi.mock('./debugSocket', () => ({
  useDebugState: () => dbgSnap,
  getDebugSocket: () => ({ sendMessage }),
}));
vi.mock('@shared/ws/operatorKey', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, getOperatorKey: () => 'test-key', withKey: (u: string) => u };
});

import { DebugView } from './DebugView';

const bell: Circuit = {
  qubits: 5,
  gates: [{ id: 'H-0', type: 'H', position: 0, qubit: 0 }],
} as Circuit;

function debugSnapshot() {
  return {
    connectionState: 'open',
    operator: true,
    detection: { type: 'detection', fps: 30, board: { found: true, corners: 4, reprojectionErrorMm: 1 }, markers: [], warnings: [] },
    status: { type: 'status', camera: { kind: 'replay', connected: true }, backend: { enabled: false, healthy: false }, clients: 1 },
    layout: { type: 'layout', mode: 'composer', sidebar: 'right', panels: ['results', 'state', 'qasm'], wires: 'compact', noise: 'off', menu: null },
    circuit: { type: 'circuit', seq: 1, circuit: bell, qasm: '', source: 'replay' },
  };
}

beforeEach(() => {
  sendMessage.mockClear();
  dbgSnap = debugSnapshot();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The `camera` label that is a panel checkbox (not the status "camera" row). */
function cameraPanelLabel(): HTMLLabelElement {
  const label = screen
    .getAllByText('camera')
    .map((el) => el.closest('label'))
    .find((l): l is HTMLLabelElement => l?.querySelector('input[type="checkbox"]') != null);
  if (!label) throw new Error('no camera panel checkbox label found');
  return label;
}

describe('/debug Layout card camera panel', () => {
  it('offers a camera panel checkbox', () => {
    render(<DebugView />);
    expect(cameraPanelLabel()).not.toBeNull();
  });

  it('enabling the camera checkbox sends select_layout appending camera', () => {
    render(<DebugView />);
    const checkbox = cameraPanelLabel().querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(false); // not in the composer preset
    fireEvent.click(checkbox);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'select_layout',
      panels: ['results', 'state', 'qasm', 'camera'],
    });
  });
});
