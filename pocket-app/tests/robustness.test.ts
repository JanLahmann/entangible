/**
 * Unit coverage for the robustness work: the spatial (not id-keyed) dedupe that
 * lets a board carry repeated marker ids (GHZ-3's two CNOT tiles), grid-guided
 * redetection of a cell the blind front end missed, and the robust single-quad
 * decode primitives. Markers are painted straight into a grayscale buffer here
 * (no Python / no camera) from the same dictionary bit matrices the detector
 * matches against, so the tests are hermetic.
 */
import { describe, it, expect } from 'vitest';
import {
  detectMarkers,
  decodeQuad,
  sampleGridGray,
  sampleQuietZoneWhite,
  borderAwareThreshold,
  type GrayImage,
  type Corner,
} from '../src/vision/detect';
import { fitBoard } from '../src/vision/board';
import { guidedRedetect } from '../src/vision/guided';
import { GridMapper } from '../src/vision/grid';
import { BOARD, TILE, cornerMarkerSquare } from '../src/vision/geometry';
import dictionary from '../src/vision/dictionary.json';

const markers = dictionary.markers as Record<string, { bits: number[][] }>;

interface Canvas {
  data: Uint8Array;
  width: number;
  height: number;
}

function blank(width: number, height: number): Canvas {
  const data = new Uint8Array(width * height).fill(255); // white
  return { data, width, height };
}

/** Paint a 6×6 marker (black border + inner bits) into the gray buffer. */
function paintMarker(
  cv: Canvas,
  id: number,
  x0: number,
  y0: number,
  markerPx: number,
): void {
  const bits = markers[String(id)].bits;
  const m = markerPx / 6;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      const border = r === 0 || r === 5 || c === 0 || c === 5;
      const black = border ? true : bits[r - 1][c - 1] === 1;
      if (!black) continue;
      const px0 = Math.round(x0 + c * m);
      const py0 = Math.round(y0 + r * m);
      const px1 = Math.round(x0 + (c + 1) * m);
      const py1 = Math.round(y0 + (r + 1) * m);
      for (let y = py0; y < py1; y++) {
        for (let x = px0; x < px1; x++) {
          if (x >= 0 && y >= 0 && x < cv.width && y < cv.height) cv.data[y * cv.width + x] = 0;
        }
      }
    }
  }
}

const asGray = (cv: Canvas): GrayImage => ({ data: cv.data, width: cv.width, height: cv.height });

// A marker painted flush at a known box, plus its quad corners.
function paintAt(cv: Canvas, id: number, x0: number, y0: number, size: number): [Corner, Corner, Corner, Corner] {
  paintMarker(cv, id, x0, y0, size);
  return [
    [x0, y0],
    [x0 + size, y0],
    [x0 + size, y0 + size],
    [x0, y0 + size],
  ];
}

describe('robust single-quad decode', () => {
  it('border-aware threshold separates a painted marker and decodes it', () => {
    const cv = blank(200, 200);
    const corners = paintAt(cv, 30, 40, 40, 90);
    const gray = asGray(cv);

    const samples = sampleGridGray(gray, corners, true);
    const quiet = sampleQuietZoneWhite(gray, corners);
    const thr = borderAwareThreshold(samples, quiet);
    expect(thr).not.toBeNull();
    expect(thr!).toBeGreaterThan(20);
    expect(thr!).toBeLessThan(235);

    const match = decodeQuad(gray, corners, { robust: true, extraThresholds: true });
    expect(match).not.toBeNull();
    expect(match!.id).toBe(30);
  });

  it('border-aware threshold is null on a non-marker (all-white) quad', () => {
    const cv = blank(200, 200);
    const corners: [Corner, Corner, Corner, Corner] = [
      [40, 40],
      [130, 40],
      [130, 130],
      [40, 130],
    ];
    const gray = asGray(cv);
    const samples = sampleGridGray(gray, corners, true);
    const quiet = sampleQuietZoneWhite(gray, corners);
    expect(borderAwareThreshold(samples, quiet)).toBeNull();
  });
});

describe('spatial dedupe (repeated marker ids)', () => {
  it('keeps two identical-id markers at different locations', () => {
    const cv = blank(400, 200);
    paintMarker(cv, 17, 40, 55, 90); // CNOT control, left
    paintMarker(cv, 17, 260, 55, 90); // CNOT control, right — same id
    const found = detectMarkers(asGray(cv));
    const id17 = found.filter((m) => m.id === 17);
    expect(id17.length).toBe(2);
  });

  it('legacy id-dedupe collapses them to one (the original GHZ-3 failure)', () => {
    const cv = blank(400, 200);
    paintMarker(cv, 17, 40, 55, 90);
    paintMarker(cv, 17, 260, 55, 90);
    const found = detectMarkers(asGray(cv), { legacyIdDedupe: true });
    expect(found.filter((m) => m.id === 17).length).toBe(1);
  });
});

describe('grid-guided redetection', () => {
  it('rescues a tile in a cell the blind set omitted, at the right (row,col)', () => {
    const ppm = 1.6;
    const pad = 24;
    const w = Math.round(BOARD.matWidth * ppm) + 2 * pad;
    const h = Math.round(BOARD.matHeight * ppm) + 2 * pad;
    const cv = blank(w, h);
    const mmToPx = (x: number, y: number): [number, number] => [x * ppm + pad, y * ppm + pad];

    // Paint the four corner fiducials at their board-mm squares.
    for (const id of [0, 1, 2, 3]) {
      const sq = cornerMarkerSquare(id);
      const [px, py] = mmToPx(sq[0][0], sq[0][1]);
      paintMarker(cv, id, px, py, BOARD.cornerMarkerSize * ppm);
    }
    // Paint one gate tile (H, id 30) at cell (0,0).
    const grid = new GridMapper(BOARD);
    const [cx, cy] = grid.cellCenter(0, 0);
    const half = TILE.markerSize / 2;
    const [tx, ty] = mmToPx(cx - half, cy - half);
    paintMarker(cv, 30, tx, ty, TILE.markerSize * ppm);

    const gray = asGray(cv);
    const all = detectMarkers(gray);
    const board = fitBoard(all);
    expect(board).not.toBeNull();

    // Simulate a frame where the blind stage saw only the corners.
    const blindCornersOnly = all.filter((m) => m.id <= 3);
    const rescued = guidedRedetect(gray, board!, blindCornersOnly, grid);

    const rescuedH = rescued.find((m) => m.id === 30);
    expect(rescuedH).toBeDefined();
    const [bx, by] = board!.imageToBoard(rescuedH!.center);
    expect(grid.assign(bx, by)).toEqual({ row: 0, col: 0 });
  });
});
