/**
 * Parity test for the shared display-only wire-count transform, used by both
 * the booth and Pocket editors. Merged from the two apps' former copies in SC1.
 */
import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import {
  displayCircuit,
  displayQubits,
  highestUsedRow,
  FULL_WIRES,
  MIN_COMPACT_WIRES,
} from './displayWires';

let seq = 0;
const g = (partial: Omit<Gate, 'id'>): Gate => ({ id: `g${seq++}`, ...partial });
const H = (q: number, position = 0): Gate => g({ type: 'H', qubit: q, position });
const CNOT = (control: number, target: number, position = 1): Gate =>
  g({ type: 'CNOT', control, target, position });

/** The recognized circuit is ALWAYS physically 5 qubits. */
const circuit = (gates: Gate[]): Circuit => ({ qubits: FULL_WIRES, gates });

describe('highestUsedRow', () => {
  it('is -1 for an empty circuit', () => {
    expect(highestUsedRow(circuit([]))).toBe(-1);
  });

  it('tracks single-qubit and CNOT rows (control/target)', () => {
    expect(highestUsedRow(circuit([H(1)]))).toBe(1);
    expect(highestUsedRow(circuit([H(0), CNOT(0, 4)]))).toBe(4);
    expect(highestUsedRow(circuit([CNOT(3, 1)]))).toBe(3);
  });
});

describe('displayQubits — compact mode (floor 3, grows to 5)', () => {
  it('empty board shows the floor of 3', () => {
    expect(displayQubits(circuit([]), 'compact')).toBe(3);
  });

  it('a tile on q1 still shows 3 (floor)', () => {
    expect(displayQubits(circuit([H(1)]), 'compact')).toBe(3);
  });

  it('a tile on q3 grows to 4', () => {
    expect(displayQubits(circuit([H(3)]), 'compact')).toBe(4);
  });

  it('a tile on q4 grows to the full 5', () => {
    expect(displayQubits(circuit([H(4)]), 'compact')).toBe(5);
  });

  it('contracts again when the high tile is removed', () => {
    expect(displayQubits(circuit([H(0), H(4)]), 'compact')).toBe(5);
    expect(displayQubits(circuit([H(0)]), 'compact')).toBe(3);
  });
});

describe('displayQubits — compact mode grows for CNOT control/target rows', () => {
  it('grows to cover a CNOT target below the floor', () => {
    expect(displayQubits(circuit([CNOT(0, 3)]), 'compact')).toBe(4);
  });

  it('grows to the full 5 when a CNOT control sits on q4', () => {
    expect(displayQubits(circuit([CNOT(4, 0)]), 'compact')).toBe(5);
  });

  it('is driven by the highest of control/target regardless of order', () => {
    expect(displayQubits(circuit([CNOT(3, 1)]), 'compact')).toBe(4);
  });
});

describe('displayQubits — all mode', () => {
  it('always shows 5, regardless of used rows', () => {
    expect(displayQubits(circuit([]), 'all')).toBe(5);
    expect(displayQubits(circuit([H(1)]), 'all')).toBe(5);
    expect(displayQubits(circuit([H(3)]), 'all')).toBe(5);
    expect(MIN_COMPACT_WIRES).toBe(3);
    expect(FULL_WIRES).toBe(5);
  });
});

describe('displayCircuit', () => {
  it('keeps the same gate array, re-counts only the wires', () => {
    const phys = circuit([H(1)]);
    const shown = displayCircuit(phys, 'compact');
    expect(shown.qubits).toBe(3);
    expect(shown.gates).toBe(phys.gates); // gate data untouched (same reference)
  });

  it('returns the input object unchanged when the count already matches', () => {
    const phys = circuit([H(4)]); // compact → 5, already the physical count
    expect(displayCircuit(phys, 'compact')).toBe(phys);
    expect(displayCircuit(phys, 'all')).toBe(phys);
  });

  it('minWires floors the compact trim (golf: the hole sets the wire count)', () => {
    // An empty board on a 4-qubit hole must already show 4 wires — the player
    // sees where the target lives before the first gate lands on q3.
    const empty = circuit([]);
    expect(displayQubits(empty, 'compact', 4)).toBe(4);
    expect(displayCircuit(empty, 'compact', 4).qubits).toBe(4);
    // Gates above the floor still win…
    expect(displayQubits(circuit([H(4)]), 'compact', 4)).toBe(5);
    // …the floor never exceeds the physical ceiling…
    expect(displayQubits(empty, 'compact', 9)).toBe(5);
    // …and 'all' plus small floors behave as before.
    expect(displayQubits(empty, 'all', 2)).toBe(5);
    expect(displayQubits(empty, 'compact', 2)).toBe(3);
  });
});
