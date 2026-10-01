/**
 * The in-browser detection loop: frame → detector → board → grid → stabilizer →
 * circuit. Mirrors `qamposer_vision/pipeline.py` (`_map_markers` +
 * `_rebuild_and_maybe_emit` + warning composition), minus the threading — the
 * app drives `processFrame` from a requestAnimationFrame loop.
 */
import {
  detectMarkers,
  toGray,
  type DetectedMarker,
  type DetectOptions,
  type DetectStats,
  type RgbaImage,
  type GrayImage,
} from './detect';
import {
  fitBoard,
  boardFrameRotation,
  estimateBoardRect,
  type BoardResult,
} from './board';
import { guidedRedetect } from './guided';
import { GridMapper, clusterColumns, firstCenterX, roundHalfUp } from './grid';
import {
  BOARD,
  CORNER_IDS,
  MAT_RECT,
  MAT_RECT_TOLERANCE,
  onBoard,
  type BoardRect,
} from './geometry';
import {
  DEFAULT_BOARD_LAYOUT,
  buildBoardModel,
  matBoardModel,
  type BoardLayout,
  type BoardModel,
} from './boardModel';
import {
  MeasureStabilizer,
  WireStabilizer,
  measurePoints,
  pairMeasures,
  pairTolerance,
  strayFurniture,
  wirePoints,
  type MeasurePairing,
  type Point,
  type StrayBlock,
  type WireSpan,
} from './wires';
import { MARKER_TABLE, MEASURE_BLOCK_ID, QUBIT_WIRE_ID } from './markers';
import {
  TileStabilizer,
  tileKey,
  parseTile,
  type Tile,
} from './stabilizer';
import {
  buildCircuit,
  type BuildResult,
  type BuildWarning,
  type TilePlacement,
} from './circuitBuilder';

/**
 * Smallest fraction of the estimated board width a wire's measured left→right
 * run may cover before it is called out (#97). Wire and measurement blocks sit
 * on opposite EDGES of the board, so a run much shorter than the board means the
 * blocks are somewhere they should not be — but where exactly along each edge is
 * the user's business, hence a loose bound rather than a tight one.
 */
export const SPAN_MIN_FRACTION = 0.5;

/**
 * Width (board mm) of the absolute x buckets a tile is stabilized under (#109).
 * Mirrors `pipeline.X_BUCKET_MM`.
 *
 * Columns are clustered from the tiles' actual x positions, so a column index is
 * a property of the whole board, not of one tile — inserting a tile left of all
 * others renumbers every column to its right. Had the stabilizer keyed tiles by
 * that per-frame column, one inserted tile would change EVERY key at once and
 * flap the whole board through the hysteresis. Keys must be insertion-invariant,
 * so a tile is keyed by `round(x / X_BUCKET_MM)` — an absolute position no other
 * tile can move — and columns are clustered only from the STABLE set, at
 * emission. 10 mm is far below the 30 mm cluster gap (`COLUMN_GAP_MM`), so
 * bucketing never merges or splits a column; it only absorbs sub-bucket jitter.
 */
export const X_BUCKET_MM = 10.0;

/** The absolute x bucket of a tile centre — its stability-key x (#109). */
export function xBucket(xMm: number): number {
  return roundHalfUp(xMm / X_BUCKET_MM);
}

/**
 * The `off_grid` warning for a tile on the board but on no row. Since #109 only
 * the row can miss: columns are clustered from wherever the tiles lie, so "off
 * grid" now means between two qubit wires / lattice rows. Mirrors
 * `pipeline.off_grid_warning`.
 */
export function offGridWarning(markerId: number, xMm: number, yMm: number): BuildWarning {
  return {
    kind: 'off_grid',
    message:
      `Tile marker ${markerId} (${MARKER_TABLE.get(markerId)!.label}) at board ` +
      `(${xMm.toFixed(0)}, ${yMm.toFixed(0)}) mm is on the board but on no qubit ` +
      'wire; excluded.',
    row: null,
    col: null,
    marker_ids: [markerId],
  };
}

export interface MarkerObs {
  readonly id: number;
  readonly row: number | null;
  readonly col: number | null;
  readonly offGrid: boolean;
}

