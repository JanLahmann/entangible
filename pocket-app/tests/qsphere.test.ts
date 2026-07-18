import { describe, it, expect } from 'vitest';
import { zeroState, DIM, type StateVector, type Complex } from '@quantum/statevector';
import { qsphereLayout, ringRadii } from '../src/app/QSphere2D';

const SIZE = 180;

describe('ringRadii', () => {
  it('is five evenly spaced rings (weight 1..5) up to size/2 - margin', () => {
    expect(ringRadii(SIZE)).toEqual([16, 32, 48, 64, 80]);
  });
});

describe('qsphereLayout', () => {
  it('places all 32 basis nodes with the |0…0⟩ node at the centre', () => {
    const nodes = qsphereLayout(zeroState(), { size: SIZE });
    expect(nodes).toHaveLength(DIM);

    const center = nodes[0];
    expect(center.index).toBe(0);
    expect(center.weight).toBe(0);
    expect(center.x).toBeCloseTo(90);
    expect(center.y).toBeCloseTo(90);
  });

  it('groups nodes into Hamming-weight rings (1,5,10,10,5,1)', () => {
    const nodes = qsphereLayout(zeroState(), { size: SIZE });
    const counts = [0, 0, 0, 0, 0, 0];
    for (const n of nodes) counts[n.weight]++;
    expect(counts).toEqual([1, 5, 10, 10, 5, 1]);
  });

  it('first node of each ring points up (deterministic angle)', () => {
    const nodes = qsphereLayout(zeroState(), { size: SIZE });
    // First weight-1 node is basis index 1 at radius 16, angle -90° → straight up.
    const first1 = nodes.find((n) => n.weight === 1);
    expect(first1?.index).toBe(1);
    expect(first1?.x).toBeCloseTo(90);
    expect(first1?.y).toBeCloseTo(74); // 90 - 16
  });

  it('node radius scales with |amplitude| (min dot for zero)', () => {
    const nodes = qsphereLayout(zeroState(), { size: SIZE, minDot: 1.5, maxDot: 9 });
    expect(nodes[0].amp).toBeCloseTo(1); // |0…0⟩ has amplitude 1
    expect(nodes[0].dot).toBeCloseTo(9); // full dot
    const zeroAmp = nodes[1];
    expect(zeroAmp.amp).toBeCloseTo(0);
    expect(zeroAmp.dot).toBeCloseTo(1.5); // minimum dot
  });

  it('fill phase is derived from the amplitude argument', () => {
    const sv: StateVector = new Array<Complex>(DIM);
    for (let i = 0; i < DIM; i++) sv[i] = { re: 0, im: 0 };
    sv[0] = { re: 0, im: 1 }; // +90° phase
    sv[1] = { re: -1, im: 0 }; // 180° phase
    const nodes = qsphereLayout(sv, { size: SIZE });
    expect(nodes[0].phaseDeg).toBeCloseTo(90);
    expect(nodes.find((n) => n.index === 1)?.phaseDeg).toBeCloseTo(180);
  });

  it('outlines target nodes', () => {
    const nodes = qsphereLayout(zeroState(), { size: SIZE, targets: new Set([0, 3]) });
    expect(nodes.find((n) => n.index === 0)?.isTarget).toBe(true);
    expect(nodes.find((n) => n.index === 3)?.isTarget).toBe(true);
    expect(nodes.find((n) => n.index === 1)?.isTarget).toBe(false);
  });

  it('is deterministic', () => {
    expect(qsphereLayout(zeroState(), { size: SIZE })).toEqual(
      qsphereLayout(zeroState(), { size: SIZE }),
    );
  });
});
