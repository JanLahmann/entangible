import { describe, it, expect } from 'vitest';
import {
  layout,
  project,
  projectPoint,
  viewMatrix,
  ringLatitudes,
  clampPitch,
  faceOrientation,
  MAX_PITCH,
  basisVisuals,
} from './qsphere';

const R = Math.SQRT1_2;

describe('layout', () => {
  it('places 2^n nodes with poles on the z axis', () => {
    const nodes = layout(5);
    expect(nodes).toHaveLength(32);

    const north = nodes.find((n) => n.index === 0)!;
    expect(north.weight).toBe(0);
    expect(north.pos).toEqual({ x: 0, y: 0, z: 1 }); // |0…0⟩ north pole

    const south = nodes.find((n) => n.index === 31)!;
    expect(south.weight).toBe(5);
    expect(south.pos.x).toBeCloseTo(0);
    expect(south.pos.y).toBeCloseTo(0);
    expect(south.pos.z).toBeCloseTo(-1); // |1…1⟩ south pole
  });

  it('groups nodes into Hamming-weight rings (1,5,10,10,5,1)', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    for (const n of layout(5)) counts[n.weight]++;
    expect(counts).toEqual([1, 5, 10, 10, 5, 1]);
  });

  it('rings sit at latitude z = 1 - 2w/n', () => {
    const byWeight = new Map<number, number>();
    for (const n of layout(5)) byWeight.set(n.weight, n.pos.z);
    expect(byWeight.get(0)).toBeCloseTo(1);
    expect(byWeight.get(1)).toBeCloseTo(0.6);
    expect(byWeight.get(2)).toBeCloseTo(0.2);
    expect(byWeight.get(3)).toBeCloseTo(-0.2);
    expect(byWeight.get(4)).toBeCloseTo(-0.6);
    expect(byWeight.get(5)).toBeCloseTo(-1);
  });

  it('spreads a ring evenly in longitude, first node at phi=0', () => {
    const nodes = layout(2); // ring w=1 has two nodes: index 1 (phi 0), index 2 (phi pi)
    const a = nodes.find((n) => n.index === 1)!;
    const b = nodes.find((n) => n.index === 2)!;
    expect(a.pos.x).toBeCloseTo(1); // r=1 at z=0, phi=0 → +x
    expect(a.pos.y).toBeCloseTo(0);
    expect(b.pos.x).toBeCloseTo(-1); // phi=pi → -x
    expect(b.pos.y).toBeCloseTo(0);
  });

  it('has one guide latitude per interior ring', () => {
    expect(ringLatitudes(5)).toHaveLength(4); // w = 1..4
    expect(ringLatitudes(2)).toHaveLength(1); // w = 1
  });
});

describe('project (yaw=0, pitch=0)', () => {
  it('fixes the poles vertically with zero depth', () => {
    const north = projectPoint({ x: 0, y: 0, z: 1 }, 0, 0);
    expect(north.x).toBeCloseTo(0);
    expect(north.y).toBeCloseTo(-1); // SVG y-down: north pole at the top
    expect(north.depth).toBeCloseTo(0);

    const south = projectPoint({ x: 0, y: 0, z: -1 }, 0, 0);
    expect(south.y).toBeCloseTo(1); // bottom
    expect(south.depth).toBeCloseTo(0);
  });

  it('signs depth: +y toward the viewer (near), -y away (far)', () => {
    expect(projectPoint({ x: 0, y: 1, z: 0 }, 0, 0).depth).toBeCloseTo(1); // near
    expect(projectPoint({ x: 0, y: -1, z: 0 }, 0, 0).depth).toBeCloseTo(-1); // far
  });

  it('is identity at rest', () => {
    const m = viewMatrix(0, 0);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(m[i]).toBeCloseTo(v));
  });
});

describe('project (yaw spin)', () => {
  it('yaw spins the +x node to the front (poles unmoved)', () => {
    const [rightNode] = project([{ index: 1, weight: 1, pos: { x: 1, y: 0, z: 0 } }], Math.PI / 2, 0);
    expect(rightNode.x).toBeCloseTo(0);
    expect(rightNode.depth).toBeCloseTo(1); // now nearest the viewer

    // The pole is unaffected by yaw.
    const [pole] = project([{ index: 0, weight: 0, pos: { x: 0, y: 0, z: 1 } }], Math.PI / 2, 0);
    expect(pole.y).toBeCloseTo(-1);
    expect(pole.depth).toBeCloseTo(0);
  });
});