export interface FrameStats {
  /** Convex quad candidates the blind detector examined this frame. */
  readonly candidates: number;
  /** Markers decoded by blind contour/quad detection. */
  readonly blindHits: number;
  /** Extra markers recovered by grid-guided redetection. */
  readonly guidedRescues: number;
}

/** Resolved detector/pipeline parameters, surfaced read-only to the debug panel. */
export interface ResolvedParams {
  readonly guided: boolean;
  readonly subpixel: boolean;
  readonly robustSample: boolean;
  readonly minArea: number;
  readonly approxEpsilonFrac: number;
  readonly thresholdWindow: number;
  readonly thresholdC: number;
}

export interface FrameResult {
  /** True on frames where the stable circuit actually changed. */
  readonly changed: boolean;
  readonly circuit: BuildResult['circuit'];
  readonly warnings: BuildWarning[];
  readonly boardFound: boolean;
  readonly corners: number;
  readonly reprojectionErrorMm: number | null;
  readonly markers: MarkerObs[];
  /** Raw detector output, for the debug overlay (marker outlines, board quad). */
  readonly detected: DetectedMarker[];
  readonly board: BoardResult | null;
  /**
   * The geometry this frame was interpreted in (task #94): the mat, or the
   * rectangle the corner blocks span under the chosen layout — plus the wire
   * blocks driving its rows (#95) and the measurement blocks refining them
   * (#97).
   */
  readonly model: BoardModel;
  /**
   * Board furniture seen OFF the board and dropped (#97 follow-up) — the spare
   * wire / measurement blocks lying beside it. Never an error, just a count.
   */
  readonly strayFurniture: number;
  /**
   * Gate tiles seen OFF the board and dropped — the unused kit inventory on the
   * table. Deliberately NOT `off_grid`: they are not misplaced, they are simply
   * not in play.
   */
  readonly strayTiles: number;
  /** Per-frame detection counters for the debug overlay. */
  readonly stats: FrameStats;
  /** Resolved detector params (read-only), for the debug panel. */
  readonly params: ResolvedParams;
}

export interface PipelineOptions {
  /** Grid-guided redetection of missing cells once the board locks (default true). */
  guided?: boolean;
  /** Per-frame detector tuning (subpixel refine, robust sampling, thresholds). */
  detect?: DetectOptions;
  /**
   * How a non-mat corner-block rectangle becomes a lattice (task #94):
   * 'stretch' scales the 5×8 board into it, 'grid' (default) keeps the mat's
   * pitch and derives the column count from the width. The classic mat is
   * unaffected either way.
   */
  boardLayout?: BoardLayout;
}

/**
 * One warning for a frame's off-board furniture, or none.
 *
 * A *count*, not a list of positions: spare blocks beside the board are the
 * normal state of a booth table, and one line saying "two blocks are not on the
 * board" is the whole of what an operator needs. Per-block warnings would turn a
 * tidy stack of spares into a wall of text. Mirrors
 * `circuit_builder.stray_furniture_warnings`.
 */
export function strayFurnitureWarnings(strays: readonly StrayBlock[]): BuildWarning[] {
  if (strays.length === 0) return [];
  const ids = [...new Set(strays.map(([id]) => id))].sort((a, b) => a - b);
  return [
    {
      kind: 'stray_furniture' as const,
      message:
        `${strays.length} board-furniture block(s) are not on the board; ` +
        'ignored. Wire and measurement blocks only count between the corner ' +
        'blocks.',
      row: null,
      col: null,
      marker_ids: ids,
    },
  ];
}

/**
 * One warning for a frame's off-board gate tiles — again, just the count.
 *
 * Distinct from `off_grid`: those tiles ARE on the board and missed a row,
 * which is a mistake worth pointing at. These are simply not in play, which at a
 * booth is what most of the kit is doing at any moment. Mirrors
 * `circuit_builder.stray_tiles_warning`.
 */
export function strayTilesWarning(count: number): BuildWarning {
  return {
    kind: 'stray_tiles' as const,
    message:
      `${count} gate tile(s) are not on the board; ignored. Only tiles inside ` +
      'the corner blocks are part of the circuit.',
    row: null,
    col: null,
    marker_ids: [],
  };
}

