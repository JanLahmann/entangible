/**
 * Golf mode engine (MVP) — pure logic for "quantum mini-golf" (docs/pocket.md).
 *
 * Five holes: superposition (par 1), Bell (par 2), GHZ-3/4/5 (par 3/4/5). Each
 * hole's target is a maximally-entangled state over `k` qubits; we score the
 * player's live circuit by the *best* fidelity achievable over any `k`-qubit
 * subset (so the superposition hole accepts an H on any qubit, and a GHZ can be
 * built on any rows). "Strokes" = gates on the board. Hole-in at fidelity ≥
 * 0.99; clearing the board then advances to the next hole. Best-per-hole is
 * persisted to localStorage. All exported logic is pure and injectable.
 */
import type { Circuit } from '@qamposer/react';
import { fidelity, ghzState, statevector, NUM_QUBITS, type StateVector } from '@quantum/statevector';

export const HOLE_IN_THRESHOLD = 0.99;
export const GOLF_STORAGE_KEY = 'entangible.pocket.golf';

export interface Hole {
  readonly id: number;
  readonly name: string;
  /** Display ket for the target state, e.g. "(|00⟩+|11⟩)/√2". */
  readonly targetKet: string;
  readonly par: number;
  /** Number of qubits the target entangles (1 = plain superposition). */
  readonly k: number;
}

function ket(k: number): string {
  const zeros = '0'.repeat(k);
  const ones = '1'.repeat(k);
  return `(|${zeros}⟩+|${ones}⟩)/√2`;
}

export const HOLES: readonly Hole[] = [
  { id: 1, name: 'Superposition', targetKet: ket(1), par: 1, k: 1 },
  { id: 2, name: 'Bell', targetKet: ket(2), par: 2, k: 2 },
  { id: 3, name: 'GHZ-3', targetKet: ket(3), par: 3, k: 3 },
  { id: 4, name: 'GHZ-4', targetKet: ket(4), par: 4, k: 4 },
  { id: 5, name: 'GHZ-5', targetKet: ket(5), par: 5, k: 5 },
];

/** All size-`k` subsets of {0..NUM_QUBITS-1}. */
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

// Precompute target statevectors per hole size (k=1..5): the canonical
// maximally-entangled state on each k-qubit subset.
const TARGETS: Map<number, StateVector[]> = new Map(
  HOLES.map((h) => [h.k, subsets(h.k).map((s) => ghzState(s))]),
);

/**
 * Best fidelity of `circuit`'s state against a `k`-qubit maximally-entangled
 * target over any qubit subset. For k=1 this is superposition on any qubit.
 */
export function bestFidelity(circuit: Circuit, k: number): number {
  const sv = statevector(circuit);
  const targets = TARGETS.get(k) ?? subsets(k).map((s) => ghzState(s));
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
  const f = strokes === 0 ? 0 : bestFidelity(circuit, hole.k);
  return { fidelity: f, strokes, holedIn: f >= HOLE_IN_THRESHOLD };
}

/** Golf score name for a completed hole (strokes vs par). */
export function scoreName(strokes: number, par: number): string {
  if (strokes < par - 1) return 'EAGLE';
  if (strokes < par) return 'BIRDIE';
  if (strokes === par) return 'PAR';
  return `HOLE IN +${strokes - par}`;
}

// --- state machine (pure) ---------------------------------------------------

export interface GolfState {
  /** 0-based index into HOLES. */
  readonly holeIndex: number;
  /** Latched once the current hole is holed in; cleared only by a board-clear advance. */
  readonly holedIn: boolean;
  /** Best (lowest) holed-in stroke count per hole id. */
  readonly best: Readonly<Record<number, number>>;
}

export function initialGolfState(best: Record<number, number> = {}): GolfState {
  return { holeIndex: 0, holedIn: false, best };
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
  /** Score name for the current completed hole (present while holed in). */
  readonly scoreName: string | null;
}

/**
 * Advance the golf state one circuit change. Pure: same (prev, circuit) → same
 * result. Board-clear (0 gates) while the hole is latched holed-in advances to
 * the next hole (clamped at the last). A fresh hole-in latches and records the
 * best stroke count.
 */
export function golfStep(prev: GolfState, circuit: Circuit): GolfStep {
  const hole = HOLES[prev.holeIndex];
  const ev = evaluate(circuit, hole);

  // Board cleared → advance if the hole was completed, else just reset.
  if (ev.strokes === 0) {
    if (prev.holedIn) {
      const holeIndex = Math.min(prev.holeIndex + 1, HOLES.length - 1);
      const nextHole = HOLES[holeIndex];
      const nextEv = evaluate(circuit, nextHole);
      return {
        state: { holeIndex, holedIn: false, best: prev.best },
        hole: nextHole,
        fidelity: nextEv.fidelity,
        strokes: 0,
        holedIn: false,
        justHoledIn: false,
        advanced: true,
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
      scoreName: null,
    };
  }

  // Fresh hole-in this frame.
  if (ev.holedIn && !prev.holedIn) {
    const best = { ...prev.best };
    const prevBest = best[hole.id];
    if (prevBest === undefined || ev.strokes < prevBest) best[hole.id] = ev.strokes;
    return {
      state: { ...prev, holedIn: true, best },
      hole,
      fidelity: ev.fidelity,
      strokes: ev.strokes,
      holedIn: true,
      justHoledIn: true,
      advanced: false,
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
    scoreName: holedIn ? scoreName(prev.best[hole.id] ?? ev.strokes, hole.par) : null,
  };
}

// --- persistence ------------------------------------------------------------

export function loadBest(
  storage?: Pick<Storage, 'getItem'> | null,
): Record<number, number> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(GOLF_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const id = Number(k);
      if (Number.isFinite(id) && typeof v === 'number' && Number.isFinite(v)) out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveBest(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  best: Record<number, number>,
): void {
  if (!storage) return;
  try {
    storage.setItem(GOLF_STORAGE_KEY, JSON.stringify(best));
  } catch {
    /* best-effort */
  }
}
