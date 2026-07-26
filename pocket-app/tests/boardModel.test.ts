/**
 * Variable corner placement (#94), TS side.
 *
 * Mirrors `packages/qamposer-vision/tests/test_board_model.py`: rectangle
 * estimation accuracy, the mat tolerance and column/row derivation as units —
 * then the whole `PocketPipeline` over synthetic boards at three scales
 * (mat-exact / 1.3× / 2×) × both layouts. Markers are painted straight into a
 * grayscale buffer from the detector's own dictionary, so the suite is
 * hermetic (no camera, no Python).
 */
import { describe, it, expect } from 'vitest';
import { estimateBoardRect, fitBoard } from '../src/vision/board';
import {
  BOARD,
  MAT_RECT,
  MAT_RECT_TOLERANCE,
  boardWithRect,
  centerSpan,
  cornerInset,
  cornerMarkerSquare,
  isMatRect,
  rectFromCenterSpan,
  TILE,
  type BoardRect,
} from '../src/vision/geometry';
import {
  MAX_COLUMNS,
  MAX_WIRES,
  buildBoardModel,
  deriveColumns,
  deriveRows,
  matBoardModel,
  type BoardLayout,
  type BoardModel,
} from '../src/vision/boardModel';
import { GridMapper } from '../src/vision/grid';
import { PocketPipeline } from '../src/vision/pipeline';
import type { Corner, DetectedMarker, GrayImage } from '../src/vision/detect';
import dictionary from '../src/vision/dictionary.json';

const DICT = dictionary.markers as Record<string, { bits: number[][] }>;

const rectOf = (sx: number, sy: number): BoardRect => ({
  widthMm: BOARD.matWidth * sx,
  heightMm: BOARD.matHeight * sy,
});

// ---------------------------------------------------------------------------
// Analytic corner markers (exact — no rasterization error)
// ---------------------------------------------------------------------------

/** A plausible camera homography: board-mm → image-px (perspective + offset). */
const H_CAMERA = [1.9, 0.13, 60, 0.09, 1.83, 44, 0.00021, 0.00013, 1];

function project(h: number[], x: number, y: number): [number, number] {
  const u = h[0] * x + h[1] * y + h[2];
  const v = h[3] * x + h[4] * y + h[5];
  const w = h[6] * x + h[7] * y + h[8];
  return [u / w, v / w];
}

/** The corner marker of `id` as it would be seen for a board spanning `rect`. */
function analyticCorner(id: number, rect: BoardRect): DetectedMarker {
  const square = cornerMarkerSquare(id, boardWithRect(rect));
  const corners = square.map(([x, y]) => project(H_CAMERA, x, y)) as unknown as [
    Corner,
    Corner,
    Corner,
    Corner,
  ];
  const cx = corners.reduce((s, c) => s + c[0], 0) / 4;
  const cy = corners.reduce((s, c) => s + c[1], 0) / 4;
  return { id, rotation: 0, corners, center: [cx, cy] };
}

describe('estimateBoardRect (#94)', () => {
  const cases: Array<[string, number, number]> = [
    ['mat-exact', 1.0, 1.0],
    ['1.3×', 1.3, 1.3],
    ['2×', 2.0, 2.0],
    ['wide (1.6 × 1.0)', 1.6, 1.0],
    ['small (0.7×)', 0.7, 0.7],
  ];

  it.each(cases)('recovers the span at %s', (_label, sx, sy) => {
    const rect = rectOf(sx, sy);
    const estimate = estimateBoardRect([0, 1, 2, 3].map((id) => analyticCorner(id, rect)));
    expect(estimate).not.toBeNull();
    expect(estimate!.cornerIds).toEqual([0, 1, 2, 3]);
    // Exact geometry in, exact geometry out — sub-0.1 mm on both axes.
    expect(Math.abs(estimate!.rect.widthMm - rect.widthMm)).toBeLessThan(0.1);
    expect(Math.abs(estimate!.rect.heightMm - rect.heightMm)).toBeLessThan(0.1);
    // And the pose fitted against it reprojects far under the 2 mm budget.
    expect(estimate!.rms).toBeLessThan(0.1);
    const board = fitBoard(
      [0, 1, 2, 3].map((id) => analyticCorner(id, rect)),
      estimate!.rect,
    );
    expect(board).not.toBeNull();
    expect(board!.reprojectionError).toBeLessThan(0.1);
    expect(board!.rect).toEqual(estimate!.rect);
  });

  it('degrades to three corners', () => {
    const rect = rectOf(1.5, 1.5);
    const estimate = estimateBoardRect([0, 1, 3].map((id) => analyticCorner(id, rect)));
    expect(estimate).not.toBeNull();
    expect(estimate!.cornerIds).toEqual([0, 1, 3]);
    // Three corners is 12 points instead of 16 and the fit is a compromise
    // rather than exact — still well inside a tenth of a percent.
    expect(Math.abs(estimate!.rect.widthMm - rect.widthMm) / rect.widthMm).toBeLessThan(
      0.001,
    );
    expect(
      Math.abs(estimate!.rect.heightMm - rect.heightMm) / rect.heightMm,
    ).toBeLessThan(0.001);
  });

  it('returns null below three corners', () => {
    expect(estimateBoardRect([])).toBeNull();
    expect(estimateBoardRect([0, 2].map((id) => analyticCorner(id, MAT_RECT)))).toBeNull();
  });

  it('survives corner-position jitter without moving the model', () => {
    // ±0.4 px of detector noise on every corner point of a 1.3× board.
    const rect = rectOf(1.3, 1.3);
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648 - 0.5;
    };
    const jittered = [0, 1, 2, 3].map((id) => {
      const m = analyticCorner(id, rect);
      const corners = m.corners.map(
        ([x, y]) => [x + rand() * 0.8, y + rand() * 0.8] as Corner,
      ) as [Corner, Corner, Corner, Corner];
      return { ...m, corners };
    });
    const estimate = estimateBoardRect(jittered);
    expect(estimate).not.toBeNull();
    expect(Math.abs(estimate!.rect.widthMm - rect.widthMm) / rect.widthMm).toBeLessThan(
      0.01,
    );
  });
});

