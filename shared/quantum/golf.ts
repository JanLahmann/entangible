/**
 * Quantum Golf engine — pure logic for the "quantum mini-golf" course.
 *
 * Shared home for BOTH apps (pocket imports it via its `@quantum` alias; the
 * booth imports it relatively). The course is **18 holes** in four rounds:
 *
 *   EASY      E1–E5  — superposition / Bell / GHZ-3/4/5 (the original 5 levels).
 *   MEDIUM    M1–M5  — bit-flip variants ("same entanglement, different face").
 *   DIFFICULT D1–D5  — relative-phase targets (minus / i-GHZ …), visible on the
 *                       Q-sphere as node colour; fidelity catches the phase.
 *   EXTRA     X1/X3/X5 — T-phase + a CH-only "Cascade" (an UNequal superposition
 *                       unreachable without a controlled-H).
 *
 * Each hole's target is a fixed statevector over `k = qubits`; we score the
 * player's live circuit by the *best* fidelity over any placement of those
 * qubits — symmetric targets (GHZ/Bell/1q/phase-GHZ) compare against every
 * unordered k-subset, asymmetric targets (the flip families, the Cascade)
 * against every ORDERED arrangement so the answer can be built on any rows in
 * any order. "Strokes" = every gate ADD and every gate DELETE since the hole was
 * teed off (#68) — deleting a wrong tile and retrying costs strokes, like real
 * golf. Hole-in at fidelity ≥ 0.99;
 * clearing the board then advances to the next hole (after hole 18 the course
 * completes, then a board-clear restarts). Best-per-hole is optionally persisted
 * through an injectable Storage (pocket uses localStorage; the booth keeps it in
 * memory). All exported logic is pure and injectable.
 *
 * The 18 holes above are the CLASSIC course. A second, RANDOM course (#70)
 * mirrors its structure with generated targets; it lives in `@quantum/golfRandom`
 * so this module never depends on the generator. Everything here is
 * course-agnostic: `golfStep` takes the hole list as an optional argument
 * (defaulting to `HOLES`), a generated hole carries its own target placements,
 * and `GolfState.course`/`randomSeed` say which course a state is playing.
 *
 * Every hole also carries a `solution` (#71): a circuit that prepares its
 * target, DRAWN on request once the hole is holed in (`shared/display/
 * MiniCircuit`). Classic holes use the reference paths their pars were derived
 * from (`holeSolution`, par − 2 long); generated holes use their own generator.
 * It is display data only — nothing here reads it, and it is never applied to
 * the board, so it can never touch strokes (#68).
 *
 * Bit convention: leftmost ket bit = first arrangement qubit, matching
 * shared/display/outcomes.ts. Internally targets live in the little-endian
 * statevector basis (index i has qubit q set when (i >> q) & 1).
 */
import type { Circuit, Gate, GateType } from '@qamposer/react';
import { fidelity, statevector, DIM, NUM_QUBITS, type Complex, type StateVector } from './statevector';

export const HOLE_IN_THRESHOLD = 0.99;
/** Legacy per-LEVEL best key (the original 5-level course). Read once, migrated. */
export const GOLF_STORAGE_KEY = 'entangible.pocket.golf';
/** Per-HOLE best key (the 18-hole course; keyed by hole number 1..18). */
export const GOLF_HOLES_KEY = 'entangible.pocket.golf.holes';
/** Which holes were solved with a mid-hole reveal (#99), keyed by hole number. */
export const GOLF_REVEALED_KEY = 'entangible.pocket.golf.revealed';

/** Which view a hole plays on (1-qubit holes on the Bloch sphere, else Q-sphere). */
export type GolfView = 'bloch' | 'qsphere';
/** The four course rounds, in play order. */
export type GolfRound = 'easy' | 'medium' | 'difficult' | 'extra';

/** Full par of the course. Par is the MINIMAL stroke count + 2 per hole
 *  (E 25 + M 29 + D 30 + X 17): optimal play scores an eagle, one extra
 *  stroke a birdie, and a small fumble still makes par. */
export const COURSE_PAR = 101;

/** Human label + accent per round (Scorecard header). */
export const ROUND_LABEL: Readonly<Record<GolfRound, string>> = {
  easy: 'Easy',
  medium: 'Medium',
  difficult: 'Difficult',
  extra: 'Extra',
};

/** Cumulative "clubs" (gate-set hint) available in each round — pedagogy only;
 *  the physical board cannot restrict tiles, so these are shown, not enforced. */
export const ROUND_CLUBS: Readonly<Record<GolfRound, readonly string[]>> = {
  easy: ['X', 'H', 'CX'],
  medium: ['X', 'H', 'CX', 'Y'],
  difficult: ['X', 'H', 'CX', 'Y', 'Z', 'S'],
  extra: ['X', 'H', 'CX', 'Y', 'Z', 'S', 'T', 'CH'],
};

export interface Hole {
  /** 1..18 — the hole number in play order. */
  readonly hole: number;
  readonly round: GolfRound;
  /** Number of qubits the target entangles (1..5). */
  readonly level: number;
  /** Alias of `level` (the entangled qubit count). */
  readonly qubits: number;
  readonly name: string;
  /** Short scorecard code, e.g. "E1", "M3", "X5". */
  readonly code: string;
  /** The view this hole renders on (1q → Bloch, else Q-sphere). */
  readonly view: GolfView;
  /** Display ket for the target state, e.g. "(|00⟩+|11⟩)/√2". */
  readonly targetKet: string;
  /** Kept for source compatibility with the former Level.target field. */
  readonly target: string;
  readonly par: number;
  /** The round's cumulative gate-set hint. */
  readonly clubs: readonly string[];
  /**
   * GENERATED holes only (the random course, #70): every target statevector
   * this hole accepts, one per placement. Fixed course holes leave it undefined
   * and are scored from the precomputed `TARGETS` table instead.
   */
  readonly targets?: readonly StateVector[];
  /** GENERATED holes only: the target built on qubits 0..k−1 (see `holeTargetState`). */
  readonly canonicalTarget?: StateVector;
  /**
   * A worked answer for this hole (#71) — a circuit that prepares the target,
   * drawn on request AFTER the hole is holed in ("Show solution"). It is par−2
   * long on the classic course (the minimum; see `holeSolution`) and the
   * generator itself on the random one, so it always beats par. Optional
   * because it is display data: nothing in the engine reads it, and a hole
   * without one simply offers no reveal.
   */
  readonly solution?: Circuit;
}

