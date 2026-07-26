/**
 * Measurement blocks (#97), TS side — the right edge refines, never creates.
 *
 * Mirrors `packages/qamposer-vision/tests/test_measure_blocks.py`: the pairing
 * rule and its determinism, the tilted-wire geometry and its effect on
 * snapping, the right-hand hysteresis, and the whole `PocketPipeline` over
 * synthetic boards with {0, 3, 5} left blocks × {0, 3, 5} right blocks.
 *
 * The asymmetry is the point and is asserted everywhere: a wire exists iff its
 * LEFT block exists, right blocks only say where a wire ends, and an unpaired
 * right block is reported and dropped. Printing none must leave #95's behaviour
 * bit for bit.
 */
import { describe, it, expect } from 'vitest';
import { BOARD, type BoardRect } from '../src/vision/geometry';
import {
  buildBoardModel,
  matBoardModel,
  type WireSpan,
} from '../src/vision/boardModel';
import { GridMapper, wireYAt } from '../src/vision/grid';
import {
  MeasureStabilizer,
  PAIR_TOLERANCE_FRACTION,
  gridRightEdge,
  pairMeasures,
  pairTolerance,
  type Point,
} from '../src/vision/wires';
import { MEASURE_BLOCK_ID } from '../src/vision/markers';
import { PocketPipeline } from '../src/vision/pipeline';
import { renderBoard, settle, wireYsFor } from './utils/renderBoard';

const rectOf = (scale: number): BoardRect => ({
  widthMm: BOARD.matWidth * scale,
  heightMm: BOARD.matHeight * scale,
});

// ---------------------------------------------------------------------------
// Pairing: nearest by y, deterministic, tolerance = half a row pitch
// ---------------------------------------------------------------------------

describe('measurement-block pairing', () => {
  it('uses exactly half the row pitch as its tolerance', () => {
    expect(PAIR_TOLERANCE_FRACTION).toBe(0.5);
    expect(pairTolerance(BOARD)).toBeCloseTo(BOARD.pitch / 2, 9);
  });

  it('pairs each right block with its own wire', () => {
    const wires: Point[] = [
      [30, 100],
      [30, 200],
      [30, 300],
    ];
    const measures: Point[] = [
      [700, 104],
      [700, 196],
      [700, 301],
    ];
    const pairing = pairMeasures(wires, measures, 35);
    expect(pairing.paired).toBe(3);
    expect(pairing.unpaired).toEqual([]);
    expect(pairing.spans).toEqual([
      [30, 100, 700, 104],
      [30, 200, 700, 196],
      [30, 300, 700, 301],
    ]);
    expect(pairing.meanSpan).toBeCloseTo(670, 9);
  });

  it('leaves a right block out of tolerance unpaired', () => {
    const pairing = pairMeasures([[30, 100]], [[700, 140]], 35);
    expect(pairing.paired).toBe(0);
    expect(pairing.spans).toEqual([null]);
    expect(pairing.unpaired).toEqual([[700, 140]]);
  });

  it('leaves every right block unpaired when there are no wires', () => {
    const pairing = pairMeasures(
      [],
      [
        [700, 100],
        [700, 200],
      ],
      35,
    );
    expect(pairing.spans).toEqual([]);
    expect(pairing.paired).toBe(0);
    expect(pairing.unpaired).toHaveLength(2);
    expect(pairing.meanSpan).toBeNull();
  });

  it('gives a contested wire to the closer block and reports the other', () => {
    const pairing = pairMeasures(
      [[30, 200]],
      [
        [700, 180],
        [700, 205],
      ],
      35,
    );
    expect(pairing.spans).toEqual([[30, 200, 700, 205]]);
    expect(pairing.unpaired).toEqual([[700, 180]]);
  });

  it('is a pure function of the ordered lists, ties included', () => {
    const wires: Point[] = [
      [30, 100],
      [30, 170],
    ];
    const measures: Point[] = [[700, 135]]; // exactly 35 mm from BOTH wires
    const first = pairMeasures(wires, measures, 35);
    for (let i = 0; i < 20; i++) {
      expect(pairMeasures(wires, measures, 35)).toEqual(first);
    }
    expect(first.spans[0]).not.toBeNull();
    expect(first.spans[1]).toBeNull();
    expect(first.unpaired).toEqual([]);
  });

  it('never gives one wire two right blocks', () => {
    const pairing = pairMeasures(
      [[30, 100]],
      [
        [700, 99],
        [700, 101],
      ],
      35,
    );
    expect(pairing.paired).toBe(1);
    expect(pairing.unpaired).toHaveLength(1);
  });

  it('counts a block as a wire end only right of the last column', () => {
    const edge = gridRightEdge(BOARD);
    expect(edge).toBeCloseTo(
      BOARD.gridOffsetX + BOARD.pitch * (BOARD.cols - 1) + BOARD.cellSize,
      9,
    );
    expect(edge).toBeGreaterThan(BOARD.gridOffsetX);
    expect(edge).toBeLessThan(BOARD.matWidth);
  });
});

