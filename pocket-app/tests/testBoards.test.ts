import { describe, it, expect } from 'vitest';
import { TEST_BOARDS } from '../src/app/testBoards';

describe('TEST_BOARDS', () => {
  it('lists the nine example boards in order', () => {
    expect(TEST_BOARDS).toHaveLength(9);
    expect(TEST_BOARDS.map((b) => b.id)).toEqual([
      '01-empty',
      '02-single-h',
      '03-bell',
      '04-ghz3',
      '05-ghz5',
      '06-all-families',
      '07-uniform-32',
      '08-lone-control',
      '09-dials',
    ]);
  });

  it('has the expected titles', () => {
    expect(TEST_BOARDS.map((b) => b.title)).toEqual([
      'Empty board',
      'H on q0',
      'Bell pair',
      'GHZ-3',
      'GHZ-5',
      'Every gate family',
      'H on all five qubits',
      'Lone control',
      'Dial tiles',
    ]);
  });

  it('carries a resolved asset url and a non-empty blurb for each board', () => {
    for (const b of TEST_BOARDS) {
      expect(typeof b.src).toBe('string');
      expect(b.src.length).toBeGreaterThan(0);
      expect(b.blurb.trim().length).toBeGreaterThan(0);
    }
  });
});
