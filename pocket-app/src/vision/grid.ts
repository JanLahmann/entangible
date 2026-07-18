/**
 * Grid mapping: board-mm coordinates → `(row, col)` cells.
 *
 * Exact port of `grid.py`. A tile is assigned to a cell only when its marker
 * centre falls inside that cell's acceptance window (± cellSize/2 of the
 * centre, scaled by `tolerance`); the pitch − cellSize gutter is a dead zone,
 * so off-grid tiles are rejected (returns null) rather than misfiled.
 */
import { BOARD, type BoardGeometry } from './geometry';

export interface Cell {
  readonly row: number;
  readonly col: number;
}

export class GridMapper {
  constructor(
    private readonly config: BoardGeometry = BOARD,
    private readonly tolerance = 1.0,
  ) {}

  cellCenter(row: number, col: number): [number, number] {
    const cfg = this.config;
    const cx = cfg.gridOffsetX + cfg.cellSize / 2.0 + cfg.pitch * col;
    const cy = cfg.gridOffsetY + cfg.cellSize / 2.0 + cfg.pitch * row;
    return [cx, cy];
  }

  assign(xMm: number, yMm: number): Cell | null {
    const cfg = this.config;
    const halfWindow = (cfg.cellSize / 2.0) * this.tolerance;

    const col = Math.round((xMm - (cfg.gridOffsetX + cfg.cellSize / 2.0)) / cfg.pitch);
    const row = Math.round((yMm - (cfg.gridOffsetY + cfg.cellSize / 2.0)) / cfg.pitch);
    if (!(col >= 0 && col < cfg.cols && row >= 0 && row < cfg.rows)) return null;

    const [cx, cy] = this.cellCenter(row, col);
    if (Math.abs(xMm - cx) <= halfWindow && Math.abs(yMm - cy) <= halfWindow) {
      return { row, col };
    }
    return null;
  }
}
