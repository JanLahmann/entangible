import { describe, it, expect } from 'vitest';
import dictionary from '../src/vision/dictionary.json';
import {
  DETECTABLE_IDS,
  MARKER_TABLE,
  MEASURE_BLOCK_ID,
  QUBIT_WIRE_ID,
} from '../src/vision/markers';

describe('marker dictionary (generated, parity-gated by pytest)', () => {
  const markers = dictionary.markers as Record<
    string,
    { bits: number[][]; rotations: number[] }
  >;

  it('covers the 30 decodable marker ids (28 gate/corner + wire + measure block)', () => {
    expect(Object.keys(markers).length).toBe(30);
    expect(new Set(Object.keys(markers).map(Number))).toEqual(new Set(DETECTABLE_IDS));
    // Both furniture blocks decode, neither is a gate.
    for (const id of [QUBIT_WIRE_ID, MEASURE_BLOCK_ID]) {
      expect(markers[String(id)]).toBeDefined();
      expect(MARKER_TABLE.has(id)).toBe(false);
    }
  });

  it('gives every marker a 4×4 bit matrix and four rotation codes', () => {
    for (const entry of Object.values(markers)) {
      expect(entry.bits.length).toBe(4);
      for (const row of entry.bits) expect(row.length).toBe(4);
      expect(entry.rotations.length).toBe(4);
    }
  });

  it('has all rotation codes distinct across different ids (Hamming-safe)', () => {
    const owner = new Map<number, string>();
    for (const [id, entry] of Object.entries(markers)) {
      for (const code of entry.rotations) {
        const prior = owner.get(code);
        expect(prior === undefined || prior === id).toBe(true);
        owner.set(code, id);
      }
    }
  });
});
