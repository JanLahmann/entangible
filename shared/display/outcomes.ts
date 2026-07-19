/**
 * RESULTS-panel outcome math shared by the kiosk booth skin and the pocket surfaces
 * (`pocket-app`) histograms.
 *
 * The outcome space is the DISPLAYED qubit count `D` (rows 0..D-1), following
 * each app's wire-trim setting, NOT the active subset. The recognized circuit
 * is always five physical qubits; the wire-trim transform guarantees no gate
 * touches a row >= D, so marginalizing the remaining |0⟩ rows is exact. Bit
 * order: leftmost stack bit = q0 (top wire).
 *
 * This module owns ONLY the pure math + thresholds — the single source of truth
 * for both panels and their parity tests. The two `*Histogram` components keep
 * their own JSX/class prefixes (`bo-` / `pk-`) until SC2 unifies them.
 */
import { statevector } from '@quantum/statevector';
import type { Circuit } from '@qamposer/react';

/** Top-N nonzero outcomes shown before the tail is collapsed. */
export const TOP_N = 6;
/** Probabilities at or below this count as "zero" (dim stub / hidden). */
export const ZERO_EPS = 0.001;
/** Per-outcome tolerance for detecting a uniform superposition. */
export const UNIFORM_EPS = 0.004;
/** Above this many nonzero outcomes the plain full-axis layout is abandoned. */
export const MAX_PLAIN = 8;

export interface Outcome {
  bits: string; // one char per displayed row, top(=q0) first
  prob: number;
}

/**
 * Probabilities over the `displayQubits` displayed rows (0..D-1), in basis
 * order 000..111. Pure — the single source of truth for the panel and its
 * parity test. Leftmost bit of `bits` is q0 (the top wire).
 */
export function displayOutcomes(circuit: Circuit, displayQubits: number): Outcome[] {
  const D = displayQubits;
  const sv = statevector(circuit);
  const probs = new Array<number>(1 << D).fill(0);
  for (let i = 0; i < sv.length; i++) {
    const p = sv[i].re * sv[i].re + sv[i].im * sv[i].im;
    if (p === 0) continue;
    let idx = 0;
    // r = 0 (q0) contributes the most-significant bit → top wire on the left.
    for (let r = 0; r < D; r++) idx = (idx << 1) | ((i >> r) & 1);
    probs[idx] += p;
  }
  return probs.map((prob, idx) => ({ bits: idx.toString(2).padStart(D, '0'), prob }));
}
