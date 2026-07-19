import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import {
  blochVector,
  blochLength,
  circuitBloch,
  superpositionMagnitude,
  BLOCH_ENDPOINTS,
  BLOCH_DEFAULT_YAW,
  BLOCH_DEFAULT_PITCH,
} from './bloch';
import { projectPoint } from './qsphere';
import { DIM, type Complex, type StateVector } from './statevector';

function state(entries: Record<number, Complex>): StateVector {
  const sv: StateVector = new Array(DIM);
  for (let i = 0; i < DIM; i++) sv[i] = { re: 0, im: 0 };
  for (const [k, v] of Object.entries(entries)) sv[Number(k)] = v;
  return sv;
}

const R = Math.SQRT1_2;
const g = (type: Gate['type'], position: number, extra: Partial<Gate> = {}): Gate => ({
  id: `${type}-${position}`,
  type,
  position,
  ...extra,
});
const circuit = (gates: Gate[]): Circuit => ({ qubits: 5, gates });

describe('blochVector canonical states (qubit 0)', () => {
  it('|0⟩ → (0,0,1)', () => {
    const v = blochVector(state({ 0: { re: 1, im: 0 } }), 0);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(1);
  });

  it('|1⟩ → (0,0,-1)', () => {
    const v = blochVector(state({ 1: { re: 1, im: 0 } }), 0);
    expect(v.z).toBeCloseTo(-1);
  });

  it('|+⟩ → (1,0,0)', () => {
    const v = blochVector(state({ 0: { re: R, im: 0 }, 1: { re: R, im: 0 } }), 0);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(0);
  });

  it('|i+⟩ = (|0⟩+i|1⟩)/√2 → (0,1,0)', () => {
    const v = blochVector(state({ 0: { re: R, im: 0 }, 1: { re: 0, im: R } }), 0);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
    expect(v.z).toBeCloseTo(0);
  });

  it('pure single-qubit states have unit length', () => {
    expect(blochLength(blochVector(state({ 0: { re: R, im: 0 }, 1: { re: R, im: 0 } }), 0))).toBeCloseTo(1);
  });
});

describe('bestBlochQubit / any-qubit rule', () => {
  it('picks the qubit carrying the superposition', () => {
    // H on q3.
    const sv = circuitBloch(circuit([g('H', 0, { qubit: 3 })]));
    expect(sv.qubit).toBe(3);
    expect(superpositionMagnitude(sv.vector)).toBeCloseTo(1);
  });

  it('an entangled (Bell) qubit has a short Bloch vector (mixed)', () => {
    const bell = circuit([g('H', 0, { qubit: 0 }), g('CNOT', 1, { control: 0, target: 1 })]);
    // Reduced state of a Bell qubit is maximally mixed → length ~0.
    const { vector } = circuitBloch(bell);
    expect(blochLength(vector)).toBeLessThan(0.2);
  });

  it('empty circuit → qubit 0 at |0⟩', () => {
    const { qubit, vector } = circuitBloch(circuit([]));
    expect(qubit).toBe(0);
    expect(vector.z).toBeCloseTo(1);
  });
});

