/**
 * The RANDOM golf course (task #70) — 18 holes whose targets are *generated*
 * instead of hand-authored.
 *
 * The classic course (`@quantum/golf`) is a fixed curriculum: eighteen known
 * states, each with a par of "minimum strokes + 2" (#69). The random course
 * keeps that SHAPE — the same four rounds, the same level ladder (E1–E5, M1–M5,
 * D1–D5, X1/X3/X5), the same views (a 1-qubit hole plays on the Bloch sphere) —
 * but draws each hole's target from a random circuit built out of the round's
 * own clubs. You are never handed a state you could not reach with the tiles in
 * front of you, because the target IS something those tiles built.
 *
 * ## Par
 * Par is simply the GENERATOR's gate count. No +2 is added: a randomly drawn
 * circuit is essentially never a minimal preparation of its own output (it
 * wastes gates on cancellations, redundant flips and phases that fidelity
 * ignores), so the slack is already baked in. On the classic course the +2 has
 * to be added by hand because those pars are exact minima.
 *
 * ## Generation (pure + seeded)
 * For the slot at (round, level k): draw `k + bonus(round)` gates uniformly from
 * the round's clubs — E +1, M +2, D +2, X +3 — on qubits 0..k−1, with
 * controlled gates offered only from k ≥ 2 (a control needs a second wire) and
 * their control/target drawn distinct. A candidate is rejected, and the draw
 * retried at the next seed offset, unless:
 *
 *   (a) the target is not |0…0⟩ — an empty board would otherwise hole in;
 *   (b) no qubit is DEAD: every wire 0..k−1 carries real |1⟩ population in the
 *       target, i.e. some amplitude with that bit set is non-negligible; and
 *   (c) on the EASY and MEDIUM rounds only, the target is PHASE-FREE — every
 *       populated amplitude is real and non-negative once aligned to the
 *       reference amplitude (the same convention the Q-sphere colours and the
 *       bra-ket line typeset by); and
 *   (d) the target has at most `KET_TERMS` populated basis states, so the ket
 *       line prints it WHOLE — a target that elides is a target you cannot read.
 *
 * (b) is checked on the STATE, not on the circuit, and is strictly stronger than
 * "the generator touched every qubit": an untouched wire is exactly |0⟩, but so
 * is one the draw touched and then undid (X·X, a bare Z, a CNOT off a |0⟩
 * control). Either way the "5-qubit" hole would be a lower-level hole wearing a
 * bigger ket — `(|000⟩+|010⟩)/√2` is a one-H hole with two idle wires. Product
 * targets are deliberately still legal: H⊗H⊗H is a fine thing to ask for,
 * because every wire is doing something. (a) is then implied by (b) but kept
 * explicit — "an empty board must never hole in" is the invariant that matters.
 *
 * (c) keeps the difficulty ladder honest, and mirrors the classic course, where
 * relative phases first appear in DIFFICULT. A phased easy target can demand a
 * genuinely advanced move — Jan drew an E3 that could only be answered by
 * composing a CZ out of H and CX, which is a difficult-round insight sitting in
 * the easy round. So E and M targets must read as plain positive superpositions;
 * D and X stay unconstrained, because phase IS their lesson.
 *
 * (d) is the readability floor: you are asked to BUILD this state, so you have to
 * be able to see all of it. The ket line caps at `KET_TERMS` terms and elides the
 * rest with "+ ⋯", which for a target would hide part of the goal — a five-H
 * spread over all 32 basis states is a perfectly legal draw and a useless hole.
 * The check is bound to the very constant the ket is typeset with, so the two can
 * never drift apart. Only k = 5 can trip it (a k ≤ 4 target has at most 16 basis
 * states to begin with), and it is nearly free: it removes well under 0.1% of the
 * draws that clear (a)–(c).
 *
 * Everything is derived from one 32-bit base seed: the slot at index `i` uses
 * `baseSeed + i * 1000`, and a rejected draw retries at `+1` (capped far below
 * the 1000 stride, so slots can never collide). The seed lives on `GolfState`,
 * which is what makes a session's course stable across re-renders, hole retries
 * and clear-the-board advances.
 *
 * ## Scoring
 * A generated hole carries its own target statevector plus every ORDERED
 * placement of it across the five wires (`orderedPlacements`) — the exact
 * machinery the asymmetric Cascade hole uses. A generated state has no symmetry
 * to exploit, so the ordered list is the right one: the answer scores on any k
 * wires in any order. Fidelity, the hole-in threshold and stroke counting (#68)
 * are entirely unchanged.
 *
 * ## Solution (#71)
 * A generated hole hands its GENERATOR back as `hole.solution`, so the "Show
 * solution" reveal on the scorecard works on the random course exactly as it
 * does on the classic one. There is nothing to derive: the circuit that made the
 * target is by construction an answer to it, and at `size` gates against a par
 * of `size + 1` it beats par.
 *
 * This module depends on `@quantum/golf`, never the reverse: `golfStep` takes
 * the course as an optional parameter and defaults to the fixed `HOLES`, so the
 * engine stays free of the generator.
 */
