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
 * any order. "Strokes" = gates on the board. Hole-in at fidelity ≥ 0.99;
 * clearing the board then advances to the next hole (after hole 18 the course
 * completes, then a board-clear restarts). Best-per-hole is optionally persisted
 * through an injectable Storage (pocket uses localStorage; the booth keeps it in
 * memory). All exported logic is pure and injectable.
 *
 * Bit convention: leftmost ket bit = first arrangement qubit, matching
 * shared/display/outcomes.ts. Internally targets live in the little-endian
 * statevector basis (index i has qubit q set when (i >> q) & 1).
 */
import type { Circuit } from '@qamposer/react';
import { fidelity, statevector, DIM, NUM_QUBITS, type Complex, type StateVector } from './statevector';

export const HOLE_IN_THRESHOLD = 0.99;
/** Legacy per-LEVEL best key (the original 5-level course). Read once, migrated. */
export const GOLF_STORAGE_KEY = 'entangible.pocket.golf';
/** Per-HOLE best key (the 18-hole course; keyed by hole number 1..18). */
export const GOLF_HOLES_KEY = 'entangible.pocket.golf.holes';

/** Which view a hole plays on (1-qubit holes on the Bloch sphere, else Q-sphere). */
export type GolfView = 'bloch' | 'qsphere';
/** The four course rounds, in play order. */
export type GolfRound = 'easy' | 'medium' | 'difficult' | 'extra';

/** Full par of the course (E 15 + M 19 + D 20 + X 11). */
export const COURSE_PAR = 65;

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
  { round: 'easy', qubits: 1, name: 'Superposition', targetKet: '(|0⟩+|1⟩)/√2', par: 1 },
  { round: 'easy', qubits: 2, name: 'Bell', targetKet: '(|00⟩+|11⟩)/√2', par: 2 },
  { round: 'easy', qubits: 3, name: 'GHZ-3', targetKet: '(|000⟩+|111⟩)/√2', par: 3 },
  { round: 'easy', qubits: 4, name: 'GHZ-4', targetKet: '(|0000⟩+|1111⟩)/√2', par: 4 },
  { round: 'easy', qubits: 5, name: 'GHZ-5', targetKet: '(|00000⟩+|11111⟩)/√2', par: 5 },
  // MEDIUM
  { round: 'medium', qubits: 1, name: 'Bit flip', targetKet: '|1⟩', par: 1 },
  { round: 'medium', qubits: 2, name: 'Ψ-plus', targetKet: '(|01⟩+|10⟩)/√2', par: 3 },
  { round: 'medium', qubits: 3, name: 'Flipped GHZ-3', targetKet: '(|001⟩+|110⟩)/√2', par: 4 },
  { round: 'medium', qubits: 4, name: 'Flipped GHZ-4', targetKet: '(|0001⟩+|1110⟩)/√2', par: 5 },
  { round: 'medium', qubits: 5, name: 'Flipped GHZ-5', targetKet: '(|00001⟩+|11110⟩)/√2', par: 6 },
  // DIFFICULT
  { round: 'difficult', qubits: 1, name: 'Minus', targetKet: '(|0⟩−|1⟩)/√2', par: 2 },
  { round: 'difficult', qubits: 2, name: 'Φ-minus', targetKet: '(|00⟩−|11⟩)/√2', par: 3 },
  { round: 'difficult', qubits: 3, name: 'i-GHZ-3', targetKet: '(|000⟩+i|111⟩)/√2', par: 4 },
  { round: 'difficult', qubits: 4, name: 'Minus GHZ-4', targetKet: '(|0000⟩−|1111⟩)/√2', par: 5 },
  { round: 'difficult', qubits: 5, name: 'i-GHZ-5', targetKet: '(|00000⟩+i|11111⟩)/√2', par: 6 },
  // EXTRA-HARD
  { round: 'extra', qubits: 1, name: 'Magic T', targetKet: '(|0⟩+ω|1⟩)/√2', par: 2 },
  { round: 'extra', qubits: 3, name: 'Cascade', targetKet: '(√2|000⟩+|100⟩+|111⟩)/2', par: 3 },
  { round: 'extra', qubits: 5, name: 'Golden GHZ', targetKet: '(|00000⟩+ω|11111⟩)/√2', par: 6 },
];