export class PocketPipeline {
  private readonly stabilizer = new TileStabilizer();
  private readonly wireStabilizer = new WireStabilizer();
  private readonly measureStabilizer = new MeasureStabilizer();
  private lastCircuit: BuildResult['circuit'] | null = null;
  private structuralWarnings: BuildWarning[] = [];
  private emitted = false;
  private readonly guided: boolean;
  private readonly detectOptions: DetectOptions;
  private boardLayout: BoardLayout;
  /**
   * Sticky board rectangle (task #94): starts at the mat and only moves when an
   * estimate differs by more than the mat tolerance, so a real mat stays
   * bit-for-bit classic and a fixed table layout does not re-derive its column
   * count on every frame's measurement noise.
   */
  private rect: BoardRect = MAT_RECT;
  private model: BoardModel = matBoardModel();
  /** Resolved parameter snapshot (matches detect.ts defaults), for the debug panel. */
  readonly params: ResolvedParams;

  constructor(options: PipelineOptions = {}) {
    this.guided = options.guided ?? true;
    this.detectOptions = options.detect ?? {};
    this.boardLayout = options.boardLayout ?? DEFAULT_BOARD_LAYOUT;
    const d = this.detectOptions;
    this.params = {
      guided: this.guided,
      subpixel: d.subpixel ?? true,
      robustSample: d.robustSample ?? true,
      minArea: d.minArea ?? 100,
      approxEpsilonFrac: d.approxEpsilonFrac ?? 0.05,
      thresholdWindow: d.thresholdWindow ?? 21,
      thresholdC: d.thresholdC ?? 7,
    };
  }

  reset(): void {
    this.stabilizer.reset();
    this.wireStabilizer.reset();
    this.measureStabilizer.reset();
    this.rect = MAT_RECT;
    this.model = matBoardModel();
    this.lastCircuit = null;
    this.structuralWarnings = [];
    this.emitted = false;
  }

  /**
   * Choose how a non-mat rectangle becomes a lattice (task #94). Takes effect
   * on the next frame; a no-op when unchanged, and the classic mat is
   * unaffected either way.
   */
  setBoardLayout(layout: BoardLayout): void {
    this.boardLayout = layout;
  }

  processFrame(image: RgbaImage | GrayImage): FrameResult {
    // Grayscale once, then share it across blind detection and the guided pass.
    const gray: GrayImage =
      'data' in image && (image as RgbaImage).data.length === image.width * image.height * 4
        ? toGray(image as RgbaImage)
        : (image as GrayImage);

    const detectStats: DetectStats = { candidates: 0 };
    const blind = detectMarkers(gray, this.detectOptions, detectStats);

    // 1. What rectangle do the corner blocks actually span? (task #94)
    this.updateRect(blind);
    const board = fitBoard(blind, this.rect);

    // 2. Qubit-wire blocks, read in the rectangle's own board frame (#95), then
    //    measurement blocks refining them (#97). The pre-wire model supplies the
    //    "left of the grid" / "right of the last column" thresholds; the
    //    stabilized wire set decides the rows, and the stabilized measurement
    //    set only tilts wires that have one.
    const base = buildBoardModel(this.rect, this.boardLayout);
    let wireChanged = false;
    let furnitureWarnings: BuildWarning[] = [];
    let strays = 0;
    if (board) {
      const wireObs = wirePoints(blind, board, base.grid, base.rect);
      const wires = this.wireStabilizer.update(wireObs.map(([, y]) => y));
      wireChanged = wires.changed;
      const measures = this.measureStabilizer.update(
        measurePoints(blind, board, base.grid, base.rect),
      );
      const paired = this.pairMeasureBlocks(wires.wires, wireObs, measures.points, base);
      const strayBlocks = strayFurniture(blind, board, base.rect);
      strays = strayBlocks.length;
      furnitureWarnings = [...paired.warnings, ...strayFurnitureWarnings(strayBlocks)];
      this.model = buildBoardModel(
        this.rect,
        this.boardLayout,
        wires.wires,
        undefined,
        paired.spans,
      );
    } else {
      this.model = base;
    }
    const grid = new GridMapper(this.model.grid);

    // Grid-guided redetection: recover markers the blind front end missed in
    // cells whose expected quad we can now project through the locked board.
    let detected = blind;
    let guidedRescues = 0;
    if (board && this.guided) {
      const stats = { rescued: 0 };
      const rescued = guidedRedetect(gray, board, blind, grid, this.model, stats);
      guidedRescues = stats.rescued;
      if (rescued.length > 0) detected = [...blind, ...rescued];
    }

    const corners = detected.filter((m) => String(m.id) in CORNER_IDS).length;

    const { observations, markerObs, offGridWarnings, strayTiles } = this.mapMarkers(
      detected,
      board,
      grid,
      board ? base.rect : null,
    );
    if (strayTiles > 0) offGridWarnings.push(strayTilesWarning(strayTiles));

    const result = this.stabilizer.update(observations);
    let changed = false;
    if (result.changed || wireChanged || !this.emitted) {
      changed = this.rebuild(result.stable);
    }

    const warnings = this.composeWarnings([...offGridWarnings, ...furnitureWarnings]);

    return {
      changed,
      circuit: this.lastCircuit ?? { qubits: BOARD.rows, gates: [] },
      warnings,
      boardFound: board !== null,
      corners,
      reprojectionErrorMm: board ? board.reprojectionError : null,
      markers: markerObs,
      detected,
      board,
      model: this.model,
      strayFurniture: strays,
      strayTiles,
      stats: {
        candidates: detectStats.candidates,
        blindHits: blind.length,
        guidedRescues,
      },
      params: this.params,
    };
  }

