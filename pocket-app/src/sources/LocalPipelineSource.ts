/**
 * LocalPipelineSource — the on-device camera + vision pipeline, behind the
 * `StateSource` seam (Entangible One, phase U1b).
 *
 * Pragmatic seam (docs/design.md): the camera element, zoom, freeze, debug
 * overlay and corner stats are tightly UI-coupled, so they stay in `App`. This
 * source is a thin adapter: `App`'s existing frame loop feeds it each
 * `FrameResult` via {@link ingest}, and it emits a neutral {@link StateUpdate}
 * only when the stable circuit actually changed — exactly the `result.changed`
 * gate the old inline `onResult` used. No behavior change. U2 deepens this into
 * a pluggable frame input (getUserMedia | remote MJPEG).
 */
import type { Circuit } from '@qamposer/react';
import type { WarningInput } from '@shared/display/warnings';
import type { FrameResult } from '../vision/pipeline';
import type { BuildWarning } from '../vision/circuitBuilder';
import type { StateListener, StateSource, StateUpdate } from './StateSource';

/**
 * Map a pipeline `BuildWarning` (discriminated by `kind`) into the shared
 * `friendlyWarning` envelope (keyed on `code`), preserving the column and the
 * verbatim message — identical wording to the old pocket `warnings.ts` bridge.
 */
export function buildWarningToInput(w: BuildWarning): WarningInput {
  return { code: w.kind, col: w.col ?? undefined, message: w.message };
}

export class LocalPipelineSource implements StateSource {
  readonly kind = 'local' as const;
  private readonly listeners = new Set<StateListener>();

  // The pipeline is driven by App's rAF loop, so there is nothing to start or
  // stop here; the methods exist to satisfy the StateSource contract.
  start(): void {}
  stop(): void {}

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Feed one processed frame. Emits a neutral update only on frames where the
   * stable circuit changed (mirrors the old `if (!result.changed) return`).
   */
  ingest(result: FrameResult): void {
    if (!result.changed) return;
    const update: StateUpdate = {
      source: 'local',
      circuit: result.circuit as unknown as Circuit,
      warnings: result.warnings.map(buildWarningToInput),
    };
    for (const listener of this.listeners) listener(update);
  }
}
