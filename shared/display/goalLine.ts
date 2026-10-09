/**
 * The golf hole's GOAL in plain words — one line under the target, so a player
 * who has never read a ket still knows what the hole asks for ("Goal: a fair
 * 50/50 coin."). Pure and deterministic: the sentence is derived from the
 * target statevector alone, never from the hole's name, so the classic course
 * and every generated random hole go through the same reading.
 *
 * Templates, most specific first (the ball metaphor: one ball per qubit):
 *
 *   - ONE basis state            → "make the ball certain to land on 1 — flip it."
 *   - one qubit, two equal terms → "a fair 50/50 coin."
 *   - two equal terms, every qubit differs between them (the GHZ family):
 *       00…0 / 11…1             → "entangle the two balls so they always agree."
 *       01 / 10                 → "… so they always disagree."
 *       any other complement    → "entangle all 3 balls — always 001 or 110, 50/50."
 *   - two equal terms, ONE qubit differs → a coin on one ball, the rest certain.
 *   - two equal terms, some qubits differ → those balls entangled, named outcomes.
 *   - all 2^k outcomes equally likely, no phase → "make both balls fair 50/50 coins."
 *   - m outcomes equally likely  → "m outcomes, all equally likely."
 *
 * Any of the superposition templates gains a PHASE clause when the amplitudes
 * match but their phases do not ("…, plus a half-turn phase twist.") — the
 * relative phase is exactly what the difficult round is about, and leaving it
 * out would make the sentence describe a different state. A two-term twist is
 * named by its angle where it is one of the gate set's (half / quarter / eighth
 * turn); anything else is simply "a phase twist".
 *
 * Anything else — unequal weights, like the Cascade — reads "Goal: match the
 * target state shown." The rule is that the line may be VAGUE but never WRONG:
 * every template above is a statement about measurement outcomes (and phase)
 * that holds exactly for the state it is chosen for.
 *
 * Conventions are the bra-ket line's (`KetDisplay`): outcome labels are
 * MSB-first bitstrings of the basis index, and phases are relative to the first
 * populated basis state in index order (`basisVisuals`), so a global phase can
 * never turn into a "twist".
 */
import { basisVisuals } from '@quantum/qsphere';
import { holeTargetState, type Hole } from '@quantum/golf';
import type { StateVector } from '@quantum/statevector';

/** Below this probability a basis state is not an outcome of the target. */
const SUPPORT_EPS = 1e-9;
/** Probabilities this close count as equal (targets are exact to ~1e-15). */
const EQUAL_EPS = 1e-6;
/** Phase tolerance in degrees for "no twist" and for naming a twist's angle. */
const PHASE_TOL_DEG = 0.5;

/** The honest fallback — always true, never specific. */
export const GOAL_FALLBACK = 'Goal: match the target state shown.';

/** One populated outcome: its basis index, probability and relative phase. */
interface Outcome {
  readonly index: number;
  readonly prob: number;
  /** Phase relative to the first populated outcome, in [0, 360). */
  readonly phaseDeg: number;
}

/** Signed distance of a [0, 360) phase from 0, in degrees, folded to [0, 180]. */
function phaseOffset(phaseDeg: number): number {
  const d = ((phaseDeg % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

const near = (a: number, b: number) => Math.abs(a - b) <= PHASE_TOL_DEG;

/** The twist's name by its angle, for the two-term case. */
function twistName(phaseDeg: number): string {
  const off = phaseOffset(phaseDeg);
  if (near(off, 180)) return 'a half-turn phase twist';
  if (near(off, 90)) return 'a quarter-turn phase twist';
  if (near(off, 45)) return 'an eighth-turn phase twist';
  if (near(off, 135)) return 'a three-eighths-turn phase twist';
  return 'a phase twist';
}

/** "Goal: <body>." or "Goal: <body>, plus <twist>." */
function sentence(body: string, twist: string | null): string {
  return twist === null ? `Goal: ${body}.` : `Goal: ${body}, plus ${twist}.`;
}

function popcount(x: number): number {
  let c = 0;
  for (let v = x; v; v &= v - 1) c++;
  return c;
}

/** "the ball" / "both balls" / "all 3 balls" — how many balls a clause is about. */
function balls(k: number): string {
  if (k === 1) return 'the ball';
  if (k === 2) return 'both balls';
  return `all ${k} balls`;
}

/**
 * The plain-language goal for a target over `qubits` qubits (its canonical
 * placement on wires 0..qubits−1, as `holeTargetState` returns it). Total: every
 * input yields a non-empty sentence, the fallback when no template applies.
 */
export function goalSentence(target: StateVector, qubits: number): string {
  const k = Math.max(1, Math.min(qubits, Math.log2(target.length) | 0));
  const count = 1 << k;
  const label = (i: number) => i.toString(2).padStart(k, '0');

  const outcomes: Outcome[] = basisVisuals(target, count)
    .filter((v) => v.prob > SUPPORT_EPS)
    .map((v) => ({ index: v.index, prob: v.prob, phaseDeg: v.phaseDeg }));
  if (outcomes.length === 0) return GOAL_FALLBACK;

  // A single outcome: no superposition, so no phase to speak of either.
  if (outcomes.length === 1) {
    const bits = label(outcomes[0].index);
    if (k === 1) {
      return bits === '1'
        ? 'Goal: make the ball certain to land on 1 — flip it.'
        : 'Goal: make the ball certain to land on 0.';
    }
    return `Goal: make ${balls(k)} certain to land on ${bits}.`;
  }

  // Every template below is about EQUALLY likely outcomes; unequal weights
  // (the Cascade, a CH split) get the honest fallback.
  const p0 = outcomes[0].prob;
  if (!outcomes.every((o) => Math.abs(o.prob - p0) <= EQUAL_EPS)) return GOAL_FALLBACK;
  const twisted = outcomes.some((o) => !near(phaseOffset(o.phaseDeg), 0));

  if (outcomes.length === 2) {
    const [a, b] = outcomes;
    const twist = twisted ? twistName(b.phaseDeg) : null;
    if (k === 1) return sentence('a fair 50/50 coin', twist);

    const differ = a.index ^ b.index;
    const differing = popcount(differ);
    const all = count - 1;
    if (differ === all) {
      // The GHZ family: every ball is entangled with every other one.
      if (a.index === 0) {
        return k === 2
          ? sentence('entangle the two balls so they always agree', twist)
          : sentence(`entangle all ${k} balls so they always agree`, twist);
      }
      if (k === 2) return sentence('entangle the two balls so they always disagree', twist);
      return sentence(
        `entangle all ${k} balls — always ${label(a.index)} or ${label(b.index)}, 50/50`,
        twist,
      );
    }
    if (differing === 1) {
      return sentence(
        `one ball a fair 50/50 coin, the rest certain — ${label(a.index)} or ${label(b.index)}`,
        twist,
      );
    }
    return sentence(
      `entangle ${differing} of the ${k} balls — always ${label(a.index)} or ${label(b.index)}, 50/50`,
      twist,
    );
  }

  // Every outcome equally likely with no twist is exactly |+⟩ on every wire.
  if (outcomes.length === count && !twisted) {
    return sentence(`make ${balls(k)} fair 50/50 coins`, null);
  }
  return sentence(
    `${outcomes.length} outcomes, all equally likely`,
    twisted ? 'a phase twist' : null,
  );
}

/** The goal line for a golf hole — `goalSentence` of its canonical target. */
export function holeGoal(hole: Hole): string {
  return goalSentence(holeTargetState(hole), hole.qubits);
}