/**
 * A club list as `@qamposer/react` gate types. Only 'CX' needs translating —
 * the library spells the controlled-NOT 'CNOT'; every other club
 * ('X','H','Y','Z','S','T','CH') is already its library name.
 */
export function gateTypesForClubs(clubs: readonly string[]): GateType[] {
  return clubs.map((c) => (c === 'CX' ? 'CNOT' : c) as GateType);
}

/**
 * The clubs of `hole`'s round as `@qamposer/react` gate types — what the
 * on-screen gate palette offers while a golf hole is built by hand (task #55).
 * The physical board cannot restrict tiles, so on the table the clubs stay a
 * hint; on screen we hand out exactly the round's set, so the palette teaches
 * the round instead of every gate the library knows.
 */
export function clubGateTypes(hole: Hole): GateType[] {
  return gateTypesForClubs(hole.clubs);
}

// ---------------------------------------------------------------------------
// Target construction (custom statevectors per hole)
// ---------------------------------------------------------------------------

const R = Math.SQRT1_2;
const amp = (re: number, im = 0): Complex => ({ re, im });
/** ω = e^{iπ/4}; the T-phase on |1…1⟩ contributes ω·R = (½, ½). */
const OMEGA_R: Complex = { re: 0.5, im: 0.5 };
/** i·R for the S-phase (i-GHZ) targets. */
const I_R: Complex = { re: 0, im: R };

/** One basis term of a target: a bit pattern over the arrangement positions
 *  (leftmost = position 0 = first arrangement qubit) with its amplitude. */
interface Term {
  readonly bits: readonly number[];
  readonly amp: Complex;
}

/** A 32-amplitude all-zero vector. */
function zeroVec(): StateVector {
  const s: StateVector = new Array(DIM);
  for (let i = 0; i < DIM; i++) s[i] = amp(0);
  return s;
}

/** Place `terms` onto an ordered `arrangement` of physical qubits. Position `j`
 *  of each term maps to physical qubit `arrangement[j]` (little-endian bit). */
function buildTarget(arrangement: readonly number[], terms: readonly Term[]): StateVector {
  const s = zeroVec();
  for (const t of terms) {
    let idx = 0;
    for (let j = 0; j < arrangement.length; j++) if (t.bits[j]) idx |= 1 << arrangement[j];
    s[idx] = t.amp;
  }
  return s;
}

/** All size-`k` subsets of {0..NUM_QUBITS-1} (ascending). */
function subsets(k: number): number[][] {
  const out: number[][] = [];
  const choose = (start: number, acc: number[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let q = start; q < NUM_QUBITS; q++) {
      acc.push(q);
      choose(q + 1, acc);
      acc.pop();
    }
  };
  choose(0, []);
  return out;
}

/** All ORDERED k-arrangements of {0..NUM_QUBITS-1} (permutations of each subset). */
function arrangements(k: number): number[][] {
  const out: number[][] = [];
  const used = new Array(NUM_QUBITS).fill(false);
  const acc: number[] = [];
  const rec = () => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let q = 0; q < NUM_QUBITS; q++) {
      if (used[q]) continue;
      used[q] = true;
      acc.push(q);
      rec();
      acc.pop();
      used[q] = false;
    }
  };
  rec();
  return out;
}

const zeros = (k: number): number[] => new Array(k).fill(0);
const ones = (k: number): number[] => new Array(k).fill(1);

/** A GHZ-style target: |0…0⟩ with amplitude `a`, |1…1⟩ with amplitude `b`. */
function ghzTerms(k: number, a: Complex, b: Complex): Term[] {
  return [
    { bits: zeros(k), amp: a },
    { bits: ones(k), amp: b },
  ];
}

/** How a hole enumerates its target vectors over the 5-qubit board. */
interface TargetSpec {
  /** 'subset' for permutation-invariant targets, 'ordered' for asymmetric ones. */
  readonly placement: 'subset' | 'ordered';
  /** One or more term-lists; every list is placed on every placement. Multiple
   *  lists express a "family" (e.g. any single-flip GHZ variant). */
  readonly families: readonly (readonly Term[])[];
}

/** Build every target statevector for a spec across all valid placements. */
function buildTargets(k: number, spec: TargetSpec): StateVector[] {
  const places = spec.placement === 'ordered' ? arrangements(k) : subsets(k);
  const out: StateVector[] = [];
  for (const place of places) for (const terms of spec.families) out.push(buildTarget(place, terms));
  return out;
}

/** Below this probability an amplitude is not a term of a placed target. */
const TERM_EPS = 1e-12;

/**
 * Every ORDERED placement of an arbitrary `canonical` target (a state living on
 * qubits 0..k−1) across the 5-qubit board — the same machinery the Cascade hole
 * uses, opened up for the generated random course (#70). A generated target has
 * no symmetry to exploit, so like the Cascade it is matched against every
 * ordered k-arrangement: the answer can be built on ANY k wires in any order.
 */
export function orderedPlacements(k: number, canonical: StateVector): StateVector[] {
  const terms: Term[] = [];
  for (let i = 0; i < 1 << k; i++) {
    const a = canonical[i];
    if (a.re * a.re + a.im * a.im <= TERM_EPS) continue;
    const bits: number[] = [];
    // Position j of a term is arrangement qubit j, so it carries bit j of `i`.
    for (let j = 0; j < k; j++) bits.push((i >> j) & 1);
    terms.push({ bits, amp: a });
  }
  return buildTargets(k, { placement: 'ordered', families: [terms] });
}

// -- per-hole term families --------------------------------------------------

/** The single-flip GHZ family on k qubits: GHZ with EXACTLY one qubit disagreeing.
 *  One family entry per flipped position (leftmost = position 0). */
function flippedGhzFamilies(k: number): Term[][] {
  const fams: Term[][] = [];
  for (let f = 0; f < k; f++) {
    const a = zeros(k);
    const b = ones(k);
    a[f] = 1; // flip that position in the |0…0⟩ branch …
    b[f] = 0; // … and its complement in the |1…1⟩ branch.
    fams.push([
      { bits: a, amp: amp(R) },
      { bits: b, amp: amp(R) },
    ]);
  }
  return fams;
}

