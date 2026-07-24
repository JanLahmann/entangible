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

// Controlled gates via the ● modifier (task #51). `type` is widened past the
// library's GateType union — the circuit JSON carries these controlled types.
const cg = (partial: Record<string, unknown>): Gate =>
  ({ id: `cg${seq++}`, ...partial }) as unknown as Gate;

describe('generic controlled-U (task #51)', () => {
  // Little-endian basis index: qubit q set when (i >> q) & 1. With control q0
  // and target q1, |00⟩→0, |10⟩(q0=1)→1, |01⟩(q1=1)→2, |11⟩→3.
  it('CX applies identically whether typed CNOT or CX', () => {
    const a = statevector(circuit([H(0), cg({ type: 'CNOT', control: 0, target: 1, position: 1 })]));
    const b = statevector(circuit([H(0), cg({ type: 'CX', control: 0, target: 1, position: 1 })]));
    expect(fidelity(a, b)).toBeCloseTo(1, 12);
    expect(fidelity(a, bellState([0, 1]))).toBeCloseTo(1, 10);
  });

  it('CH on |+⟩ control: (|00⟩ + (|10⟩+|11⟩)/√2)/√2', () => {
    const sv = statevector(circuit([H(0), cg({ type: 'CH', control: 0, target: 1, position: 1 })]));
    expect(sv[0].re).toBeCloseTo(Math.SQRT1_2, 12); // |00⟩ = 1/√2
    expect(sv[1].re).toBeCloseTo(0.5, 12); // |10⟩ = 1/2
    expect(sv[3].re).toBeCloseTo(0.5, 12); // |11⟩ = 1/2
    expect(sv[2].re).toBeCloseTo(0, 12); // |01⟩ = 0
  });

  it('CZ flips the sign of |11⟩ only', () => {
    // control q0 |1⟩, target q1 |1⟩ → amplitude −1 at |11⟩ (index 3).
    const sv = statevector(circuit([X(0), X(1), cg({ type: 'CZ', control: 0, target: 1, position: 1 })]));
    expect(sv[3].re).toBeCloseTo(-1, 12);
    expect(sv[3].im).toBeCloseTo(0, 12);
  });

  it('CY on |11⟩: Y|1⟩ = −i|0⟩ so |11⟩ → −i|10⟩', () => {
    const sv = statevector(circuit([X(0), X(1), cg({ type: 'CY', control: 0, target: 1, position: 1 })]));
    // target q1 flips 1→0, amplitude −i; result at |10⟩ (index 1).
    expect(sv[1].re).toBeCloseTo(0, 12);
    expect(sv[1].im).toBeCloseTo(-1, 12);
  });

  it('CS applies phase i to |11⟩ (controlled-phase, not controlled-RZ)', () => {
    const sv = statevector(circuit([X(0), X(1), cg({ type: 'CS', control: 0, target: 1, position: 1 })]));
    expect(sv[3].re).toBeCloseTo(0, 12);
    expect(sv[3].im).toBeCloseTo(1, 12); // e^{iπ/2} = i
  });

  it('CT applies phase e^{iπ/4} to |11⟩', () => {
    const sv = statevector(circuit([X(0), X(1), cg({ type: 'CT', control: 0, target: 1, position: 1 })]));
    expect(sv[3].re).toBeCloseTo(Math.SQRT1_2, 12);
    expect(sv[3].im).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('CS/CT leave |01⟩ (control 0) and |10⟩ (target 0) untouched', () => {
    const only01 = statevector(circuit([X(1), cg({ type: 'CS', control: 0, target: 1, position: 1 })]));
    expect(only01[2].re).toBeCloseTo(1, 12); // control 0 → no phase
    const only10 = statevector(circuit([X(0), cg({ type: 'CS', control: 0, target: 1, position: 1 })]));
    expect(only10[1].re).toBeCloseTo(1, 12); // target 0 → no phase
  });

  it('CCX (Toffoli) truth table: target flips iff BOTH controls are |1⟩', () => {
    const ccx = (pos = 3) => cg({ type: 'CCX', control: 0, control2: 1, target: 2, position: pos });
    // both controls 1 → target flips to 1
    expect(probOne(statevector(circuit([X(0), X(1), ccx()])), 2)).toBeCloseTo(1, 10);
    // only one control 1 → target stays 0
    expect(probOne(statevector(circuit([X(0), ccx()])), 2)).toBeCloseTo(0, 10);
    expect(probOne(statevector(circuit([X(1), ccx()])), 2)).toBeCloseTo(0, 10);
    // no controls → target stays 0
    expect(probOne(statevector(circuit([ccx()])), 2)).toBeCloseTo(0, 10);
  });

  it('CCX + Hadamard control makes a GHZ-like branch (both controls entangled)', () => {
    // H on q0 and q1, then CCX(0,1→2): |2⟩ set only in the |11⟩ control branch.
    const sv = statevector(
      circuit([H(0), H(1), cg({ type: 'CCX', control: 0, control2: 1, target: 2, position: 2 })]),
    );
    // |110⟩? control branch 11 (q0=1,q1=1) flips q2 → index 0b111 = 7, amp 1/2.
    expect(sv[7].re).toBeCloseTo(0.5, 12);
    // the other three control branches keep q2=0: indices 0,1,2 each 1/2.
    expect(sv[0].re).toBeCloseTo(0.5, 12);
    expect(sv[1].re).toBeCloseTo(0.5, 12);
    expect(sv[2].re).toBeCloseTo(0.5, 12);
  });
});
