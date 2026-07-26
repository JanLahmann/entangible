/**
 * Shared synthetic board renderer for the vision suites — the TS twin of
 * `tests/utils/render_board.py`.
 *
 * Markers are painted straight into a grayscale buffer from the detector's own
 * dictionary, so every suite that uses it is hermetic: no camera, no Python, and
 * the same bits the browser decodes at runtime.
 */
import { BOARD, TILE, cornerMarkerSquare } from '../../src/vision/geometry';
import { GridMapper } from '../../src/vision/grid';
import { MEASURE_BLOCK_ID, QUBIT_WIRE_ID } from '../../src/vision/markers';
import type { BoardModel } from '../../src/vision/boardModel';
import type { PocketPipeline } from '../../src/vision/pipeline';
import type { GrayImage } from '../../src/vision/detect';
import dictionary from '../../src/vision/dictionary.json';

const DICT = dictionary.markers as Record<string, { bits: number[][] }>;

export interface Canvas {
  data: Uint8Array;
  width: number;
  height: number;
}

export function blank(width: number, height: number): Canvas {
  return { data: new Uint8Array(width * height).fill(255), width, height };
}

/** Paint a 6x6 marker (black border + inner bits) into the gray buffer. */
export function paintMarker(
  cv: Canvas,
  id: number,
  x0: number,
  y0: number,
  px: number,
): void {
  const bits = DICT[String(id)].bits;
  const m = px / 6;
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      const border = r === 0 || r === 5 || c === 0 || c === 5;
      if (!(border || bits[r - 1][c - 1] === 1)) continue;
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

/**
 * Render a board spanning `model.rect`: the four corner fiducials, any wire
 * blocks at the board's left edge, any measurement blocks at its right edge
 * (#97, mirrored inset) and gate tiles at the model's cell centres.
 */
export function renderBoard(
  model: BoardModel,
  placements: Array<[number, number, number]>,
  wireYs: readonly number[],
  ppm: number,
  measureYs: readonly number[] = [],
): GrayImage {
  const padMm = 24;
  const pad = Math.round(padMm * ppm);
  const cv = blank(
    Math.round(model.rect.widthMm * ppm) + 2 * pad,
    Math.round(model.rect.heightMm * ppm) + 2 * pad,
  );
  const at = (xMm: number, yMm: number): [number, number] => [
    xMm * ppm + pad,
    yMm * ppm + pad,
  ];

  for (const id of [0, 1, 2, 3]) {
    const square = cornerMarkerSquare(id, model.board);
    const [x0, y0] = at(square[0][0], square[0][1]);
    paintMarker(cv, id, x0, y0, BOARD.cornerMarkerSize * ppm);
  }

  // Wire blocks along the left edge, at the corner-block inset.
  const wireX = BOARD.cornerMargin + BOARD.cornerMarkerSize / 2;
  for (const y of wireYs) {
    const [x0, y0] = at(
      wireX - BOARD.cornerMarkerSize / 2,
      y - BOARD.cornerMarkerSize / 2,
    );
    paintMarker(cv, QUBIT_WIRE_ID, x0, y0, BOARD.cornerMarkerSize * ppm);
  }

  // Measurement blocks along the right edge, mirrored inset (#97).
  const measureX = model.rect.widthMm - BOARD.cornerMargin - BOARD.cornerMarkerSize / 2;
  for (const y of measureYs) {
    const [x0, y0] = at(
      measureX - BOARD.cornerMarkerSize / 2,
      y - BOARD.cornerMarkerSize / 2,
    );
    paintMarker(cv, MEASURE_BLOCK_ID, x0, y0, BOARD.cornerMarkerSize * ppm);
  }

  const mapper = new GridMapper(model.grid);
  const half = TILE.markerSize / 2;
  for (const [id, row, col] of placements) {
    const [cx, cy] = mapper.cellCenter(row, col);
    const [x0, y0] = at(cx - half, cy - half);
    paintMarker(cv, id, x0, y0, TILE.markerSize * ppm);
  }
  return { data: cv.data, width: cv.width, height: cv.height };
}

/**
 * Feed one still through the pipeline until the hysteresis settles.
 *
 * Wire blocks need their own 5-of-7 debounce BEFORE the tiles can be filed
 * against the wire rows, and the tile stabilizer then needs its own 5 frames on
 * the new keys — so a wired board takes roughly twice the frames of a bare one
 * to reach its final circuit (about a second at booth frame rates). Measurement
 * blocks (#97) debounce on the same window, in parallel.
 */
export function settle(pipe: PocketPipeline, frame: GrayImage, frames = 14) {
  let last = pipe.processFrame(frame);
  for (let i = 1; i < frames; i++) last = pipe.processFrame(frame);
  return last;
}

/** `count` evenly spread wire positions inside a board `height` mm tall. */
export function wireYsFor(height: number, count: number): number[] {
  const top = BOARD.gridOffsetY + BOARD.cellSize / 2;
  const bottom = height - top;
  if (count === 0) return [];
  if (count === 1) return [(top + bottom) / 2];
  const step = (bottom - top) / (count - 1);
  return Array.from({ length: count }, (_, i) => top + step * i);
}