/** Cascade (√2|000⟩ + |100⟩ + |111⟩)/2 — leftmost = position 0. */
const CASCADE_TERMS: Term[] = [
  { bits: [0, 0, 0], amp: amp(R) }, // √2/2 = R
  { bits: [1, 0, 0], amp: amp(0.5) },
  { bits: [1, 1, 1], amp: amp(0.5) },
];

/** Ψ-plus (|01⟩ + |10⟩)/√2 — symmetric under swap, so a subset suffices. */
const PSI_PLUS_TERMS: Term[] = [
  { bits: [0, 1], amp: amp(R) },
  { bits: [1, 0], amp: amp(R) },
];

/** Target spec keyed by hole number. */
function holeSpec(hole: number, k: number): TargetSpec {
  switch (hole) {
    // EASY — GHZ family (symmetric).
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
      return { placement: 'subset', families: [ghzTerms(k, amp(R), amp(R))] };
    // MEDIUM.
    case 6: // M1 |1⟩
      return { placement: 'subset', families: [[{ bits: [1], amp: amp(1) }]] };
    case 7: // M2 Ψ-plus (symmetric under swap)
      return { placement: 'subset', families: [PSI_PLUS_TERMS] };
    case 8: // M3 flipped GHZ-3 family
    case 9: // M4 flipped GHZ-4 family
    case 10: // M5 flipped GHZ-5 family
      return { placement: 'subset', families: flippedGhzFamilies(k) };
    // DIFFICULT — relative-phase GHZ (symmetric).
    case 11: // D1 minus
      return { placement: 'subset', families: [[{ bits: [0], amp: amp(R) }, { bits: [1], amp: amp(-R) }]] };
    case 12: // D2 Φ-minus
      return { placement: 'subset', families: [ghzTerms(k, amp(R), amp(-R))] };
    case 13: // D3 i-GHZ-3
      return { placement: 'subset', families: [ghzTerms(k, amp(R), I_R)] };
    case 14: // D4 minus GHZ-4
      return { placement: 'subset', families: [ghzTerms(k, amp(R), amp(-R))] };
    case 15: // D5 i-GHZ-5
      return { placement: 'subset', families: [ghzTerms(k, amp(R), I_R)] };
    // EXTRA.
    case 16: // X1 magic-T
      return { placement: 'subset', families: [[{ bits: [0], amp: amp(R) }, { bits: [1], amp: OMEGA_R }]] };
    case 17: // X3 Cascade (asymmetric → ordered)
      return { placement: 'ordered', families: [CASCADE_TERMS] };
    case 18: // X5 golden GHZ (T-phase)
      return { placement: 'subset', families: [ghzTerms(k, amp(R), OMEGA_R)] };
    default:
      return { placement: 'subset', families: [ghzTerms(k, amp(R), amp(R))] };
  }
}

// ---------------------------------------------------------------------------
// Solutions — the worked answer offered after a hole-in (#71)
// ---------------------------------------------------------------------------

/**
 * One gate of a solution. `position` is the column it occupies, so the sequence
 * reads left to right exactly as it would sit on the board.
 */
function sg(type: GateType, position: number, extra: Partial<Gate>): Gate {
  return {
    id: `sol-${type}-${position}-${extra.qubit ?? extra.control ?? 0}`,
    type,
    position,
    ...extra,
  };
}

/** GHZ-k on q0..q(k−1): H on q0, then a fan of CNOTs out of q0. */
function ghzGates(k: number, base = 0): Gate[] {
  const gates: Gate[] = [sg('H', base, { qubit: 0 })];
  for (let t = 1; t < k; t++) gates.push(sg('CNOT', base + t, { control: 0, target: t }));
  return gates;
}

const solCircuit = (gates: Gate[]): Circuit => ({ qubits: NUM_QUBITS, gates });

/**
 * The reference answer for classic hole `n` — the MINIMAL preparation of its
 * target, i.e. exactly `par − 2` gates (#69 sets par at the minimum + 2), so a
 * player who fumbled to +4 can see the clean path.
 *
 * These are the course's own reference paths: they are what the pars were
 * derived from, and `golf.test.ts` asserts against this very data that each one
 * still holes in and still costs par − 2. The S/T holes use the native S/T
 * clubs; the printed tiles' RZ(π/2)/RZ(π/4) spelling holes in just as well
 * (`bestFidelity` applies both), it is simply not what we print.
 */
export function holeSolution(n: number): Circuit {
  switch (n) {
    // EASY — the GHZ family.
    case 1: // E1 superposition
      return solCircuit([sg('H', 0, { qubit: 0 })]);
    case 2: // E2 Bell
      return solCircuit(ghzGates(2));
    case 3: // E3 GHZ-3
      return solCircuit(ghzGates(3));
    case 4: // E4 GHZ-4
      return solCircuit(ghzGates(4));
    case 5: // E5 GHZ-5
      return solCircuit(ghzGates(5));
    // MEDIUM — bit-flip variants.
    case 6: // M1 |1⟩
      return solCircuit([sg('X', 0, { qubit: 0 })]);
    case 7: // M2 Ψ-plus = Bell + X
      return solCircuit([...ghzGates(2), sg('X', 2, { qubit: 0 })]);
    case 8: // M3 flipped GHZ-3 = GHZ-3 + X
      return solCircuit([...ghzGates(3), sg('X', 3, { qubit: 2 })]);
    case 9: // M4 flipped GHZ-4 = GHZ-4 + X
      return solCircuit([...ghzGates(4), sg('X', 4, { qubit: 3 })]);
    case 10: // M5 flipped GHZ-5 = GHZ-5 + X
      return solCircuit([...ghzGates(5), sg('X', 5, { qubit: 4 })]);
    // DIFFICULT — relative phase.
    case 11: // D1 minus = H·Z
      return solCircuit([sg('H', 0, { qubit: 0 }), sg('Z', 1, { qubit: 0 })]);
    case 12: // D2 Φ-minus = Bell + Z
      return solCircuit([...ghzGates(2), sg('Z', 2, { qubit: 0 })]);
    case 13: // D3 i-GHZ-3 = GHZ-3 + S
      return solCircuit([...ghzGates(3), sg('S', 3, { qubit: 0 })]);
    case 14: // D4 minus GHZ-4 = GHZ-4 + Z
      return solCircuit([...ghzGates(4), sg('Z', 4, { qubit: 0 })]);
    case 15: // D5 i-GHZ-5 = GHZ-5 + S
      return solCircuit([...ghzGates(5), sg('S', 5, { qubit: 0 })]);
    // EXTRA.
    case 16: // X1 magic-T = H·T
      return solCircuit([sg('H', 0, { qubit: 0 }), sg('T', 1, { qubit: 0 })]);
    case 17: // X3 Cascade = H q0; CH q0→q1; CX q1→q2
      return solCircuit([
        sg('H', 0, { qubit: 0 }),
        sg('CH', 1, { control: 0, target: 1 }),
        sg('CNOT', 2, { control: 1, target: 2 }),
      ]);
    case 18: // X5 golden GHZ = GHZ-5 + T
      return solCircuit([...ghzGates(5), sg('T', 5, { qubit: 0 })]);
    default:
      throw new Error(`no solution for hole ${n}`);
  }
}

