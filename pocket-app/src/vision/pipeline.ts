/**
 * The in-browser detection loop: frame → detector → board → grid → stabilizer →
 * circuit. Mirrors `qamposer_vision/pipeline.py` (`_map_markers` +
 * `_rebuild_and_maybe_emit` + warning composition), minus the threading — the
 * app drives `processFrame` from a requestAnimationFrame loop.
 */
import { detectMarkers, type DetectedMarker, type RgbaImage, type GrayImage } from './detect';
import { fitBoard, type BoardResult } from './board';
import { GridMapper } from './grid';
import { BOARD, CORNER_IDS } from './geometry';
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
}

export class PocketPipeline {
  private readonly grid = new GridMapper(BOARD);
  private readonly stabilizer = new TileStabilizer();
  private lastCircuit: BuildResult['circuit'] | null = null;
  private structuralWarnings: BuildWarning[] = [];
  private emitted = false;

  reset(): void {
    this.stabilizer.reset();
    this.lastCircuit = null;
    this.structuralWarnings = [];
    this.emitted = false;
  }

  processFrame(image: RgbaImage | GrayImage): FrameResult {
    const detected = detectMarkers(image);
    const board = fitBoard(detected);
    const corners = detected.filter((m) => String(m.id) in CORNER_IDS).length;

    const { observations, markerObs, offGridWarnings } = this.mapMarkers(detected, board);

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
    };
  }

  private mapMarkers(
    markers: DetectedMarker[],
    board: BoardResult | null,
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
      const cell = this.grid.assign(bx, by);
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
      observations.push(tileKey(marker.id, cell.row, cell.col));
      markerObs.push({ id: marker.id, row: cell.row, col: cell.col, offGrid: false });
    }

    return { observations, markerObs, offGridWarnings };
  }

  private rebuild(stable: ReadonlySet<Tile>): boolean {
    const placements: TilePlacement[] = [...stable].map((t) => {
      const [markerId, row, col] = parseTile(t);
      return { markerId, row, col };
    });
    const build = buildCircuit(placements, BOARD.rows);
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
