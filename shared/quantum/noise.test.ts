import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import { DIM, statevector } from './statevector';
import { type NoiseParams, noisyProbabilities, resolvePreset } from './noise';
import fixturesData from './__fixtures__/noise-fixtures.json';

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
const RX = (q: number, parameter: number, position = 0) =>
  g({ type: 'RX', qubit: q, parameter, position });
const RZ = (q: number, parameter: number, position = 0) =>
  g({ type: 'RZ', qubit: q, parameter, position });

const ZERO: NoiseParams = { p1: 0, p2: 0, gamma1: 0, gammaPhi: 0, readout: 0 };

/** statevector probabilities (|amplitude|²), same ordering as noisyProbabilities. */
function stateProbs(c: Circuit): number[] {
  return statevector(c).map((a) => a.re * a.re + a.im * a.im);
}

describe('noise — parity with statevector (zero noise)', () => {
  // Controlled gates (task #51): `type` is widened past the library GateType
  // union — the density sim consumes the same controlled types the JSON carries.
  const cg = (partial: Record<string, unknown>): Gate =>
    ({ id: `cg${seq++}`, ...partial }) as unknown as Gate;
  const cases: Record<string, Circuit> = {
    bell: circuit([H(0), CNOT(0, 1)]),
    ghz5: circuit([H(0), CNOT(0, 1, 1), CNOT(0, 2, 2), CNOT(0, 3, 3), CNOT(0, 4, 4)]),
    rotations: circuit([RX(0, Math.PI / 3), RZ(0, Math.PI / 5, 1), H(2, 2)]),
    asymmetric: circuit([H(3), CNOT(3, 1)]),
    empty: circuit([]),
    // Density-matrix path must reproduce the controlled-U statevector exactly.
    ch: circuit([H(0), cg({ type: 'CH', control: 0, target: 1, position: 1 })]),
    cz: circuit([H(0), H(1), cg({ type: 'CZ', control: 0, target: 1, position: 2 })]),
    cs: circuit([X(0), X(1), cg({ type: 'CS', control: 0, target: 1, position: 1 })]),
    ct: circuit([X(0), X(1), cg({ type: 'CT', control: 0, target: 1, position: 1 })]),
    ccx: circuit([H(0), H(1), cg({ type: 'CCX', control: 0, control2: 1, target: 2, position: 2 })]),
  };
  for (const [name, c] of Object.entries(cases)) {
    it(`reproduces statevector probabilities for ${name}`, () => {
      const noisy = noisyProbabilities(c, ZERO);
      const ideal = stateProbs(c);
      expect(noisy).toHaveLength(DIM);
      for (let i = 0; i < DIM; i++) expect(noisy[i]).toBeCloseTo(ideal[i], 12);
    });
  }
});

describe('noise — closed-form goldens', () => {
  it('amplitude-damped |1⟩ has P(1) = 1 − γ', () => {
    const gamma = 0.3;
    const probs = noisyProbabilities(circuit([X(0)]), { ...ZERO, gamma1: gamma });
    expect(probs[1]).toBeCloseTo(1 - gamma, 12); // |...1⟩ on q0
    expect(probs[0]).toBeCloseTo(gamma, 12);
    for (let i = 2; i < DIM; i++) expect(probs[i]).toBeCloseTo(0, 12);
  });

  it('2-qubit depolarized Bell has the analytic diagonal', () => {
    const p = 0.1;
    const probs = noisyProbabilities(circuit([H(0), CNOT(0, 1)]), { ...ZERO, p2: p });
    // ρ → (1−16p/15)ρ_bell + (4p/15)·I₄ on qubits {0,1}; ρ_bell diag = ½ on
    // |00⟩,|11⟩. Off-diagonal basis states carry only the identity floor.
    const floor = (4 * p) / 15;
    const peak = (1 - (16 * p) / 15) * 0.5 + floor;
    expect(probs[0b00000]).toBeCloseTo(peak, 12);
    expect(probs[0b00011]).toBeCloseTo(peak, 12); // q0=q1=1
    expect(probs[0b00001]).toBeCloseTo(floor, 12);
    expect(probs[0b00010]).toBeCloseTo(floor, 12);
    for (let i = 4; i < DIM; i++) expect(probs[i]).toBeCloseTo(0, 12);
  });

  it('readout confusion is the per-qubit tensor product on a deterministic |11⟩', () => {
    const r0 = 0.1;
    const r1 = 0.2;
    const probs = noisyProbabilities(circuit([X(0), X(1)]), {
      ...ZERO,
      readout: [r0, r1, 0, 0, 0],
    });
    expect(probs[0b00011]).toBeCloseTo((1 - r0) * (1 - r1), 12);
    expect(probs[0b00010]).toBeCloseTo(r0 * (1 - r1), 12); // q0 flipped
    expect(probs[0b00001]).toBeCloseTo((1 - r0) * r1, 12); // q1 flipped
    expect(probs[0b00000]).toBeCloseTo(r0 * r1, 12);
    for (let i = 4; i < DIM; i++) expect(probs[i]).toBeCloseTo(0, 12);
  });
});