// ---------------------------------------------------------------------------
// The course
// ---------------------------------------------------------------------------

interface HoleDef {
  round: GolfRound;
  qubits: number;
  name: string;
  targetKet: string;
  par: number;
}

const COURSE: readonly HoleDef[] = [
  // EASY
  { round: 'easy', qubits: 1, name: 'Superposition', targetKet: '(|0⟩+|1⟩)/√2', par: 3 },
  { round: 'easy', qubits: 2, name: 'Bell', targetKet: '(|00⟩+|11⟩)/√2', par: 4 },
  { round: 'easy', qubits: 3, name: 'GHZ-3', targetKet: '(|000⟩+|111⟩)/√2', par: 5 },
  { round: 'easy', qubits: 4, name: 'GHZ-4', targetKet: '(|0000⟩+|1111⟩)/√2', par: 6 },
  { round: 'easy', qubits: 5, name: 'GHZ-5', targetKet: '(|00000⟩+|11111⟩)/√2', par: 7 },
  // MEDIUM
  { round: 'medium', qubits: 1, name: 'Bit flip', targetKet: '|1⟩', par: 3 },
  { round: 'medium', qubits: 2, name: 'Ψ-plus', targetKet: '(|01⟩+|10⟩)/√2', par: 5 },
  { round: 'medium', qubits: 3, name: 'Flipped GHZ-3', targetKet: '(|001⟩+|110⟩)/√2', par: 6 },
  { round: 'medium', qubits: 4, name: 'Flipped GHZ-4', targetKet: '(|0001⟩+|1110⟩)/√2', par: 7 },
  { round: 'medium', qubits: 5, name: 'Flipped GHZ-5', targetKet: '(|00001⟩+|11110⟩)/√2', par: 8 },
  // DIFFICULT
  { round: 'difficult', qubits: 1, name: 'Minus', targetKet: '(|0⟩−|1⟩)/√2', par: 4 },
  { round: 'difficult', qubits: 2, name: 'Φ-minus', targetKet: '(|00⟩−|11⟩)/√2', par: 5 },
  { round: 'difficult', qubits: 3, name: 'i-GHZ-3', targetKet: '(|000⟩+i|111⟩)/√2', par: 6 },
  { round: 'difficult', qubits: 4, name: 'Minus GHZ-4', targetKet: '(|0000⟩−|1111⟩)/√2', par: 7 },
  { round: 'difficult', qubits: 5, name: 'i-GHZ-5', targetKet: '(|00000⟩+i|11111⟩)/√2', par: 8 },
  // EXTRA-HARD
  { round: 'extra', qubits: 1, name: 'Magic T', targetKet: '(|0⟩+ω|1⟩)/√2', par: 4 },
  { round: 'extra', qubits: 3, name: 'Cascade', targetKet: '(√2|000⟩+|100⟩+|111⟩)/2', par: 5 },
  { round: 'extra', qubits: 5, name: 'Golden GHZ', targetKet: '(|00000⟩+ω|11111⟩)/√2', par: 8 },
];

/**
 * The one-letter code of each round — the letter its holes are numbered with
 * (E1…, M1…, D1…, X1/X3/X5) and the letter the scorecard's chip strip labels
 * its rows with. Exported so those two can never disagree: deriving the row
 * label from `ROUND_LABEL` instead used to print the extra round as "E",
 * because "Extra" and "Easy" share an initial (#74).
 */
export const ROUND_CODE: Readonly<Record<GolfRound, string>> = {
  easy: 'E',
  medium: 'M',
  difficult: 'D',
  extra: 'X',
};

export const HOLES: readonly Hole[] = (() => {
  const counters: Record<GolfRound, number> = { easy: 0, medium: 0, difficult: 0, extra: 0 };
  return COURSE.map((d, i) => {
    counters[d.round] += 1;
    // The extra round is numbered by qubit count (X1/X3/X5); the rest sequentially.
    const code = ROUND_CODE[d.round] + (d.round === 'extra' ? d.qubits : counters[d.round]);
    return {
      hole: i + 1,
      round: d.round,
      level: d.qubits,
      qubits: d.qubits,
      name: d.name,
      code,
      view: d.qubits === 1 ? 'bloch' : 'qsphere',
      targetKet: d.targetKet,
      target: d.targetKet,
      par: d.par,
      clubs: ROUND_CLUBS[d.round],
      solution: holeSolution(i + 1),
    } as Hole;
  });
})();

// Precompute the target statevectors for every hole (keyed by hole number).
const TARGETS: Map<number, StateVector[]> = new Map(
  HOLES.map((h) => [h.hole, buildTargets(h.qubits, holeSpec(h.hole, h.qubits))]),
);

/** The hole's canonical target statevector (built on the lowest qubits) — the
 *  one the Q-sphere ghosts (#58) and the target outline are drawn from. Fidelity
 *  scoring still accepts every placement (see `bestFidelity`). */
export function holeTargetState(hole: Hole): StateVector {
  // Generated holes (random course) carry their own canonical target.
  if (hole.canonicalTarget) return hole.canonicalTarget;
  const spec = holeSpec(hole.hole, hole.qubits);
  return buildTarget(
    Array.from({ length: hole.qubits }, (_, i) => i),
    spec.families[0],
  );
}