import type { Circuit, Gate, GateType } from '@qamposer/react';
import { ketTerms } from '@shared/display/KetDisplay';
import { mulberry32, cryptoRng, type Rng } from '@shared/menu/sample';
import { basisVisuals } from './qsphere';
import { statevector, DIM, NUM_QUBITS, type StateVector } from './statevector';
import {
  HOLES,
  ROUND_CLUBS,
  gateTypesForClubs,
  orderedPlacements,
  type GolfRound,
  type GolfState,
  type Hole,
} from './golf';

/** Extra gates over the hole's qubit count — the round's difficulty dial. */
export const ROUND_BONUS: Readonly<Record<GolfRound, number>> = {
  easy: 1,
  medium: 2,
  difficult: 2,
  extra: 3,
};

/** Seed stride between slots; retries stay well inside it (see MAX_ATTEMPTS). */
const SLOT_STRIDE = 1000;
/**
 * Seed offsets tried before the deterministic fallback, sized for the tightest
 * slots. Keeping five wires alive on a 7-gate draw is genuinely demanding, and
 * the phase-free rule tightens the wide EASY/MEDIUM slots further. Measured
 * acceptance over 4000 seeds per slot, with ALL FOUR constraints: D5 1.77%,
 * X5 1.79%, E5 2.82%, M5 3.46% — everything else far looser (M1 82%, E2 31%).
 * The 16-term cap barely moved those numbers (D5 was 1.78% without it), because
 * a draw wide enough to fill 17+ basis states rarely also keeps every wire
 * alive. At 900 attempts even the worst slot falls through to the fallback with
 * probability ~1e-7 per hole, and the budget still fits inside `SLOT_STRIDE`, so
 * slot seed ranges cannot collide.
 */
const MAX_ATTEMPTS = 900;
/** How close |amplitude(|0…0⟩)|² may come to 1 before the target counts as trivial. */
const TRIVIAL_EPS = 1e-9;
/** Below this probability an amplitude is not evidence that a qubit is alive. */
const LIVE_EPS = 1e-9;
/** How far a reference-relative phase may stray from 0° and still read as none. */
const PHASE_TOL_DEG = 1e-6;
/** Rounds whose targets must be phase-free (see constraint (c) in the header). */
const PHASE_FREE_ROUNDS: ReadonlySet<GolfRound> = new Set<GolfRound>(['easy', 'medium']);
/** Terms shown in a generated hole's scorecard ket (the rest elide to "+ ⋯").
 *  Doubles as the cap on a target's populated basis states (constraint (d)), so
 *  a generated ket is always printed in full and never actually elides. */
const KET_TERMS = 16; // full 4-qubit targets fit since ket lines wrap; only 5q elides

/** Gate types that need a control wire (so: only from level 2 up). */
const CONTROLLED: ReadonlySet<string> = new Set([
  'CNOT',
  'CX',
  'CY',
  'CZ',
  'CH',
  'CS',
  'CT',
  'CCX',
]);

/** A uniform integer in [0, n). */
function randInt(rng: Rng, n: number): number {
  return Math.min(n - 1, Math.floor(rng() * n));
}

/** Draw `n` gates over qubits 0..k−1 from `types` (controlled gates need k ≥ 2). */
function drawGates(rng: Rng, types: readonly GateType[], k: number, n: number): Gate[] {
  const pool = k >= 2 ? types : types.filter((t) => !CONTROLLED.has(t));
  const gates: Gate[] = [];
  for (let i = 0; i < n; i++) {
    const type = pool[randInt(rng, pool.length)];
    if (CONTROLLED.has(type)) {
      // Distinct control/target: pick the control, then a target from the k−1
      // remaining wires (shifting past the control keeps the draw uniform).
      const control = randInt(rng, k);
      let target = randInt(rng, k - 1);
      if (target >= control) target += 1;
      gates.push({ id: `rg${i}-${type}`, type, position: i, control, target });
    } else {
      gates.push({ id: `rg${i}-${type}`, type, position: i, qubit: randInt(rng, k) });
    }
  }
  return gates;
}

