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
 * ## Par (#76)
 * Par is the target's COMPUTED MINIMUM plus two — the classic course's own rule
 * (#69), now that `@quantum/optimal` can find that minimum. Par used to be the
 * generator's gate count + 1, on the theory that a random draw carries its own
 * redundancy; measuring 832 deals showed it carries a median of TWO wasted
 * gates, so that rule was handing out par − optimal = 3 (and 4 on a fifth of
 * EXTRA deals) where the classic course hands out 2. Random holes were a full
 * stroke more forgiving than fixed ones of the same width. Deriving par from
 * the optimal makes the two courses score the same way.
 *
 * When the search cannot resolve inside `GEN_STATE_BUDGET` — the five-wire
 * EXTRA slot, sometimes — par falls back to the old generator + 1.
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
 * (e) is the DIFFICULTY floor (#76), and it applies to MEDIUM levels 2–5 only.
 * The same 832-deal survey found that a medium target is buildable in exactly
 * `level` gates in 84–100% of deals — the identical gate count to the EASY
 * round's GHZ of the same width. Medium was not harder than easy; it was easy
 * wearing a different ket, scored more leniently. So a medium draw must now
 * PROVE it needs more than `level` gates or be redrawn. M1 is exempt by design
 * (the one-gate warm-up, and on one wire the medium clubs cannot reach anything
 * longer once (a) and (c) have spoken); DIFFICULT and EXTRA are exempt because
 * their optimal lengths genuinely spread (45–67% and 33–48% at the floor), which
 * is the variance golf is supposed to have.
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
 * `baseSeed + i * SLOT_STRIDE`, and a rejected draw retries at `+1` (capped far
 * below the stride, so slots can never collide). The optimal search is itself
 * deterministic, so adding (e) and the computed par keeps a seed's course
 * exactly reproducible. The seed lives on `GolfState`,
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
 * ## Solution (#71, #76)
 * `hole.solution` is the BEST circuit known for the target: the shorter one the
 * optimal search found, or the generator itself when the generator is already
 * minimal (or the search could not resolve). The reveal should teach the good
 * way to build the state, not the accident that dealt it. The dealt generator
 * is still returned on `GeneratedHole.circuit` for tests and tooling.
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
import { optimalSearch } from './optimal';
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
const SLOT_STRIDE = 10_000;
/**
 * Seed offsets tried before the deterministic fallback, sized for the tightest
 * slots. Keeping five wires alive on a 7-gate draw is genuinely demanding, and
 * the phase-free rule tightens the wide EASY/MEDIUM slots further. Measured
 * acceptance over 4000 seeds per slot, with constraints (a)–(d): D5 1.77%,
 * X5 1.79%, E5 2.82%, M5 3.46% — everything else far looser (M1 82%, E2 31%).
 * The 16-term cap barely moved those numbers (D5 was 1.78% without it), because
 * a draw wide enough to fill 17+ basis states rarely also keeps every wire
 * alive.
 *
 * The MEDIUM floor (e) multiplies into that: only 6–16% of draws that clear
 * (a)–(d) also need more than `level` gates, so M2–M5 compound down to
 * 0.4%–2.6% and need thousands of offsets, not hundreds. Measured mean attempts
 * per accepted hole: M2 39, M3 24, M4 106, M5 253 — worst-case slot M5 falls
 * through to the fallback with probability (1 − 0.0040)^4000 ≈ 1e-7, the same
 * safety margin the pre-#76 budget carried. `SLOT_STRIDE` grows with it so the
 * budget still fits inside one slot's seed range and slots cannot collide.
 */
const MAX_ATTEMPTS = 4000;
/**
 * States a generation-time optimal search may visit before giving up (#76).
 * Deliberately far below `@quantum/optimal`'s own default: this runs inside the
 * draw loop, on every candidate that clears (a)–(d), and course generation must
 * stay a one-off ~300 ms rather than a multi-second stall. Measured: 20k
 * resolves every E/M/D slot and X1/X3 essentially always; only the five-wire
 * EXTRA slot regularly outruns it, and that is exactly the case the
 * generator-length fallback exists for.
 */
export const GEN_STATE_BUDGET = 20_000;
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

/** Constraint (e): a hole must be harder to BUILD than an easy hole of the same
 *  width (#76). Medium only, from level 2 up — M1 is the one-gate warm-up by
 *  design, and on one wire the medium clubs {X,H,Y} can only reach |1⟩ and |+⟩
 *  once (a) and (c) have had their say, so no floor is even possible there.
 *  DIFFICULT and EXTRA are left alone: their optimal lengths spread 1–6 and 5–8
 *  across deals, which is legitimate variance, not a mislabelled round. */
function hasFloor(round: GolfRound, k: number): boolean {
  return round === 'medium' && k >= 2;
}

/** What a generation-time optimal search learned about a candidate target. */
interface OptimalFind {
  /** Shortest circuit length that prepares the target, or `null` if the search
   *  ran out of budget before it could tell. */
  readonly optimal: number | null;
  /** The shorter circuit itself, when one was found (the generator is not it). */
  readonly gates: Gate[] | null;
}

/**
 * How short this target really is (#76), searched with the shared engine and a
 * tight budget. `maxDepth = size − 1` asks only "is there something shorter than
 * the draw?", which is the cheap question; a `minimal` verdict means the draw
 * itself is the shortest answer.
 */
function findOptimalFor(
  target: StateVector,
  types: readonly GateType[],
  k: number,
  size: number,
): OptimalFind {
  const it = optimalSearch(target, types, k, {
    maxDepth: size - 1,
    stateBudget: GEN_STATE_BUDGET,
  });
  let step = it.next();
  while (!step.done) step = it.next();
  const result = step.value;
  if (result.status === 'shorter') return { optimal: result.gates.length, gates: result.gates };
  if (result.status === 'minimal') return { optimal: size, gates: null };
  return { optimal: null, gates: null };
}

/** A generated hole together with the circuit that defines it (the "answer"). */
export interface GeneratedHole {
  readonly hole: Hole;
  /** The generator — the circuit the hole was DEALT from. Still exactly what
   *  the draw produced, even when the optimal search found something shorter
   *  and `hole.solution` became that instead (#76). */
  readonly circuit: Circuit;
  /** Seed offsets consumed before this hole was accepted (1 = first draw).
   *  Exposed for the `MAX_ATTEMPTS` budget arithmetic and its guard test. */
  readonly attempts: number;
}

/** Generate one hole for `slot` from `seed` (deterministic in both). */
export function generateHole(slot: Slot, seed: number): GeneratedHole {
  const clubs = ROUND_CLUBS[slot.round];
  const types = gateTypesForClubs(clubs);
  const k = slot.level;
  const size = k + ROUND_BONUS[slot.round];
  const phaseFree = PHASE_FREE_ROUNDS.has(slot.round);

  const floored = hasFloor(slot.round, k);

  let gates: Gate[] | null = null;
  let found: OptimalFind = { optimal: null, gates: null };
  let attempts = MAX_ATTEMPTS;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = drawGates(mulberry32(seed + attempt), types, k, size);
    const target = statevector({ qubits: NUM_QUBITS, gates: candidate });
    if (!isNonTrivial(target)) continue;
    if (!everyQubitLives(target, k)) continue;
    if (phaseFree && !isPhaseFree(target, k)) continue;
    if (!fitsTheKetLine(target, k)) continue;
    // (e) — asked LAST, because it is the only expensive constraint: the search
    // runs on the ~2–30% of draws that already cleared (a)–(d), never on all of
    // them. It doubles as the source of this hole's par (#76).
    const optimal = findOptimalFor(target, types, k, size);
    // A floored slot must be able to PROVE it is above the floor; a search that
    // ran out of budget proves nothing, so the draw is retried rather than
    // waved through. Measured: medium never actually exhausts this budget.
    if (floored && (optimal.optimal === null || optimal.optimal <= k)) continue;
    gates = candidate;
    found = optimal;
    attempts = attempt + 1;
    break;
  }
  const circuit: Circuit = { qubits: NUM_QUBITS, gates: gates ?? fallbackGates(types, k, size) };
  const target = statevector(circuit);
  const ket = ketText(target, k);
  // Par on the classic course's own rule (#69): the MINIMUM plus two, so one
  // extra gate is a birdie and a small fumble still makes par. When the search
  // could not resolve — the wide EXTRA slot, occasionally — fall back to the
  // pre-#76 generator + 1, which is the tightest honest bound we have left.
  const par = found.optimal === null ? size + 1 : found.optimal + 2;
  // The reveal (#71) should teach the BEST way to build the target, not the
  // accident that dealt it; the dealt generator stays on `GeneratedHole.circuit`.
  const solution: Circuit =
    found.gates === null ? circuit : { qubits: NUM_QUBITS, gates: found.gates };

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
    par,
    clubs,
    targets: orderedPlacements(k, target),
    canonicalTarget: target,
    solution,
  };
  return { hole, circuit, attempts };
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
 * A course's shareable CODE: its base seed in base 36 (#78). Short enough to
 * read out loud or print on a card ("Course #1z9k4h"), and lossless — the code
 * IS the seed, so anyone who types it gets the identical eighteen holes.
 */
export function courseCode(seed: number): string {
  return (seed >>> 0).toString(36);
}

/**
 * The seed behind a course code, or `null` if the text is not one. Accepts any
 * case and surrounding space (people retype these from photos and messages) and
 * a leading '#'. Rejects anything that is not a 32-bit base-36 value, so a
 * mistyped `?course=` in the URL is ignored rather than dealing a wrong course.
 */
export function parseCourseCode(code: string): number | null {
  const text = code.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-z]{1,7}$/.test(text)) return null;
  const seed = Number.parseInt(text, 36);
  if (!Number.isFinite(seed) || seed < 0 || seed > 0xffffffff) return null;
  // Round-trip guard: rejects leading zeros and other spellings that would show
  // the player a code different from the one they typed.
  if (courseCode(seed) !== text) return null;
  return seed >>> 0;
}

/**
 * A fresh 32-bit base seed for a new random course. Defaults to `cryptoRng` so
 * two visitors never share a round; tests pin a `mulberry32`.
 */
export function randomBaseSeed(rng: Rng = cryptoRng()): number {
  return Math.floor(rng() * 0x100000000) >>> 0;
}
