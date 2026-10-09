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
 * LANGUAGES: choosing the template (`classifyGoal`) is language-free; only the
 * wording (`renderGoal`) reads the messages (`t.goal`, default English). Every
 * language therefore says the same thing about the same state, and the rule
 * above binds each translation of each template.
 *
 * Conventions are the bra-ket line's (`KetDisplay`): outcome labels are
 * MSB-first bitstrings of the basis index, and phases are relative to the first
 * populated basis state in index order (`basisVisuals`), so a global phase can
 * never turn into a "twist".
 */
import { basisVisuals } from '@quantum/qsphere';
import { holeTargetState, type Hole } from '@quantum/golf';
import type { StateVector } from '@quantum/statevector';
import { en, type Messages } from '@shared/i18n/en';

/** Below this probability a basis state is not an outcome of the target. */
const SUPPORT_EPS = 1e-9;
/** Probabilities this close count as equal (targets are exact to ~1e-15). */
const EQUAL_EPS = 1e-6;
/** Phase tolerance in degrees for "no twist" and for naming a twist's angle. */
const PHASE_TOL_DEG = 0.5;

/** The honest fallback — always true, never specific. */
export const GOAL_FALLBACK = en.goal.fallback;

/** One populated outcome: its basis index, probability and relative phase. */
interface Outcome {
  readonly index: number;
  readonly prob: number;
  /** Phase relative to the first populated outcome, in [0, 360). */
  readonly phaseDeg: number;
}

/** A twist named by its angle (two-term case), or `any` for an unnamed one. */
export type GoalTwist = keyof Messages['goal']['twist'];

/**
 * What the goal line SAYS, before it is put into words: one template and its
 * values. Every language renders the same `Goal`, so a translation can never
 * claim something the English line does not.
 */
export type Goal =
  | { readonly kind: 'fallback' }
  | { readonly kind: 'certainOne' }
  | { readonly kind: 'certainZero' }
  | { readonly kind: 'certain'; readonly balls: number; readonly bits: string }
  | { readonly kind: 'fairCoin'; readonly twist: GoalTwist | null }
  | { readonly kind: 'agree'; readonly balls: number; readonly twist: GoalTwist | null }
  | { readonly kind: 'disagree'; readonly twist: GoalTwist | null }
  | {
      readonly kind: 'complement';
      readonly balls: number;
      readonly a: string;
      readonly b: string;
      readonly twist: GoalTwist | null;
    }
  | {
      readonly kind: 'oneCoin';
      readonly a: string;
      readonly b: string;
      readonly twist: GoalTwist | null;
    }
  | {
      readonly kind: 'someEntangled';
      readonly entangled: number;
      readonly balls: number;
      readonly a: string;
      readonly b: string;
      readonly twist: GoalTwist | null;
    }
  | { readonly kind: 'allCoins'; readonly balls: number }
  | {
      readonly kind: 'equallyLikely';
      readonly outcomes: number;
      readonly twist: GoalTwist | null;
    };

