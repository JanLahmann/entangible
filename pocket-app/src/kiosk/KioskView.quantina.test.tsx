// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import type { Circuit } from '@qamposer/react';
import type { StateSnapshot } from '@shared/ws/stateSocket';

// Mock the kiosk socket module: the live-state hook, the singleton getter (whose
// fake socket captures serve sends), and the standing helper (real logic).
let snapshot: StateSnapshot;
const sendSpy = vi.fn((_msg?: unknown) => true);
vi.mock('./kioskSocket', () => ({
  useKioskState: () => snapshot,
  getKioskSocket: () => ({ getSnapshot: () => snapshot, send: sendSpy }),
  kioskStanding: (s: StateSnapshot) => (s.operator === true ? 'operator' : 'viewer'),
}));

import { KioskView } from './KioskView';
import { AttractMode } from './AttractMode';

const bell: Circuit = {
  qubits: 5,
  gates: [
    { id: 'H-0', type: 'H', position: 0, qubit: 0 },
    { id: 'CX-1', type: 'CNOT', position: 1, control: 0, target: 1 },
  ],
} as Circuit;

function quantinaSnapshot(
  opts: { operator?: boolean; served?: unknown; menu?: string | null } = {},
): StateSnapshot {
  return {
    connectionState: 'open',
    lastSeq: 1,
    operator: opts.operator,
    circuit: { type: 'circuit', seq: 1, circuit: bell, qasm: 'OPENQASM 2.0;', source: 'replay' },
    detection: { type: 'detection', fps: 30, board: { found: true, corners: 4, reprojectionErrorMm: 1 }, markers: [], warnings: [] },
    status: { type: 'status', camera: { kind: 'replay', connected: true }, backend: { enabled: false, healthy: false }, clients: 1 },
    layout: {
      type: 'layout',
      mode: 'quantina',
      sidebar: 'right',
      panels: ['menu', 'order', 'results'],
      wires: 'compact',
      noise: 'off',
      menu: opts.menu ?? 'coffee',
    },
    served: opts.served,
  } as unknown as StateSnapshot;
}

beforeEach(() => {
  sendSpy.mockClear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) })));
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('KioskView quantina mode', () => {
  it('renders the menu grid + pack title from the layout pack', () => {
    snapshot = quantinaSnapshot();
    const { container } = render(<KioskView />);
    expect(container.querySelector('.bo-menu')).not.toBeNull();
    expect(screen.getByText('QoffeeMaker')).toBeTruthy(); // coffee pack title
    expect(screen.getByText('Espresso')).toBeTruthy(); // coffee 010
    // The one-shot real-hardware line is always present in the order panel.
    expect(screen.getByText(/run it with ONE shot/)).toBeTruthy();
  });

  it('falls back to coffee when the layout menu is null', () => {
    snapshot = quantinaSnapshot({ menu: null });
    render(<KioskView />);
    expect(screen.getByText('QoffeeMaker')).toBeTruthy();
  });

  it('reveals the order card from a served replay (keyed on seq)', () => {
    snapshot = quantinaSnapshot({
      served: { type: 'served', seq: 3, packId: 'coffee', outcomes: ['010'], shotSource: 'ideal' },
    });
    const { container } = render(<KioskView />);
    const reveal = container.querySelector('.bo-reveal');
    expect(reveal).not.toBeNull();
    expect(reveal?.getAttribute('data-seq')).toBe('3');
    expect(container.querySelector('.bo-order')).not.toBeNull();
    // 010 → Espresso resolves into the order lines (also shown in the menu grid).
    expect(screen.getAllByText('Espresso').length).toBeGreaterThan(1);
  });

  it('hides the Serve button for a keyless (viewer) kiosk', () => {
    snapshot = quantinaSnapshot({ operator: false });
    const { container } = render(<KioskView />);
    expect(container.querySelector('.bo-serve-btn')).toBeNull();
  });

  it('shows Serve for a provisioned (operator) kiosk and sends via serve.ts on tap', () => {
    snapshot = quantinaSnapshot({ operator: true });
    const { container } = render(<KioskView />);
    const btn = container.querySelector('.bo-serve-btn') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    fireEvent.click(btn!);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const msg = sendSpy.mock.calls[0][0] as unknown as {
      type: string;
      outcomes: string[];
      shotSource: string;
    };
    expect(msg.type).toBe('serve');
    expect(Array.isArray(msg.outcomes)).toBe(true);
    expect(msg.outcomes[0]).toHaveLength(3); // coffee = 3 qubits
    expect(msg.shotSource).toBe('ideal'); // noise off
  });
});

describe('AttractMode quantina line', () => {
  it('includes the "order your coffee" rotating line', () => {
    render(<AttractMode />);
    expect(screen.getByText('Order your coffee with a quantum computer')).toBeTruthy();
  });
});