  /**
   * Move the sticky board rectangle if the frame says it really changed.
   *
   * Estimates are noisy at the tenth-of-a-millimetre level, and the derived
   * column count is a floor(), so adopting every estimate would let a board
   * near a column boundary flip size frame to frame. The current rectangle is
   * therefore kept until an estimate differs from it by more than
   * `MAT_RECT_TOLERANCE` on either axis — which also keeps a real mat pinned to
   * exactly the mat geometry.
   */
  private updateRect(markers: DetectedMarker[]): void {
    const estimate = estimateBoardRect(markers);
    if (estimate === null) return;
    const { rect } = estimate;
    const tol = MAT_RECT_TOLERANCE;
    if (
      Math.abs(rect.widthMm - this.rect.widthMm) <= tol * this.rect.widthMm &&
      Math.abs(rect.heightMm - this.rect.heightMm) <= tol * this.rect.heightMm
    ) {
      return;
    }
    this.rect = rect;
  }

  /**
   * Map gate tiles onto rows + x buckets; also count the ones off the board.
   *
   * Each accepted tile is observed as `(markerId, row, xBucket, rotation)` — an
   * absolute x bucket, not a column (see `X_BUCKET_MM` for why the key must be
   * insertion-invariant). The columns in the `MarkerObs` debug rows are
   * clustered from this frame's accepted tiles alone and are display-only.
   *
   * Two different failures, deliberately told apart (#97 follow-up):
   *
   * - a tile whose centre is **off the board** (outside `rect` by more than
   *   `BOARD_MARGIN_MM`) is dropped *silently* — no warning, no `MarkerObs`,
   *   nothing in the stabilizer. That is the booth case: the unused kit lies on
   *   the table right next to the board, and it must not spam warnings or wobble
   *   the hysteresis. Only the count leaves this method.
   * - a tile **on the board** that lands on no row (between two wires or
   *   lattice rows) keeps its `off_grid` warning and its debug-table row. That
   *   one is a real "you misplaced a tile" signal and is worth the noise. No x
   *   position is rejected: columns are clustered (#109).
   *
   * Mirrors `pipeline._map_markers`.
   */
  private mapMarkers(
    markers: DetectedMarker[],
    board: BoardResult | null,
    grid: GridMapper,
    rect: BoardRect | null = null,
  ): {
    observations: Tile[];
    markerObs: MarkerObs[];
    offGridWarnings: BuildWarning[];
    strayTiles: number;
  } {
    const observations: Tile[] = [];
    const markerObs: MarkerObs[] = [];
    const offGridWarnings: BuildWarning[] = [];
    let strayTiles = 0;
    // [index into markerObs, marker id, row, x] of each accepted tile, so the
    // debug rows can get this frame's clustered columns afterwards.
    const accepted: Array<[number, number, number, number]> = [];

    for (const marker of markers) {
      if (String(marker.id) in CORNER_IDS || !MARKER_TABLE.has(marker.id)) continue;
      if (board === null) {
        markerObs.push({ id: marker.id, row: null, col: null, offGrid: true });
        continue;
      }
      const [bx, by] = board.imageToBoard(marker.center);
      if (rect !== null && !onBoard(bx, by, rect)) {
        strayTiles += 1;
        continue;
      }
      const row = grid.assignRow(bx, by);
      if (row === null) {
        markerObs.push({ id: marker.id, row: null, col: null, offGrid: true });
        offGridWarnings.push(offGridWarning(marker.id, bx, by));
        continue;
      }
      // Dial tiles carry their board-frame rotation (0-7, 45° steps) in the
      // stability key so turning one in place re-emits; every other tile pins
      // rotation 0.
      const spec = MARKER_TABLE.get(marker.id)!;
      const rot = spec.dialAxis ? boardFrameRotation(marker, board) : 0;
      observations.push(tileKey(marker.id, row, xBucket(bx), rot));
      accepted.push([markerObs.length, marker.id, row, bx]);
      markerObs.push({ id: marker.id, row, col: null, offGrid: false });
    }

    const cols = clusterColumns(
      accepted.map(([, , , x]) => x),
      grid.config.pitch,
      firstCenterX(grid.config),
    );
    accepted.forEach(([i, id, row], k) => {
      markerObs[i] = { id, row, col: cols[k], offGrid: false };
    });

    return { observations, markerObs, offGridWarnings, strayTiles };
  }

