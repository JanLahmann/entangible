import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import {
  activeQubits,
  bellState,
  DIM,
  fidelity,
  ghzState,
  probOne,
  statevector,
} from './statevector';

let seq = 0;
function g(partial: Omit<Gate, 'id'>): Gate {
  return { id: `g${seq++}`, ...partial };
}
function circuit(gates: Gate[]): Circuit {
  return { qubits: 5, gates };
}

const H = (q: number, position = 0) => g({ type: 'H', qubit: q, position });
const X = (q: number, position = 0) => g({ type: 'X', qubit: q, position });
const CNOT = (control: number, target: number, position = 1) =>
  g({ type: 'CNOT', control, target, position });

describe('statevector', () => {
  it('H|0⟩ is an equal superposition of |0⟩ and |1⟩', () => {
    const sv = statevector(circuit([H(0)]));
    expect(sv).toHaveLength(DIM);
    expect(sv[0].re).toBeCloseTo(Math.SQRT1_2, 10);
    expect(sv[1].re).toBeCloseTo(Math.SQRT1_2, 10);
    // all other amplitudes vanish
    for (let i = 2; i < DIM; i++) {
      expect(sv[i].re).toBeCloseTo(0, 10);
      expect(sv[i].im).toBeCloseTo(0, 10);
    }
    expect(probOne(sv, 0)).toBeCloseTo(0.5, 10);
  });

  it('X|0⟩ = |1⟩ (bit flip)', () => {
    const sv = statevector(circuit([X(2)]));
    expect(probOne(sv, 2)).toBeCloseTo(1, 10);
    expect(sv[1 << 2].re).toBeCloseTo(1, 10);
  });

  it('a Bell circuit has fidelity 1.0 against the canonical Bell state', () => {
    const sv = statevector(circuit([H(0), CNOT(0, 1)]));
    expect(fidelity(sv, bellState([0, 1]))).toBeCloseTo(1, 10);
    // and is NOT a product state: fidelity vs |00⟩ is ~0.5
    expect(probOne(sv, 0)).toBeCloseTo(0.5, 10);
    expect(probOne(sv, 1)).toBeCloseTo(0.5, 10);
  });

  it('a Bell pair on a non-adjacent qubit pair still matches', () => {
    const sv = statevector(circuit([H(1), CNOT(1, 4)]));
    expect(fidelity(sv, bellState([1, 4]))).toBeCloseTo(1, 10);
  });

  it('builds GHZ-3, GHZ-4 and GHZ-5 with fidelity 1.0', () => {
    const ghz3 = statevector(circuit([H(0), CNOT(0, 1), CNOT(0, 2)]));
    expect(fidelity(ghz3, ghzState([0, 1, 2]))).toBeCloseTo(1, 10);

    const ghz4 = statevector(
      circuit([H(0), CNOT(0, 1), CNOT(0, 2), CNOT(0, 3)]),
    );
    expect(fidelity(ghz4, ghzState([0, 1, 2, 3]))).toBeCloseTo(1, 10);

    const ghz5 = statevector(
      circuit([H(0), CNOT(0, 1), CNOT(0, 2), CNOT(0, 3), CNOT(0, 4)]),
    );
    expect(fidelity(ghz5, ghzState([0, 1, 2, 3, 4]))).toBeCloseTo(1, 10);
  });

  it('RX(π) equals X up to a global phase (fidelity 1.0)', () => {
    const rx = statevector(circuit([g({ type: 'RX', qubit: 0, parameter: Math.PI, position: 0 })]));
    const x = statevector(circuit([X(0)]));
    expect(fidelity(rx, x)).toBeCloseTo(1, 10);
    // it really is a bit flip, even though the amplitude is -i not 1
    expect(probOne(rx, 0)).toBeCloseTo(1, 10);
    expect(rx[1].im).toBeCloseTo(-1, 10);
  });

  it('RY(π) equals X exactly (no phase)', () => {
    const ry = statevector(circuit([g({ type: 'RY', qubit: 0, parameter: Math.PI, position: 0 })]));
    expect(probOne(ry, 0)).toBeCloseTo(1, 10);
    expect(ry[1].re).toBeCloseTo(1, 10);
  });

  it('reports the active qubits, ascending and de-duplicated', () => {
    const c = circuit([H(3), CNOT(3, 0), X(3, 2)]);
    expect(activeQubits(c)).toEqual([0, 3]);
    expect(activeQubits(circuit([]))).toEqual([]);
  });

  it('applies gates in position order regardless of array order', () => {
    // H then X on q0: X·H|0⟩ — same magnitude either way, but ordering must be
    // by `position`, not array index.
    const inOrder = statevector(circuit([H(0, 0), CNOT(0, 1, 1)]));
    const shuffled = statevector(circuit([CNOT(0, 1, 1), H(0, 0)]));
    expect(fidelity(inOrder, shuffled)).toBeCloseTo(1, 10);
  });
});
