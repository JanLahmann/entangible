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
/**
 * Paired (ideal + noisy) mode floor for a NOISY-ONLY outcome to earn a bar. Set
 * well below `ZERO_EPS` on purpose: noisy leakage (a GHZ near-miss, a readout
 * flip) is the pedagogic payload, so a ~0.3% error peak must survive the union
 * even though the ideal peak there is zero. The `PAIRED_TOP_N` cap keeps this
 * from exploding into 32 slivers when a preset smears probability everywhere.
 */
export const NOISY_EPS = 0.003;
/** Top-N outcomes shown in paired mode (a touch wider than TOP_N to leave room
 * for eroded peaks AND a few visible error outcomes side by side). */
export const PAIRED_TOP_N = 8;

export interface Outcome {
  /** One char per displayed row, Qiskit order: leftmost = q(D−1), rightmost = q0. */
  bits: string;
  prob: number;
}

/**
 * Probabilities over the `displayQubits` displayed rows (0..D-1), in basis
 * order 000..111 (index i ↔ `bits` = i in binary, so the rightmost bit is q0,
 * the top wire). Pure — the single source of truth for the panel and its parity
 * test.
 */
export function displayOutcomes(circuit: Circuit, displayQubits: number): Outcome[] {
  const sv = statevector(circuit);
  const probs = sv.map((a) => a.re * a.re + a.im * a.im);
  return outcomesFromProbabilities(probs, displayQubits);
}

/**
 * Marginalize a raw physical probability vector (length 2^physicalQubits, in the
 * SAME little-endian basis-state ordering statevector.ts uses — index i has
 * qubit q set when (i >> q) & 1) onto the `displayQubits` displayed rows,
 * returning the 2^D outcomes in basis order. Shares the exact bit-mapping of
 * `displayOutcomes` so an ideal series and a noisy series (from
 * `@quantum/noise`'s `noisyProbabilities`) align outcome-for-outcome by index.
 */
export function outcomesFromProbabilities(
  probs: readonly number[],
  displayQubits: number,
): Outcome[] {
  const D = displayQubits;
  const mask = (1 << D) - 1;
  const out = new Array<number>(1 << D).fill(0);
  // Keeping the low D bits marginalizes rows >= D away; the outcome index keeps
  // the statevector's little-endian bits, so its binary spelling is Qiskit order.
  for (let i = 0; i < probs.length; i++) {
    if (probs[i] !== 0) out[i & mask] += probs[i];
  }
  return out.map((prob, idx) => ({ bits: idx.toString(2).padStart(D, '0'), prob }));
}

/** The char of `bits` (Qiskit order, see `Outcome.bits`) that holds qubit `q`. */
export function bitOf(bits: string, q: number): string {
  return bits[bits.length - 1 - q];
}
