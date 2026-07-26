/**
 * Qubit-wire blocks (task #95) — the qubit count comes off the table.
 * EXACT port of `wires.py`.
 *
 * Marker ID 46 (`QUBIT_WIRE_ID`) is board furniture, not a gate: up to five
 * *identical* blocks sit along the board's left edge between the UL and LL
 * corner blocks, and each one declares a qubit wire at its own vertical
 * position. Sorted top-down they become q0…qn−1, the emitted circuit has
 * exactly that many qubits, and gate tiles snap to the nearest wire instead of
 * a fixed lattice row. No blocks on the table = the classic behaviour (the
 * model's own rows).
 *
 * {@link wirePositions} decides which detected ID-46 markers count as wires
 * (they have to be *left of* the grid, in board mm); {@link WireStabilizer}
 * applies the same asymmetric hysteresis the tile stabilizer uses to the wire
 * SET, so a hand crossing the left edge cannot resize the circuit frame by
 * frame. Growing the set takes `appearMin` of the last `appearWindow` frames;
 * shrinking it (including losing the last block, which falls back to the
 * classic rows) takes `disappearAfter` CONSECUTIVE frames. While the count
 * holds steady the positions keep tracking, silently — a block nudged a
 * centimetre moves its wire without re-emitting anything.
 */
import type { BoardResult } from './board';
import { MAX_WIRES } from './boardModel';
import type { GridConfig } from './grid';
import { QUBIT_WIRE_ID } from './markers';
import type { DetectedMarker } from './detect';

/**
 * Board-mm y of every qubit-wire block, sorted top-down.
 *
 * A block counts only when its centre falls **left of the grid's first column**
 * (`x < gridOffsetX`) — that is where the wires start, and it keeps a stray
 * block that wandered onto the lattice from silently becoming a wire. At most
 * `maxWires` are returned (the topmost ones).
 */
export function wirePositions(
  markers: readonly DetectedMarker[],
  board: BoardResult,
  grid: GridConfig,
  maxWires = MAX_WIRES,
): number[] {
  const ys: number[] = [];
  for (const marker of markers) {
    if (marker.id !== QUBIT_WIRE_ID) continue;
    const [xMm, yMm] = board.imageToBoard(marker.center);
    if (xMm >= grid.gridOffsetX) continue;
    ys.push(yMm);
  }
  ys.sort((a, b) => a - b);
  return ys.slice(0, maxWires);
}

/** Outcome of feeding one frame's wire observations to the stabilizer. */
export interface WireResult {
  /** Stable wire positions (board mm, top-down), or null for "no blocks". */
  readonly wires: number[] | null;
  /** True only on frames where the stable wire COUNT changed. */
  readonly changed: boolean;
}

/** Asymmetric-hysteresis stabilizer over per-frame wire-block positions. */
export class WireStabilizer {
  private readonly window: number[] = [];
  private stableWires: number[] | null = null;
  private shrinkStreak = 0;

  constructor(
    private readonly appearWindow = 7,
    private readonly appearMin = 5,
    private readonly disappearAfter = 12,
    private readonly maxWires = MAX_WIRES,
  ) {
    if (appearMin > appearWindow) {
      throw new Error('appearMin cannot exceed appearWindow');
    }
  }

  get stable(): number[] | null {
    return this.stableWires === null ? null : [...this.stableWires];
  }

  /** Forget all history (e.g. on a camera swap). */
  reset(): void {
    this.window.length = 0;
    this.stableWires = null;
    this.shrinkStreak = 0;
  }

  /** Advance one frame with the wire y positions seen on it. */
  update(observed: readonly number[]): WireResult {
    const ys = [...observed].sort((a, b) => a - b).slice(0, this.maxWires);
    const n = ys.length;
    this.window.push(n);
    if (this.window.length > this.appearWindow) this.window.shift();
    const current = this.stableWires === null ? 0 : this.stableWires.length;
    let changed = false;

    if (n < current) {
      // Shrinking (a block removed, or a hand over the left edge) is slow: only
      // after `disappearAfter` consecutive frames short of the count.
      this.shrinkStreak += 1;
      if (this.shrinkStreak >= this.disappearAfter) {
        this.stableWires = ys.length > 0 ? ys : null;
        this.shrinkStreak = 0;
        changed = true;
      }
    } else {
      this.shrinkStreak = 0;
      if (n > current) {
        // Growing is a debounce: seen in `appearMin` of the last
        // `appearWindow` frames.
        let seen = 0;
        for (const count of this.window) if (count >= n) seen++;
        if (seen >= this.appearMin) {
          this.stableWires = ys;
          changed = true;
        }
      } else if (n > 0) {
        // Same count: track the positions, emit nothing.
        this.stableWires = ys;
      }
    }

    return { wires: this.stable, changed };
  }
}