describe('Bloch axis + state labels', () => {
  const byKet = (k: string) => BLOCH_ENDPOINTS.find((e) => e.ket === k)!;

  it('exposes all six labelled endpoints with the standard convention', () => {
    expect(BLOCH_ENDPOINTS).toHaveLength(6);
    // Every eigenstate ket is present exactly once.
    const kets = BLOCH_ENDPOINTS.map((e) => e.ket);
    expect(new Set(kets)).toEqual(new Set(['|0⟩', '|1⟩', '|+⟩', '|−⟩', '|i+⟩', '|i−⟩']));
    // Convention: which unit direction each ket sits on.
    expect(byKet('|0⟩').dir).toEqual({ x: 0, y: 0, z: 1 });
    expect(byKet('|1⟩').dir).toEqual({ x: 0, y: 0, z: -1 });
    expect(byKet('|+⟩').dir).toEqual({ x: 1, y: 0, z: 0 });
    expect(byKet('|−⟩').dir).toEqual({ x: -1, y: 0, z: 0 });
    expect(byKet('|i+⟩').dir).toEqual({ x: 0, y: 1, z: 0 });
    expect(byKet('|i−⟩').dir).toEqual({ x: 0, y: -1, z: 0 });
  });

  it('shows an axis letter only at the three positive ends', () => {
    const letters = BLOCH_ENDPOINTS.filter((e) => e.axisLetter).map((e) => e.axisLetter);
    expect(letters.sort()).toEqual(['x', 'y', 'z']);
    // Positive ends carry the letter; negative ends do not.
    for (const e of BLOCH_ENDPOINTS) {
      expect(e.axisLetter).toBe(e.sign === 1 ? e.axis : null);
    }
  });

  it('|+⟩ aligns with the +x axis end (blochVector and label agree)', () => {
    // The measured Bloch vector of |+⟩ is (1,0,0)…
    const v = blochVector(state({ 0: { re: R, im: 0 }, 1: { re: R, im: 0 } }), 0);
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(0);
    // …which is exactly the direction the |+⟩ label sits on.
    expect(byKet('|+⟩').dir).toEqual({ x: 1, y: 0, z: 0 });
    // And both project to the same screen point at the default view.
    const pv = projectPoint(v, BLOCH_DEFAULT_YAW, BLOCH_DEFAULT_PITCH);
    const pe = projectPoint(byKet('|+⟩').dir, BLOCH_DEFAULT_YAW, BLOCH_DEFAULT_PITCH);
    expect(pv.x).toBeCloseTo(pe.x);
    expect(pv.y).toBeCloseTo(pe.y);
    expect(pv.depth).toBeCloseTo(pe.depth);
  });

  it('projects the six endpoints to distinct, well-separated screen points', () => {
    const proj = BLOCH_ENDPOINTS.map((e) => ({
      ket: e.ket,
      ...projectPoint(e.dir, BLOCH_DEFAULT_YAW, BLOCH_DEFAULT_PITCH),
    }));
    // No two endpoints share a screen position (min pairwise gap comfortable).
    let minGap = Infinity;
    for (let i = 0; i < proj.length; i++) {
      for (let j = i + 1; j < proj.length; j++) {
        minGap = Math.min(minGap, Math.hypot(proj[i].x - proj[j].x, proj[i].y - proj[j].y));
      }
    }
    expect(minGap).toBeGreaterThan(0.3);
    // Poles land top/bottom on the vertical centre line.
    const zero = proj.find((p) => p.ket === '|0⟩')!;
    const one = proj.find((p) => p.ket === '|1⟩')!;
    expect(zero.x).toBeCloseTo(0);
    expect(one.x).toBeCloseTo(0);
    expect(zero.y).toBeLessThan(0); // |0⟩ at the top (y-down screen)
    expect(one.y).toBeGreaterThan(0); // |1⟩ at the bottom
  });

  it('default view keeps |0⟩ near and splits the ends three near / three far', () => {
    const depthOf = (k: string) =>
      projectPoint(byKet(k).dir, BLOCH_DEFAULT_YAW, BLOCH_DEFAULT_PITCH).depth;
    // |0⟩ is the prominent NEAR pole (depth > 0); |1⟩ is behind.
    expect(depthOf('|0⟩')).toBeGreaterThan(0);
    expect(depthOf('|1⟩')).toBeLessThan(0);
    const near = BLOCH_ENDPOINTS.filter(
      (e) => projectPoint(e.dir, BLOCH_DEFAULT_YAW, BLOCH_DEFAULT_PITCH).depth >= 0,
    );
    expect(near).toHaveLength(3); // depth-dim flags split evenly
  });
});
