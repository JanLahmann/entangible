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
import { GridMapper } from './grid';
import {
  BOARD,
  CORNER_IDS,
  MAT_RECT,
  MAT_RECT_TOLERANCE,
  type BoardRect,
} from './geometry';
import {
  DEFAULT_BOARD_LAYOUT,
  buildBoardModel,
  matBoardModel,
  type BoardLayout,
  type BoardModel,
} from './boardModel';
import { MARKER_TABLE } from './markers';
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
   * rectangle the corner blocks span under the chosen layout.
   */
  readonly model: BoardModel;
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

export class PocketPipeline {
  private readonly stabilizer = new TileStabilizer();
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

    // 2. Interpret it under the chosen layout.
    this.model = buildBoardModel(this.rect, this.boardLayout);
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

    const { observations, markerObs, offGridWarnings } = this.mapMarkers(
      detected,
      board,
      grid,
    );

    const result = this.stabilizer.update(observations);
    let changed = false;
    if (result.changed || !this.emitted) {
      changed = this.rebuild(result.stable);
    }

    const warnings = this.composeWarnings(offGridWarnings);

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

  private mapMarkers(
    markers: DetectedMarker[],
    board: BoardResult | null,
    grid: GridMapper,
  ): { observations: Tile[]; markerObs: MarkerObs[]; offGridWarnings: BuildWarning[] } {
    const observations: Tile[] = [];
    const markerObs: MarkerObs[] = [];
    const offGridWarnings: BuildWarning[] = [];

    for (const marker of markers) {
      if (String(marker.id) in CORNER_IDS || !MARKER_TABLE.has(marker.id)) continue;
      if (board === null) {
        markerObs.push({ id: marker.id, row: null, col: null, offGrid: true });
        continue;
      }
      const [bx, by] = board.imageToBoard(marker.center);
      const cell = grid.assign(bx, by);
      if (cell === null) {
        markerObs.push({ id: marker.id, row: null, col: null, offGrid: true });
        // Mirrors pipeline.py's `off_grid` warning.
        offGridWarnings.push({
          kind: 'off_grid',
          message: `Tile marker ${marker.id} (${MARKER_TABLE.get(marker.id)!.label}) at board (${bx.toFixed(0)}, ${by.toFixed(0)}) mm does not fall on any cell; excluded.`,
          row: null,
          col: null,
          marker_ids: [marker.id],
        });
        continue;
      }
      // Dial tiles carry their board-frame rotation in the stability key so
      // turning one in place re-emits; every other tile pins rotation 0.
      const spec = MARKER_TABLE.get(marker.id)!;
      const rot = spec.dialAxis ? boardFrameRotation(marker, board) : 0;
      observations.push(tileKey(marker.id, cell.row, cell.col, rot));
      markerObs.push({ id: marker.id, row: cell.row, col: cell.col, offGrid: false });
    }

    return { observations, markerObs, offGridWarnings };
  }

  private rebuild(stable: ReadonlySet<Tile>): boolean {
    const placements: TilePlacement[] = [...stable].map((t) => {
      const [markerId, row, col, rotation] = parseTile(t);
      return { markerId, row, col, rotation };
    });
    // Qubit count follows the active model: the mat's five rows, or the rows
    // derived from the board height.
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

function circuitsEqual(
  a: BuildResult['circuit'],
  b: BuildResult['circuit'] | null,
): boolean {
  if (b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