/** Constraint (a): the target is not the all-|0⟩ state (which an empty board hits). */
function isNonTrivial(target: StateVector): boolean {
  const a = target[0];
  return 1 - (a.re * a.re + a.im * a.im) > TRIVIAL_EPS;
}

/**
 * Constraint (b): no DEAD wire — every qubit 0..k−1 has some non-negligible
 * amplitude with its bit set, so the target genuinely lives on k qubits. A
 * product state passes (H⊗H⊗H is a legitimate k-qubit target); a state that
 * pins a wire to |0⟩ does not, because that hole would be a lower-level hole
 * with idle wires attached.
 */
function everyQubitLives(target: StateVector, k: number): boolean {
  for (let q = 0; q < k; q++) {
    let alive = false;
    for (let i = 0; i < DIM; i++) {
      if (((i >> q) & 1) === 0) continue;
      const a = target[i];
      if (a.re * a.re + a.im * a.im > LIVE_EPS) {
        alive = true;
        break;
      }
    }
    if (!alive) return false;
  }
  return true;
}

/**
 * Constraint (c): the target carries no relative phase — every populated
 * amplitude sits at 0° once aligned to the reference amplitude. Phases are read
 * with `basisVisuals`, the SAME machinery the Q-sphere colours nodes by and the
 * bra-ket line typesets from, so "phase-free" here means exactly "nothing on
 * screen shows a phase". Degrees live in [0, 360), so a hair below zero wraps to
 * just under 360 and both ends must be accepted.
 */
function isPhaseFree(target: StateVector, k: number): boolean {
  for (const v of basisVisuals(target, 1 << k)) {
    if (v.prob <= LIVE_EPS) continue;
    if (Math.min(v.phaseDeg, 360 - v.phaseDeg) > PHASE_TOL_DEG) return false;
  }
  return true;
}

/**
 * Constraint (d): the target fits the ket line whole — at most `KET_TERMS`
 * populated basis states, so nothing about the goal hides behind "+ ⋯". Bound to
 * the very constant the ket is typeset with, so the two cannot drift. Checked
 * unconditionally (it is one short loop) although only k = 5 can ever fail it:
 * a k ≤ 4 target has at most 16 basis states to spread over in the first place.
 */
function fitsTheKetLine(target: StateVector, k: number): boolean {
  let populated = 0;
  for (let i = 0; i < 1 << k; i++) {
    const a = target[i];
    if (a.re * a.re + a.im * a.im <= LIVE_EPS) continue;
    if (++populated > KET_TERMS) return false;
  }
  return true;
}

/**
 * A hand-built circuit satisfying ALL FOUR constraints, used only if the retry
 * budget is somehow exhausted: H on q0, X on every other wire — so the target is
 * |+⟩⊗|1…1⟩, which has exactly TWO populated basis states however wide the hole
 * is (an H on every wire would spread over all 32 and trip (d) at k = 5), no dead
 * qubit, no phase, and no chance of being |0…0⟩. Padding to `n` gates repeats the
 * X on q0, and X|+⟩ = |+⟩, so the padding is genuinely inert whatever the round's
 * bonus adds. Every round's club list carries both H and X.
 */
function fallbackGates(types: readonly GateType[], k: number, n: number): Gate[] {
  const single = types.filter((t) => !CONTROLLED.has(t));
  const spread = single.includes('H') ? ('H' as GateType) : single[0];
  const flip =
    single.includes('X') ? ('X' as GateType) : (single.find((t) => t !== spread) ?? spread);
  const gates: Gate[] = [{ id: 'fb0', type: spread, position: 0, qubit: 0 }];
  for (let q = 1; q < k; q++) gates.push({ id: `fb${q}`, type: flip, position: q, qubit: q });
  for (let i = k; i < n; i++) gates.push({ id: `fb${i}`, type: flip, position: i, qubit: 0 });
  return gates;
}

/**
 * The generated hole's display ket, typeset by the SAME `ketTerms` the live
 * bra-ket line under the sphere uses (so the target and the state you are
 * building are written in one notation), flattened to plain text for the
 * scorecard. Constraint (d) keeps every generated target inside `KET_TERMS`, so
 * the elision branch is dead for real holes and survives only as a safety net.
 */
function ketText(target: StateVector, k: number): string {
  const { terms, truncated } = ketTerms(target, k, KET_TERMS);
  const body = terms
    .map((t) => `${t.op}${t.coef}${t.exponent === null ? '' : `e^(${t.exponent})`}${t.unit}${t.ket}`)
    .join('');
  return truncated ? `${body} + ⋯` : body;
}

