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
 * Measurement blocks (task #97, marker ID 47) are the right-edge counterpart,
 * and a pure *refinement*: they never create a wire. A wire exists iff its LEFT
 * block exists; a right block only says where that wire ENDS, which turns the
 * wire from a horizontal line at the left block's y into the SEGMENT through
 * both block centres — so a board whose two rows of blocks are slightly out of
 * square gets tilted wires that still follow the tiles. A right block with no
 * left partner is ignored and reported.
 *
 * {@link wirePoints} / {@link wirePositions} decide which detected ID-46
 * markers count as wires (they have to be ON the board and *left of* the grid,
 * in board mm); {@link measurePoints} asks the mirrored question of ID-47 (on
 * the board and *right of* the last column), {@link strayFurniture} collects
 * the blocks those threw away for being off the board entirely, and
 * {@link pairMeasures} matches the survivors by y.
 * {@link WireStabilizer} applies the same asymmetric hysteresis the tile
 * stabilizer uses to the wire SET, so a hand crossing the left edge cannot
 * resize the circuit frame by frame. Growing the set takes `appearMin` of the
 * last `appearWindow` frames; shrinking it (including losing the last block,
 * which falls back to the classic rows) takes `disappearAfter` CONSECUTIVE
 * frames. While the count holds steady the positions keep tracking, silently —
 * a block nudged a centimetre moves its wire without re-emitting anything.
 * {@link MeasureStabilizer} does the same for the right-hand blocks, so a hand
 * crossing the *right* edge cannot make paired wires snap between tilted and
 * horizontal frame by frame.
 */
import type { BoardResult } from './board';
import { MAX_WIRES } from './boardModel';
import { BOARD_MARGIN_MM, onBoard, type BoardRect } from './geometry';
import { yPitch, type GridConfig } from './grid';
import { MEASURE_BLOCK_ID, QUBIT_WIRE_ID } from './markers';
import type { DetectedMarker } from './detect';

/** A board-mm point: `[x, y]`. */
export type Point = readonly [number, number];

/**
 * The two board-furniture marker IDs. Neither is a gate; both are placed by
 * hand at a board edge, so both are subject to the same on-board test.
 */
export const FURNITURE_IDS: ReadonlySet<number> = new Set([
  QUBIT_WIRE_ID,
  MEASURE_BLOCK_ID,
]);

/**
 * Half a row pitch: how far a measurement block's centre may sit from a wire
 * block's and still be read as *that* wire's end. Half the pitch is exactly the
 * "closer to this wire than to the next one" boundary, and the blocks are 60 mm
 * squares on a 70 mm pitch, so a correctly placed pair is never near it.
 */
export const PAIR_TOLERANCE_FRACTION = 0.5;

/** Vertical tolerance (board mm) for pairing a right block to a left one. */
export function pairTolerance(grid: GridConfig): number {
  return yPitch(grid) * PAIR_TOLERANCE_FRACTION;
}

/** Board-mm x of the right edge of the lattice's last column. */
export function gridRightEdge(grid: GridConfig): number {
  return grid.gridOffsetX + grid.pitch * (grid.cols - 1) + grid.cellSize;
}

/**
 * Board-mm `[x, y]` of every ON-BOARD marker with `markerId`.
 *
 * The on-board test comes first, before either edge rule, so a block that is not
 * on the board never reaches the wire set — and therefore never reaches the
 * hysteresis either. A stray appearing and disappearing at the edge of frame
 * must not churn the stabilizer; the way to guarantee that is for the stabilizer
 * never to hear about it.
 */
function furniturePoints(
  markers: readonly DetectedMarker[],
  board: BoardResult,
  markerId: number,
  rect: BoardRect,
  margin = BOARD_MARGIN_MM,
): Point[] {
  const points: Point[] = [];
  for (const marker of markers) {
    if (marker.id !== markerId) continue;
    const [xMm, yMm] = board.imageToBoard(marker.center);
    if (!onBoard(xMm, yMm, rect, margin)) continue;
    points.push([xMm, yMm]);
  }
  return points;
}

/** A furniture block found off the board: `[markerId, x, y]` in board mm. */
export type StrayBlock = readonly [number, number, number];

/**
 * Furniture blocks whose centre is OFF the board, sorted top-down.
 *
 * The complement of what {@link wirePoints} and {@link measurePoints} accept, on
 * the board-bounds test only: a block that is on the board but on the wrong side
 * of its edge rule is a *misplacement*, not a stray, and is handled where it
 * happens. These are the ones that are not on the board at all — the spare
 * blocks in the box next to it — and all the frame does with them is count them.
 *
 * Sorted by `(y, x, id)` so a frame's report is a pure function of what was on
 * the table, not of detector ordering. Mirrors `wires.stray_furniture`.
 */
export function strayFurniture(
  markers: readonly DetectedMarker[],
  board: BoardResult,
  rect: BoardRect,
  margin = BOARD_MARGIN_MM,
): StrayBlock[] {
  const out: StrayBlock[] = [];
  for (const marker of markers) {
    if (!FURNITURE_IDS.has(marker.id)) continue;
    const [xMm, yMm] = board.imageToBoard(marker.center);
    if (onBoard(xMm, yMm, rect, margin)) continue;
    out.push([marker.id, xMm, yMm]);
  }
  out.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  return out;
}

/**
 * Board-mm `[x, y]` of every qubit-wire block, sorted top-down.
 *
 * A block counts only when it is **on the board** ({@link onBoard} against
 * `rect`) *and* its centre falls **left of the grid's first column**
 * (`x < gridOffsetX`). The first rule drops the spares lying on the table beside
 * the board; the second keeps a block that wandered onto the lattice from
 * silently becoming a wire. At most `maxWires` are returned (the topmost ones).
 */
export function wirePoints(
  markers: readonly DetectedMarker[],
  board: BoardResult,
  grid: GridConfig,
  rect: BoardRect,
  maxWires = MAX_WIRES,
): Point[] {
  const points = furniturePoints(markers, board, QUBIT_WIRE_ID, rect).filter(
    ([x]) => x < grid.gridOffsetX,
  );
  points.sort((a, b) => a[1] - b[1]);
  return points.slice(0, maxWires);
}

/**
 * Board-mm y of every qubit-wire block, sorted top-down — the y half of
 * {@link wirePoints}, i.e. what decides how many wires the board has.
 */
export function wirePositions(
  markers: readonly DetectedMarker[],
  board: BoardResult,
  grid: GridConfig,
  rect: BoardRect,
  maxWires = MAX_WIRES,
): number[] {
  return wirePoints(markers, board, grid, rect, maxWires).map(([, y]) => y);
}

/**
 * Board-mm `[x, y]` of every measurement block, sorted top-down.
 *
 * The mirror of {@link wirePoints}: a block counts only when it is on the board
 * and its centre falls **right of the last column**, so neither a spare off the
 * board nor one that wandered onto the lattice can be read as a wire end. At
 * most `maxWires` are returned — a board tops out at `MAX_WIRES` wires, so more
 * right blocks than that cannot all be ends.
 */
export function measurePoints(
  markers: readonly DetectedMarker[],
  board: BoardResult,
  grid: GridConfig,
  rect: BoardRect,
  maxWires = MAX_WIRES,
): Point[] {
  const edge = gridRightEdge(grid);
  const points = furniturePoints(markers, board, MEASURE_BLOCK_ID, rect).filter(
    ([x]) => x > edge,
  );
  points.sort((a, b) => a[1] - b[1]);
  return points.slice(0, maxWires);
}

/** A wire's full extent: `[xLeft, yLeft, xRight, yRight]` in board mm. */
export type WireSpan = readonly [number, number, number, number];

/** The result of matching measurement blocks to qubit-wire blocks. */
export interface MeasurePairing {
  /**
   * Per wire (same order as the wire list): the segment through both block
   * centres, or null for a wire with no measurement block — that one stays
   * horizontal.
   */
  readonly spans: readonly (WireSpan | null)[];
  /**
   * Measurement blocks that matched no wire, top-down. They are ignored: the
   * left side always wins.
   */
  readonly unpaired: readonly Point[];
  /** How many wires have a measured end. */
  readonly paired: number;
  /** Mean left→right horizontal run of the paired wires (mm), or null. */
  readonly meanSpan: number | null;
}

/**
 * Match each measurement block to the nearest wire block by y.
 *
 * Greedy over every in-tolerance candidate pair sorted by vertical distance, so
 * the closest pair always wins and neither side is used twice. Ties are broken
 * by index — the pairing is a pure function of the two ordered lists, which is
 * what makes it reproducible frame to frame and in tests.
 *
 * A right block further than `tolerance` from every wire is *unpaired*: it is
 * reported and otherwise ignored. Wire count is never derived from here.
 */
export function pairMeasures(
  wires: readonly Point[],
  measures: readonly Point[],
  tolerance: number,
): MeasurePairing {
  const candidates: Array<[number, number, number]> = [];
  measures.forEach(([, my], mi) => {
    wires.forEach(([, wy], wi) => {
      const distance = Math.abs(my - wy);
      if (distance <= tolerance) candidates.push([distance, mi, wi]);
    });
  });
  candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);

  const spans: (WireSpan | null)[] = wires.map(() => null);
  const usedM = new Set<number>();
  const usedW = new Set<number>();
  for (const [, mi, wi] of candidates) {
    if (usedM.has(mi) || usedW.has(wi)) continue;
    usedM.add(mi);
    usedW.add(wi);
    spans[wi] = [wires[wi][0], wires[wi][1], measures[mi][0], measures[mi][1]];
  }

  const unpaired = measures.filter((_p, i) => !usedM.has(i));
  const runs = spans.filter((s): s is WireSpan => s !== null).map((s) => s[2] - s[0]);
  return {
    spans,
    unpaired,
    paired: runs.length,
    meanSpan: runs.length > 0 ? runs.reduce((a, b) => a + b, 0) / runs.length : null,
  };
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

/** Outcome of feeding one frame's measurement-block observations. */
export interface MeasureResult {
  /** Stable measurement-block positions (board mm, top-down). Empty = none. */
  readonly points: readonly Point[];
  /** True only on frames where the stable block COUNT changed. */
  readonly changed: boolean;
}

/**
 * Hysteresis over the measurement-block set — the wire stabilizer's mirror.
 *
 * A right block only refines a wire, so a flickering one cannot change the
 * qubit count; what it *can* do is make a paired wire snap between tilted and
 * horizontal, which would move gate rows on a boundary tile. So the right side
 * gets exactly the same asymmetric hysteresis as the left: the count is
 * delegated to a {@link WireStabilizer} over the blocks' y positions, and the x
 * positions ride along with it.
 *
 * While the stable count holds, the most recent observation *of that count* is
 * what is reported — so a block hidden for a frame keeps its last known place
 * rather than dropping its wire back to horizontal. Because both of the
 * stabilizer's transitions re-seed the stable set from the very frame that
 * triggered them, an observation matching the stable count always arrives on
 * the frame the count changes.
 */
export class MeasureStabilizer {
  private readonly inner: WireStabilizer;
  private points: readonly Point[] = [];

  constructor(
    appearWindow = 7,
    appearMin = 5,
    disappearAfter = 12,
    private readonly maxWires = MAX_WIRES,
  ) {
    this.inner = new WireStabilizer(appearWindow, appearMin, disappearAfter, maxWires);
  }

  get stable(): readonly Point[] {
    return this.points;
  }

  /** Forget all history (e.g. on a camera swap). */
  reset(): void {
    this.inner.reset();
    this.points = [];
  }

  /** Advance one frame with the measurement-block points seen on it. */
  update(observed: readonly Point[]): MeasureResult {
    const points = [...observed].sort((a, b) => a[1] - b[1]).slice(0, this.maxWires);
    const result = this.inner.update(points.map(([, y]) => y));
    const stableN = result.wires === null ? 0 : result.wires.length;
    if (stableN === 0) this.points = [];
    else if (points.length === stableN) this.points = points;
    return { points: this.points, changed: result.changed };
  }
}
