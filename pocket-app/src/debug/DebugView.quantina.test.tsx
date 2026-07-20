// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import type { Circuit } from '@qamposer/react';

// Mock the operator socket + the key gate so the full DebugView renders.
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
  gates: [
    { id: 'H-0', type: 'H', position: 0, qubit: 0 },
    { id: 'CX-1', type: 'CNOT', position: 1, control: 0, target: 1 },
  ],
} as Circuit;

function debugSnapshot(menu: string | null = 'coffee') {
  return {
    connectionState: 'open',
    operator: true,
    detection: { type: 'detection', fps: 30, board: { found: true, corners: 4, reprojectionErrorMm: 1 }, markers: [], warnings: [] },
    status: { type: 'status', camera: { kind: 'replay', connected: true }, backend: { enabled: false, healthy: false }, clients: 1 },
    layout: { type: 'layout', mode: 'quantina', sidebar: 'right', panels: ['menu', 'order', 'results'], wires: 'compact', noise: 'off', menu },
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

describe('/debug Quantina card', () => {
  it('pack picker sends select_menu', () => {
    render(<DebugView />);
    fireEvent.click(screen.getByRole('button', { name: 'cocktails' }));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'select_menu', pack: 'cocktails' });
  });

  it('Serve samples the live circuit and sends shotSource ideal (noise off)', () => {
    render(<DebugView />);
    fireEvent.click(screen.getByRole('button', { name: 'Serve' }));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const msg = sendMessage.mock.calls[0][0] as unknown as {
      type: string;
      outcomes: string[];
      shotSource: string;
    };
    expect(msg.type).toBe('serve');
    expect(msg.shotSource).toBe('ideal');
    expect(msg.outcomes[0]).toHaveLength(3); // coffee = 3 qubits
  });

  it('real-hardware entry validates the bit width and sends shotSource real', () => {
    render(<DebugView />);
    const input = screen.getByLabelText('real hardware bitstring') as HTMLInputElement;
    const enter = () => screen.getByRole('button', { name: 'Enter real result' }) as HTMLButtonElement;

    // Too short (2 of 3 bits) → button disabled, nothing sent.
    fireEvent.change(input, { target: { value: '10' } });
    expect(enter().disabled).toBe(true);

    // Exactly pack.qubits bits → valid; sends a real serve.
    fireEvent.change(input, { target: { value: '101' } });
    expect(enter().disabled).toBe(false);
    fireEvent.click(enter());
    expect(sendMessage).toHaveBeenCalledWith({ type: 'serve', outcomes: ['101'], shotSource: 'real' });
  });
});