describe('rectangle helpers', () => {
  it('round-trips the centre span', () => {
    const [spanX, spanY] = centerSpan(MAT_RECT);
    expect(spanX).toBe(BOARD.matWidth - 2 * cornerInset());
    expect(rectFromCenterSpan(spanX, spanY)).toEqual(MAT_RECT);
  });

  it('treats anything within the tolerance as the mat', () => {
    expect(isMatRect(MAT_RECT)).toBe(true);
    expect(
      isMatRect({
        widthMm: BOARD.matWidth * (1 + MAT_RECT_TOLERANCE * 0.9),
        heightMm: BOARD.matHeight * (1 - MAT_RECT_TOLERANCE * 0.9),
      }),
    ).toBe(true);
    expect(isMatRect({ widthMm: BOARD.matWidth * 1.2, heightMm: BOARD.matHeight })).toBe(
      false,
    );
  });
});

describe('board model derivation (#94)', () => {
  it('yields the classic model for a mat-sized rectangle, in both layouts', () => {
    const classic = matBoardModel().grid;
    for (const layout of ['stretch', 'grid'] as BoardLayout[]) {
      expect(buildBoardModel(MAT_RECT, layout).kind).toBe('mat');
      expect(buildBoardModel(MAT_RECT, layout).grid).toEqual(classic);
      const near = { widthMm: BOARD.matWidth * 1.02, heightMm: BOARD.matHeight * 0.98 };
      expect(buildBoardModel(near, layout).grid).toEqual(classic);
    }
    expect(buildBoardModel(null, 'grid').kind).toBe('mat');
  });

  it('derives the column count from the width', () => {
    expect(deriveColumns(BOARD.matWidth)).toBe(BOARD.cols);
    expect(deriveColumns(BOARD.matWidth + BOARD.pitch)).toBe(BOARD.cols + 1);
    expect(deriveColumns(BOARD.matWidth + BOARD.pitch - 1)).toBe(BOARD.cols);
    expect(deriveColumns(10)).toBe(1);
    expect(deriveColumns(100_000)).toBe(MAX_COLUMNS);
  });

  it('derives the row count from the height, capped at the simulator', () => {
    expect(deriveRows(BOARD.matHeight)).toBe(BOARD.rows);
    expect(deriveRows(BOARD.matHeight - BOARD.pitch)).toBe(BOARD.rows - 1);
    expect(deriveRows(10)).toBe(1);
    expect(deriveRows(100_000)).toBe(MAX_WIRES);
  });

  it('stretch scales both axes independently', () => {
    const rect = { widthMm: BOARD.matWidth * 1.6, heightMm: BOARD.matHeight * 1.2 };
    const model = buildBoardModel(rect, 'stretch');
    expect(model.kind).toBe('stretch');
    expect([model.rows, model.cols]).toEqual([BOARD.rows, BOARD.cols]);
    expect(model.grid.pitch).toBeCloseTo(BOARD.pitch * 1.6, 9);
    expect(model.grid.pitchY).toBeCloseTo(BOARD.pitch * 1.2, 9);
    const [cx, cy] = new GridMapper(model.grid).cellCenter(BOARD.rows - 1, BOARD.cols - 1);
    const [mx, my] = new GridMapper(BOARD).cellCenter(BOARD.rows - 1, BOARD.cols - 1);
    expect(cx).toBeCloseTo(mx * 1.6, 9);
    expect(cy).toBeCloseTo(my * 1.2, 9);
  });

  it('grid keeps the mat pitch and adds columns', () => {
    const rect = { widthMm: BOARD.matWidth * 2, heightMm: BOARD.matHeight };
    const model = buildBoardModel(rect, 'grid');
    expect(model.kind).toBe('grid');
    expect(model.grid.pitch).toBe(BOARD.pitch);
    expect(model.grid.cellSize).toBe(BOARD.cellSize);
    expect(model.cols).toBe(deriveColumns(rect.widthMm));
    expect(model.cols).toBeGreaterThan(BOARD.cols);
    expect(model.rows).toBe(BOARD.rows);
  });

  it('falls back to grid for an unknown layout', () => {
    const rect = { widthMm: BOARD.matWidth * 1.5, heightMm: BOARD.matHeight };
    expect(buildBoardModel(rect, 'nonsense').kind).toBe('grid');
  });
});

