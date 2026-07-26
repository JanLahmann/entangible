/**
 * Board + tile geometry, read from the generated `geometry.json` (exported from
 * `assets.toml` by `tools/export_dictionary.py` — the single source of truth
 * shared with print and Python detection).
 *
 * Port of the geometry helpers in `board.py` (corner-marker squares) and
 * `grid.py` (cell centres), so the TS pipeline places tiles exactly where the
 * Python pipeline does.
 */
import geometryJson from './geometry.json';

export interface BoardGeometry {
  readonly rows: number;
  readonly cols: number;
  readonly pitch: number;
  readonly cellSize: number;
  readonly matWidth: number;
  readonly matHeight: number;
  readonly cornerMarkerSize: number;
  readonly cornerMargin: number;
  readonly gridOffsetX: number;
  readonly gridOffsetY: number;
}

export interface TileGeometry {
  readonly size: number;
  readonly markerSize: number;
}

export const BOARD: BoardGeometry = geometryJson.board;
export const TILE: TileGeometry = geometryJson.tile;
export const CORNER_IDS: Readonly<Record<string, string>> = geometryJson.cornerIds;
export const CORNER_ROLES: readonly string[] = geometryJson.cornerRoles;

/** A homography needs ≥ 4 point pairs; each corner marker gives 4, so 3 corners. */
export const MIN_CORNERS_FOR_BOARD = 3;

export type Point = readonly [number, number];

/**
 * The outer rectangle the four corner markers span, in board mm (task #94).
 * Measured exactly as the mat is — including the `cornerMargin` inset on both
 * sides — so corner blocks at mat spacing report `(matWidth, matHeight)` and
 * the board-mm origin stays the board's top-left corner.
 */
export interface BoardRect {
  readonly widthMm: number;
  readonly heightMm: number;
}

/**
 * Relative tolerance within which an estimated rectangle counts as "the mat"
 * (mirrors `MAT_RECT_TOLERANCE` in board.py). Inside it the classic geometry is
 * used verbatim, so a real mat — and corner blocks at mat spacing — detect
 * exactly as they did before variable placement existed. It doubles as the
 * hysteresis band of the pipeline's sticky rectangle.
 */
export const MAT_RECT_TOLERANCE = 0.05;

/**
 * How far outside the measured board rectangle a piece's centre may sit and
 * still count as being ON the board (mm). Half a printed piece (`TILE.size` is
 * 60 mm for every tile *and* every furniture block), so a piece whose centre is
 * within the margin still physically overlaps the play area — the worst a
 * flush-laid piece can look after a nudge — while a centre further out means the
 * piece is not touching the board at all. Three orders of magnitude above the
 * detector's own error (< 0.1 mm RMS reprojection, measured in #94), so it is
 * placement slop it absorbs, never noise. Mirrors `board.BOARD_MARGIN_MM`.
 */
export const BOARD_MARGIN_MM = 30.0;

/**
 * Is a board-mm point inside the board rectangle, within `margin`?
 *
 * The board-mm origin is the rectangle's own top-left corner, so the test is
 * simply the rectangle grown by `margin` on every side.
 *
 * Everything a camera can see that is *not* on the board — the unused kit heaped
 * on the table next to it at a booth, a furniture block that never made it
 * between the corners — fails this and is dropped before it can reach cell
 * mapping, the stabilizers or the warning list. That silence is the point: a
 * pile of spare tiles beside the board is normal, not an error. Mirrors
 * `board.on_board`.
 */
export function onBoard(
  xMm: number,
  yMm: number,
  rect: BoardRect,
  margin = BOARD_MARGIN_MM,
): boolean {
  return (
    xMm >= -margin &&
    xMm <= rect.widthMm + margin &&
    yMm >= -margin &&
    yMm <= rect.heightMm + margin
  );
}

/** The printed mat's rectangle: the classic geometry and the initial guess. */
export const MAT_RECT: BoardRect = {
  widthMm: BOARD.matWidth,
  heightMm: BOARD.matHeight,
};

/** Distance from a board edge to a corner marker's *centre*, in mm. */
export function cornerInset(board: BoardGeometry = BOARD): number {
  return board.cornerMargin + board.cornerMarkerSize / 2;
}

/** Centre-to-centre spacing of opposite corner markers for `rect` (mm). */
export function centerSpan(
  rect: BoardRect,
  board: BoardGeometry = BOARD,
): [number, number] {
  const inset = 2 * cornerInset(board);
  return [rect.widthMm - inset, rect.heightMm - inset];
}

/** Inverse of {@link centerSpan}. */
export function rectFromCenterSpan(
  spanX: number,
  spanY: number,
  board: BoardGeometry = BOARD,
): BoardRect {
  const inset = 2 * cornerInset(board);
  return { widthMm: spanX + inset, heightMm: spanY + inset };
}

/**
 * A copy of the board geometry whose mat extents are `rect`. Everything
 * downstream reads the mat extents, so resizing them is all it takes to
 * describe a board of corner blocks spanning a different rectangle.
 */
export function boardWithRect(rect: BoardRect, board: BoardGeometry = BOARD): BoardGeometry {
  return { ...board, matWidth: rect.widthMm, matHeight: rect.heightMm };
}

/** Is `rect` the printed mat, within `tolerance` (relative, per axis)? */
export function isMatRect(
  rect: BoardRect,
  tolerance = MAT_RECT_TOLERANCE,
  board: BoardGeometry = BOARD,
): boolean {
  return (
    Math.abs(rect.widthMm - board.matWidth) <= tolerance * board.matWidth &&
    Math.abs(rect.heightMm - board.matHeight) <= tolerance * board.matHeight
  );
}

/**
 * Board-mm coordinates of a corner marker's four corners, in ArUco canonical
 * order (TL, TR, BR, BL of the marker as printed) — mirrors
 * `BoardConfig.corner_marker_square`.
 *
 * `board` defaults to the printed mat; pass {@link boardWithRect} to read the
 * squares of corner blocks spanning some other rectangle (task #94).
 */
export function cornerMarkerSquare(
  markerId: number,
  board: BoardGeometry = BOARD,
): [Point, Point, Point, Point] {
  const role = CORNER_IDS[String(markerId)];
  const size = board.cornerMarkerSize;
  const margin = board.cornerMargin;
  let x0: number;
  let y0: number;
  switch (role) {
    case 'TL':
      x0 = margin;
      y0 = margin;
      break;
    case 'TR':
      x0 = board.matWidth - margin - size;
      y0 = margin;
      break;
    case 'BR':
      x0 = board.matWidth - margin - size;
      y0 = board.matHeight - margin - size;
      break;
    case 'BL':
      x0 = margin;
      y0 = board.matHeight - margin - size;
      break;
    default:
      throw new Error(`Unknown corner role for marker ${markerId}`);
  }
  return [
    [x0, y0],
    [x0 + size, y0],
    [x0 + size, y0 + size],
    [x0, y0 + size],
  ];
}
