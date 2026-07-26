/**
 * Optimal solution search (#72) — "is there a SHORTER way to build this?"
 *
 * Quantum Golf hands every hole a stored solution (#71): the reference path on
 * the classic course, the generator on the random one. Neither is claimed to be
 * minimal — a random generator in particular wastes gates on cancellations and
 * phases fidelity ignores, so its "answer" can be two or three gates longer than
 * it needs to be. This module goes and looks for a shorter one.
 *
 * ## The search
 * A forward breadth-first search from |0…0⟩ over the hole's own clubs, on its
 * own wires (singles on each qubit 0..k−1, controlled clubs on each ORDERED
 * pair), stopping at the first depth that contains a state clearing the hole
 * (fidelity ≥ `HOLE_IN_THRESHOLD` against the target — already global-phase
 * invariant). Breadth-first is what makes the answer minimal: every state at
 * depth d was first reached in d gates.
 *
 * States, not circuits, are deduplicated, and they are deduplicated up to GLOBAL
 * PHASE: `canonicalKey` rotates the first significant amplitude real-positive
 * and rounds to `KEY_SCALE`, so the S tile and its RZ(π/2) spelling — which
 * differ by a global phase only — collapse to one node, exactly as they do for
 * scoring. Without that the frontier would carry many copies of every state and
 * the budget would be spent on phases nobody can see.
 *
 * ## Why it always terminates quickly enough
 * Two bounds, both required:
 *
 *  - `maxDepth` defaults to `stored.length − 1`. We only care whether something
 *    SHORTER exists, so the search never explores as deep as the answer we
 *    already have. On the classic course, where the reference paths really are
 *    minimal, this makes the usual outcome ("nothing shorter") cheap.
 *  - `stateBudget` caps the deduplicated states visited. The wide holes (five
 *    wires, eight clubs, a seven-gate generator) have a frontier that grows by
 *    ~70× per depth and would never finish; they hit the budget instead and
 *    report `'unknown'`, and the card simply shows no optimal. Budget exhaustion
 *    is a normal outcome, not an error.
 *
 * The three outcomes are distinguished on purpose (`OptimalResult`): "found
 * something shorter", "proved nothing shorter exists", and "ran out of budget"
 * are three different things to say to a player, and only the middle one lets
 * the card call the stored solution optimal.
 *
 * ## Cooperative, not blocking
 * The core is a generator that yields its progress, so the same search can be
 * drained synchronously (`findOptimal`, for tests and tooling) or chunk by chunk
 * across macrotasks (`findOptimalAsync`), which is what the scorecard uses: a
 * phone must keep painting while a wide hole burns through its budget.
 *
 * Pure throughout — no DOM, no React, no time source. Gate matrices come from
 * `statevector`, the declared single source of gate definitions; nothing here
 * defines a unitary of its own.
 */
import type { Gate, GateType } from '@qamposer/react';
import { HOLE_IN_THRESHOLD } from './golf';
import {
  applyGatesTo,
  controlledTargetOp,
  fidelity,
  zeroState,
  DIM,
  type StateVector,
} from './statevector';

/** Deduplicated states a search may visit before giving up (see the header). */
export const DEFAULT_STATE_BUDGET = 300_000;
/** Children expanded per macrotask in `findOptimalAsync` — the UI-liveness dial. */
export const CHUNK_CHILDREN = 20_000;

/** Below this probability an amplitude is not part of a state's identity. */
const KEY_EPS = 1e-9;
/** Amplitudes are keyed to ~1e-6, comfortably finer than the 0.99 hole-in gate. */
const KEY_SCALE = 1e6;

/**
 * What a search concluded.
 *
 *  - `shorter` — a strictly shorter answer exists, and here it is.
 *  - `minimal` — every path shorter than the stored solution was explored and
 *    none holes in: the stored solution is optimal.
 *  - `unknown` — the budget ran out first. Says nothing either way.
 */
export type OptimalResult =
  | { readonly status: 'shorter'; readonly gates: Gate[] }
  | { readonly status: 'minimal' }
  | { readonly status: 'unknown' };

export interface OptimalOptions {
  /** Deepest circuit to consider. Callers pass `stored.length − 1`. */
  readonly maxDepth?: number;
  /** Deduplicated states to visit before reporting `'unknown'`. */
  readonly stateBudget?: number;
}

/**
 * The moves available on a hole: every club on every wire it could act on —
 * singles on each qubit 0..k−1, controlled clubs on each ORDERED pair (control
 * and target are not interchangeable). Returned as real `Gate`s so the search
 * evolves states through the ordinary `applyGatesTo` path and the winning path
 * needs no translation to be drawn.
 *
 * `CCX` is skipped: it needs a second control, no round's clubs offer it, and a
 * malformed two-wire Toffoli would silently no-op inside the simulator.
 */