const ROUND_INITIAL: Readonly<Record<GolfRound, string>> = {
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
    const code = ROUND_INITIAL[d.round] + (d.round === 'extra' ? d.qubits : counters[d.round]);
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
    } as Hole;
  });
})();

// Precompute the target statevectors for every hole (keyed by hole number).
const TARGETS: Map<number, StateVector[]> = new Map(
  HOLES.map((h) => [h.hole, buildTargets(h.qubits, holeSpec(h.hole, h.qubits))]),
);

/** The canonical target's nonzero basis indices (built on the lowest qubits),
 *  for the Q-sphere / Bloch "target" outline. */
export function holeHighlight(hole: Hole): Set<number> {
  const spec = holeSpec(hole.hole, hole.qubits);
  const canonical = buildTarget(
    Array.from({ length: hole.qubits }, (_, i) => i),
    spec.families[0],
  );
  const out = new Set<number>();
  for (let i = 0; i < DIM; i++) {
    const a = canonical[i];
    if (a.re * a.re + a.im * a.im > 1e-9) out.add(i);
  }
  return out;
}

/**
 * The statevector engine (shared/quantum/statevector.ts, read-only) natively
 * applies H/X/Y/Z/RX/RY/RZ and the controlled gates, but NOT the standalone
 * phase tiles S (marker 40) and T (marker 41). Those are exactly the D/X "clubs".
 * S ≡ RZ(π/2) and T ≡ RZ(π/4) up to a GLOBAL phase — which fidelity ignores — so
 * we rewrite them to the equivalent RZ rotation before simulating. This lets a
 * hole be solved with either the dedicated S/T tile or the RZ(π/2)/RZ(π/4) tile.
 */
function normalizeForGolf(circuit: Circuit): Circuit {
  let changed = false;
  const gates = circuit.gates.map((g) => {
    const t = g.type as string;
    if (t === 'S' || t === 'T') {
      changed = true;
      return { ...g, type: 'RZ', parameter: t === 'S' ? Math.PI / 2 : Math.PI / 4 } as typeof g;
    }
    return g;
  });
  return changed ? { ...circuit, gates } : circuit;
}

/**
 * Best fidelity of `circuit`'s state against a hole's target over every valid
 * placement (unordered subsets for symmetric targets, ordered arrangements for
 * asymmetric ones; a "family" hole tries each variant too).
 */
export function bestFidelity(circuit: Circuit, hole: Hole): number {
  const sv = statevector(normalizeForGolf(circuit));
  const targets = TARGETS.get(hole.hole) ?? [];
  let best = 0;
  for (const t of targets) {
    const f = fidelity(sv, t);
    if (f > best) best = f;
  }
  return best;
}

export interface Evaluation {
  readonly fidelity: number;
  readonly strokes: number;
  readonly holedIn: boolean;
}

/** Evaluate a circuit against a hole: fidelity, stroke count, hole-in flag. */
export function evaluate(circuit: Circuit, hole: Hole): Evaluation {
  const strokes = circuit.gates.length;
  const f = strokes === 0 ? 0 : bestFidelity(circuit, hole);
  return { fidelity: f, strokes, holedIn: f >= HOLE_IN_THRESHOLD };
}

