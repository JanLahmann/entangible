// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Circuit } from '@qamposer/react';
import { ComposerQr } from './ComposerQr';
import { composerUrl, SIGN_IN_HINT } from './composerTransfer';
import { planComposerQr } from './composerQrCode';
import { qasmForCircuit } from './qasm';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bell: Circuit = {
  qubits: 5,
  gates: [
    { id: 'h-0-0', type: 'H', qubit: 0, position: 0 },
    { id: 'cnot-0-1', type: 'CNOT', control: 0, target: 1, position: 1 },
  ],
};
const empty: Circuit = { qubits: 5, gates: [] };
// Touches q4, so it uses all five wires — the sign-in hint should appear.
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

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const qrButton = () => container.querySelector('.pk-qr-btn') as HTMLButtonElement | null;
const overlay = () => document.querySelector('.pk-qr-overlay') as HTMLDivElement | null;

describe('ComposerQr', () => {
  it('renders nothing for an empty circuit', () => {
    act(() => root.render(<ComposerQr circuit={empty} />));
    expect(qrButton()).toBeNull();
  });

  it('shows the QR button beside Transfer when the circuit is non-empty', () => {
    act(() => root.render(<ComposerQr circuit={bell} />));
    expect(qrButton()).not.toBeNull();
    expect(overlay()).toBeNull(); // closed until tapped
  });

  it('opens the overlay with a live SVG QR and the standard caption', async () => {
    act(() => root.render(<ComposerQr circuit={bell} />));
    await act(async () => {
      qrButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    const ov = overlay();
    expect(ov).not.toBeNull();
    // The QR is the circuit's composerUrl, rendered as an inline SVG.
    expect(ov!.querySelector('.pk-qr-code svg')).not.toBeNull();
    expect(planComposerQr(qasmForCircuit(bell)).url).toBe(composerUrl(qasmForCircuit(bell)));
    expect(ov!.querySelector('.pk-qr-caption')!.textContent).toContain('Scan to open YOUR circuit');
    expect(ov!.querySelector('.pk-qr-disclaimer')!.textContent).toContain('not affiliated with IBM');
  });

  it('shows the 5-qubit sign-in hint only when the circuit uses all five wires', async () => {
    // Bell uses 2 wires → no hint.
    act(() => root.render(<ComposerQr circuit={bell} />));
    await act(async () => {
      qrButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(overlay()!.textContent).not.toContain(SIGN_IN_HINT);
    await act(async () => {
      (document.querySelector('.pk-qr-close') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    // A circuit touching q4 uses all five → hint appears.
    act(() => root.render(<ComposerQr circuit={fiveWire} />));
    await act(async () => {
      qrButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(overlay()!.textContent).toContain(SIGN_IN_HINT);
  });

  it('closes on the X button', async () => {
    act(() => root.render(<ComposerQr circuit={bell} />));
    await act(async () => {
      qrButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(overlay()).not.toBeNull();

    await act(async () => {
      (document.querySelector('.pk-qr-close') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(overlay()).toBeNull();
  });

  it('closes on tap-outside (backdrop click) and Escape', async () => {
    act(() => root.render(<ComposerQr circuit={bell} />));
    await act(async () => {
      qrButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    // Backdrop click closes.
    await act(async () => {
      overlay()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(overlay()).toBeNull();

    // Reopen, then Escape closes.
    await act(async () => {
      qrButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(overlay()).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(overlay()).toBeNull();
  });
});
