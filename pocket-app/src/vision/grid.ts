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
    if (cfg.wireYs) return [cx, cfg.wireYs[row]];
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
    // else the y lattice.
    let row: number;
    if (cfg.wireYs) {
      if (cfg.wireYs.length === 0) return null;
      row = 0;
      for (let i = 1; i < cfg.wireYs.length; i++) {
        if (Math.abs(yMm - cfg.wireYs[i]) < Math.abs(yMm - cfg.wireYs[row])) row = i;
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