/** Signed distance of a [0, 360) phase from 0, in degrees, folded to [0, 180]. */
function phaseOffset(phaseDeg: number): number {
  const d = ((phaseDeg % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

const near = (a: number, b: number) => Math.abs(a - b) <= PHASE_TOL_DEG;

/** The twist's name by its angle, for the two-term case. */
function twistName(phaseDeg: number): GoalTwist {
  const off = phaseOffset(phaseDeg);
  if (near(off, 180)) return 'half';
  if (near(off, 90)) return 'quarter';
  if (near(off, 45)) return 'eighth';
  if (near(off, 135)) return 'threeEighths';
  return 'any';
}

function popcount(x: number): number {
  let c = 0;
  for (let v = x; v; v &= v - 1) c++;
  return c;
}

/**
 * Which template a target over `qubits` qubits gets (its canonical placement on
 * wires 0..qubits−1, as `holeTargetState` returns it). Total: every input is
 * classified — `fallback` when no template applies.
 */
export function classifyGoal(target: StateVector, qubits: number): Goal {
  const k = Math.max(1, Math.min(qubits, Math.log2(target.length) | 0));
  const count = 1 << k;
  const label = (i: number) => i.toString(2).padStart(k, '0');

  const outcomes: Outcome[] = basisVisuals(target, count)
    .filter((v) => v.prob > SUPPORT_EPS)
    .map((v) => ({ index: v.index, prob: v.prob, phaseDeg: v.phaseDeg }));
  if (outcomes.length === 0) return { kind: 'fallback' };

  // A single outcome: no superposition, so no phase to speak of either.
  if (outcomes.length === 1) {
    const bits = label(outcomes[0].index);
    if (k === 1) return { kind: bits === '1' ? 'certainOne' : 'certainZero' };
    return { kind: 'certain', balls: k, bits };
  }

  // Every template below is about EQUALLY likely outcomes; unequal weights
  // (the Cascade, a CH split) get the honest fallback.
  const p0 = outcomes[0].prob;
  if (!outcomes.every((o) => Math.abs(o.prob - p0) <= EQUAL_EPS)) return { kind: 'fallback' };
  const twisted = outcomes.some((o) => !near(phaseOffset(o.phaseDeg), 0));

  if (outcomes.length === 2) {
    const [a, b] = outcomes;
    const twist = twisted ? twistName(b.phaseDeg) : null;
    if (k === 1) return { kind: 'fairCoin', twist };

    const differ = a.index ^ b.index;
    const differing = popcount(differ);
    const all = count - 1;
    if (differ === all) {
      // The GHZ family: every ball is entangled with every other one.
      if (a.index === 0) return { kind: 'agree', balls: k, twist };
      if (k === 2) return { kind: 'disagree', twist };
      return { kind: 'complement', balls: k, a: label(a.index), b: label(b.index), twist };
    }
    if (differing === 1) {
      return { kind: 'oneCoin', a: label(a.index), b: label(b.index), twist };
    }
    return {
      kind: 'someEntangled',
      entangled: differing,
      balls: k,
      a: label(a.index),
      b: label(b.index),
      twist,
    };
  }

  // Every outcome equally likely with no twist is exactly |+⟩ on every wire.
  if (outcomes.length === count && !twisted) return { kind: 'allCoins', balls: k };
  return { kind: 'equallyLikely', outcomes: outcomes.length, twist: twisted ? 'any' : null };
}

/** A classified goal in words; `t` picks the language (default English). */
export function renderGoal(goal: Goal, t: Messages = en): string {
  const g = t.goal;
  const say = (body: string, twist: GoalTwist | null) =>
    g.sentence(body, twist === null ? null : g.twist[twist]);
  switch (goal.kind) {
    case 'fallback':
      return g.fallback;
    case 'certainOne':
      return say(g.certainOne, null);
    case 'certainZero':
      return say(g.certainZero, null);
    case 'certain':
      return say(g.certain(goal.balls, goal.bits), null);
    case 'fairCoin':
      return say(g.fairCoin, goal.twist);
    case 'agree':
      return say(g.agree(goal.balls), goal.twist);
    case 'disagree':
      return say(g.disagree, goal.twist);
    case 'complement':
      return say(g.complement(goal.balls, goal.a, goal.b), goal.twist);
    case 'oneCoin':
      return say(g.oneCoin(goal.a, goal.b), goal.twist);
    case 'someEntangled':
      return say(g.someEntangled(goal.entangled, goal.balls, goal.a, goal.b), goal.twist);
    case 'allCoins':
      return say(g.allCoins(goal.balls), null);
    case 'equallyLikely':
      return say(g.equallyLikely(goal.outcomes), goal.twist);
  }
}

/**
 * The plain-language goal for a target over `qubits` qubits. Total: every input
 * yields a non-empty sentence, the fallback when no template applies.
 */
export function goalSentence(target: StateVector, qubits: number, t: Messages = en): string {
  return renderGoal(classifyGoal(target, qubits), t);
}

/** The goal line for a golf hole — `goalSentence` of its canonical target. */
export function holeGoal(hole: Hole, t: Messages = en): string {
  return goalSentence(holeTargetState(hole), hole.qubits, t);
}