// ---------------------------------------------------------------------------
// The tilted wire: geometry and snapping
// ---------------------------------------------------------------------------

describe('a paired wire is the segment through both block centres', () => {
  it('interpolates and extrapolates along the segment', () => {
    const spans: (WireSpan | null)[] = [[30, 100, 700, 140]];
    const model = matBoardModel([100], BOARD, spans);
    expect(model.grid.wireSpans).toEqual(spans);
    expect(model.measureCount).toBe(1);
    expect(wireYAt(model.grid, 0, 30)).toBeCloseTo(100, 9);
    expect(wireYAt(model.grid, 0, 700)).toBeCloseTo(140, 9);
    expect(wireYAt(model.grid, 0, 365)).toBeCloseTo(120, 9);
    expect(wireYAt(model.grid, 0, 1370)).toBeCloseTo(180, 9); // one run further
  });

  it('leaves an unpaired wire horizontal', () => {
    const model = matBoardModel([100, 300], BOARD, [[30, 100, 700, 140], null]);
    expect(model.measureCount).toBe(1);
    expect(wireYAt(model.grid, 1, 30)).toBeCloseTo(300, 9);
    expect(wireYAt(model.grid, 1, 700)).toBeCloseTo(300, 9);
  });

  it('carries its tiles: a tile on the tilt is on the wire', () => {
    const wireYs = [150, 250];
    const flat = matBoardModel(wireYs);
    const tilted = matBoardModel(wireYs, BOARD, [[30, 150, 700, 230], null]);
    const last = flat.grid.cols - 1;
    const [cx] = new GridMapper(flat.grid).cellCenter(0, last);
    const onTheTilt = wireYAt(tilted.grid, 0, cx);
    expect(onTheTilt).toBeGreaterThan(200);

    expect(new GridMapper(tilted.grid).assign(cx, onTheTilt)).toEqual({
      row: 0,
      col: last,
    });
    // Without the span the same tile is not on wire 0 at all.
    expect(new GridMapper(flat.grid).assign(cx, onTheTilt)).not.toEqual({
      row: 0,
      col: last,
    });
  });

  it('still rejects a tile that is on no wire', () => {
    const model = matBoardModel([150, 350], BOARD, [[30, 150, 700, 190], null]);
    const [cx] = new GridMapper(model.grid).cellCenter(0, 0);
    expect(new GridMapper(model.grid).assign(cx, 260)).toBeNull();
  });

  it('drops a mismatched span list rather than misapplying it', () => {
    const model = matBoardModel([100, 200], BOARD, [[30, 100, 700, 140]]);
    expect(model.grid.wireSpans).toBeNull();
    expect(model.measureCount).toBe(0);
  });

  it('leaves the pre-#97 shape when nothing was measured', () => {
    const plain = matBoardModel([100, 200]);
    const withNulls = matBoardModel([100, 200], BOARD, [null, null]);
    expect(withNulls.grid.wireSpans).toBeNull();
    expect(withNulls.grid.wireYs).toEqual(plain.grid.wireYs);
    expect(withNulls.measureCount).toBe(0);
  });

  it('reports no measure count at all without wires', () => {
    expect(matBoardModel().measureCount).toBeNull();
    expect(matBoardModel([]).measureCount).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hysteresis on the right-hand set
// ---------------------------------------------------------------------------

describe('MeasureStabilizer', () => {
  const pts: Point[] = [
    [700, 100],
    [700, 200],
  ];

  it('appears after five of seven frames', () => {
    const st = new MeasureStabilizer();
    for (let i = 0; i < 4; i++) expect(st.update(pts).points).toEqual([]);
    const result = st.update(pts);
    expect(result.changed).toBe(true);
    expect(result.points).toEqual(pts);
  });

  it('survives a hand over the right edge for eleven frames', () => {
    const st = new MeasureStabilizer();
    for (let i = 0; i < 5; i++) st.update(pts);
    for (let i = 0; i < 11; i++) {
      const r = st.update([]);
      expect(r.changed).toBe(false);
      expect(r.points).toEqual(pts);
    }
    const r = st.update([]);
    expect(r.changed).toBe(true);
    expect(r.points).toEqual([]);
  });

  it('tracks positions without re-emitting', () => {
    const st = new MeasureStabilizer();
    for (let i = 0; i < 5; i++) st.update(pts);
    const r = st.update([
      [702, 104],
      [699, 197],
    ]);
    expect(r.changed).toBe(false);
    expect(r.points).toEqual([
      [702, 104],
      [699, 197],
    ]);
  });

  it('forgets everything on reset', () => {
    const st = new MeasureStabilizer();
    for (let i = 0; i < 5; i++) st.update(pts);
    expect(st.stable).toHaveLength(2);
    st.reset();
    expect(st.stable).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// End to end through the pipeline
// ---------------------------------------------------------------------------

describe('PocketPipeline over left × right block counts', () => {
  const scales: Array<[string, number, number]> = [
    ['mat', 1.0, 1.5],
    ['1.5×', 1.5, 1.1],
  ];
  const counts: Array<[number, number]> = [
    [0, 0],
    [0, 3],
    [3, 0],
    [3, 3],
    [5, 5],
  ];

  for (const [label, scale, ppm] of scales) {
    for (const [left, right] of counts) {
      it(`reads a ${label} board with ${left} wire and ${right} measurement blocks`, () => {
        const rect = rectOf(scale);
        const wireYs = wireYsFor(rect.heightMm, left);
        const measureYs = wireYsFor(rect.heightMm, right);
        const model = buildBoardModel(rect, 'grid', left === 0 ? null : wireYs);
        const frame = renderBoard(
          model,
          [
            [10, 0, 0],
            [14, 0, 1],
            [15, 1, 1],
          ],
          wireYs,
          ppm,
          measureYs,
        );
        const pipe = new PocketPipeline({ boardLayout: 'grid' });
        const result = settle(pipe, frame);

        expect(result.boardFound).toBe(true);
        // The qubit count is the LEFT count, whatever the right side does.
        if (left > 0) {
          expect(result.model.wireCount).toBe(left);
          expect(result.circuit.qubits).toBe(left);
        } else {
          expect(result.model.wireCount).toBeNull();
          expect(result.circuit.qubits).toBe(model.rows);
        }
        // Right blocks refine only where there is a wire to refine.
        const expectedPaired = Math.min(left, right);
        expect(result.model.measureCount ?? 0).toBe(expectedPaired);
        const unpaired = result.warnings.filter((w) => w.kind === 'unpaired_measure');
        expect(unpaired).toHaveLength(right - expectedPaired);

        // The Bell pair reads the same in every cell of the sweep.
        expect(result.circuit.gates.map((g) => [g.type, g.position])).toEqual([
          ['H', 0],
          ['CNOT', 1],
        ]);
        expect(result.circuit.gates[1].control).toBe(0);
        expect(result.circuit.gates[1].target).toBe(1);
        expect(result.warnings.filter((w) => w.kind === 'off_grid')).toEqual([]);
      });
    }
  }

  it('warns about an unpaired right block and changes nothing else', () => {
    const wireYs = [150, 290];
    const stray = [150 + BOARD.pitch]; // squarely between the two wires
    const model = buildBoardModel(MAT_RECT_OF_BOARD, 'grid', wireYs);
    const frame = renderBoard(model, [[10, 0, 0]], wireYs, 1.5, stray);
    const result = settle(new PocketPipeline({ boardLayout: 'grid' }), frame);

    expect(result.model.wireCount).toBe(2); // unchanged by the stray block
    expect(result.model.measureCount).toBe(0);
    const unpaired = result.warnings.filter((w) => w.kind === 'unpaired_measure');
    expect(unpaired).toHaveLength(1);
    expect(unpaired[0].marker_ids).toEqual([MEASURE_BLOCK_ID]);
    expect(unpaired[0].message).toContain('ignored');
    expect(result.circuit.qubits).toBe(2);
  });

  it('files the tiles of a board whose block rows are ±8 mm out of square', () => {
    const leftYs = [150, 290];
    const rightYs = [158, 282];
    const wireX = BOARD.cornerMargin + BOARD.cornerMarkerSize / 2;
    const measureX = BOARD.matWidth - BOARD.cornerMargin - BOARD.cornerMarkerSize / 2;
    const spans: (WireSpan | null)[] = leftYs.map((ly, i) => [
      wireX,
      ly,
      measureX,
      rightYs[i],
    ]);
    const tilted = matBoardModel(leftYs, BOARD, spans);
    expect(tilted.measureCount).toBe(2);

    const last = tilted.grid.cols - 1;
    const frame = renderBoard(
      tilted,
      [
        [10, 0, 0],
        [11, 0, last],
        [12, 1, 3],
      ],
      leftYs,
      1.5,
      rightYs,
    );
    const result = settle(new PocketPipeline({ boardLayout: 'grid' }), frame);

    expect(result.model.wireCount).toBe(2);
    expect(result.model.measureCount).toBe(2);
    expect(result.warnings).toEqual([]);
    expect(
      result.circuit.gates.map((g) => [g.type, g.position, g.qubit]).sort(),
    ).toEqual(
      [
        ['H', 0, 0],
        ['X', last, 0],
        ['Y', 3, 1],
      ].sort(),
    );
  });

  it('is bit-for-bit the #95 result with zero right blocks', () => {
    const wireYs = [150, 250, 350];
    const model = buildBoardModel(MAT_RECT_OF_BOARD, 'grid', wireYs);
    const frame = renderBoard(
      model,
      [
        [10, 0, 0],
        [14, 0, 1],
        [15, 2, 1],
      ],
      wireYs,
      1.5,
    );
    const result = settle(new PocketPipeline({ boardLayout: 'grid' }), frame);

    expect(result.model.grid.wireSpans ?? null).toBeNull();
    expect(result.model.measureCount).toBe(0);
    expect(result.circuit.qubits).toBe(3);
    expect(result.circuit.gates.map((g) => [g.type, g.position])).toEqual([
      ['H', 0],
      ['CNOT', 1],
    ]);
    expect(result.warnings).toEqual([]);
  });
});

/** The printed mat's own rectangle — the "no rescaling" case. */
const MAT_RECT_OF_BOARD: BoardRect = {
  widthMm: BOARD.matWidth,
  heightMm: BOARD.matHeight,
};
