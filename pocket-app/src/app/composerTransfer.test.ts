// @vitest-environment jsdom
import LZString from 'lz-string';
import { describe, it, expect, vi } from 'vitest';
import type { Circuit } from '@qamposer/react';
import {
  COMPOSER_BASE,
  COPIED_MESSAGE,
  NO_COPY_MESSAGE,
  canTransfer,
  composerUrl,
  transferToComposer,
  usedQubits,
  withUsedQubits,
  type TransferEnv,
} from './composerTransfer';
import { qasmForCircuit } from './qasm';

const circuit = (gates: Circuit['gates']): Circuit => ({ qubits: 5, gates });

/** QASM the app emits for a 5-wire board carrying `gates` (qreg/creg = 5). */
const qasm5 = (gates: Circuit['gates']): string => qasmForCircuit(circuit(gates));

/** Decode a `?initial=` Composer URL back to its {title, description, qasm}. */
function decodePayload(url: string): { title: string; description: string; qasm: string } {
  const component = decodeURIComponent(url.split('?initial=')[1]);
  return JSON.parse(LZString.decompressFromEncodedURIComponent(component)!);
}

// The exact QASM `qasmForCircuit` emits for tests/fixtures/circuits/bell.json
// (H on q0, CNOT 0→1), byte-identical to the Python golden bell.qasm.
const BELL_QASM =
  'OPENQASM 2.0;\ninclude "qelib1.inc";\n\nqreg q[5];\ncreg c[5];\n\nh q[0];\ncx q[0], q[1];\n';

describe('canTransfer', () => {
  it('is true once the circuit has a gate', () => {
    expect(canTransfer(circuit([{ id: 'h-0-0', type: 'H', qubit: 0, position: 0 }]))).toBe(true);
  });
  it('is false for an empty circuit', () => {
    expect(canTransfer(circuit([]))).toBe(false);
  });
});

describe('usedQubits', () => {
  it('is 1 for an empty circuit (never 0)', () => {
    expect(usedQubits(qasm5([]))).toBe(1);
  });
  it('is 1 for a single gate on q0', () => {
    expect(usedQubits(qasm5([{ id: 'h-0-0', type: 'H', qubit: 0, position: 0 }]))).toBe(1);
  });
  it('keeps the size at 5 for a gate on q4 (trailing wires below it stay)', () => {
    expect(usedQubits(qasm5([{ id: 'x-4-0', type: 'X', qubit: 4, position: 0 }]))).toBe(5);
  });
  it('counts both ends of a CNOT spanning q0→q2', () => {
    expect(
      usedQubits(qasm5([{ id: 'cx-0-2', type: 'CNOT', control: 0, target: 2, position: 0 }])),
    ).toBe(3);
  });
  it('is 2 for a Bell pair (H q0, CNOT 0→1)', () => {
    expect(usedQubits(BELL_QASM)).toBe(2);
  });
});

describe('withUsedQubits', () => {
  it('rewrites qreg/creg of a Bell circuit from 5 down to 2, gates untouched', () => {
    const sized = withUsedQubits(BELL_QASM);
    expect(sized).toContain('qreg q[2];');
    expect(sized).toContain('creg c[2];');
    expect(sized).toContain('h q[0];');
    expect(sized).toContain('cx q[0], q[1];');
    expect(sized).not.toContain('q[5]');
  });
  it('keeps size 5 when a gate touches q4', () => {
    const sized = withUsedQubits(qasm5([{ id: 'x-4-0', type: 'X', qubit: 4, position: 0 }]));
    expect(sized).toContain('qreg q[5];');
    expect(sized).toContain('creg c[5];');
  });
  it('is idempotent (sizing an already-trimmed circuit is a no-op)', () => {
    const once = withUsedQubits(BELL_QASM);
    expect(withUsedQubits(once)).toBe(once);
  });
});

describe('composerUrl', () => {
  // The current cloud Composer takes no circuit URL param (verified against its
  // ?initial= carries LZ-compressed {title, description, qasm} — the format
  // rediscovered from Qoffee-Maker and visually verified on the live cloud
  // Composer (2026-07-19).
  it('is the plain editor URL without qasm', () => {
    expect(composerUrl()).toBe(COMPOSER_BASE);
    expect(composerUrl()).not.toContain('?');
  });

  it('pre-loads the circuit via ?initial= when qasm is given', () => {
    const url = composerUrl('OPENQASM 2.0;\nqreg q[2];\nh q[0];\n');
    expect(url.startsWith(`${COMPOSER_BASE}?initial=`)).toBe(true);
    // Round-trip: decode the param back to the payload.
    const payload = decodePayload(url);
    expect(payload.qasm).toContain('h q[0];');
    expect(payload.title).toBe('Built with Entangible');
    expect(payload.description).toBe('');
  });

  it('trims the pre-loaded QASM to the used qubits (Bell payload → qreg q[2])', () => {
    const payload = decodePayload(composerUrl(BELL_QASM));
    expect(payload.qasm).toContain('qreg q[2];');
    expect(payload.qasm).toContain('creg c[2];');
    expect(payload.qasm).not.toContain('q[5]');
  });

  it('falls back to the plain URL when the payload would be enormous', () => {
    // Genuinely incompressible payload via an LCG (cyclic strings LZ-compress too well).
    let x = 42;
    const noisy = Array.from({ length: 30000 }, () => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return String.fromCharCode(33 + (x % 90));
    }).join('');
    expect(composerUrl(noisy)).toBe(COMPOSER_BASE);
  });
});

describe('transferToComposer', () => {
  const makeEnv = (over: Partial<TransferEnv> = {}): TransferEnv => ({
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    execCopy: vi.fn().mockReturnValue(true),
    open: vi.fn(),
    ...over,
  });

  it('copies via the clipboard and opens the Composer tab (happy path)', async () => {
    const env = makeEnv();
    const result = await transferToComposer(BELL_QASM, env);
    expect(env.clipboard!.writeText).toHaveBeenCalledWith(withUsedQubits(BELL_QASM));
    expect(env.execCopy).not.toHaveBeenCalled();
    expect(env.open).toHaveBeenCalledWith(composerUrl(BELL_QASM), '_blank', 'noopener');
    expect(result).toMatchObject({ copied: true, opened: true, message: COPIED_MESSAGE });
  });

  it('falls back to execCommand copy when the clipboard rejects', async () => {
    const execCopy = vi.fn().mockReturnValue(true);
    const env = makeEnv({
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      execCopy,
    });
    const result = await transferToComposer(BELL_QASM, env);
    expect(execCopy).toHaveBeenCalledWith(withUsedQubits(BELL_QASM));
    expect(result.copied).toBe(true);
    expect(result.message).toBe(COPIED_MESSAGE);
  });

  it('still opens the tab and adapts the toast when both copy paths fail', async () => {
    const env = makeEnv({
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      execCopy: vi.fn().mockReturnValue(false),
    });
    const result = await transferToComposer(BELL_QASM, env);
    expect(env.open).toHaveBeenCalledWith(composerUrl(BELL_QASM), '_blank', 'noopener');
    expect(result).toMatchObject({ copied: false, opened: true, message: NO_COPY_MESSAGE });
  });

  it('reports not-opened without throwing when window.open fails', async () => {
    const env = makeEnv({
      open: vi.fn(() => {
        throw new Error('popup blocked');
      }),
    });
    const result = await transferToComposer(BELL_QASM, env);
    expect(result.opened).toBe(false);
    expect(result.copied).toBe(true);
  });
});
