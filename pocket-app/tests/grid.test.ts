/**
 * Grid mapping (#109), TS side — rows from the lattice / wires, columns
 * clustered from the tiles' actual x positions.
 *
 * Mirrors `packages/qamposer-vision/tests/test_grid.py` (same inputs, same
 * expected numbers — the two sides share `roundHalfUp`, so they agree at the
 * halves too) plus the insertion-invariance test of `test_pipeline.py`.
 */
import { describe, it, expect } from 'vitest';
import { BOARD } from '../src/vision/geometry';
import { matBoardModel } from '../src/vision/boardModel';
import {
  COLUMN_GAP_MM,
  GridMapper,
  clusterColumns,
  firstCenterX,
  roundHalfUp,
  wireYAt,
  type GridConfig,
} from '../src/vision/grid';
import { PocketPipeline, X_BUCKET_MM, xBucket } from '../src/vision/pipeline';
import { parseTile, type Tile } from '../src/vision/stabilizer';
import { renderBoard } from './utils/renderBoard';

const mapper = new GridMapper(BOARD);
const x0 = firstCenterX(BOARD);
const cols = (xs: number[]): number[] => clusterColumns(xs, BOARD.pitch, x0);
const center = (row: number, col: number) => mapper.cellCenter(row, col);

function combinations(n: number): number[][] {
  const out: number[][] = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    const subset: number[] = [];
    for (let c = 0; c < n; c++) if (mask & (1 << c)) subset.push(c);
    out.push(subset);
  }
  return out;
}

describe('roundHalfUp', () => {
  it('rounds every half up (JS Math.round semantics, shared with Python)', () => {
    const halves = [-3, -2, -1, 0, 1, 2].map((k) => k + 0.5);
    expect(halves.map(roundHalfUp)).toEqual([-2, -1, 0, 1, 2, 3]);
    expect([-0.49, 0, 0.49, 1.49, 1.51].map((v) => roundHalfUp(v) + 0)).toEqual([
      0, 0, 0, 1, 2,
    ]);
  });
});

describe('clusterColumns', () => {
  it('anchors on lattice column 0', () => {
    expect(x0).toBe(center(0, 0)[0]);
    expect(COLUMN_GAP_MM).toBe(30);
  });

  it('returns nothing for no tiles', () => {
    expect(clusterColumns([], 70, 111)).toEqual([]);
  });

  it('gives a single tile its lattice column', () => {
    for (let col = 0; col < BOARD.cols; col++) {
      expect(cols([center(0, col)[0]])).toEqual([col]);
    }
  });

  it('keeps a pair within the gap in one column', () => {
    const [cx] = center(0, 2);
    for (const dx of [0, 5, 17.5, COLUMN_GAP_MM]) {
      expect(cols([cx, cx + dx])).toEqual([2, 2]);
    }
    expect(cols([cx, cx + COLUMN_GAP_MM + 0.1])).toEqual([2, 3]);
  });

  it('spaces columns by the pitch', () => {
    expect(cols([x0, x0 + 40])).toEqual([0, 1]);
    expect(cols([x0, x0 + 140])).toEqual([0, 2]);
    expect(cols([x0 + 140, x0])).toEqual([2, 0]);
  });

  it('chains by single linkage', () => {
    const xs = [x0 + 60, x0 - 30, x0, x0 + 30];
    expect(cols(xs)).toEqual([0, 0, 0, 0]);
    expect(cols([...xs, x0 + 15 + 140])).toEqual([0, 0, 0, 0, 2]);
  });

  it('clamps a left-of-grid first column to 0', () => {
    for (const x of [x0 - 35.1, x0 - 70, x0 - 200, -50]) {
      expect(cols([x])).toEqual([0]);
    }
    expect(cols([x0 - 70, x0, x0 + 70])).toEqual([0, 1, 2]);
  });

  it('reproduces the lattice for EVERY subset of mat columns', () => {
    let subsets = 0;
    for (const subset of combinations(BOARD.cols)) {
      const xs: number[] = [];
      const want: number[] = [];
      for (const col of subset) {
        for (const row of [0, BOARD.rows - 1]) {
          xs.push(center(row, col)[0]);
          want.push(col);
        }
      }
      expect(cols(xs)).toEqual(want);
      subsets++;
    }
    expect(subsets).toBe(2 ** BOARD.cols - 1);
  });

  it('matches the lattice under ±10 mm jitter (all sign patterns)', () => {
    const centres = Array.from({ length: BOARD.cols }, (_, c) => center(0, c)[0]);
    const want = centres.map((_, c) => c);
    for (let mask = 0; mask < 1 << centres.length; mask++) {
      const xs = centres.map((x, i) => x + (mask & (1 << i) ? 10 : -10));
      expect(cols(xs)).toEqual(want);
    }
  });
});

