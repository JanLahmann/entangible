import { describe, it, expect } from 'vitest';
import {
  easeInOutCubic,
  lerpAngleShort,
  interpolateStatevector,
  slerpBloch,
  blochToStatevector,
} from './evolutionAnimation';
import { blochVector, type BlochVector } from '@quantum/bloch';
import type { StateVector } from '@quantum/statevector';

const R = Math.SQRT1_2;
const c = (re: number, im = 0) => ({ re, im });

describe('easeInOutCubic', () => {
  it('pins the endpoints and the midpoint, clamping out of range', () => {
    expect(easeInOutCubic(0)).toBeCloseTo(0);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(1)).toBeCloseTo(1);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });
});

describe('lerpAngleShort', () => {
  it('interpolates along the SHORTER arc across the ±π wrap', () => {
    // 350° → 10° should go forward through 360°/0°, not backward through 180°.
    const a = (350 * Math.PI) / 180;
    const b = (10 * Math.PI) / 180;
    const mid = lerpAngleShort(a, b, 0.5);
    // Normalise to (-π, π]: the midpoint is 0° (i.e. 360°), not 180°.
    const norm = Math.atan2(Math.sin(mid), Math.cos(mid));
    expect(norm).toBeCloseTo(0, 6);
  });
});

describe('interpolateStatevector', () => {
  // a = |0⟩, b = |1⟩ (embedded in 5 qubits): probability crosses over.
  const a: StateVector = Array.from({ length: 32 }, (_, i) => (i === 0 ? c(1) : c(0)));
  const b: StateVector = Array.from({ length: 32 }, (_, i) => (i === 1 ? c(1) : c(0)));

  it('is exact at the endpoints (t=0 → a, t=1 → b)', () => {
    const at0 = interpolateStatevector(a, b, 0);
    const at1 = interpolateStatevector(a, b, 1);
    for (let i = 0; i < 32; i++) {
      expect(at0[i].re).toBeCloseTo(a[i].re, 9);
      expect(at0[i].im).toBeCloseTo(a[i].im, 9);
      expect(at1[i].re).toBeCloseTo(b[i].re, 9);
      expect(at1[i].im).toBeCloseTo(b[i].im, 9);
    }
  });

  it('lerps PROBABILITY (radius²) — halfway each node carries p = 0.5', () => {
    const mid = interpolateStatevector(a, b, 0.5);
    const p0 = mid[0].re * mid[0].re + mid[0].im * mid[0].im;
    const p1 = mid[1].re * mid[1].re + mid[1].im * mid[1].im;
    expect(p0).toBeCloseTo(0.5, 9);
    expect(p1).toBeCloseTo(0.5, 9);
  });

  it('a node growing from zero borrows the destination phase (no colour sweep)', () => {
    // b index 1 has a +i phase (90°); a index 1 is empty → mid should already be
    // at 90°, not sweeping from an arbitrary 0°.
    const bi: StateVector = Array.from({ length: 32 }, (_, i) => (i === 1 ? c(0, 1) : c(0)));
    const mid = interpolateStatevector(a, bi, 0.5);
    expect(Math.atan2(mid[1].im, mid[1].re)).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe('slerpBloch', () => {
  const zPlus: BlochVector = { x: 0, y: 0, z: 1 }; // |0⟩
  const xPlus: BlochVector = { x: 1, y: 0, z: 0 }; // |+⟩

  it('is exact at the endpoints', () => {
    expect(slerpBloch(zPlus, xPlus, 0)).toMatchObject({ x: 0, y: 0, z: 1 });
    const at1 = slerpBloch(zPlus, xPlus, 1);
    expect(at1.x).toBeCloseTo(1);
    expect(at1.z).toBeCloseTo(0);
  });

  it('stays on the unit sphere and follows the 90° arc (45° at the midpoint)', () => {
    const mid = slerpBloch(zPlus, xPlus, 0.5);
    expect(Math.hypot(mid.x, mid.y, mid.z)).toBeCloseTo(1, 6);
    expect(mid.x).toBeCloseTo(R, 6);
    expect(mid.z).toBeCloseTo(R, 6);
  });

  it('lerps LENGTH for entangled (sub-unit) vectors', () => {
    const half: BlochVector = { x: 0, y: 0, z: 0.5 };
    const mid = slerpBloch(zPlus, half, 0.5);
    expect(mid.z).toBeCloseTo(0.75, 6); // (1 + 0.5)/2
  });

  it('grows a degenerate (zero) end along the other end direction', () => {
    const zero: BlochVector = { x: 0, y: 0, z: 0 };
    const mid = slerpBloch(zero, xPlus, 0.5);
    expect(mid.x).toBeCloseTo(0.5, 6);
    expect(mid.y).toBeCloseTo(0, 6);
    expect(mid.z).toBeCloseTo(0, 6);
  });
});

describe('blochToStatevector', () => {
  const roundtrips = (v: BlochVector, q: number) => {
    const sv = blochToStatevector(v, q);
    const got = blochVector(sv, q);
    expect(got.x).toBeCloseTo(v.x, 9);
    expect(got.y).toBeCloseTo(v.y, 9);
    expect(got.z).toBeCloseTo(v.z, 9);
  };

  it('reconstructs pure axis states on any qubit', () => {
    roundtrips({ x: 0, y: 0, z: 1 }, 0); // |0⟩
    roundtrips({ x: 0, y: 0, z: -1 }, 2); // |1⟩
    roundtrips({ x: 1, y: 0, z: 0 }, 1); // |+⟩
    roundtrips({ x: 0, y: 1, z: 0 }, 4); // |i+⟩
  });

  it('reconstructs sub-unit (entangled/mixed) vectors via the purifying ancilla', () => {
    roundtrips({ x: 0.3, y: -0.4, z: 0.5 }, 0);
    roundtrips({ x: 0, y: 0, z: 0.5 }, 3);
    roundtrips({ x: 0, y: 0, z: 0 }, 2); // maximally mixed → zero vector
  });
});