/** The (round, level, code, number) skeleton a generated hole is poured into —
 *  read off the classic course so the two share one structure. */
interface Slot {
  readonly hole: number;
  readonly round: GolfRound;
  readonly level: number;
  readonly code: string;
}

const SLOTS: readonly Slot[] = HOLES.map((h) => ({
  hole: h.hole,
  round: h.round,
  level: h.level,
  code: h.code,
}));

/** A generated hole together with the circuit that defines it (the "answer"). */
export interface GeneratedHole {
  readonly hole: Hole;
  /** The generator — a par-beating solution, useful to tests and tooling. Also
   *  carried on the hole itself as `hole.solution`, which is what the scorecard
   *  reveals after a hole-in (#71). */
  readonly circuit: Circuit;
}

/** Generate one hole for `slot` from `seed` (deterministic in both). */
export function generateHole(slot: Slot, seed: number): GeneratedHole {
  const clubs = ROUND_CLUBS[slot.round];
  const types = gateTypesForClubs(clubs);
  const k = slot.level;
  const size = k + ROUND_BONUS[slot.round];
  const phaseFree = PHASE_FREE_ROUNDS.has(slot.round);

  let gates: Gate[] | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = drawGates(mulberry32(seed + attempt), types, k, size);
    const target = statevector({ qubits: NUM_QUBITS, gates: candidate });
    if (!isNonTrivial(target)) continue;
    if (!everyQubitLives(target, k)) continue;
    if (phaseFree && !isPhaseFree(target, k)) continue;
    if (!fitsTheKetLine(target, k)) continue;
    gates = candidate;
    break;
  }
  const circuit: Circuit = { qubits: NUM_QUBITS, gates: gates ?? fallbackGates(types, k, size) };
  const target = statevector(circuit);
  const ket = ketText(target, k);

  const hole: Hole = {
    hole: slot.hole,
    round: slot.round,
    level: k,
    qubits: k,
    name: `Random ${slot.code}`,
    code: slot.code,
    view: k === 1 ? 'bloch' : 'qsphere',
    targetKet: ket,
    target: ket,
    // Par = generator size + 1: the draw usually carries its own redundancy,
    // but an efficient deal would otherwise leave ZERO slack — with #68's
    // edit-counted strokes a single fumble would make par unreachable (Jan hit
    // exactly that on a minimal E3 deal).
    par: size + 1,
    clubs,
    targets: orderedPlacements(k, target),
    canonicalTarget: target,
    // The generator IS a worked answer (#71): it built this target, and at
    // `size` gates it beats the hole's par of `size + 1`. Carrying it on the
    // hole is what lets `courseHoles` hand the scorecard a random round whose
    // "Show solution" works exactly like the classic one's.
    solution: circuit,
  };
  return { hole, circuit };
}

/** The full 18-hole generated course for `baseSeed`, with its generators. */
export function generateCourse(baseSeed: number): readonly GeneratedHole[] {
  return SLOTS.map((slot, i) => generateHole(slot, (baseSeed + i * SLOT_STRIDE) >>> 0));
}

/** Memo of recently generated courses — the holes are rebuilt on every render
 *  otherwise (each carries up to 120 placed target vectors). */
const COURSE_CACHE = new Map<number, readonly Hole[]>();
const CACHE_LIMIT = 4;

/** The generated course for `baseSeed` (memoized, so identity is stable). */
export function randomCourse(baseSeed: number): readonly Hole[] {
  const hit = COURSE_CACHE.get(baseSeed);
  if (hit) return hit;
  const holes = generateCourse(baseSeed).map((g) => g.hole);
  if (COURSE_CACHE.size >= CACHE_LIMIT) COURSE_CACHE.clear();
  COURSE_CACHE.set(baseSeed, holes);
  return holes;
}

/** The holes a golf state is playing: the fixed course, or its generated one. */
export function courseHoles(state: Pick<GolfState, 'course' | 'randomSeed'>): readonly Hole[] {
  return state.course === 'random' ? randomCourse(state.randomSeed) : HOLES;
}

/** The hole currently in play on `state`'s course. */
export function currentHole(
  state: Pick<GolfState, 'course' | 'randomSeed' | 'levelIndex'>,
): Hole {
  return courseHoles(state)[state.levelIndex];
}

/**
 * A fresh 32-bit base seed for a new random course. Defaults to `cryptoRng` so
 * two visitors never share a round; tests pin a `mulberry32`.
 */
export function randomBaseSeed(rng: Rng = cryptoRng()): number {
  return Math.floor(rng() * 0x100000000) >>> 0;
}
