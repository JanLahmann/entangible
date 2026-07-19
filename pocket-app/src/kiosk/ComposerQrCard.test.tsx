// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Circuit } from '@qamposer/react';
import { ComposerQrCard } from './ComposerQrCard';
import { QR_DEBOUNCE_MS } from '../app/composerQrCode';
import { SIGN_IN_HINT } from '../app/composerTransfer';
import { qasmForCircuit } from '../app/qasm';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bell: Circuit = {
  qubits: 5,
  gates: [
    { id: 'h-0-0', type: 'H', qubit: 0, position: 0 },
    { id: 'cnot-0-1', type: 'CNOT', control: 0, target: 1, position: 1 },
  ],
};
const empty: Circuit = { qubits: 5, gates: [] };
// Touches q4 → uses all five wires (drives the sign-in hint).
const fiveWire: Circuit = {
  qubits: 5,
  gates: [
    { id: 'h-0-0', type: 'H', qubit: 0, position: 0 },
    { id: 'x-4-1', type: 'X', qubit: 4, position: 1 },
  ],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const card = () => container.querySelector('.bo-composer-qr');

async function settle() {
  // Let the stability debounce elapse and the async QR render resolve.
  await act(async () => {
    await new Promise((r) => setTimeout(r, QR_DEBOUNCE_MS + 50));
  });
}

describe('ComposerQrCard (kiosk)', () => {
  it('renders nothing for an empty board', async () => {
    act(() => root.render(<ComposerQrCard circuit={empty} />));
    await settle();
    expect(card()).toBeNull();
  });

  it('shows the take-home card with a QR once a non-empty circuit settles', async () => {
    act(() => root.render(<ComposerQrCard circuit={bell} qasm="OPENQASM 2.0;\nh q[0];\n" />));
    await settle();
    const el = card();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain('Your circuit → IBM Composer');
    expect(el!.querySelector('.bo-composer-qr__code svg')).not.toBeNull();
    // Bell uses 2 wires → no sign-in hint.
    expect(el!.textContent).not.toContain(SIGN_IN_HINT);
  });

  it('appends the 5-qubit sign-in hint to the label when all wires are used', async () => {
    act(() => root.render(<ComposerQrCard circuit={fiveWire} qasm={qasmForCircuit(fiveWire)} />));
    await settle();
    const el = card();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain(SIGN_IN_HINT);
  });
});
