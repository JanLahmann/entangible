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
 * Board-mm coordinates of a corner marker's four corners, in ArUco canonical
 * order (TL, TR, BR, BL of the marker as printed) — mirrors
 * `BoardConfig.corner_marker_square`.
 */
export function cornerMarkerSquare(markerId: number): [Point, Point, Point, Point] {
  const role = CORNER_IDS[String(markerId)];
  const size = BOARD.cornerMarkerSize;
  const margin = BOARD.cornerMargin;
  let x0: number;
  let y0: number;
  switch (role) {
    case 'TL':
      x0 = margin;
      y0 = margin;
      break;
    case 'TR':
      x0 = BOARD.matWidth - margin - size;
      y0 = margin;
      break;
    case 'BR':
      x0 = BOARD.matWidth - margin - size;
      y0 = BOARD.matHeight - margin - size;
      break;
    case 'BL':
      x0 = margin;
      y0 = BOARD.matHeight - margin - size;
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