/** The canonical target's nonzero basis indices (built on the lowest qubits),
 *  for the Q-sphere / Bloch "target" outline. */
export function holeHighlight(hole: Hole): Set<number> {
  const canonical = holeTargetState(hole);
  const out = new Set<number>();
  for (let i = 0; i < DIM; i++) {
    const a = canonical[i];
    if (a.re * a.re + a.im * a.im > 1e-9) out.add(i);
  }
  return out;
}

/**
 * Best fidelity of `circuit`'s state against a hole's target over every valid
 * placement (unordered subsets for symmetric targets, ordered arrangements for
 * asymmetric ones; a "family" hole tries each variant too).
 *
 * The D/X clubs S and T reach us either as native `S`/`T` gates (the on-screen
 * palette) or as RZ(π/2)/RZ(π/4) (the printed tiles 40/41 emit their RZ
 * equivalent). The engine applies both spellings; they differ by a GLOBAL phase
 * only, which fidelity ignores — so a hole holes in whichever tile was used.
 */
export function bestFidelity(circuit: Circuit, hole: Hole): number {
  const sv = statevector(circuit);
  // Generated holes (random course, #70) carry their own placement list; fixed
  // holes read the precomputed table, keyed by hole number.
  const targets = hole.targets ?? TARGETS.get(hole.hole) ?? [];
  let best = 0;
  for (const t of targets) {
    const f = fidelity(sv, t);
    if (f > best) best = f;
  }
  return best;
}

export interface Evaluation {
  readonly fidelity: number;
  /** Gates currently on the board. NOT the score — strokes are cumulative and
   *  live on `GolfState.strokes` (see `strokeDelta`). */
  readonly gateCount: number;
  readonly holedIn: boolean;
}

/** Evaluate a circuit against a hole: fidelity, gate count, hole-in flag. */
export function evaluate(circuit: Circuit, hole: Hole): Evaluation {
  const gateCount = circuit.gates.length;
  const f = gateCount === 0 ? 0 : bestFidelity(circuit, hole);
  return { fidelity: f, gateCount, holedIn: f >= HOLE_IN_THRESHOLD };
}

// ---------------------------------------------------------------------------
// Strokes — every add and every delete counts (#68)
// ---------------------------------------------------------------------------

/**
 * A gate's identity for stroke counting: what it IS and how it is WIRED, never
 * where it sits along the wire.
 *
 * `position` (the column) is deliberately excluded, so sliding a tile sideways
 * — or the editor auto-compacting the columns after a delete — is free, while
 * rewiring or retyping a gate reads as a remove **and** an add (2 strokes).
 * The rotation `parameter` is part of the identity: an RZ(π/2) tile and an
 * RZ(π/4) tile are different clubs (the printed S/T tiles emit exactly those).
 */
function gateKey(g: Gate): string {
  return [g.type, g.qubit, g.control, g.control2, g.target, g.parameter]
    .map((v) => (v === undefined ? '' : String(v)))
    .join('|');
}

/** Multiset of gate keys: key → how many identical gates the board carries. */
export type GateCounts = Readonly<Record<string, number>>;

/** The empty board's multiset — also the tee-off baseline for a fresh hole. */
const NO_GATES: GateCounts = {};