describe('clampPitch', () => {
  it('clamps to ±80°', () => {
    expect(clampPitch(Math.PI)).toBeCloseTo(MAX_PITCH);
    expect(clampPitch(-Math.PI)).toBeCloseTo(-MAX_PITCH);
    expect(clampPitch(0.2)).toBeCloseTo(0.2);
  });
});

describe('basisVisuals (probability radius + reference phase)', () => {
  it('radius driver is probability p = |amp|², flagging p≈0 as faint', () => {
    // Bell pair on qubits {0,1}: indices 0 and 3 at 1/√2 → p = 0.5 each.
    const amps = [{ re: R, im: 0 }, { re: 0, im: 0 }, { re: 0, im: 0 }, { re: R, im: 0 }];
    const v = basisVisuals(amps);
    expect(v[0].prob).toBeCloseTo(0.5);
    expect(v[3].prob).toBeCloseTo(0.5);
    expect(v[0].faint).toBe(false);
    expect(v[1].prob).toBeCloseTo(0);
    expect(v[1].faint).toBe(true);
  });

  it('phase is relative to the reference (doc example: three 0-phase + one π)', () => {
    // (|00⟩+|01⟩+|10⟩−|11⟩)/2 → phases (0, 0, 0, π).
    const amps = [
      { re: 0.5, im: 0 },
      { re: 0.5, im: 0 },
      { re: 0.5, im: 0 },
      { re: -0.5, im: 0 },
    ];
    const v = basisVisuals(amps);
    expect(v[0].phaseDeg).toBeCloseTo(0);
    expect(v[1].phaseDeg).toBeCloseTo(0);
    expect(v[2].phaseDeg).toBeCloseTo(0);
    expect(v[3].phaseDeg).toBeCloseTo(180);
  });

  it('reference = first populated basis state when the ground state is empty', () => {
    // index 1 = i (arg 90°) is the reference; index 3 = 1 (arg 0°) → 0-90 = -90 → 270°.
    const amps = [
      { re: 0, im: 0 },
      { re: 0, im: R },
      { re: 0, im: 0 },
      { re: R, im: 0 },
    ];
    const v = basisVisuals(amps);
    expect(v[1].phaseDeg).toBeCloseTo(0); // reference itself
    expect(v[3].phaseDeg).toBeCloseTo(270);
  });

  it('global phase cancels against the reference (ground state stays 0)', () => {
    // |+⟩-like with a global i: both amplitudes rotated by 90°, relative phase 0.
    const amps = [{ re: 0, im: R }, { re: 0, im: R }];
    const v = basisVisuals(amps);
    expect(v[0].phaseDeg).toBeCloseTo(0);
    expect(v[1].phaseDeg).toBeCloseTo(0);
  });
});

describe('faceOrientation (#58)', () => {
  const dirs = [
    { x: 0.6, y: 0.8, z: 0 },
    { x: -0.3, y: 0.4, z: 0.866 },
    { x: 0.5, y: -0.5, z: -0.707 },
  ];

  it('brings a direction to screen centre facing the viewer', () => {
    for (const d of dirs) {
      const { yaw, pitch } = faceOrientation(d);
      const pr = projectPoint(d, yaw, pitch);
      expect(pr.x).toBeCloseTo(0, 6);
      expect(pr.y).toBeCloseTo(0, 6);
      expect(pr.depth).toBeGreaterThan(0.99);
    }
  });

  it('only uses the direction, not the magnitude', () => {
    const a = faceOrientation({ x: 0.6, y: 0.8, z: 0 });
    const b = faceOrientation({ x: 6, y: 8, z: 0 });
    expect(b.yaw).toBeCloseTo(a.yaw);
    expect(b.pitch).toBeCloseTo(a.pitch);
  });

  it('clamps a pole direction to the interactive pitch range', () => {
    expect(faceOrientation({ x: 0, y: 0, z: 1 }).pitch).toBeCloseTo(-MAX_PITCH);
    expect(faceOrientation({ x: 0, y: 0, z: -1 }).pitch).toBeCloseTo(MAX_PITCH);
  });
});
