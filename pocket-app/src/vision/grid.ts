/**
 * Grid mapping: board-mm coordinates → `(row, col)` cells.
 *
 * Exact port of `grid.py`. A tile is assigned to a cell only when its marker
 * centre falls inside that cell's acceptance window (± cellSize/2 of the
 * centre, scaled by `tolerance`); the pitch − cellSize gutter is a dead zone,
 * so off-grid tiles are rejected (returns null) rather than misfiled.
 */
import { BOARD } from './geometry';

export interface Cell {
  readonly row: number;
  readonly col: number;
}

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

export class GridMapper {
  constructor(
    private readonly config: GridConfig = BOARD,
    private readonly tolerance = 1.0,
  ) {}

  cellCenter(row: number, col: number): [number, number] {
    const cfg = this.config;
    const cx = cfg.gridOffsetX + cfg.cellSize / 2.0 + cfg.pitch * col;
    if (cfg.wireYs) return [cx, wireYAt(cfg, row, cx)];
    const cy = cfg.gridOffsetY + yCell(cfg) / 2.0 + yPitch(cfg) * row;
    return [cx, cy];
  }

  assign(xMm: number, yMm: number): Cell | null {
    const cfg = this.config;
    const halfWindow = (cfg.cellSize / 2.0) * this.tolerance;
    const halfWindowY = (yCell(cfg) / 2.0) * this.tolerance;

    // Nearest column by the lattice spacing.
    const col = Math.round((xMm - (cfg.gridOffsetX + cfg.cellSize / 2.0)) / cfg.pitch);
    // Nearest row: an explicit wire when qubit-wire blocks declare them (#95),
    // else the y lattice. "Nearest" is measured to the wire AT THIS TILE'S x,
    // so a wire tilted by its measurement block (#97) is followed rather than
    // judged by where it started.
    let row: number;
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
    } else {
      row = Math.round((yMm - (cfg.gridOffsetY + yCell(cfg) / 2.0)) / yPitch(cfg));
    }
    if (!(col >= 0 && col < cfg.cols && row >= 0 && row < cfg.rows)) return null;

    const [cx, cy] = this.cellCenter(row, col);
    if (Math.abs(xMm - cx) <= halfWindow && Math.abs(yMm - cy) <= halfWindowY) {
      return { row, col };
    }
    return null;
  }
}
