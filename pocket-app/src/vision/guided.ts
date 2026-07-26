/**
 * Grid-guided redetection — the highest-impact robustness lever.
 *
 * Once the board homography is locked, every grid cell has a *known* expected
 * position and size for a tile marker. For each cell where blind contour/quad
 * detection found nothing this frame, we project the cell's marker quad straight
 * into image space via the inverse homography and decode it directly — bypassing
 * the fragile threshold → contour → polygon-approx front end exactly where a
 * marginal (small / blurred / low-contrast) marker slips through it. A handful
 * of small jitter offsets and several threshold strategies (border-aware, Otsu,
 * mean) give the weak marker a few extra chances; the border-valid + Hamming ≤ 1
 * gate keeps false positives out.
 *
 * Corner fiducials (IDs 0-3) are deliberately *not* rescued here — they define
 * the very homography we are projecting through, so they stay blind-only.
 */
import {
  decodeQuad,
  type Corner,
  type DetectedMarker,
  type GrayImage,
} from './detect';
import type { BoardResult } from './board';
import { CORNER_IDS, TILE, type Point } from './geometry';
import { matBoardModel, type BoardModel } from './boardModel';
import { MARKER_TABLE } from './markers';
import type { GridMapper } from './grid';

/** Jitter offsets (image px) applied to the projected quad — the homography and
 * cell centring are never pixel-perfect, so a couple of ±2-3 px nudges recover
 * markers whose projection lands slightly off. */
const JITTERS: ReadonlyArray<[number, number]> = [
  [0, 0],
  [2.5, 2.5],
  [-2.5, -2.5],
];

export interface GuidedStats {
  rescued: number;
}

/**
 * Attempt a targeted decode of every grid cell not already claimed by a blind
 * detection. Returns the freshly-rescued markers (image-space quad + centre at
 * the projected cell), to be merged with the blind set (blind wins — occupied
 * cells are skipped here).
 */
export function guidedRedetect(
  gray: GrayImage,
  board: BoardResult,
  blind: DetectedMarker[],
  grid: GridMapper,
  model: BoardModel = matBoardModel(),
  stats?: GuidedStats,
): DetectedMarker[] {
  // Cells already claimed by a blind tile detection — never re-attempt them.
  const occupied = new Set<string>();
  for (const m of blind) {
    if (String(m.id) in CORNER_IDS || !MARKER_TABLE.has(m.id)) continue;
    const [bx, by] = board.imageToBoard(m.center);
    const cell = grid.assign(bx, by);
    if (cell) occupied.add(`${cell.row},${cell.col}`);
  }

  const half = TILE.markerSize / 2;
  const margin = 8; // px slack allowed outside the frame for a partly-cropped tile
  const rescued: DetectedMarker[] = [];

  // The ACTIVE lattice, not the mat's: a wider board has more columns and wire
  // blocks may have replaced the rows (#94/#95).
  for (let row = 0; row < model.rows; row++) {
    for (let col = 0; col < model.cols; col++) {
      if (occupied.has(`${row},${col}`)) continue;

      const [cx, cy] = grid.cellCenter(row, col);
      const quadMm: [Point, Point, Point, Point] = [
        [cx - half, cy - half],
        [cx + half, cy - half],
        [cx + half, cy + half],
        [cx - half, cy + half],
      ];
      const quad: [Corner, Corner, Corner, Corner] = [
        board.boardToImage(quadMm[0]),
        board.boardToImage(quadMm[1]),
        board.boardToImage(quadMm[2]),
        board.boardToImage(quadMm[3]),
      ];

      // Reject cells whose projection is (mostly) out of frame or degenerate.
      let inFrame = false;
      for (const [x, y] of quad) {
        if (x >= -margin && y >= -margin && x < gray.width + margin && y < gray.height + margin) {
          inFrame = true;
          break;
        }
      }
      if (!inFrame) continue;
      const diag = Math.hypot(quad[0][0] - quad[2][0], quad[0][1] - quad[2][1]);
      if (diag < 10) continue; // too small to decode reliably

      const match = tryDecodeWithJitter(gray, quad);
      if (!match) continue;
      if (String(match.id) in CORNER_IDS || !MARKER_TABLE.has(match.id)) continue;

      rescued.push({
        id: match.id,
        rotation: match.rotation,
        corners: quad,
        center: [cx0(quad), cy0(quad)],
      });
      if (stats) stats.rescued++;
    }
  }

  return rescued;
}

function tryDecodeWithJitter(
  gray: GrayImage,
  quad: [Corner, Corner, Corner, Corner],
): { id: number; rotation: number } | null {
  for (const [ox, oy] of JITTERS) {
    const shifted: [Corner, Corner, Corner, Corner] = [
      [quad[0][0] + ox, quad[0][1] + oy],
      [quad[1][0] + ox, quad[1][1] + oy],
      [quad[2][0] + ox, quad[2][1] + oy],
      [quad[3][0] + ox, quad[3][1] + oy],
    ];
    const match = decodeQuad(gray, shifted, { robust: true, extraThresholds: true });
    if (match) return match;
  }
  return null;
}

function cx0(quad: [Corner, Corner, Corner, Corner]): number {
  return (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
}
function cy0(quad: [Corner, Corner, Corner, Corner]): number {
  return (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
}
