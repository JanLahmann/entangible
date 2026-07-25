import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import { DIM, fidelity, bellState, statevector } from './statevector';
import {
  antipodalWaypoint,
  evolutionSteps,
  lerpHue,
  occupiedColumns,
  surfacePath,
  transportEdges,
} from './evolution';
import { layout } from './qsphere';

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

describe('transportEdges (roll-the-ball map, #57)', () => {
  /** Edges of one segment as sortable `from→to@weight` strings. */
  const shape = (edges: ReturnType<typeof transportEdges>[number]) =>
    edges.map((e) => `${e.from}->${e.to}@${e.weight.toFixed(4)}`).sort();

  it('splits one ball into two for H on |0⟩', () => {
    const [seg0] = transportEdges(circuit([H(0, 0)]));
    // The self-edge is part of the map (mass that stays); the renderer skips it.
    expect(shape(seg0)).toEqual(['0->0@0.5000', '0->1@0.5000']);
  });

  it('moves ALL the mass for X — one edge, no self-edge', () => {
    const [seg0] = transportEdges(circuit([X(0, 0)]));
    expect(shape(seg0)).toEqual(['0->1@1.0000']);
  });

  it('maps two sources through a CNOT: {0→0, 2→3}', () => {
    // H on q1 (col 0) → (|00⟩+|10⟩)/√2, i.e. indices 0 and 2. Then CNOT 1→0.
    const segs = transportEdges(circuit([H(1, 0), CNOT(1, 0, 1)]));
    expect(shape(segs[1])).toEqual(['0->0@0.5000', '2->3@0.5000']);
  });

  it('applies BOTH gates of a two-gate column', () => {
    // X on q0 and X on q1 share column 0: |00000⟩ → |00011⟩ (index 3).
    const [seg0] = transportEdges(circuit([X(0, 0), X(1, 0)]));
    expect(shape(seg0)).toEqual(['0->3@1.0000']);
  });

  it('conserves probability: weights leaving a source sum to its prob', () => {
    const c = circuit([H(0, 0), H(1, 0), CNOT(0, 2, 1), H(1, 2)]);
    const steps = evolutionSteps(c);
    const segs = transportEdges(c, steps);
    segs.forEach((edges, k) => {
      const bySource = new Map<number, number>();
      for (const e of edges) bySource.set(e.from, (bySource.get(e.from) ?? 0) + e.weight);
      for (const [i, sum] of bySource) {
        const a = steps[k][i];
        expect(sum).toBeCloseTo(a.re * a.re + a.im * a.im, 8);
      }
      // Every segment moves the whole normalised state.
      expect([...bySource.values()].reduce((s, w) => s + w, 0)).toBeCloseTo(1, 8);
    });
  });

  it('carries phase hues: a Z after H turns the |1⟩ ball 180° on arrival', () => {
    // H (col 0) then Z on q0 (col 1): (|0⟩+|1⟩)/√2 → (|0⟩−|1⟩)/√2.
    const segs = transportEdges(circuit([H(0, 0), g({ type: 'Z', qubit: 0, position: 1 })]));
    const seg1 = segs[1];
    // Z only phases — every edge is a self-edge, no ball actually travels.
    expect(seg1.every((e) => e.from === e.to)).toBe(true);
    const flipped = seg1.find((e) => e.from === 1)!;
    expect(flipped.fromHue).toBeCloseTo(0, 6); // departs in phase with |0⟩
    expect(flipped.toHue).toBeCloseTo(180, 6); // arrives anti-phase
  });

  it('has one edge list per occupied column', () => {
    const c = circuit([H(0, 0), X(1, 4), CNOT(0, 1, 7)]);
    expect(transportEdges(c)).toHaveLength(occupiedColumns(c).length);
    expect(transportEdges(circuit([]))).toEqual([]);
  });
});

