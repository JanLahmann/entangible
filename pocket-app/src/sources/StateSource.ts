/**
 * StateSource — the seam between "where circuit state comes from" and the one
 * shared pocket shell that renders it (Entangible One, phase U1b).
 *
 * The pocket app has always run its own camera + vision pipeline inline. U1b
 * introduces a small abstraction so the SAME downstream (editor, histogram,
 * state/qasm panels, golf, celebrations, Transfer) can be fed either by the
 * on-device pipeline (`LocalPipelineSource`) or by a booth host over
 * `/ws/state` (`BoothSocketSource`, read-only viewer), or driven directly by
 * the editor's native on-screen editing (`ManualEditSource` — the no-camera
 * fallback: build gates on screen, everything downstream unchanged).
 *
 * A source delivers `StateUpdate`s of a neutral shape — the minimal set of
 * fields today's `App` needs. The video UI (camera element, zoom, freeze,
 * debug overlay) deliberately stays in `App`: the source boundary sits at
 * "circuit + warnings out", not "pixels in" (a pluggable frame input arrives
 * with U2 per docs/design.md).
 */
import type { Circuit } from '@qamposer/react';
import type { Wires } from '@shared/display/wires';
import type { NoisePreset } from '@quantum/noise';
import type { ServedMessage } from '@shared/ws/messages';
import type { WarningInput } from '@shared/display/warnings';

/** Which kind of source produced an update. */
export type SourceKind = 'local' | 'booth' | 'manual';

/** Booth display mode the pocket shell understands (attract collapses to composer). */
export type BoothMode = 'composer' | 'golf' | 'quantina';

/** Coarse connection phase surfaced to the UI (booth sources only). */
export type ConnectionPhase = 'connecting' | 'open' | 'closed';

/**
 * A neutral state update. `warnings` are already in the shared
 * `friendlyWarning` envelope (`{ code, col?, message? }`) so both apps render
 * them identically. Booth-only fields (`qasm`, `boothMode`, `boothWires`,
 * `connection`) are absent for local updates.
 */
export interface StateUpdate {
  readonly source: SourceKind;
  readonly circuit: Circuit;
  readonly warnings: WarningInput[];
  /** Pre-rendered OpenQASM (booth only; local re-derives it downstream). */
  readonly qasm?: string;
  /** Host-driven mode; when present it overrides the local `settings.mode`. */
  readonly boothMode?: BoothMode;
  /** Host-driven wire count; when present it overrides the local setting. */
  readonly boothWires?: Wires;
  /** Host-driven noise preset; when present it overrides the local setting. */
  readonly boothNoise?: NoisePreset;
  /**
   * Host-driven Quantina menu-pack id (booth only, QN2): the active
   * `layout.menu`, or `null` when none is chosen (clients fall back to
   * `coffee`). Present ⟺ a `layout` message has arrived.
   */
  readonly boothMenu?: string | null;
  /**
   * Latest booth `served` broadcast (booth only, QN2). Drives the viewer's
   * synced Quantina reveal, keyed on `served.seq`; absent until the first serve.
   */
  readonly boothServed?: ServedMessage;
  /** Connection phase (booth only). */
  readonly connection?: ConnectionPhase;
}

export type StateListener = (update: StateUpdate) => void;

/** Lifecycle + subscription contract shared by every state source. */
export interface StateSource {
  readonly kind: SourceKind;
  /** Begin producing updates. Idempotent. */
  start(): void;
  /** Stop producing updates and release resources. Idempotent. */
  stop(): void;
  /** Subscribe to updates; returns an unsubscribe function. */
  subscribe(listener: StateListener): () => void;
}