// ---------------------------------------------------------------------------
// Rendered end-to-end: scale × layout
// ---------------------------------------------------------------------------

interface Canvas {
  data: Uint8Array;
  width: number;
  height: number;
}

function blank(width: number, height: number): Canvas {
  return { data: new Uint8Array(width * height).fill(255), width, height };
}

/** Paint a 6×6 marker (black border + inner bits) into the gray buffer. */
function paintMarker(cv: Canvas, id: number, x0: number, y0: number, px: number): void {
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
 * Render a board spanning `model.rect`: the four corner fiducials and gate
 * tiles at the model's cell centres.
 */
function renderBoard(
  model: BoardModel,
  placements: Array<[number, number, number]>,
  ppm: number,
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

  const mapper = new GridMapper(model.grid);
  const half = TILE.markerSize / 2;
  for (const [id, row, col] of placements) {
    const [cx, cy] = mapper.cellCenter(row, col);
    const [x0, y0] = at(cx - half, cy - half);
    paintMarker(cv, id, x0, y0, TILE.markerSize * ppm);
  }
  return { data: cv.data, width: cv.width, height: cv.height };
}

/** Feed one still through the pipeline until the hysteresis settles. */
function settle(pipe: PocketPipeline, frame: GrayImage, frames = 8) {
  let last = pipe.processFrame(frame);
  for (let i = 1; i < frames; i++) last = pipe.processFrame(frame);
  return last;
}

describe('PocketPipeline over scale × layout', () => {
  const scales: Array<[string, number, number]> = [
    ['mat', 1.0, 1.5],
    ['1.3×', 1.3, 1.2],
    ['2×', 2.0, 0.9],
  ];
  const layouts: BoardLayout[] = ['stretch', 'grid'];

  for (const [label, scale, ppm] of scales) {
    for (const layout of layouts) {
      it(`detects a Bell pair on a ${label} board, ${layout}`, () => {
        const rect = rectOf(scale, scale);
        const model = buildBoardModel(rect, layout);
        const frame = renderBoard(
          model,
          [
            [10, 0, 0],
            [14, 0, 1],
            [15, 1, 1],
          ],
          ppm,
        );

        const pipe = new PocketPipeline({ boardLayout: layout });
        const result = settle(pipe, frame);

        expect(result.boardFound).toBe(true);
        expect(result.model.kind).toBe(scale === 1 ? 'mat' : layout);
        expect(result.circuit.qubits).toBe(model.rows);
        expect(result.circuit.gates.map((g) => [g.type, g.position])).toEqual([
          ['H', 0],
          ['CNOT', 1],
        ]);
        expect(result.circuit.gates[1].control).toBe(0);
        expect(result.circuit.gates[1].target).toBe(1);
        expect(result.warnings).toEqual([]);
      });
    }
  }

  it('uses the extra columns a double-width table buys (grid)', () => {
    const rect = { widthMm: BOARD.matWidth * 2, heightMm: BOARD.matHeight };
    const model = buildBoardModel(rect, 'grid');
    expect(model.cols).toBeGreaterThanOrEqual(BOARD.cols + 8);
    const far = model.cols - 1;
    const frame = renderBoard(
      model,
      [
        [10, 0, 0],
        [11, 0, far],
      ],
      1.0,
    );
    const result = settle(new PocketPipeline({ boardLayout: 'grid' }), frame);
    expect(result.model.cols).toBe(model.cols);
    expect(result.circuit.gates.map((g) => [g.type, g.position])).toEqual([
      ['H', 0],
      ['X', far],
    ]);
  });

  it('keeps a mat-sized board on the classic model whatever the switch says', () => {
    for (const layout of layouts) {
      const model = matBoardModel();
      const frame = renderBoard(model, [[10, 0, 0]], 1.5);
      const result = settle(new PocketPipeline({ boardLayout: layout }), frame);
      expect(result.model.kind).toBe('mat');
      expect(result.model.rect).toEqual(MAT_RECT);
      expect(result.circuit).toEqual({
        qubits: BOARD.rows,
        gates: [{ id: 'h-0-0', type: 'H', qubit: 0, position: 0 }],
      });
    }
  });
});
