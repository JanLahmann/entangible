/**
 * Grid mapping: board-mm coordinates → `(row, col)` cells.
 *
 * Exact port of `grid.py`. The two axes are mapped differently (#109):
 *
 * - **Rows** are a lattice (or wire, #95/#97) question: a tile takes the
 *   nearest row only within half a cell height of it; anything between two
 *   rows is rejected (null) rather than misfiled.
 * - **Columns** are derived from the tiles themselves: `clusterColumns` groups
 *   the tiles' actual x positions (closer than `COLUMN_GAP_MM` = one column)
 *   and spaces the groups by the pitch. No x position is ever rejected.
 */
import { BOARD } from './geometry';

/**
 * Largest x distance (board mm) between neighbouring tile centres that still
 * counts as ONE column (#109): half a 60 mm tile. Centres closer than this would
 * physically overlap, so they cannot be side by side in two columns — and a CNOT
 * pair (● over ⊕) placed by hand slightly out of line stays inside it.
 */
export const COLUMN_GAP_MM = 30.0;

/**
 * Lattice geometry needed to place a board-mm point into a cell.
 *
 * `pitch`/`cellSize` are the x-axis spacing and cell width; `pitchY` and
 * `cellHeight` default to them (the square mat lattice) and differ only under
 * the `stretch` layout, which scales x and y independently (#94).
 *
 * `wireYs` (task #95) replaces the y lattice entirely: when qubit-wire blocks
 * are on the table, each declares one wire at its own board-mm y and a tile
 * takes the row of the NEAREST wire (within half a cell height) instead of a
 * lattice row.
 *
 * `wireSpans` (task #97) refines that further: a wire whose measurement block
 * was found runs as the straight SEGMENT through both block centres rather than
 * as a horizontal line at `wireYs[row]`, so a board whose two rows of blocks are
 * slightly out of square gets wires that still follow the tiles. It is optional
 * per wire and changes nothing else — the row count and ordering still come
 * from `wireYs` alone.
 *
 * `BoardGeometry` satisfies this shape structurally, so the classic mat lattice
 * is simply `BOARD`.
 */
export interface GridConfig {
  readonly rows: number;
  readonly cols: number;
  readonly pitch: number;
  readonly cellSize: number;
  readonly gridOffsetX: number;
  readonly gridOffsetY: number;
  /** y pitch; omitted = `pitch` (the isotropic mat lattice). */
  readonly pitchY?: number;
  /** cell height; omitted = `cellSize`. */
  readonly cellHeight?: number;
  /** Explicit wire positions (board mm, sorted top-down), or null/omitted. */
  readonly wireYs?: readonly number[] | null;
  /**
   * Per-wire segment `[xLeft, yLeft, xRight, yRight]` from a paired measurement
   * block (#97), null for a wire that has none. Same length and order as
   * `wireYs` when present.
   */
  readonly wireSpans?: readonly (readonly [number, number, number, number] | null)[] | null;
}

/**
 * Board-mm y of wire `row` at board-mm `x` (mirrors `GridConfig.wire_y_at`).
 *
 * A wire with a paired measurement block (#97) is the straight line through both
 * block centres, so its y depends on where along the board you ask; one without
 * stays horizontal at `wireYs[row]`, exactly as before #97. Only ever called
 * when `wireYs` is set.
 */
export function wireYAt(config: GridConfig, row: number, xMm: number): number {
  const span = config.wireSpans ? config.wireSpans[row] : null;
  if (span) {
    const [x0, y0, x1, y1] = span;
    if (x1 !== x0) return y0 + ((y1 - y0) * (xMm - x0)) / (x1 - x0);
  }
  return config.wireYs![row];
}

/** y-axis pitch of a lattice (mirrors `GridConfig.y_pitch`). */
export function yPitch(config: GridConfig): number {
  return config.pitchY ?? config.pitch;
}

/** y-axis cell height of a lattice (mirrors `GridConfig.y_cell`). */
export function yCell(config: GridConfig): number {
  return config.cellHeight ?? config.cellSize;
}

/** x of lattice column 0's centre — `clusterColumns`'s anchor (mirrors `GridConfig.first_center_x`). */
export function firstCenterX(config: GridConfig): number {
  return config.gridOffsetX + config.cellSize / 2.0;
}