describe('noise — quantum_info fixtures', () => {
  for (const f of fixturesData.fixtures) {
    it(`matches the qiskit fixture ${f.name}`, () => {
      const probs = noisyProbabilities(f.circuit as Circuit, f.params as NoiseParams);
      expect(probs).toHaveLength(f.expected.length);
      for (let i = 0; i < probs.length; i++) expect(probs[i]).toBeCloseTo(f.expected[i], 9);
    });
  }
});

describe('noise — invariants', () => {
  const circuits: Circuit[] = [
    circuit([H(0), CNOT(0, 1, 1), RX(2, 1.1, 1), CNOT(3, 4, 2), RZ(1, 0.7, 2)]),
    circuit([RX(0, 0.3), RX(1, 2.4), H(2), X(3), CNOT(2, 4, 1), RZ(0, 1.9, 1)]),
    circuit([H(0), H(1), H(2), H(3), H(4)]),
  ];
  const paramSets: Record<string, NoiseParams> = {
    moderate: { p1: 0.02, p2: 0.04, gamma1: 0.03, gammaPhi: 0.03, readout: 0.03 },
    falcon: resolvePreset('falcon'),
    eagle: resolvePreset('eagle'),
    heron: resolvePreset('heron'),
    nighthawk: resolvePreset('nighthawk'),
  };
  for (const [pname, params] of Object.entries(paramSets)) {
    circuits.forEach((c, ci) => {
      it(`probabilities are non-negative and sum to 1 (${pname}, circuit ${ci})`, () => {
        const probs = noisyProbabilities(c, params);
        let sum = 0;
        for (const p of probs) {
          expect(p).toBeGreaterThanOrEqual(-1e-12);
          sum += p;
        }
        expect(sum).toBeCloseTo(1, 12);
      });
    });
  }
});

describe('noise — preset resolution', () => {
  const finiteUnit = (x: number) => Number.isFinite(x) && x > 0 && x < 1;

  it("'off' is all zero", () => {
    expect(resolvePreset('off')).toEqual(ZERO);
  });

  for (const name of ['eagle', 'heron', 'nighthawk'] as const) {
    it(`'${name}' loads uniform finite scalars in (0,1)`, () => {
      const p = resolvePreset(name);
      for (const v of [p.p1, p.p2, p.gamma1, p.gammaPhi, p.readout]) {
        expect(typeof v).toBe('number');
        expect(finiteUnit(v as number)).toBe(true);
      }
    });
  }

  it("'falcon' loads length-5 per-qubit arrays in (0,1)", () => {
    const p = resolvePreset('falcon');
    expect(typeof p.p1).toBe('number');
    expect(typeof p.p2).toBe('number');
    for (const arr of [p.gamma1, p.gammaPhi, p.readout]) {
      expect(Array.isArray(arr)).toBe(true);
      expect(arr as readonly number[]).toHaveLength(5);
      for (const v of arr as readonly number[]) expect(finiteUnit(v)).toBe(true);
    }
  });
});