describe('GridMapper.assignRow', () => {
  it('assigns every cell centre its row', () => {
    for (let row = 0; row < BOARD.rows; row++) {
      for (let col = 0; col < BOARD.cols; col++) {
        const [cx, cy] = center(row, col);
        expect(mapper.assignRow(cx, cy)).toBe(row);
      }
    }
  });

  it('ignores x entirely (no x window, #109)', () => {
    const [, cy] = center(2, 3);
    for (const x of [-50, 0, 111 + 35, 145, 10_000]) {
      expect(mapper.assignRow(x, cy)).toBe(2);
    }
  });

  it('accepts within the half-cell y window', () => {
    const [cx, cy] = center(2, 3);
    const half = BOARD.cellSize / 2;
    expect(mapper.assignRow(cx, cy - 20)).toBe(2);
    expect(mapper.assignRow(cx, cy + half)).toBe(2);
    expect(mapper.assignRow(cx, cy - half)).toBe(2);
  });

  it('rejects between rows and outside the rows', () => {
    const [cx, cy] = center(1, 1);
    const off = BOARD.cellSize / 2 + 2;
    expect(mapper.assignRow(cx, cy + off)).toBeNull();
    expect(mapper.assignRow(cx, cy - off)).toBeNull();
    const [, cy0] = center(0, 0);
    const [, cyLast] = center(BOARD.rows - 1, 0);
    expect(mapper.assignRow(cx, cy0 - BOARD.pitch)).toBeNull();
    expect(mapper.assignRow(cx, cyLast + BOARD.pitch)).toBeNull();
    expect(mapper.assignRow(cx, -50)).toBeNull();
    expect(mapper.assignRow(cx, 100000)).toBeNull();
  });

  it('scales the row window with tolerance', () => {
    const [cx, cy] = center(0, 0);
    const dy = BOARD.cellSize / 2 + 2;
    expect(new GridMapper(BOARD, 1.0).assignRow(cx, cy + dy)).toBeNull();
    expect(new GridMapper(BOARD, 1.3).assignRow(cx, cy + dy)).toBe(0);
  });

  it('snaps to wires within the window', () => {
    const wired: GridConfig = { ...BOARD, rows: 3, wireYs: [120, 240, 360] };
    const m = new GridMapper(wired);
    const half = BOARD.cellSize / 2;
    [120, 240, 360].forEach((wy, row) => {
      expect(m.assignRow(500, wy)).toBe(row);
      expect(m.assignRow(500, wy + half)).toBe(row);
      expect(m.assignRow(500, wy - half)).toBe(row);
      expect(m.assignRow(500, wy - half - 0.5)).toBeNull();
    });
    expect(m.assignRow(500, 180)).toBeNull();
    expect(new GridMapper({ ...BOARD, wireYs: [] }).assignRow(500, 120)).toBeNull();
  });

  it("follows a tilted wire at the tile's x", () => {
    const tilted: GridConfig = {
      ...BOARD,
      rows: 2,
      wireYs: [150, 250],
      wireSpans: [[30, 150, 700, 230], null],
    };
    const m = new GridMapper(tilted);
    for (const x of [30, 200, 450, 700]) {
      expect(m.assignRow(x, wireYAt(tilted, 0, x))).toBe(0);
    }
    expect(wireYAt(tilted, 0, 700)).toBeCloseTo(230);
    expect(m.assignRow(700, 250)).toBe(1);
  });
});

describe('insertion invariance (#109)', () => {
  it('inserting a tile left of all others never drops another', () => {
    // Mirrors test_pipeline.test_inserting_a_tile_left_of_all_others_never_drops_another.
    const model = matBoardModel();
    const bell: Array<[number, number, number]> = [
      [30, 0, 0],
      [17, 0, 1],
      [15, 1, 1],
    ];
    const [cx0, cy2] = center(2, 0);
    const leftX = cx0 - BOARD.pitch;
    const frameA = renderBoard(model, bell, [], 1.5);
    const frameB = renderBoard(model, bell, [], 1.5, { loose: [[35, leftX, cy2]] });

    const pipe = new PocketPipeline();
    const stable = (): ReadonlySet<Tile> => pipe['stabilizer'].stable;
    let last = pipe.processFrame(frameA);
    for (let i = 1; i < 15; i++) last = pipe.processFrame(frameA);
    const settled = new Set(stable());
    expect(settled.size).toBe(3);
    expect(
      [...settled].map((t) => parseTile(t).slice(0, 2).join(',')).sort(),
    ).toEqual(['15,1', '17,0', '30,0']);
    expect(last.circuit.gates.map((g) => g.type)).toEqual(['H', 'CNOT']);

    const flicker = [frameB, frameA, frameB, frameB, frameA, frameB, frameA, frameB];
    const script = [...flicker, ...Array(20).fill(frameB)];
    const emitted = [];
    for (const frame of script) {
      const r = pipe.processFrame(frame);
      const now = stable();
      for (const t of settled) expect(now.has(t)).toBe(true);
      if (r.changed) emitted.push(r.circuit);
      // Every circuit on the way keeps the whole Bell pair.
      const kinds = r.circuit.gates.map((g) => g.type);
      expect(kinds).toContain('H');
      expect(kinds).toContain('CNOT');
    }
    expect(emitted).toHaveLength(1);
    expect(
      emitted[0].gates.map((g) => [g.type, g.position]).sort(),
    ).toEqual([
      ['CNOT', 2],
      ['H', 1],
      ['X', 0],
    ]);

    const added = [...stable()].filter((t) => !settled.has(t)).map(parseTile);
    expect(added).toHaveLength(1);
    const [mid, row, bucket, rot] = added[0];
    expect([mid, row, rot]).toEqual([35, 2, 0]);
    expect(Math.abs(bucket * X_BUCKET_MM - leftX)).toBeLessThanOrEqual(X_BUCKET_MM);
    expect(xBucket(leftX)).toBe(Math.floor(leftX / 10 + 0.5));
  });
});