  /**
   * Resolve the stable `(id, row, xBucket, rot)` set into placements. Mirrors
   * `pipeline._stable_placements`.
   *
   * Columns are clustered from the stable tiles' bucket centres (#109), so they
   * follow the whole stable board and nothing else. Two keys of one tile that
   * straddle a bucket boundary land in the same column and collapse to one
   * placement, exactly as a single key did before.
   */
  private stablePlacements(stable: ReadonlySet<Tile>): TilePlacement[] {
    const tiles = [...stable].map(parseTile).sort(compareTuples);
    const cfg = this.model.grid;
    const cols = clusterColumns(
      tiles.map(([, , bucket]) => bucket * X_BUCKET_MM),
      cfg.pitch,
      firstCenterX(cfg),
    );
    const unique = new Map<string, [number, number, number, number]>();
    tiles.forEach(([markerId, row, , rotation], k) => {
      const t: [number, number, number, number] = [markerId, row, cols[k], rotation];
      unique.set(t.join(','), t);
    });
    return [...unique.values()]
      .sort(compareTuples)
      .map(([markerId, row, col, rotation]) => ({ markerId, row, col, rotation }));
  }

  /**
   * The wires' LEFT endpoints — block centres where available.
   *
   * The wire set is stabilized as y positions alone (#95), which is all the
   * qubit count ever needed; the segment a measurement block completes (#97)
   * also wants the left block's x. Each stable y therefore takes the x of the
   * wire block observed nearest to it on this frame, and falls back to the
   * lattice's left edge for a wire whose block is momentarily hidden — a
   * fallback that only shifts the segment's origin along its own axis, never
   * its height. Mirrors `pipeline._wire_ends`.
   */
  private wireEnds(
    wireYs: readonly number[] | null,
    observed: readonly Point[],
    grid: BoardModel['grid'],
  ): Point[] {
    return (wireYs ?? []).map((y) => {
      if (observed.length === 0) return [grid.gridOffsetX, y] as Point;
      let best = observed[0];
      for (const p of observed) {
        if (Math.abs(p[1] - y) < Math.abs(best[1] - y)) best = p;
      }
      return [best[0], y] as Point;
    });
  }