export function movesFor(clubs: readonly GateType[], k: number): Gate[] {
  const moves: Gate[] = [];
  const add = (g: Omit<Gate, 'id'>) => moves.push({ id: `m${moves.length}`, ...g } as Gate);
  for (const type of clubs) {
    if (type === 'CCX') continue;
    if (controlledTargetOp(type)) {
      if (k < 2) continue; // a control needs a second wire
      for (let c = 0; c < k; c++) {
        for (let t = 0; t < k; t++) {
          if (c !== t) add({ type, position: 0, control: c, target: t });
        }
      }
    } else {
      for (let q = 0; q < k; q++) add({ type, position: 0, qubit: q });
    }
  }
  return moves;
}

/**
 * A state's identity, canonical under GLOBAL PHASE: the first significant
 * amplitude is rotated real-positive, then every populated amplitude is written
 * as `index:re:im` rounded to `KEY_SCALE`. Two states that differ only by an
 * overall phase — S vs RZ(π/2), T vs RZ(π/4), a Z on a wire nothing else
 * touches — produce the same key, which is exactly how fidelity scores them.
 *
 * Rounding at 1e-6 can in principle split two states that agree to 1e-16 but sit
 * on a rounding boundary. The cost of that is one duplicate node, never a wrong
 * answer: the search is still breadth-first and still checks fidelity per state.
 */
export function canonicalKey(state: StateVector): string {
  // Undo the global phase of the first significant amplitude (multiply by its
  // conjugate over its modulus, so that amplitude becomes real and positive).
  let px = 1;
  let py = 0;
  for (let i = 0; i < DIM; i++) {
    const a = state[i];
    const m2 = a.re * a.re + a.im * a.im;
    if (m2 > KEY_EPS) {
      const m = Math.sqrt(m2);
      px = a.re / m;
      py = -a.im / m;
      break;
    }
  }
  let key = '';
  for (let i = 0; i < DIM; i++) {
    const a = state[i];
    if (a.re * a.re + a.im * a.im <= KEY_EPS) continue;
    const re = Math.round((a.re * px - a.im * py) * KEY_SCALE);
    const im = Math.round((a.re * py + a.im * px) * KEY_SCALE);
    // Base 36, and a real amplitude drops its imaginary half entirely. The keys
    // ARE the search's memory footprint — one string per visited state, held for
    // the whole search — so this is not cosmetic: it is ~2.5× less heap at the
    // budget, measured, and phase-free rounds (E/M) win the most.
    key += im === 0
      ? `${i.toString(36)}:${re.toString(36)};`
      : `${i.toString(36)}:${re.toString(36)}:${im.toString(36)};`;
  }
  return key;
}

/**
 * A node's path back to |0…0⟩ — the gate that reached it, plus its parent.
 *
 * The frontier stores ONLY these, never the 32 amplitudes they evolve to: a
 * state is re-derived from its trail when the node is expanded. Two pointers per
 * node instead of a 32-amplitude vector is the difference between ~60 MB and
 * ~640 MB at the default budget (measured), which is the difference between
 * running on a phone and not. It costs one extra `applyGatesTo` per expanded
 * node — `depth` gate applications against the ~70 the expansion itself does,
 * so under 10%.
 */
interface Trail {
  readonly gate: Gate;
  readonly parent: Trail | null;
}

/** A trail as a drawable circuit: gates in order, at columns 0..n−1. */
function pathOf(trail: Trail | null): Gate[] {
  const back: Gate[] = [];
  for (let t = trail; t; t = t.parent) back.push(t.gate);
  back.reverse();
  return back.map((g, i) => ({ ...g, id: `opt${i}-${g.type}`, position: i }));
}

/**
 * The search itself, as a cooperative generator: it yields the number of
 * children expanded so far roughly every `CHUNK_CHILDREN`, and returns the
 * `OptimalResult`. Callers choose whether to drain it in one go (`findOptimal`)
 * or across macrotasks (`findOptimalAsync`).
 */