/** The gate multiset of a circuit (the baseline a later change is diffed against). */
function gateCounts(circuit: Circuit): GateCounts {
  const out: Record<string, number> = {};
  for (const g of circuit.gates) {
    const k = gateKey(g);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** adds + removes between two gate multisets. */
function countsDelta(prev: GateCounts, next: GateCounts): number {
  let delta = 0;
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    delta += Math.abs((next[k] ?? 0) - (prev[k] ?? 0));
  }
  return delta;
}

/**
 * Strokes charged for one circuit change: the multiset edit distance
 * (adds + removes) between two boards. Moving a gate to another column costs
 * 0; adding or deleting one costs 1; rewiring or retyping one costs 2.
 */
export function strokeDelta(prev: Circuit, next: Circuit): number {
  return countsDelta(gateCounts(prev), gateCounts(next));
}

/** How a completed hole scored, as a bare category — the scorecard colours its
 *  chips by this (#74), and `scoreName` writes it out for the holed-in line. */
export type ScoreKind = 'eagle' | 'birdie' | 'par' | 'over';

/** Classify a completed hole: strokes vs par. */
export function scoreKind(strokes: number, par: number): ScoreKind {
  if (strokes < par - 1) return 'eagle';
  if (strokes < par) return 'birdie';
  if (strokes === par) return 'par';
  return 'over';
}

/**
 * What a completed hole RECORDS (#99) — strokes, floored at double par if the
 * answer was revealed while the hole was still being played.
 *
 * The price of looking is deliberately a floor rather than a fistful of
 * strokes. Injecting +2×par and playing on would compound: a player who reveals
 * and then still fumbles ends near triple par, punished twice for the same
 * decision. A floor says exactly what was agreed — "this hole now scores at
 * least double par" — and leaves the stroke count itself an honest record of
 * what happened on the board (#68). A player who reveals and then plays a
 * shambles still records the shambles; one who reveals and plays it clean
 * records double par.
 *
 * The reveal AFTER holing in is free and never reaches here: the score is
 * already written, and reading the clean line afterwards is the pedagogy the
 * whole feature exists for (#71).
 */
export function holeScore(strokes: number, par: number, revealed: boolean): number {
  return revealed ? Math.max(strokes, 2 * par) : strokes;
}

/** Golf score name for a completed hole (strokes vs par). */
export function scoreName(strokes: number, par: number): string {
  switch (scoreKind(strokes, par)) {
    case 'eagle':
      return 'EAGLE';
    case 'birdie':
      return 'BIRDIE';
    case 'par':
      return 'PAR';
    default:
      return `HOLE IN +${strokes - par}`;
  }
}

// ---------------------------------------------------------------------------
// Course totals (running score vs par across completed holes)
// ---------------------------------------------------------------------------

export interface CourseTotals {
  /** Number of holes with a recorded best. */
  readonly completed: number;
  /** Total strokes across completed holes (their best). */
  readonly strokes: number;
  /** Total par of the completed holes. */
  readonly par: number;
  /** strokes − par (negative = under par). */
  readonly vsPar: number;
}

/** Total par of a course — `COURSE_PAR` for the fixed 18, summed for a
 *  generated one (whose pars are their generators' gate counts). */
export function coursePar(holes: readonly Hole[] = HOLES): number {
  return holes.reduce((s, h) => s + h.par, 0);
}

/** Running total across completed holes (those with a recorded best score).
 *  `holes` defaults to the fixed course; the random course passes its own. */
export function courseTotals(
  best: Readonly<Record<number, number>>,
  holes: readonly Hole[] = HOLES,
): CourseTotals {
  let completed = 0;
  let strokes = 0;
  let par = 0;
  for (const h of holes) {
    const b = best[h.hole];
    if (b === undefined) continue;
    completed += 1;
    strokes += b;
    par += h.par;
  }
  return { completed, strokes, par, vsPar: strokes - par };
}

/**
 * A duration as mm:ss (or h:mm:ss past an hour) — the course timer's format
 * (#83). Pure formatting, next to `formatVsPar`, so the ticking clock on the
 * card, the frozen time on the summary and the celebration copy are all typeset
 * by one function and cannot drift apart.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** How a finished round is celebrated (#80) — the tiers a course-end burst is
 *  scaled and worded by. */
export type CompletionTier = 'legendary' | 'under' | 'even' | 'over';

/** Under this vs-par a round stops being good and starts being a story. */
export const LEGENDARY_VS_PAR = -18;

export interface CompletionCelebration {
  readonly tier: CompletionTier;
  /** Multiplier on the celebration's particle budget — the burst should feel
   *  like the round did, not identical for a triumph and a slog. */
  readonly intensity: number;
  /** Banner copy, naming the result rather than just saying "well done". */
  readonly copy: string;
}

/**
 * The course-end celebration for a finished round (#80). Pure and display-free:
 * it decides tier, intensity and words from the score alone, and the two
 * drivers hand the result to the celebration machinery they already own.
 *
 * −18 is the legendary line because it is what playing every hole at the
 * minimum earns on the classic course (18 holes × 2 under a par of minimum + 2),
 * so it means "you found the best line, or something like it, all the way round".
 */
export function completionCelebration(
  vsPar: number,
  elapsedMs: number | null = null,
): CompletionCelebration {
  // The time is the other half of a result (#83): "12 under" says how well,
  // "in 12:34" says how it was earned, and together they are what one player
  // compares with another.
  const time = elapsedMs === null ? '' : ` in ${formatDuration(elapsedMs)}`;
  if (vsPar <= LEGENDARY_VS_PAR) {
    return {
      tier: 'legendary',
      intensity: 2,
      copy: `Legendary round — ${Math.abs(vsPar)} under par${time}!`,
    };
  }
  if (vsPar < 0) {
    return { tier: 'under', intensity: 1.5, copy: `${Math.abs(vsPar)} under par${time}!` };
  }
  if (vsPar === 0) {
    return { tier: 'even', intensity: 1, copy: `Even par — course complete${time}!` };
  }
  return {
    tier: 'over',
    intensity: 0.6,
    copy: `Course complete — ${formatVsPar(vsPar)}${time}.`,
  };
}

/** Format a vs-par delta golf-style: "E" (even), "+3", "−2". */
export function formatVsPar(vsPar: number): string {
  if (vsPar === 0) return 'E';
  return vsPar > 0 ? `+${vsPar}` : `−${Math.abs(vsPar)}`;
}

// --- state machine (pure) ---------------------------------------------------

/**
 * Which course is in play (#70).
 *
 *  - `'classic'` — the fixed 18 holes of `HOLES`; pars are the minimum stroke
 *    count + 2 (#69).
 *  - `'random'` — 18 GENERATED holes over the same round/level structure, whose
 *    targets come from random circuits built out of the round's clubs. Par is
 *    the generator's gate count, which already carries its own slack (a random
 *    generator is essentially never minimal), so no +2 is added.
 *
 * Generated holes are derived from `randomSeed` by `@quantum/golfRandom`; the
 * seed lives on the state so a session's course is stable across re-renders and
 * hole retries.
 */
export type GolfCourse = 'classic' | 'random';

export interface GolfState {
  /** Which course the hole indices refer to (`courseHoles` resolves it). */
  readonly course: GolfCourse;
  /** Base seed of the generated course; 0 (unused) on the classic course. */
  readonly randomSeed: number;
  /** 0-based index into the course's holes. */
  readonly levelIndex: number;
  /** Latched once the current hole is holed in; cleared by a board-clear advance. */
  readonly holedIn: boolean;
  /** True once hole 18 is cleared — the course is finished (a board-clear restarts). */
  readonly complete: boolean;
  /**
   * Best (lowest) holed-in stroke count per hole number (1..18). Still a plain
   * number per hole, exactly the shape pre-#68 builds wrote — an old save loads
   * and compares unchanged (it just recorded a gate count where we now record
   * cumulative strokes), so there is nothing to migrate.
   */
  readonly best: Readonly<Record<number, number>>;
  /**
   * Cumulative strokes on the hole in play: every add and every delete since
   * the hole was teed off. Reset to 0 only when the hole is LEFT — the advance
   * after a hole-in, the course-complete clear, and the post-course restart.
   * Sweeping the board mid-hole keeps counting (#73).
   */
  readonly strokes: number;
  /** Gate multiset of the last circuit seen — the baseline the next change is
   *  diffed against. Empty at tee-off (see the teardown rule on `golfStep`). */
  readonly gateKeys: GateCounts;
  /**
   * Holes whose answer was revealed while they were still being played (#99).
   * Sticky per hole and per course: the price is paid once, so closing and
   * reopening the drawing is free, and a replay of a hole you have already seen
   * the answer to still scores at least double par — otherwise the reveal would
   * be a free lesson followed by a free eagle.
   */
  readonly revealed: Readonly<Record<number, boolean>>;
}

/**
 * A fresh state teed off on hole 1. Defaults to the CLASSIC course; the random
 * course is entered by passing `('random', seed)` with an EMPTY `best` — a
 * generated course's scores are session-only and share no numbering with the
 * fixed one (see `persistsBest`).
 */
export function initialGolfState(
  best: Record<number, number> = {},
  course: GolfCourse = 'classic',
  randomSeed = 0,
  revealed: Record<number, boolean> = {},
): GolfState {
  return {
    course,
    randomSeed,
    levelIndex: 0,
    holedIn: false,
    complete: false,
    best,
    strokes: 0,
    gateKeys: NO_GATES,
    revealed,
  };
}

/**
 * Take the mid-hole reveal on `holeNumber` (#99) — the ONLY way the flag is
 * ever set, and the reason the price lives in the engine rather than in the
 * card's arithmetic: strokes and scores are the engine's business (#68, #73),
 * and a UI that could adjust a score is a UI that will eventually disagree with
 * a replay, a second surface, or itself.
 *
 * Idempotent and refusing: revealing a hole that is already latched holed-in
 * costs nothing (that reveal is the free pedagogy of #71), and revealing a hole
 * whose price is already paid changes nothing, so the card may call this on
 * every open of the drawer without counting anything twice.
 */
export function golfReveal(state: GolfState, holeNumber: number): GolfState {
  if (state.holedIn || state.complete) return state;
  if (state.revealed[holeNumber]) return state;
  return { ...state, revealed: { ...state.revealed, [holeNumber]: true } };
}

/**
 * May this state's best scores be written to `GOLF_HOLES_KEY`? Only the classic
 * course: a generated course's hole numbers mean something different on every
 * seed, so persisting them would corrupt the device's real card. Random rounds
 * are session-only by design.
 */
export function persistsBest(state: Pick<GolfState, 'course'>): boolean {
  return state.course === 'classic';
}

export interface GolfStep {
  readonly state: GolfState;
  readonly hole: Hole;
  readonly fidelity: number;
  readonly strokes: number;
  /**
   * What the hole RECORDS as it stands (#99): the stroke count, floored at
   * double par once the answer has been revealed mid-hole. Identical to
   * `strokes` on every hole nobody peeked at, which is almost all of them.
   */
  readonly score: number;
  readonly holedIn: boolean;
  /** True on the frame the current hole transitions into a hole-in. */
  readonly justHoledIn: boolean;
  /** True on the frame a board-clear advanced to the next hole. */
  readonly advanced: boolean;
  /** True on the frame hole 18's clear finished the course. */
  readonly justCompleted: boolean;
  /** True on the frame a board-clear restarted a finished course. */
  readonly restarted: boolean;
  /** True while the course is finished (the total-vs-par summary is shown). */
  readonly complete: boolean;
  /** Score name for the current completed hole (present while holed in). */
  readonly scoreName: string | null;
}

/**
 * Advance the golf state one circuit change. Pure: same (prev, circuit) → same
 * result. Progression is linear hole 1→18. A board-clear (0 gates) while the
 * hole is latched holed-in advances to the next hole; clearing after hole 18
 * marks the course complete; a board-clear on the complete screen restarts at
 * hole 1 (keeping best scores). A fresh hole-in latches and records the best.
 *
 * ## Strokes (#68)
 * Each change costs `strokeDelta(previous board, this board)` — adds + removes
 * — added to `state.strokes`, so deleting a wrong tile and retrying costs
 * strokes like real golf. Two rules keep that honest across both apps:
 *
 *  - **Ball in the hole, pencil down.** Once the hole is latched holed-in the
 *    count freezes: the score is already written, and lifting the tiles off the
 *    table to advance is not a stroke.
 *  - **Teardown never lands on the next hole.** The board-clear branches that
 *    LEAVE the hole — the post-hole-in advance, the course-complete clear and
 *    the post-course restart — reset `strokes` to 0 and the diff baseline
 *    `gateKeys` to the empty multiset. Since the baseline is empty, a stale tile
 *    the camera still sees (or that flickers back) can only ever be charged as
 *    an *add* — a leftover *removal* is arithmetically impossible. That makes
 *    the manual path (one `clear()` emit) and the camera path (tiles lifted one
 *    at a time, the last one triggering the advance) behave identically without
 *    any ordering assumption.
 *  - **Sweeping the board mid-hole is not a do-over (#73).** An empty board on a
 *    hole you have not holed in keeps its stroke count: the tiles you lifted
 *    were strokes, and starting the same hole over from scratch is a decision
 *    with a price, exactly as in golf. (This overrules #68's original "any empty
 *    board is a fresh tee-off", which let a stuck player wipe their card.) Only
 *    the baseline resets, and only because the board really is empty.
 *
 * The tile stabiliser upstream already hysteresis-filters the camera, so there
 * is no debouncing here: an occlusion that really removes and re-adds a gate
 * costs 2 strokes, because that is what happened on the table.
 *
 * ## Courses (#70)
 * `holes` is the course in play and defaults to the fixed `HOLES`, so every
 * existing caller is unchanged. A random-course caller passes
 * `courseHoles(prev)` from `@quantum/golfRandom` (which is where the generated
 * holes live, keeping this module free of a dependency on the generator).
 */
export function golfStep(
  prev: GolfState,
  circuit: Circuit,
  holes: readonly Hole[] = HOLES,
): GolfStep {
  const keys = gateCounts(circuit);

  // Course finished: a board-clear restarts; otherwise hold the summary.
  if (prev.complete) {
    if (circuit.gates.length === 0) {
      const state: GolfState = {
        ...prev,
        levelIndex: 0,
        holedIn: false,
        complete: false,
        best: prev.best,
        strokes: 0,
        gateKeys: NO_GATES,
        // A restart is a NEW round, so every mid-hole reveal is unpaid again
        // (#99). Bests are the record of what has been achieved and stay; the
        // prices are about the round being played.
        revealed: {},
      };
      return {
        state,
        hole: holes[0],
        fidelity: 0,
        strokes: 0,
        score: 0,
        holedIn: false,
        justHoledIn: false,
        advanced: false,
        justCompleted: false,
        restarted: true,
        complete: false,
        scoreName: null,
      };
    }
    // Tiles on the complete screen: no hole is in play, so nothing is charged;
    // we only carry the baseline so the restart below tees off from empty.
    return {
      state: { ...prev, gateKeys: keys },
      hole: holes[prev.levelIndex],
      fidelity: 0,
      strokes: 0,
      score: 0,
      holedIn: false,
      justHoledIn: false,
      advanced: false,
      justCompleted: false,
      restarted: false,
      complete: true,
      scoreName: null,
    };
  }

  const hole = holes[prev.levelIndex];
  const ev = evaluate(circuit, hole);
  // Ball in the hole, pencil down: once latched, teardown edits cost nothing.
  const strokes = prev.holedIn ? prev.strokes : prev.strokes + countsDelta(prev.gateKeys, keys);

  // Board cleared → advance / complete if the hole was done, else just reset.
  // Every branch tees the next hole off from zero strokes and an EMPTY baseline.
  if (ev.gateCount === 0) {
    if (prev.holedIn) {
      // Finished the last hole → the course is complete.
      if (prev.levelIndex >= holes.length - 1) {
        return {
          state: { ...prev, holedIn: false, complete: true, strokes: 0, gateKeys: NO_GATES },
          hole,
          fidelity: 0,
          strokes: 0,
          score: 0,
          holedIn: false,
          justHoledIn: false,
          advanced: false,
          justCompleted: true,
          restarted: false,
          complete: true,
          scoreName: null,
        };
      }
      const levelIndex = prev.levelIndex + 1;
      const nextHole = holes[levelIndex];
      const nextEv = evaluate(circuit, nextHole);
      return {
        state: { ...prev, levelIndex, holedIn: false, strokes: 0, gateKeys: NO_GATES },
        hole: nextHole,
        fidelity: nextEv.fidelity,
        strokes: 0,
        score: 0,
        holedIn: false,
        justHoledIn: false,
        advanced: true,
        justCompleted: false,
        restarted: false,
        complete: false,
        scoreName: null,
      };
    }
    // Swept the board without holing in (#73): NOT a fresh tee-off. Clearing
    // mid-hole is just another edit — one stroke per tile lifted, already
    // charged above — and the hole plays on from there. Only the baseline goes
    // empty, which it does anyway because the board IS empty.
    return {
      state: { ...prev, holedIn: false, strokes, gateKeys: NO_GATES },
      hole,
      fidelity: 0,
      strokes,
      score: holeScore(strokes, hole.par, prev.revealed[hole.hole] === true),
      holedIn: false,
      justHoledIn: false,
      advanced: false,
      justCompleted: false,
      restarted: false,
      complete: false,
      scoreName: null,
    };
  }

  // Fresh hole-in this frame. What is RECORDED is the hole's score, which is
  // the stroke count unless the answer was revealed mid-hole — then it is
  // floored at double par (#99). Everything downstream reads the record, so the
  // chips, the totals, the celebration tier and a shared result all see the
  // price with no special-casing anywhere.
  if (ev.holedIn && !prev.holedIn) {
    const best = { ...prev.best };
    const prevBest = best[hole.hole];
    const score = holeScore(strokes, hole.par, prev.revealed[hole.hole] === true);
    if (prevBest === undefined || score < prevBest) best[hole.hole] = score;
    return {
      state: { ...prev, holedIn: true, best, strokes, gateKeys: keys },
      hole,
      fidelity: ev.fidelity,
      strokes,
      score,
      holedIn: true,
      justHoledIn: true,
      advanced: false,
      justCompleted: false,
      restarted: false,
      complete: false,
      scoreName: scoreName(score, hole.par),
    };
  }

  // Steady state: keep the latch until the board is cleared.
  const holedIn = prev.holedIn;
  return {
    state: { ...prev, holedIn, strokes, gateKeys: keys },
    hole,
    fidelity: ev.fidelity,
    strokes,
    score: holeScore(strokes, hole.par, prev.revealed[hole.hole] === true),
    holedIn,
    justHoledIn: false,
    advanced: false,
    justCompleted: false,
    restarted: false,
    complete: false,
    scoreName: holedIn ? scoreName(prev.best[hole.hole] ?? strokes, hole.par) : null,
  };
}

// --- persistence ------------------------------------------------------------

type ReadableStorage = Pick<Storage, 'getItem'> &
  Partial<Pick<Storage, 'setItem' | 'removeItem'>>;

function parseRecord(raw: string): Record<number, number> {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(parsed)) {
    const id = Number(k);
    if (Number.isFinite(id) && typeof v === 'number' && Number.isFinite(v)) out[id] = v;
  }
  return out;
}