/**
 * `floor(value + 0.5)` — the one rounding rule both mirrors use (`grid.py`'s
 * `round_half_up`). Python's `round()` rounds halves to even, so the Python side
 * cannot use it; spelling the rule out here keeps the two numerically identical.
 */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/**
 * Column index for each tile x, derived from the tiles themselves (#109).
 * Mirrors `grid.cluster_columns`.
 *
 * Single-linkage 1-D clustering: sort the x positions; wherever two neighbours
 * are more than `gap` apart a new column starts. Each cluster's centroid then
 * gets an index — the first `max(0, round((x0 − firstCenterX) / pitch))`, every
 * next one the previous plus `max(1, round(dx / pitch))` of the centroid step —
 * so the *spacing* still comes from the pitch (an empty column between two
 * tiles is kept) while the columns themselves follow where the tiles really
 * are. Tiles placed exactly at mat lattice cell centres get exactly their
 * lattice column indices, for any subset of columns.
 *
 * Returns the column of each input x, in input order.
 */
export function clusterColumns(
  xs: readonly number[],
  pitch: number,
  firstCenter: number,
  gap: number = COLUMN_GAP_MM,
): number[] {
  if (xs.length === 0) return [];
  // Stable index sort, ties by index — the same order Python's sorted() gives.
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b] || a - b);
  const clusters: number[][] = [[order[0]]];
  for (let k = 1; k < order.length; k++) {
    if (xs[order[k]] - xs[order[k - 1]] > gap) clusters.push([order[k]]);
    else clusters[clusters.length - 1].push(order[k]);
  }

  const cols = new Array<number>(xs.length).fill(0);
  let prevCentroid = 0;
  let col = 0;
  clusters.forEach((members, k) => {
    let sum = 0;
    for (const i of members) sum += xs[i];
    const centroid = sum / members.length;
    if (k === 0) col = Math.max(0, roundHalfUp((centroid - firstCenter) / pitch));
    else col += Math.max(1, roundHalfUp((centroid - prevCentroid) / pitch));
    prevCentroid = centroid;
    for (const i of members) cols[i] = col;
  });
  return cols;
}

/**
 * Maps a board-mm point to its ROW, with a tolerant, gap-rejecting window.
 *
 * Only the row is a lattice question any more (#109): columns are clustered
 * from where the tiles actually lie (`clusterColumns`), so there is no x-window
 * and no x gutter. On the y axis `tolerance` scales the half-cell acceptance
 * window: with the default of 1.0 a marker is accepted only within ±yCell/2 of
 * its row's wire or lattice line. `cellCenter` remains for drawing and probing
 * the lattice (renderers, grid-guided redetection).
 */
export class GridMapper {
  constructor(
    readonly config: GridConfig = BOARD,
    private readonly tolerance = 1.0,
  ) {}

  cellCenter(row: number, col: number): [number, number] {
    const cfg = this.config;
    const cx = cfg.gridOffsetX + cfg.cellSize / 2.0 + cfg.pitch * col;
    if (cfg.wireYs) return [cx, wireYAt(cfg, row, cx)];
    const cy = cfg.gridOffsetY + yCell(cfg) / 2.0 + yPitch(cfg) * row;
    return [cx, cy];
  }

  /**
   * The row a board-mm point belongs to, or null (mirrors `GridMapper.assign_row`).
   *
   * The nearest explicit wire when qubit-wire blocks declare them (#95), else
   * the nearest y-lattice row. "Nearest" is measured to the wire AT THIS TILE'S
   * x, so a wire tilted by its measurement block (#97) is followed rather than
   * judged by where it started — the only use of `xMm`. Null means the point is
   * on no row: between two wires or rows beyond the window, or outside the
   * lattice's rows.
   */
  assignRow(xMm: number, yMm: number): number | null {
    const cfg = this.config;
    const halfWindowY = (yCell(cfg) / 2.0) * this.tolerance;
    let row: number;
    let lineY: number;
    if (cfg.wireYs) {
      if (cfg.wireYs.length === 0) return null;
      row = 0;
      let best = Math.abs(yMm - wireYAt(cfg, 0, xMm));
      for (let i = 1; i < cfg.wireYs.length; i++) {
        const d = Math.abs(yMm - wireYAt(cfg, i, xMm));
        if (d < best) {
          best = d;
          row = i;
        }
      }
      lineY = wireYAt(cfg, row, xMm);
    } else {
      row = roundHalfUp((yMm - (cfg.gridOffsetY + yCell(cfg) / 2.0)) / yPitch(cfg));
      if (!(row >= 0 && row < cfg.rows)) return null;
      lineY = cfg.gridOffsetY + yCell(cfg) / 2.0 + yPitch(cfg) * row;
    }
    return Math.abs(yMm - lineY) <= halfWindowY ? row : null;
  }
}
