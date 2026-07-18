import { describe, it, expect } from 'vitest';
import dictionary from '../src/vision/dictionary.json';

describe('marker dictionary (generated, parity-gated by pytest)', () => {
  const markers = dictionary.markers as Record<
    string,
    { bits: number[][]; rotations: number[] }
  >;

  it('covers the 27 live marker ids', () => {
    expect(Object.keys(markers).length).toBe(27);
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
