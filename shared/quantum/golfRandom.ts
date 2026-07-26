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
 * (e) is the DIFFICULTY floor (#76), and it applies to every M/D/X slot but M1.
 * A 832-deal survey found that a medium target is buildable in exactly `level`
 * gates in 84–100% of deals — the identical gate count to the EASY round's GHZ
 * of the same width. Medium was not harder than easy; it was easy wearing a
 * different ket, scored more leniently. D and X were looser but not clean
 * either (45–67% and 33–48% at the same floor). So every deal must now PROVE it
 * costs more than `level` gates, or be redrawn. M1 alone is exempt: it is the
 * one-gate warm-up by design, and on one wire nothing could bite anyway.
 *
 * (f) is the CLUB-NECESSITY rule (#77): the clubs a round ADDS have to be the
 * reason its target is worth building. Jan noticed medium never actually needed
 * Y, and the cause was structural — the {X, H, CX} orbit of |0…0⟩ is exactly the
 * non-negative real states, so while (c) demanded phase-FREE targets, every
 * medium target was reachable without Y by definition. Relaxing (c) to real-±
 * makes a Y-only target possible; (f) makes it compulsory, and generalises the
 * same demand to D (needs S) and X (needs T or CH).
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
import { canonicalKey, optimalSearch, reachableWithin, type ReachMap } from './optimal';
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
const SLOT_STRIDE = 100_000;
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
 * The floor (e) and the club-necessity rule (f) multiply into that, and they
 * bite hard: measured mean attempts per accepted hole are M2 256, M3 278,
 * M4 607, M5 1084, D4 150, D5 538, X5 168 — acceptance 0.09%–0.6% on the tight
 * slots. At 32k offsets even the worst (M5, 0.092%) falls through to the
 * fallback with probability (1 − 0.00092)^32000 ≈ 2e-13, and no slot came within
 * an order of magnitude of the cap in measurement (worst observed: M5 at 4259).
 * `SLOT_STRIDE` grows with it so the budget still fits inside one slot's seed
 * range and slots cannot collide.
 *
 * The draws are cheap enough for that to be fine: (e) and (f) are map lookups,
 * not searches, so a rejected candidate costs a statevector and two hashes.
 */
const MAX_ATTEMPTS = 32_000;
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
/**
 * States a club-orbit enumeration may visit (#77). Larger than the par search's
 * budget because these are built ONCE per (round, wires, depth) and cached for
 * the session, and because one of them genuinely needs the room: the EXTRA clubs
 * on five wires close out at ~176k states, which is what makes the floor exact
 * for X5 instead of a guess. The orbits that do NOT close inside this (the
 * five-wire stabilizer sets, reached from below by D5 and X5) fall through to
 * the club signatures, which cost nothing.
 */
const FLOOR_ORBIT_BUDGET = 250_000;
/**
 * Budget for the orbit constraint (f) looks the target up in — the round BELOW,
 * at the deal's own depth. Deliberately far smaller than the floor's: the orbits
 * that matter here either close early (EASY's affine-subspace states, and the
 * narrow MEDIUM/DIFFICULT sets behind D1–D3 and X1/X3) or cannot be closed at
 * any budget worth spending (the five-wire stabilizer sets behind D5 and X5,
 * millions of states). Chasing the second kind bought nothing and cost seconds,
 * so the fallback to the club signature happens early and cheaply.
 */
const NECESSITY_ORBIT_BUDGET = 30_000;
/** How close |amplitude(|0…0⟩)|² may come to 1 before the target counts as trivial. */
const TRIVIAL_EPS = 1e-9;
/** Below this probability an amplitude is not evidence that a qubit is alive. */
const LIVE_EPS = 1e-9;
/** How far a reference-relative phase may stray from 0° and still read as none. */
const PHASE_TOL_DEG = 1e-6;
/**
 * How much phase a round's targets may carry (constraint (c)).
 *
 *  - `nonNegative` — every populated amplitude at 0°: plain positive
 *    superpositions, the EASY round's whole vocabulary.
 *  - `real` — 0° or 180°: minus signs allowed, nothing imaginary. MEDIUM (#77).
 *    A minus sign is precisely what the medium round's Y is FOR, and under the
 *    old non-negative rule it could never appear, which is why Y was decorative
 *    (see the header's (f)).
 *  - `any` — DIFFICULT and EXTRA, where phase is the lesson.
 */
type PhaseRule = 'nonNegative' | 'real' | 'any';
const ROUND_PHASE: Readonly<Record<GolfRound, PhaseRule>> = {
  easy: 'nonNegative',
  medium: 'real',
  difficult: 'any',
  extra: 'any',
};
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
 * Constraint (c): the target's phases stay inside its round's vocabulary.
 * Phases are read with `basisVisuals`, the SAME machinery the Q-sphere colours
 * nodes by and the bra-ket line typesets from, so a rule here means exactly
 * what a player sees. Degrees live in [0, 360), so a hair below zero wraps to
 * just under 360 and both ends of each allowed angle must be accepted.
 */
function satisfiesPhase(target: StateVector, k: number, rule: PhaseRule): boolean {
  if (rule === 'any') return true;
  for (const v of basisVisuals(target, 1 << k)) {
    if (v.prob <= LIVE_EPS) continue;
    const fromZero = Math.min(v.phaseDeg, 360 - v.phaseDeg);
    if (fromZero <= PHASE_TOL_DEG) continue;
    // `real` also admits a flat 180° — a minus sign, and nothing else.
    if (rule === 'real' && Math.abs(v.phaseDeg - 180) <= PHASE_TOL_DEG) continue;
    return false;
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

/**
 * Which round a slot must out-build (#77). A deal has to be strictly cheaper
 * with its own round's clubs than with the round below's, so the clubs the round
 * introduces are the REASON the target is worth building. `null` exempts a slot.
 */
const ROUND_BELOW: Readonly<Record<GolfRound, GolfRound | null>> = {
  easy: null,
  medium: 'easy',
  difficult: 'medium',
  extra: 'difficult',
};

/**
 * Constraints (e) and (f) apply to every slot of M/D/X — except M1 (#76, #77).
 *
 * M1 stays the one-gate warm-up, and no rule could bite there anyway: on one
 * wire the medium clubs are {X, H, Y}, Y is XZ up to a global phase, and every
 * state {X, H, Y} reaches in n gates {X, H} reaches in n too. Nothing about a
 * one-qubit medium target can be made to need Y, or to cost more than an easy
 * hole of the same width.
 *
 * Everything else is floored and club-checked, D1 and X1 included — that is what
 * stops a D3 dealing |111⟩ (three gates on three wires, an EASY hole wearing a
 * difficult label) or a D1 dealing |1⟩.
 */
function isRuled(round: GolfRound, k: number): boolean {
  if (round === 'easy') return false;
  return !(round === 'medium' && k === 1);
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

/**
 * The bounded orbit of a round's clubs on `k` wires, built once and kept.
 *
 * Constraints (e) and (f) ask the same two questions of every candidate draw —
 * "could this be built in k gates?" and "could the round BELOW have built it?" —
 * so the answers are precomputed for the whole club set instead of re-searched
 * per candidate. That is what lets both sit inside a draw loop that runs
 * hundreds of times: each becomes a map lookup.
 *
 * The cache is module-level and survives across courses, so the one genuinely
 * big orbit (the EXTRA clubs at depth 5, ~176k states) is paid for once per
 * session rather than once per "Random 18".
 */
const REACH_CACHE = new Map<string, ReachMap>();
const REACH_CACHE_LIMIT = 24;

function reachOf(round: GolfRound, k: number, maxDepth: number, budget: number): ReachMap {
  const key = `${round}:${k}:${maxDepth}`;
  const hit = REACH_CACHE.get(key);
  if (hit) return hit;
  const map = reachableWithin(gateTypesForClubs(ROUND_CLUBS[round]), k, maxDepth, {
    stateBudget: budget,
  });
  if (REACH_CACHE.size >= REACH_CACHE_LIMIT) REACH_CACHE.clear();
  REACH_CACHE.set(key, map);
  return map;
}

/**
 * Constraint (e), as a lookup: is this target buildable in `k` gates or fewer
 * with the round's OWN clubs — i.e. is it no harder than an easy hole of the
 * same width (#76)? Bounded by depth `k`, which is the only question the floor
 * asks; the far deeper search that produces `par` happens once, after a deal is
 * accepted, and never inside the loop.
 *
 * An orbit too big to enumerate leaves the question open, and an open question
 * ACCEPTS — generation must never stall on something it cannot prove.
 */
function isTooEasy(target: StateVector, round: GolfRound, k: number): boolean {
  const reach = reachOf(round, k, k, FLOOR_ORBIT_BUDGET);
  return reach.depthOf.has(canonicalKey(target));
}

/**
 * The DIFFICULT club signature: some populated amplitude sits off the real line.
 *
 * Not an approximation — an exact statement about what S buys. The medium clubs
 * {X, H, CX, Y} reach only states whose amplitudes are real up to a global phase
 * (Y is XZ up to a phase, and neither X, H, CX nor Z can put an i anywhere the
 * others cannot take out). S is the only club DIFFICULT adds that makes a
 * genuinely imaginary relative phase. So "carries a non-real phase" is precisely
 * "medium could not have built this", read the same way the Q-sphere reads it.
 */
function hasNonRealPhase(target: StateVector, k: number): boolean {
  for (const v of basisVisuals(target, 1 << k)) {
    if (v.prob <= LIVE_EPS) continue;
    const fromZero = Math.min(v.phaseDeg, 360 - v.phaseDeg);
    if (fromZero > PHASE_TOL_DEG && Math.abs(v.phaseDeg - 180) > PHASE_TOL_DEG) return true;
  }
  return false;
}

/**
 * The EXTRA club signature: a phase off the 90° lattice, or populated amplitudes
 * of unequal magnitude.
 *
 * Again exact, not approximate. The difficult clubs {X, H, CX, Y, Z, S} generate
 * the stabilizer group, and a stabilizer state built from |0…0⟩ is a uniform
 * superposition over an affine subspace with phases in {0°, 90°, 180°, 270°}.
 * EXTRA adds exactly two things that escape it: T, whose eighth-turn lands
 * between the lattice points, and CH, which splits amplitude unevenly. Either
 * signature is proof that no amount of difficult-round play reaches this target.
 */
function hasExtraSignature(target: StateVector, k: number): boolean {
  let magnitude: number | null = null;
  for (const v of basisVisuals(target, 1 << k)) {
    if (v.prob <= LIVE_EPS) continue;
    // Off the 90° lattice → a T-phase (or something T-like) is in play.
    const offLattice = Math.min(
      ...[0, 90, 180, 270, 360].map((a) => Math.abs(v.phaseDeg - a)),
    );
    if (offLattice > PHASE_TOL_DEG) return true;
    // Unequal populated magnitudes → a controlled-H split is in play.
    if (magnitude === null) magnitude = v.prob;
    else if (Math.abs(v.prob - magnitude) > LIVE_EPS * 1e3) return true;
  }
  return false;
}

/** The structural club signature a round's own clubs are the only source of.
 *  Exported for its unit tests — nothing outside generation reads it. */
export function hasRoundSignature(target: StateVector, round: GolfRound, k: number): boolean {
  if (round === 'difficult') return hasNonRealPhase(target, k);
  if (round === 'extra') return hasExtraSignature(target, k);
  return false; // MEDIUM's signature (a minus sign) is not sufficient on its own
}

/**
 * Constraint (f): the clubs this round ADDS have to matter (#77).
 *
 * Jan noticed medium never actually needed Y, and the reason was structural: the
 * {X, H, CX} orbit of |0…0⟩ is exactly the non-negative real states (uniform
 * superpositions over affine subspaces), so while (c) demanded phase-FREE
 * targets, every medium target was reachable without Y by definition. Relaxing
 * (c) to real-± is what makes a Y-only target possible; (f) is what makes it
 * compulsory. The same argument generalises: a difficult hole must need Z/S
 * beyond medium's real ±, an extra hole must need T/CH beyond the stabilizer
 * states Z/S can reach.
 *
 * Read strictly one way round. Finding the target in the lower round's orbit at
 * depth ≤ `optimal` PROVES the new clubs bought nothing, and the draw is
 * rejected. Not finding it only proves something when the orbit was enumerated
 * to exhaustion; an orbit too big for the budget (the five-wire stabilizer set
 * is millions of states) leaves the question open, and an open question ACCEPTS.
 * Generation must never stall on something it cannot prove — the asymmetry with
 * (e) is deliberate, and (e) cannot hit it anyway because its own search is
 * bounded by depth k, which is always cheap.
 */
function needsOwnClubs(
  target: StateVector,
  round: GolfRound,
  k: number,
  maxDepth: number,
): boolean {
  const below = ROUND_BELOW[round];
  if (below === null) return true;
  const reach = reachOf(below, k, maxDepth, NECESSITY_ORBIT_BUDGET);
  // Found in the lower round's orbit → the new clubs bought nothing. This is
  // the exact answer, and it is what M2–M5, D1–D3 and X1/X3 are decided by.
  if (reach.depthOf.has(canonicalKey(target))) return false;
  // Absent from a CLOSED orbit is equally exact: the target is unreachable
  // below, so the round's own clubs are what make it possible.
  if (reach.complete) return true;
  // Absent from an orbit too big to close (the five-wire stabilizer sets, D5 and
  // X5) proves nothing by itself — so fall back to the club SIGNATURE, which is
  // an exact statement of its own about what this round's clubs uniquely make.
  return hasRoundSignature(target, round, k);
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
  const phaseRule = ROUND_PHASE[slot.round];

  const ruled = isRuled(slot.round, k);

  let gates: Gate[] | null = null;
  let attempts = MAX_ATTEMPTS;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = drawGates(mulberry32(seed + attempt), types, k, size);
    const target = statevector({ qubits: NUM_QUBITS, gates: candidate });
    if (!isNonTrivial(target)) continue;
    if (!everyQubitLives(target, k)) continue;
    if (!satisfiesPhase(target, k, phaseRule)) continue;
    if (!fitsTheKetLine(target, k)) continue;
    if (ruled) {
      // (e) — no harder than an easy hole of this width? Then it is not a
      // medium/difficult/extra hole, whatever its ket looks like.
      if (isTooEasy(target, slot.round, k)) continue;
      // (f) — the clubs this round adds have to be the reason the target is
      // worth building at all.
      if (!needsOwnClubs(target, slot.round, k, size)) continue;
    }
    gates = candidate;
    attempts = attempt + 1;
    break;
  }
  const circuit: Circuit = { qubits: NUM_QUBITS, gates: gates ?? fallbackGates(types, k, size) };
  const target = statevector(circuit);
  const ket = ketText(target, k);
  // The one expensive search of the whole pipeline, run ONCE on the deal that
  // was accepted — never inside the loop, where a wide EXTRA slot would pay for
  // it on every candidate that got as far as being measured.
  const found = findOptimalFor(target, types, k, size);
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
