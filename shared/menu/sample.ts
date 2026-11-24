/**
 * Serving math for menu packs — draw outcomes from a live probability vector
 * and derive per-row marginals. Pure and RNG-injectable: tests pin a seeded
 * `mulberry32`, the UI uses `cryptoRng()`.
 *
 * The input is always `Outcome[]` from `@shared/display/outcomes` — that module
 * is the single source of the bits/index convention (Qiskit order: leftmost
 * char = highest wire, rightmost = q0, the top wire). This module does NOT
 * re-derive bit order; it consumes the outcome list the histogram already
 * renders, so a served item and the peaked histogram column are guaranteed to
 * agree. With a noise preset active the caller passes
 * the NOISY outcome vector, so "real hardware might make you an espresso
 * instead" falls out for free.
 */
import { bitOf, type Outcome } from '@shared/display/outcomes';

/** A uniform pseudo-random source over [0, 1). */
export type Rng = () => number;

/**
 * The standard mulberry32 PRNG — a tiny, fast 32-bit generator. Deterministic:
 * the same `seed` always yields the same sequence, which is what makes the
 * distribution and serve tests reproducible.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A crypto-backed RNG for the UI (unpredictable serves). Draws a fresh 32-bit
 * word from `crypto.getRandomValues` per call and scales it into [0, 1).
 */
export function cryptoRng(): Rng {
  return () => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 4294967296;
  };
}

/**
 * Draw one outcome's bitstring from `outcomes` by walking the cumulative
 * distribution, normalized by the ACTUAL probability sum (so float drift or a
 * slightly sub-unit noisy vector still samples correctly). The final outcome
 * absorbs any remaining mass. If the total probability is ≤ 0 (a degenerate or
 * empty vector) we fall back to a uniform draw over all outcomes.
 */
export function sampleOutcome(outcomes: readonly Outcome[], rng: Rng): string {
  const n = outcomes.length;
  if (n === 0) return '';

  let total = 0;
  for (const o of outcomes) total += o.prob;

  if (!(total > 0)) {
    const idx = Math.min(n - 1, Math.floor(rng() * n));
    return outcomes[idx].bits;
  }

  const r = rng() * total;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += outcomes[i].prob;
    if (r < acc) return outcomes[i].bits;
  }
  // Remaining mass (float residue) lands on the last outcome.
  return outcomes[n - 1].bits;
}

/** `k` independent draws from `outcomes` (duplicates welcome — k scoops). */
export function sampleShots(outcomes: readonly Outcome[], k: number, rng: Rng): string[] {
  const out: string[] = [];
  for (let i = 0; i < k; i++) out.push(sampleOutcome(outcomes, rng));
  return out;
}

/**
 * Per-row marginals: index `r` is `P(qubit r = 1)`, read from each outcome's
 * `bits` via `bitOf`. This is the number `subset` mode shows next to each item
 * (its qubit's marginal). A Bell state's two rows each read 0.5.
 */
export function marginals(outcomes: readonly Outcome[]): number[] {
  if (outcomes.length === 0) return [];
  const D = outcomes[0].bits.length;
  const out = new Array<number>(D).fill(0);
  for (const o of outcomes) {
    for (let r = 0; r < D; r++) {
      if (bitOf(o.bits, r) === '1') out[r] += o.prob;
    }
  }
  return out;
}