describe('surfacePath / antipodalWaypoint', () => {
  const norm = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);
  const dot = (a: { x: number; y: number; z: number }, b: typeof a) =>
    a.x * b.x + a.y * b.y + a.z * b.z;

  const nodes = layout(5);
  const at = (i: number) => nodes.find((n) => n.index === i)!.pos;

  it('stays on the unit sphere over a whole ordinary hop', () => {
    const a = at(0); // north pole |00000⟩
    const b = at(1); // first ring
    for (let k = 0; k <= 10; k++) expect(norm(surfacePath(a, b, k / 10))).toBeCloseTo(1, 10);
  });

  it('hits both endpoints exactly', () => {
    const a = at(1);
    const b = at(3);
    expect(surfacePath(a, b, 0).x).toBeCloseTo(a.x, 10);
    expect(surfacePath(a, b, 0).z).toBeCloseTo(a.z, 10);
    expect(surfacePath(a, b, 1).x).toBeCloseTo(b.x, 10);
    expect(surfacePath(a, b, 1).z).toBeCloseTo(b.z, 10);
  });

  it('routes the antipodal pole-to-pole hop through the equator, unit-norm', () => {
    const north = at(0); // (0, 0, 1)
    const south = at(31); // (0, 0, -1)
    expect(dot(north, south)).toBeCloseTo(-1, 10);
    for (let k = 0; k <= 20; k++) expect(norm(surfacePath(north, south, k / 20))).toBeCloseTo(1, 10);
    // Half way = the deterministic waypoint: the equator at longitude 0.
    const mid = surfacePath(north, south, 0.5);
    expect(mid.z).toBeCloseTo(0, 10);
    expect(mid.x).toBeCloseTo(1, 10);
    expect(mid.y).toBeCloseTo(0, 10);
    // Deterministic: same inputs, same path.
    expect(surfacePath(north, south, 0.3)).toEqual(surfacePath(north, south, 0.3));
    // Monotone descent from north to south (it really rolls the long way).
    let prev = 2;
    for (let k = 0; k <= 20; k++) {
      const z = surfacePath(north, south, k / 20).z;
      expect(z).toBeLessThanOrEqual(prev + 1e-9);
      prev = z;
    }
  });

  it('routes an antipodal EQUATOR pair (n = 2) over the north pole', () => {
    // n = 2's weight-1 ring holds |01⟩ and |10⟩ at longitudes 0 and π — both on
    // the equator, so the source is its own "equator point": fall back to a pole.
    const two = layout(2);
    const a = two.find((n) => n.index === 1)!.pos;
    const b = two.find((n) => n.index === 2)!.pos;
    expect(dot(a, b)).toBeCloseTo(-1, 10);
    expect(antipodalWaypoint(a)).toEqual({ x: 0, y: 0, z: 1 });
    for (let k = 0; k <= 20; k++) expect(norm(surfacePath(a, b, k / 20))).toBeCloseTo(1, 10);
    expect(surfacePath(a, b, 0.5).z).toBeCloseTo(1, 10);
  });

  it('waypoints a pole source at longitude 0', () => {
    expect(antipodalWaypoint({ x: 0, y: 0, z: 1 })).toEqual({ x: 1, y: 0, z: 0 });
  });
});

describe('lerpHue', () => {
  it('interpolates linearly within a hemisphere of the wheel', () => {
    expect(lerpHue(0, 180, 0.5)).toBeCloseTo(90, 10);
    expect(lerpHue(60, 120, 0)).toBeCloseTo(60, 10);
    expect(lerpHue(60, 120, 1)).toBeCloseTo(120, 10);
  });

  it('takes the SHORT way round the wheel', () => {
    // 350° → 10° passes through 0°, not backwards through 180°.
    expect(lerpHue(350, 10, 0.5)).toBeCloseTo(0, 10);
    expect(lerpHue(10, 350, 0.5)).toBeCloseTo(0, 10);
  });

  it('always returns a hue in [0, 360)', () => {
    for (let k = 0; k <= 10; k++) {
      const h = lerpHue(300, 40, k / 10);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
});
