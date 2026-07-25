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
 *   (a) the target is not |0…0⟩ — an empty board would otherwise hole in; and
 *   (b) every qubit 0..k−1 is touched — otherwise the "5-qubit" hole is a
 *       lower-level hole wearing a bigger ket.
 *
 * (a) subsumes "the state must actually differ from the product ground state".
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
 * This module depends on `@quantum/golf`, never the reverse: `golfStep` takes
 * the course as an optional parameter and defaults to the fixed `HOLES`, so the
 * engine stays free of the generator.
 */
import type { Circuit, Gate, GateType } from '@qamposer/react';
import { ketTerms } from '@shared/display/KetDisplay';
import { mulberry32, cryptoRng, type Rng } from '@shared/menu/sample';
import { activeQubits, statevector, NUM_QUBITS, type StateVector } from './statevector';
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
/** Seed offsets tried before the deterministic fallback. Never reached in
 *  practice — the worst slot (E1: two gates from {X,H}) rejects only half its
 *  draws, so exhausting 200 offsets has probability ~2⁻²⁰⁰. */
const MAX_ATTEMPTS = 200;
/** How close |amplitude(|0…0⟩)|² may come to 1 before the target counts as trivial. */
const TRIVIAL_EPS = 1e-9;
/** Terms shown in a generated hole's scorecard ket (the rest elide to "+ ⋯"). */
const KET_TERMS = 4;

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

/** Constraint (b): the draw touches every one of qubits 0..k−1. */
function touchesEveryQubit(circuit: Circuit, k: number): boolean {
  return activeQubits(circuit).length === k;
}

/** Constraint (a): the target is not the all-|0⟩ state (which an empty board hits). */
function isNonTrivial(target: StateVector): boolean {
  const a = target[0];
  return 1 - (a.re * a.re + a.im * a.im) > TRIVIAL_EPS;
}

/**
 * A hand-built circuit satisfying both constraints, used only if the retry
 * budget is somehow exhausted: an H on every wire (touching all of them and
 * leaving |0…0⟩ far behind), padded to `n` gates on q0 with another club.
 */
function fallbackGates(types: readonly GateType[], k: number, n: number): Gate[] {
  const single = types.filter((t) => !CONTROLLED.has(t));
  const spread = single.includes('H') ? ('H' as GateType) : single[0];
  const filler = single.find((t) => t !== spread) ?? spread;
  const gates: Gate[] = [];
  for (let q = 0; q < k; q++) gates.push({ id: `fb${q}`, type: spread, position: q, qubit: q });
  for (let i = k; i < n; i++) gates.push({ id: `fb${i}`, type: filler, position: i, qubit: 0 });
  return gates;
}

/**
 * The generated hole's display ket, typeset by the SAME `ketTerms` the live
 * bra-ket line under the sphere uses (so the target and the state you are
 * building are written in one notation), flattened to plain text for the
 * scorecard. Long targets elide — the Q-sphere ghost carries the full truth.
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
  /** The generator — a par-length solution, useful to tests and tooling. */
  readonly circuit: Circuit;
}

/** Generate one hole for `slot` from `seed` (deterministic in both). */
export function generateHole(slot: Slot, seed: number): GeneratedHole {
  const clubs = ROUND_CLUBS[slot.round];
  const types = gateTypesForClubs(clubs);
  const k = slot.level;
  const size = k + ROUND_BONUS[slot.round];

  let gates: Gate[] | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = drawGates(mulberry32(seed + attempt), types, k, size);
    const circuit: Circuit = { qubits: NUM_QUBITS, gates: candidate };
    if (!touchesEveryQubit(circuit, k)) continue;
    if (!isNonTrivial(statevector(circuit))) continue;
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
    // Par IS the generator's size — see the module header on built-in slack.
    par: size,
    clubs,
    targets: orderedPlacements(k, target),
    canonicalTarget: target,
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