  /**
   * Match measurement blocks to wires and report what did not match (#97).
   * Mirrors `pipeline._pair_measures` + `_span_consistency_warnings`.
   *
   * Measurement blocks are a refinement: with no wire blocks on the table there
   * is nothing to refine, so every right block is simply reported as unpaired
   * and the model is untouched.
   */
  private pairMeasureBlocks(
    wireYs: readonly number[] | null,
    wireObs: readonly Point[],
    measures: readonly Point[],
    base: BoardModel,
  ): { spans: readonly (WireSpan | null)[] | null; warnings: BuildWarning[] } {
    if (measures.length === 0) return { spans: null, warnings: [] };
    const wires = this.wireEnds(wireYs, wireObs, base.grid);
    const pairing = pairMeasures(wires, measures, pairTolerance(base.grid));
    const warnings: BuildWarning[] = pairing.unpaired.map(([x, y]) => ({
      kind: 'unpaired_measure' as const,
      message:
        `Measurement block at board (${x.toFixed(0)}, ${y.toFixed(0)}) mm has ` +
        'no qubit-wire block across from it; ignored (the left side sets the ' +
        'wires).',
      row: null,
      col: null,
      marker_ids: [MEASURE_BLOCK_ID],
    }));
    if (pairing.paired === 0) return { spans: null, warnings };
    warnings.push(...this.spanConsistencyWarnings(pairing, base));
    return { spans: pairing.spans, warnings };
  }

  /**
   * Sanity-check the measured left→right run against the estimated width.
   *
   * In `grid` layout the *column count* is derived from the rectangle the
   * corner blocks span, so the furniture and the corners are two independent
   * measurements of one board and it is worth saying when they cannot both be
   * true. The bound is deliberately loose — where along each edge the blocks sit
   * is up to the user — so only the impossible is flagged: a run WIDER than the
   * whole rectangle (the estimate must be wrong), or one under
   * `SPAN_MIN_FRACTION` of it (the blocks are bunched somewhere in the middle,
   * not on the edges). Warning only: the corners stay authoritative, because
   * they are what the homography is fitted to.
   */
  private spanConsistencyWarnings(
    pairing: MeasurePairing,
    base: BoardModel,
  ): BuildWarning[] {
    const span = pairing.meanSpan;
    if (base.kind !== 'grid' || span === null) return [];
    const width = base.rect.widthMm;
    if (span >= SPAN_MIN_FRACTION * width && span <= width) return [];
    return [
      {
        kind: 'measure_span_mismatch' as const,
        message:
          `Measurement blocks sit ${span.toFixed(0)} mm from the wire blocks, ` +
          `but the corner blocks span only ${width.toFixed(0)} mm; the corners ` +
          "win. Check the blocks are on the board's edges.",
        row: null,
        col: null,
        marker_ids: [QUBIT_WIRE_ID, MEASURE_BLOCK_ID],
      },
    ];
  }

  private rebuild(stable: ReadonlySet<Tile>): boolean {
    const placements = this.stablePlacements(stable);
    // Qubit count follows the active model: the mat's five rows, the rows
    // derived from the board height, or one per qubit-wire block (#95).
    const build = buildCircuit(placements, this.model.rows);
    this.structuralWarnings = build.warnings;

    if (!this.emitted || !circuitsEqual(build.circuit, this.lastCircuit)) {
      this.lastCircuit = build.circuit;
      this.emitted = true;
      return true;
    }
    return false;
  }

  private composeWarnings(offGrid: BuildWarning[]): BuildWarning[] {
    const combined = [...offGrid, ...this.structuralWarnings];
    combined.sort((a, b) => {
      const ca = a.col ?? 99;
      const cb = b.col ?? 99;
      if (ca !== cb) return ca - cb;
      const ra = a.row ?? 0;
      const rb = b.row ?? 0;
      if (ra !== rb) return ra - rb;
      return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
    });
    return combined;
  }
}

/** Lexicographic order on number tuples — Python's tuple ordering. */
function compareTuples(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function circuitsEqual(
  a: BuildResult['circuit'],
  b: BuildResult['circuit'] | null,
): boolean {
  if (b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
