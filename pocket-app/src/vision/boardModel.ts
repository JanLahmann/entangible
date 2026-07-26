/**
 * The active board model: how an estimated rectangle becomes a lattice.
 * EXACT port of `board_model.py`.
 *
 * Task #94 lets the four corner blocks span *any* rectangle instead of the
 * printed mat's 720×500 mm. {@link estimateBoardRect} recovers that rectangle;
 * this module turns it into the cell lattice the grid mapper works in, under
 * one of three kinds:
 *
 * - **mat** — the rectangle is the printed mat's, within `MAT_RECT_TOLERANCE`.
 *   The classic geometry is used verbatim (same rows/cols/pitch/offsets), so
 *   the detector's output is bit-for-bit what it was before this feature.
 * - **stretch** (layout A) — the same 5×8 lattice scaled proportionally into
 *   the estimated rectangle; the cells grow. x and y scale independently, so a
 *   board wider than it is tall (relative to the mat) still lands its cells.
 * - **grid** (layout B, the default) — the mat's physical pitch (70 mm) and
 *   cell size (62 mm) are kept, so a printed tile always covers exactly one
 *   cell, and the *column count* is derived from the estimated width instead.
 *   A wider table simply means more columns.
 *
 * On top of either layout, qubit-wire blocks (task #95) may replace the
 * lattice's rows: when present each block declares one wire at its own y, so
 * the row count IS the block count and tiles snap to the nearest wire.
 */
import {
  BOARD,
  MAT_RECT,
  boardWithRect,
  isMatRect,
  type BoardGeometry,
  type BoardRect,
} from './geometry';
import type { GridConfig } from './grid';

/** The operator-selectable layouts for a non-mat rectangle. */
export type BoardLayout = 'stretch' | 'grid';

export const BOARD_LAYOUTS: readonly BoardLayout[] = ['stretch', 'grid'];

/** Jan's pick: more columns beats bigger cells. */
export const DEFAULT_BOARD_LAYOUT: BoardLayout = 'grid';

/**
 * Column cap in `grid` layout. `@qamposer/react`'s CircuitEditor imposes no
 * hard limit — it always renders `MIN_POSITIONS = 20` columns and grows beyond
 * that with the circuit (`numPositions = max(20, maxGatePos + 3)`) — so 20 is
 * our own sanity cap: the widest board guaranteed to be fully visible without
 * the editor having to grow.
 */
export const MAX_COLUMNS = 20;

/**
 * Wire cap. `@qamposer/react`'s provider defaults to `maxQubits: 5` and the
 * physical kit is a 5-qubit board, so five wires is the ceiling everywhere.
 */
export const MAX_WIRES = 5;

/** Which branch produced a model. */
export type BoardModelKind = 'mat' | BoardLayout;

/** The geometry one frame is interpreted in. */
export interface BoardModel {
  readonly kind: BoardModelKind;
  /** The rectangle the corner markers span (mm). */
  readonly rect: BoardRect;
  /** Board geometry resized to `rect` — what the homography is fitted to. */
  readonly board: BoardGeometry;
  /** The cell lattice, in the same board-mm frame. */
  readonly grid: GridConfig;
  readonly rows: number;
  readonly cols: number;
  /** Wire-block count driving the rows, or null when the lattice does. */
  readonly wireCount: number | null;
}

/** Mat mm between the last column's right edge and the mat's right edge. */
function rightMargin(board: BoardGeometry): number {
  return board.matWidth - (board.gridOffsetX + board.pitch * (board.cols - 1) + board.cellSize);
}

/** Mat mm between the last row's bottom edge and the mat's bottom edge. */
function bottomMargin(board: BoardGeometry): number {
  return board.matHeight - (board.gridOffsetY + board.pitch * (board.rows - 1) + board.cellSize);
}

/** How many mat-pitch columns fit in a board `width` mm wide (1..MAX_COLUMNS). */
export function deriveColumns(width: number, board: BoardGeometry = BOARD): number {
  const usable = width - board.gridOffsetX - rightMargin(board) - board.cellSize;
  const cols = usable >= 0 ? Math.floor(usable / board.pitch) + 1 : 1;
  return Math.max(1, Math.min(MAX_COLUMNS, cols));
}

/** How many mat-pitch rows fit in a board `height` mm tall (1..MAX_WIRES). */
export function deriveRows(height: number, board: BoardGeometry = BOARD): number {
  const usable = height - board.gridOffsetY - bottomMargin(board) - board.cellSize;
  const rows = usable >= 0 ? Math.floor(usable / board.pitch) + 1 : 1;
  return Math.max(1, Math.min(MAX_WIRES, rows));
}

/** Replace a lattice's rows with explicit wire positions (task #95). */
function withWires(
  grid: GridConfig,
  wireYs: readonly number[] | null | undefined,
): GridConfig {
  if (!wireYs || wireYs.length === 0) return grid;
  const wires = [...wireYs].sort((a, b) => a - b).slice(0, MAX_WIRES);
  return { ...grid, rows: wires.length, wireYs: wires };
}

function modelOf(
  kind: BoardModelKind,
  rect: BoardRect,
  board: BoardGeometry,
  grid: GridConfig,
): BoardModel {
  return {
    kind,
    rect,
    board,
    grid,
    rows: grid.rows,
    cols: grid.cols,
    wireCount: grid.wireYs ? grid.wireYs.length : null,
  };
}

/** The classic mat model (optionally with wire blocks overriding its rows). */
export function matBoardModel(
  wireYs?: readonly number[] | null,
  board: BoardGeometry = BOARD,
): BoardModel {
  const grid: GridConfig = {
    rows: board.rows,
    cols: board.cols,
    pitch: board.pitch,
    cellSize: board.cellSize,
    gridOffsetX: board.gridOffsetX,
    gridOffsetY: board.gridOffsetY,
  };
  return modelOf('mat', MAT_RECT, board, withWires(grid, wireYs));
}

/**
 * Build the model for an estimated rectangle under `layout`. A `rect` of null —
 * or one within the mat tolerance — yields the classic mat model; an unknown
 * layout falls back to {@link DEFAULT_BOARD_LAYOUT}.
 */
export function buildBoardModel(
  rect: BoardRect | null,
  layout: string = DEFAULT_BOARD_LAYOUT,
  wireYs?: readonly number[] | null,
  board: BoardGeometry = BOARD,
): BoardModel {
  if (rect === null || isMatRect(rect, undefined, board)) {
    return matBoardModel(wireYs, board);
  }

  const sized = boardWithRect(rect, board);
  if (layout === 'stretch') {
    const sx = rect.widthMm / board.matWidth;
    const sy = rect.heightMm / board.matHeight;
    const grid: GridConfig = {
      rows: board.rows,
      cols: board.cols,
      pitch: board.pitch * sx,
      cellSize: board.cellSize * sx,
      gridOffsetX: board.gridOffsetX * sx,
      gridOffsetY: board.gridOffsetY * sy,
      pitchY: board.pitch * sy,
      cellHeight: board.cellSize * sy,
    };
    return modelOf('stretch', rect, sized, withWires(grid, wireYs));
  }

  // `grid` (default): mat pitch and cell size, more columns.
  const grid: GridConfig = {
    rows: deriveRows(rect.heightMm, board),
    cols: deriveColumns(rect.widthMm, board),
    pitch: board.pitch,
    cellSize: board.cellSize,
    gridOffsetX: board.gridOffsetX,
    gridOffsetY: board.gridOffsetY,
  };
  return modelOf('grid', rect, sized, withWires(grid, wireYs));
}
