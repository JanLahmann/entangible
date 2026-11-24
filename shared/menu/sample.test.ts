/**
 * Sampler statistics under a seeded RNG, plus closed-form marginal checks. The
 * seeded `mulberry32` makes the distribution sanity reproducible; marginal
 * fixtures are built via `outcomesFromProbabilities` (the same bit-mapping the
 * histogram uses) so the parity argument holds end to end.
 */
import { describe, it, expect } from 'vitest';
import type { Outcome } from '@shared/display/outcomes';
import { outcomesFromProbabilities } from '@shared/display/outcomes';
import { mulberry32, sampleOutcome, sampleShots, marginals } from './sample';

describe('mulberry32 — deterministic PRNG', () => {
  it('same seed → same sequence', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('all draws land in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('different seeds → different sequences', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });
});

describe('sampleOutcome — distribution sanity', () => {
  it('20000 seeded draws land within ±0.02 of a known 4-outcome distribution', () => {
    const outcomes: Outcome[] = [
      { bits: '00', prob: 0.1 },
      { bits: '01', prob: 0.2 },
      { bits: '10', prob: 0.3 },
      { bits: '11', prob: 0.4 },
    ];
    const rng = mulberry32(42);
    const counts: Record<string, number> = { '00': 0, '01': 0, '10': 0, '11': 0 };
    const draws = 20000;
    for (let i = 0; i < draws; i++) counts[sampleOutcome(outcomes, rng)]++;
    for (const o of outcomes) {
      expect(counts[o.bits] / draws).toBeCloseTo(o.prob, 1); // within ~0.05
      expect(Math.abs(counts[o.bits] / draws - o.prob)).toBeLessThan(0.02);
    }
  });

  it('normalizes by the actual sum (a sub-unit noisy vector still samples right)', () => {
    // Total 0.5, not 1 — proportions must still hold.
    const outcomes: Outcome[] = [
      { bits: '0', prob: 0.4 },
      { bits: '1', prob: 0.1 },
    ];
    const rng = mulberry32(99);
    let ones = 0;
    const draws = 20000;
    for (let i = 0; i < draws; i++) if (sampleOutcome(outcomes, rng) === '1') ones++;
    expect(ones / draws).toBeCloseTo(0.2, 1); // 0.1 / 0.5
  });

  it('zero-total vector falls back to a uniform draw', () => {
    const outcomes: Outcome[] = [
      { bits: '00', prob: 0 },
      { bits: '01', prob: 0 },
      { bits: '10', prob: 0 },
      { bits: '11', prob: 0 },
    ];
    const rng = mulberry32(2024);
    const counts: Record<string, number> = { '00': 0, '01': 0, '10': 0, '11': 0 };
    const draws = 20000;
    for (let i = 0; i < draws; i++) counts[sampleOutcome(outcomes, rng)]++;
    for (const bits of Object.keys(counts)) {
      expect(Math.abs(counts[bits] / draws - 0.25)).toBeLessThan(0.02);
    }
  });
});

describe('sampleShots — k draws', () => {
  const outcomes: Outcome[] = [
    { bits: '00', prob: 0.25 },
    { bits: '01', prob: 0.25 },
    { bits: '10', prob: 0.25 },
    { bits: '11', prob: 0.25 },
  ];

  it('returns exactly k results', () => {
    expect(sampleShots(outcomes, 3, mulberry32(1))).toHaveLength(3);
    expect(sampleShots(outcomes, 0, mulberry32(1))).toHaveLength(0);
  });

  it('is deterministic under a seed', () => {
    expect(sampleShots(outcomes, 5, mulberry32(555))).toEqual(sampleShots(outcomes, 5, mulberry32(555)));
  });
});

describe('marginals — closed-form cases', () => {
  it('Bell over 2 displayed qubits → [0.5, 0.5]', () => {
    // |00⟩+|11⟩: physical probs index 0 and 3 at 0.5 each.
    const outcomes = outcomesFromProbabilities([0.5, 0, 0, 0.5], 2);
    // Sanity: only 00 and 11 carry mass.
    const byBits = Object.fromEntries(outcomes.map((o) => [o.bits, o.prob]));
    expect(byBits['00']).toBeCloseTo(0.5, 10);
    expect(byBits['11']).toBeCloseTo(0.5, 10);
    expect(marginals(outcomes)).toEqual([0.5, 0.5]);
  });

  it('a |001⟩ peak → marginal 1 on q0 only (Qiskit order: q0 rightmost)', () => {
    // q0 set → physical index (1 << 0) = 1.
    const probs = new Array(8).fill(0);
    probs[1] = 1;
    const outcomes = outcomesFromProbabilities(probs, 3);
    expect(Object.fromEntries(outcomes.map((o) => [o.bits, o.prob]))['001']).toBeCloseTo(1, 10);
    expect(marginals(outcomes)).toEqual([1, 0, 0]);
  });

  it('empty outcome list → empty marginals', () => {
    expect(marginals([])).toEqual([]);
  });
});
