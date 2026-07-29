/**
 * Marker-table mirror: the TS twin of `packages/qamposer-vision/tests/test_markers.py`.
 *
 * `markers.ts` is a hand-port of `qamposer_vision/markers.py`, so both sides are
 * pinned against the SAME explicit specification here — the dial angle set, the
 * octant/quadrant rotation decoders and the pretty-angle labels. A change on
 * one side that is not mirrored on the other fails in one suite or the other.
 */
import { describe, it, expect } from 'vitest';
import {
  DIAL_ANGLES,
  DIAL_IDS,
  MARKER_TABLE,
  ROTATION_ANGLES,
  octantRotation,
  prettyAngle,
  quadrantRotation,
} from '../src/vision/markers';

const PI = Math.PI;

describe('DIAL_ANGLES', () => {
  it('is the eight 45° positions, the angle being the physical turn', () => {
    // Same explicit list the Python suite pins, wrapped to (−π, π].
    expect([...DIAL_ANGLES]).toEqual([
      0,
      PI / 4,
      PI / 2,
      (3 * PI) / 4,
      PI,
      (-3 * PI) / 4,
      -PI / 2,
      -PI / 4,
    ]);
    for (const a of DIAL_ANGLES) {
      expect(a).toBeGreaterThan(-PI - 1e-12);
      expect(a).toBeLessThanOrEqual(PI);
    }
  });

  it('starts at the identity, which a dial still emits', () => {
    expect(DIAL_ANGLES[0]).toBe(0);
  });

  it('keeps every classic printed angle reachable by turning a dial', () => {
    for (const angle of ROTATION_ANGLES) {
      expect(DIAL_ANGLES.some((a) => Math.abs(a - angle) < 1e-12)).toBe(true);
    }
    // …and is a different set from the fixed-angle print set.
    expect([...DIAL_ANGLES]).not.toEqual([...ROTATION_ANGLES]);
  });

  it('has one label per position, none falling back to a decimal', () => {
    expect(DIAL_ANGLES.map(prettyAngle)).toEqual([
      '0',
      'π/4',
      'π/2',
      '3π/4',
      'π',
      '-3π/4',
      '-π/2',
      '-π/4',
    ]);
  });
});

describe('octantRotation', () => {
  // printed top-left corner offset (dx right, dy down) → clockwise 45° index.
  const DIRECTIONS: Array<[number, number, number]> = [
    [-1, -1, 0], // TL of centre (canonical)
    [0, -1, 1], // straight up   (45° CW)
    [+1, -1, 2], // TR           (90°)
    [+1, 0, 3], // right         (135°)
    [+1, +1, 4], // BR           (180°)
    [0, +1, 5], // down          (225°)
    [-1, +1, 6], // BL           (270°)
    [-1, 0, 7], // left          (315°)
  ];

  it('maps every one of the eight corner offsets to its step', () => {
    for (const [dx, dy, r] of DIRECTIONS) {
      expect(octantRotation(dx, dy)).toBe(r);
    }
  });

  it('agrees with quadrantRotation on the four quarter turns', () => {
    const quadrants: Array<[number, number]> = [
      [-1, -1],
      [+1, -1],
      [+1, +1],
      [-1, +1],
    ];
    quadrants.forEach(([dx, dy], quadrant) => {
      expect(quadrantRotation(dx, dy)).toBe(quadrant);
      expect(octantRotation(dx, dy)).toBe(2 * quadrant);
      expect(Math.floor(octantRotation(dx, dy) / 2)).toBe(quadrantRotation(dx, dy));
    });
  });
});

describe('dial tiles', () => {
  it('carries one dial per rotation axis, with no fixed parameter', () => {
    expect(DIAL_IDS).toEqual({ 42: 'RX', 43: 'RY', 44: 'RZ' });
    for (const [idStr, axis] of Object.entries(DIAL_IDS)) {
      const spec = MARKER_TABLE.get(Number(idStr))!;
      expect(spec.kind).toBe('gate');
      expect(spec.gate).toBe(axis);
      expect(spec.dialAxis).toBe(axis);
      expect(spec.parameter).toBeUndefined();
      expect(spec.emitAs).toBeUndefined();
      expect(spec.label).toBe(`${axis} dial`);
    }
    const withDial = [...MARKER_TABLE.entries()]
      .filter(([, s]) => s.dialAxis !== undefined)
      .map(([id]) => id)
      .sort((a, b) => a - b);
    expect(withDial).toEqual([42, 43, 44]);
  });
});