/** Golf score name for a completed hole (strokes vs par). */
export function scoreName(strokes: number, par: number): string {
  if (strokes < par - 1) return 'EAGLE';
  if (strokes < par) return 'BIRDIE';
  if (strokes === par) return 'PAR';
  return `HOLE IN +${strokes - par}`;
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

/** Running total across completed holes (those with a recorded best score). */
export function courseTotals(best: Readonly<Record<number, number>>): CourseTotals {
  let completed = 0;
  let strokes = 0;
  let par = 0;
  for (const h of HOLES) {
    const b = best[h.hole];
    if (b === undefined) continue;
    completed += 1;
    strokes += b;
    par += h.par;
  }
  return { completed, strokes, par, vsPar: strokes - par };
}

/** Format a vs-par delta golf-style: "E" (even), "+3", "−2". */
export function formatVsPar(vsPar: number): string {
  if (vsPar === 0) return 'E';
  return vsPar > 0 ? `+${vsPar}` : `−${Math.abs(vsPar)}`;
}

// --- state machine (pure) ---------------------------------------------------

export interface GolfState {
  /** 0-based index into HOLES. */
  readonly levelIndex: number;
  /** Latched once the current hole is holed in; cleared by a board-clear advance. */
  readonly holedIn: boolean;
  /** True once hole 18 is cleared — the course is finished (a board-clear restarts). */
  readonly complete: boolean;
  /** Best (lowest) holed-in stroke count per hole number (1..18). */
  readonly best: Readonly<Record<number, number>>;
}

export function initialGolfState(best: Record<number, number> = {}): GolfState {
  return { levelIndex: 0, holedIn: false, complete: false, best };
}

export interface GolfStep {
  readonly state: GolfState;
  readonly hole: Hole;
  readonly fidelity: number;
  readonly strokes: number;
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
 */
export function golfStep(prev: GolfState, circuit: Circuit): GolfStep {
  // Course finished: a board-clear restarts; otherwise hold the summary.
  if (prev.complete) {
    if (circuit.gates.length === 0) {
      const state: GolfState = { levelIndex: 0, holedIn: false, complete: false, best: prev.best };
      return {
        state,
        hole: HOLES[0],
        fidelity: 0,
        strokes: 0,
        holedIn: false,
        justHoledIn: false,
        advanced: false,
        justCompleted: false,
        restarted: true,
        complete: false,
        scoreName: null,
      };
    }
    return {
      state: prev,
      hole: HOLES[prev.levelIndex],
      fidelity: 0,
      strokes: circuit.gates.length,
      holedIn: false,
      justHoledIn: false,
      advanced: false,
      justCompleted: false,
      restarted: false,
      complete: true,
      scoreName: null,
    };
  }

  const hole = HOLES[prev.levelIndex];
  const ev = evaluate(circuit, hole);

  // Board cleared → advance / complete if the hole was done, else just reset.
  if (ev.strokes === 0) {
    if (prev.holedIn) {
      // Finished the last hole → the course is complete.
      if (prev.levelIndex >= HOLES.length - 1) {
        return {
          state: { ...prev, holedIn: false, complete: true },
          hole,
          fidelity: 0,
          strokes: 0,
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
      const nextHole = HOLES[levelIndex];
      const nextEv = evaluate(circuit, nextHole);
      return {
        state: { ...prev, levelIndex, holedIn: false },
        hole: nextHole,
        fidelity: nextEv.fidelity,
        strokes: 0,
        holedIn: false,
        justHoledIn: false,
        advanced: true,
        justCompleted: false,
        restarted: false,
        complete: false,
        scoreName: null,
      };
    }
    return {
      state: { ...prev, holedIn: false },
      hole,
      fidelity: 0,
      strokes: 0,
      holedIn: false,
      justHoledIn: false,
      advanced: false,
      justCompleted: false,
      restarted: false,
      complete: false,
      scoreName: null,
    };
  }

  // Fresh hole-in this frame.
  if (ev.holedIn && !prev.holedIn) {
    const best = { ...prev.best };
    const prevBest = best[hole.hole];
    if (prevBest === undefined || ev.strokes < prevBest) best[hole.hole] = ev.strokes;
    return {
      state: { ...prev, holedIn: true, best },
      hole,
      fidelity: ev.fidelity,
      strokes: ev.strokes,
      holedIn: true,
      justHoledIn: true,
      advanced: false,
      justCompleted: false,
      restarted: false,
      complete: false,
      scoreName: scoreName(ev.strokes, hole.par),
    };
  }

  // Steady state: keep the latch until the board is cleared.
  const holedIn = prev.holedIn;
  return {
    state: { ...prev, holedIn },
    hole,
    fidelity: ev.fidelity,
    strokes: ev.strokes,
    holedIn,
    justHoledIn: false,
    advanced: false,
    justCompleted: false,
    restarted: false,
    complete: false,
    scoreName: holedIn ? scoreName(prev.best[hole.hole] ?? ev.strokes, hole.par) : null,
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