export function* optimalSearch(
  target: StateVector,
  clubs: readonly GateType[],
  k: number,
  opts: OptimalOptions = {},
): Generator<number, OptimalResult, void> {
  const maxDepth = opts.maxDepth ?? Number.POSITIVE_INFINITY;
  const budget = opts.stateBudget ?? DEFAULT_STATE_BUDGET;
  // A 1-gate stored solution leaves nothing shorter to look for but the empty
  // circuit, and an empty board never holes in (no hole targets |0…0⟩).
  if (maxDepth < 1) return { status: 'minimal' };

  const moves = movesFor(clubs, k);
  const start = zeroState();
  let frontier: (Trail | null)[] = [null]; // the root is the empty trail
  const seen = new Set<string>([canonicalKey(start)]);
  let visited = 1;
  let expanded = 0;
  let sinceYield = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: (Trail | null)[] = [];
    for (const node of frontier) {
      // Re-derive this node's state from its path (see `Trail`).
      const from = node === null ? start : applyGatesTo(start, pathOf(node));
      for (const move of moves) {
        const state = applyGatesTo(from, [move]);
        expanded += 1;
        sinceYield += 1;
        const key = canonicalKey(state);
        if (seen.has(key)) continue;
        seen.add(key);
        visited += 1;
        const trail: Trail = { gate: move, parent: node };
        // Breadth-first: the first hit at this depth is a shortest answer.
        if (fidelity(state, target) >= HOLE_IN_THRESHOLD) {
          return { status: 'shorter', gates: pathOf(trail) };
        }
        if (visited > budget) return { status: 'unknown' };
        next.push(trail);
      }
      if (sinceYield >= CHUNK_CHILDREN) {
        sinceYield = 0;
        yield expanded;
      }
    }
    // The reachable set is closed: no deeper circuit can reach anything new.
    if (next.length === 0) return { status: 'minimal' };
    frontier = next;
  }
  return { status: 'minimal' };
}

/**
 * Everything a club set can build on `k` wires within `maxDepth` gates, as
 * canonical state key → fewest gates that reach it (#77).
 *
 * The mirror image of `optimalSearch`: instead of asking "how short is THIS
 * target", it enumerates the whole bounded orbit once, so a caller can then ask
 * the question of thousands of candidate targets for the price of a map lookup.
 * That is what makes "does this hole actually need its round's newest club?"
 * affordable inside the random generator's draw loop, where the alternative —
 * one search per candidate — costs more than the draw itself.
 *
 * `complete` is the part that matters for soundness. A budget-capped BFS proves
 * reachability (the key is there) but never proves UNreachability, so absence
 * from `depthOf` may only be read as "not reachable within maxDepth" when the
 * enumeration closed out on its own.
 */
export interface ReachMap {
  /** Canonical state key → the fewest gates of this club set that build it. */
  readonly depthOf: ReadonlyMap<string, number>;
  /** True when the orbit was enumerated to exhaustion inside the budget, so an
   *  absent key really is unreachable within `maxDepth`. */
  readonly complete: boolean;
}

export function reachableWithin(
  clubs: readonly GateType[],
  k: number,
  maxDepth: number,
  opts: Pick<OptimalOptions, 'stateBudget'> = {},
): ReachMap {
  const budget = opts.stateBudget ?? DEFAULT_STATE_BUDGET;
  const moves = movesFor(clubs, k);
  const start = zeroState();
  const depthOf = new Map<string, number>([[canonicalKey(start), 0]]);
  let frontier: StateVector[] = [start];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: StateVector[] = [];
    for (const from of frontier) {
      for (const move of moves) {
        const state = applyGatesTo(from, [move]);
        const key = canonicalKey(state);
        if (depthOf.has(key)) continue;
        depthOf.set(key, depth);
        if (depthOf.size > budget) return { depthOf, complete: false };
        next.push(state);
      }
    }
    // The orbit closed: deeper circuits cannot reach anything new, so the map
    // is final however much `maxDepth` was left.
    if (next.length === 0) return { depthOf, complete: true };
    frontier = next;
  }
  return { depthOf, complete: true };
}

/**
 * Search to completion, synchronously. The shortest gate sequence that holes in
 * within `maxDepth`, or `null` if none exists there or the budget ran out. Use
 * `optimalSearch` directly when those two nulls must be told apart.
 */
export function findOptimal(
  target: StateVector,
  clubs: readonly GateType[],
  k: number,
  opts: OptimalOptions = {},
): Gate[] | null {
  const it = optimalSearch(target, clubs, k, opts);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value.status === 'shorter' ? step.value.gates : null;
}

/**
 * The same search, spread across macrotasks so the page keeps painting. Every
 * `CHUNK_CHILDREN` expansions it hands the thread back via `setTimeout(0)` — a
 * MACROtask, deliberately: a microtask (`Promise.resolve()`) would starve
 * rendering just as thoroughly as a blocking loop.
 */
export async function findOptimalAsync(
  target: StateVector,
  clubs: readonly GateType[],
  k: number,
  opts: OptimalOptions = {},
): Promise<OptimalResult> {
  const it = optimalSearch(target, clubs, k, opts);
  let step = it.next();
  while (!step.done) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    step = it.next();
  }
  return step.value;
}
