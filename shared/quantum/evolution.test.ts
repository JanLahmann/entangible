import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import { DIM, fidelity, bellState, statevector } from './statevector';
import { evolutionSteps, occupiedColumns } from './evolution';

const R = Math.SQRT1_2;

let seq = 0;
function g(partial: Omit<Gate, 'id'>): Gate {
  return { id: `g${seq++}`, ...partial };
}
function circuit(gates: Gate[]): Circuit {
  return { qubits: 5, gates };
}
const H = (q: number, position: number) => g({ type: 'H', qubit: q, position });
const X = (q: number, position: number) => g({ type: 'X', qubit: q, position });
const CNOT = (control: number, target: number, position: number) =>
  g({ type: 'CNOT', control, target, position });

describe('occupiedColumns', () => {
  it('is empty for an empty board', () => {
    expect(occupiedColumns(circuit([]))).toEqual([]);
  });

  it('lists distinct gate positions, ascending, deduped per column', () => {
    // Two gates share column 1 → one column; a gap at 2 is not invented.
    const c = circuit([H(0, 0), H(1, 1), X(2, 1), CNOT(0, 3, 3)]);
    expect(occupiedColumns(c)).toEqual([0, 1, 3]);
  });
});

describe('evolutionSteps', () => {
  it('an empty board yields just the initial |0…0⟩', () => {
    const steps = evolutionSteps(circuit([]));
    expect(steps).toHaveLength(1);
    expect(steps[0][0].re).toBeCloseTo(1, 10);
    for (let i = 1; i < DIM; i++) expect(steps[0][i].re).toBeCloseTo(0, 10);
  });

  it('golden: H then CX steps |00⟩ → (|00⟩+|10⟩)/√2 → Bell', () => {
    // H on q0 (column 0), CNOT(0→1) (column 1). Little-endian: index 1 = q0 set,
    // index 3 = q0 and q1 set.
    const steps = evolutionSteps(circuit([H(0, 0), CNOT(0, 1, 1)]));
    expect(steps).toHaveLength(3); // initial + 2 columns

    // Step 0: the ground state |00000⟩.
    expect(steps[0][0].re).toBeCloseTo(1, 10);
    for (let i = 1; i < DIM; i++) expect(steps[0][i].re).toBeCloseTo(0, 10);

    // Step 1: after column 0 — superposition on q0, (|…0⟩ + |…1 on q0⟩)/√2.
    expect(steps[1][0].re).toBeCloseTo(R, 10);
    expect(steps[1][1].re).toBeCloseTo(R, 10);
    for (let i = 2; i < DIM; i++) {
      expect(steps[1][i].re).toBeCloseTo(0, 10);
      expect(steps[1][i].im).toBeCloseTo(0, 10);
    }

    // Step 2: after column 1 — the Bell pair (|00⟩ + |11⟩)/√2 on {0,1}.
    expect(steps[2][0].re).toBeCloseTo(R, 10);
    expect(steps[2][3].re).toBeCloseTo(R, 10);
    expect(steps[2][1].re).toBeCloseTo(0, 10);
    expect(fidelity(steps[2], bellState([0, 1]))).toBeCloseTo(1, 10);
  });

  it('final step always equals the live full-circuit statevector', () => {
    const c = circuit([X(0, 0), H(1, 1), CNOT(1, 2, 2)]);
    const steps = evolutionSteps(c);
    // The last snapshot is the state the golf views already show today.
    const full = statevector(c);
    const last = steps[steps.length - 1];
    for (let i = 0; i < DIM; i++) {
      expect(last[i].re).toBeCloseTo(full[i].re, 10);
      expect(last[i].im).toBeCloseTo(full[i].im, 10);
    }
  });
});