/**
 * Load per-hole best scores. Prefers the per-hole key; if only the legacy
 * per-LEVEL key is present, migrate it once (level N → hole N, i.e. E1..E5),
 * persist under the new key, and drop the old one.
 */
export function loadBest(storage?: ReadableStorage | null): Record<number, number> {
  if (!storage) return {};
  try {
    const rawHoles = storage.getItem(GOLF_HOLES_KEY);
    if (rawHoles) return parseRecord(rawHoles);
    const rawLegacy = storage.getItem(GOLF_STORAGE_KEY);
    if (rawLegacy) {
      const legacy = parseRecord(rawLegacy);
      const migrated: Record<number, number> = {};
      // Level 1..5 map to holes 1..5 (E1..E5) one-for-one.
      for (const [k, v] of Object.entries(legacy)) {
        const level = Number(k);
        if (level >= 1 && level <= 5) migrated[level] = v;
      }
      storage.setItem?.(GOLF_HOLES_KEY, JSON.stringify(migrated));
      storage.removeItem?.(GOLF_STORAGE_KEY);
      return migrated;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveBest(
  storage: (Pick<Storage, 'setItem'>) | null | undefined,
  best: Record<number, number>,
): void {
  if (!storage) return;
  try {
    storage.setItem(GOLF_HOLES_KEY, JSON.stringify(best));
  } catch {
    /* best-effort */
  }
}

/**
 * Which holes have already been paid for with a mid-hole reveal (#99).
 *
 * Persisted for the same reason the best scores are: the price is per hole, and
 * a refresh in the middle of a round must not offer a player a second reveal on
 * different terms from the first. Missing or corrupt storage reads as "nothing
 * revealed", which is the state a brand-new device is in anyway. Only the
 * classic course writes here (`persistsBest`): a generated hole 7 is a
 * different hole on every seed.
 */
export function loadRevealed(storage?: ReadableStorage | null): Record<number, boolean> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(GOLF_REVEALED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<number, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number(k);
      if (Number.isFinite(id) && v === true) out[id] = true;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveRevealed(
  storage: (Pick<Storage, 'setItem'>) | null | undefined,
  revealed: Readonly<Record<number, boolean>>,
): void {
  if (!storage) return;
  try {
    storage.setItem(GOLF_REVEALED_KEY, JSON.stringify(revealed));
  } catch {
    /* best-effort */
  }
}
