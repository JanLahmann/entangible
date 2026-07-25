// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { Circuit } from '@qamposer/react';
import { golfStep, initialGolfState } from '@quantum/golf';
import {
  BOARD_QUBITS,
  ManualEditSource,
  resolveActiveInput,
} from '../../src/sources/ManualEditSource';
import type { StateUpdate } from '../../src/sources/StateSource';

// --- helpers ----------------------------------------------------------------

/** An editor circuit (as `onCircuitChange` would hand it back). */
function circuit(qubits: number, gates: Circuit['gates']): Circuit {
  return { qubits, gates } as Circuit;
}

const H0 = { id: 'H-0', type: 'H', position: 0, qubit: 0 } as const;
const CX = { id: 'CX-1', type: 'CNOT', position: 1, control: 0, target: 1 } as const;

// --- resolveActiveInput (precedence) ----------------------------------------

describe('resolveActiveInput', () => {
  it('a connected booth viewer wins over ?input=manual', () => {
    // Precedence: ?connect=1 (→ connected) beats ?input=manual.
    expect(resolveActiveInput({ connected: true, input: 'manual' })).toBe('booth');
    expect(resolveActiveInput({ connected: true, input: 'camera' })).toBe('booth');
  });
  it('otherwise the input mode chooses manual vs camera', () => {
    expect(resolveActiveInput({ connected: false, input: 'manual' })).toBe('manual');
    expect(resolveActiveInput({ connected: false, input: 'camera' })).toBe('camera');
  });
});

// --- emit / subscribe -------------------------------------------------------

describe('ManualEditSource emit/subscribe', () => {
  it('start() emits the current circuit so downstream syncs', () => {
    const src = new ManualEditSource();
    const seen: StateUpdate[] = [];
    src.subscribe((u) => seen.push(u));
    expect(seen).toHaveLength(0); // nothing before start
    src.start();
    expect(seen).toHaveLength(1);
    expect(seen[0].source).toBe('manual');
    expect(seen[0].warnings).toEqual([]);
    expect(seen[0].circuit.qubits).toBe(BOARD_QUBITS);
    expect(seen[0].circuit.gates).toEqual([]);
  });

  it('an editor edit emits a neutral update through the same shape', () => {
    const src = new ManualEditSource();
    const seen: StateUpdate[] = [];
    src.subscribe((u) => seen.push(u));
    src.start();
    src.setFromEditor(circuit(BOARD_QUBITS, [H0]));
    expect(seen).toHaveLength(2);
    expect(seen[1].source).toBe('manual');
    expect(seen[1].circuit.gates).toEqual([H0]);
  });

  it('pins the register to five qubits even when the editor reports fewer', () => {
    const src = new ManualEditSource();
    const seen: StateUpdate[] = [];
    src.subscribe((u) => seen.push(u));
    src.start();
    // The editor is seeded from a display-collapsed 3-wire circuit; the emitted
    // (downstream) circuit must still carry the full 5-qubit register.
    src.setFromEditor(circuit(3, [H0]));
    expect(seen[1].circuit.qubits).toBe(BOARD_QUBITS);
    expect(src.getCircuit().qubits).toBe(BOARD_QUBITS);
    expect(src.getCircuit().gates).toEqual([H0]);
  });

  it('unsubscribe stops delivery', () => {
    const src = new ManualEditSource();
    const listener = vi.fn();
    const off = src.subscribe(listener);
    src.start();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    src.setFromEditor(circuit(BOARD_QUBITS, [H0]));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// --- feedback-loop guard ----------------------------------------------------

describe('ManualEditSource no-feedback-loop guard', () => {
  it('re-applying the controlled value (structurally equal) does NOT re-emit', () => {
    const src = new ManualEditSource();
    const seen: StateUpdate[] = [];
    src.subscribe((u) => seen.push(u));
    src.start(); // 1 emit
    src.setFromEditor(circuit(BOARD_QUBITS, [H0])); // 2 emit (real edit)
    // The controlled value flows back into the editor; an echo with the SAME
    // content (a different object, even a different qubit count that pins equal)
    // must be swallowed — no loop.
    src.setFromEditor(circuit(BOARD_QUBITS, [{ ...H0 }]));
    src.setFromEditor(circuit(3, [{ ...H0 }])); // pins to 5 → equal to held
    expect(seen).toHaveLength(2);
  });

  it('only real content changes emit', () => {
    const src = new ManualEditSource();
    const seen: StateUpdate[] = [];
    src.subscribe((u) => seen.push(u));
    src.start();
    src.setFromEditor(circuit(BOARD_QUBITS, [H0])); // emit
    src.setFromEditor(circuit(BOARD_QUBITS, [H0, CX])); // emit
    src.setFromEditor(circuit(BOARD_QUBITS, [H0, CX])); // no-op
    expect(seen).toHaveLength(3);
  });

  it('edits before start() update state silently (no emit until started)', () => {
    const src = new ManualEditSource();
    const seen: StateUpdate[] = [];
    src.subscribe((u) => seen.push(u));
    src.setFromEditor(circuit(BOARD_QUBITS, [H0])); // pre-start: no emit
    expect(seen).toHaveLength(0);
    src.start(); // emits the accumulated circuit once
    expect(seen).toHaveLength(1);
    expect(seen[0].circuit.gates).toEqual([H0]);
  });
});

// --- golf in manual mode ----------------------------------------------------

describe('golf steps on a manual circuit change', () => {
  it('building a Bell pair on screen holes in golf level 2', () => {
    // Mirrors App.applyUpdate's golf branch: each manual edit → golfStep.
    const src = new ManualEditSource();
    let golf = initialGolfState();
    // Advance to the Bell level (level index 1, 2 qubits).
    golf = { ...golf, levelIndex: 1 };
    let holedIn = false;
    src.subscribe((u) => {
      const step = golfStep(golf, u.circuit);
      golf = step.state;
      if (step.justHoledIn) holedIn = true;
    });
    src.start();
    src.setFromEditor(circuit(BOARD_QUBITS, [H0])); // superposition, not yet Bell
    expect(holedIn).toBe(false);
    src.setFromEditor(circuit(BOARD_QUBITS, [H0, CX])); // Bell pair → hole in
    expect(holedIn).toBe(true);
  });

  it('counts every on-screen add and delete, and clear() tees the next hole off at 0 (#68)', () => {
    // The Scorecard's "Next hole" button calls clear() — the manual twin of
    // sweeping the table. It must advance AND reset the stroke count.
    const src = new ManualEditSource();
    let golf = { ...initialGolfState(), levelIndex: 1 }; // Bell hole (par 2)
    src.subscribe((u) => {
      golf = golfStep(golf, u.circuit).state;
    });
    src.start();
    src.setFromEditor(circuit(BOARD_QUBITS, [H0])); // +1
    expect(golf.strokes).toBe(1);
    const strayX = { id: 'X-1', type: 'X', position: 1, qubit: 3 } as const;
    src.setFromEditor(circuit(BOARD_QUBITS, [H0, strayX])); // wrong club, +1
    expect(golf.strokes).toBe(2);
    src.setFromEditor(circuit(BOARD_QUBITS, [H0])); // deleted again, +1
    expect(golf.strokes).toBe(3);
    src.setFromEditor(circuit(BOARD_QUBITS, [H0, CX])); // Bell → hole in at 4
    expect(golf.strokes).toBe(4);
    expect(golf.best[2]).toBe(4);

    src.clear();
    expect(golf.levelIndex).toBe(2); // advanced to the GHZ-3 hole …
    expect(golf.strokes).toBe(0); // … with a clean card
    expect(golf.gateKeys).toEqual({});
  });
});
