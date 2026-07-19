/**
 * Wire protocol types for the Entangible `/ws/state` channel.
 *
 * This file mirrors `docs/protocol.md` (v1) 1:1. The vitest parity test
 * (`messages.test.ts`) parses that document and guards the field names against
 * this module, so keep the two in lockstep. All JSON field names are camelCase.
 *
 * `Circuit` / `Gate` are re-exported from `@qamposer/react` so the display app
 * and the composer share exactly one circuit schema (no drift).
 */
import type { Circuit, Gate } from '@qamposer/react';

export type { Circuit, Gate };

// ---------------------------------------------------------------------------
// Server → client messages
// ---------------------------------------------------------------------------

/** Origin of a circuit emission. */
export type CircuitSource = 'camera' | 'replay' | 'push';

/** `circuit` — sent on every *stable* circuit change. */
export interface CircuitMessage {
  type: 'circuit';
  /** Monotonically increasing per host process. */
  seq: number;
  circuit: Circuit;
  qasm: string;
  source: CircuitSource;
}

/** Board fiducial state within a `detection` message. */
export interface BoardState {
  found: boolean;
  /** Corner markers currently visible (0-4). */
  corners: number;
  /** null when the board is not found. */
  reprojectionErrorMm: number | null;
}

/** A detected gate tile (corner markers 0-3 are never listed here). */
export interface MarkerObs {
  id: number;
  /** On-grid row (qubit). Absent for off-grid markers. */
  row?: number;
  /** On-grid column. Absent for off-grid markers. */
  col?: number;
  /** True when detected but rejected by grid mapping. */
  offGrid?: boolean;
}

/** A circuit-builder warning (`lone_control`, `lone_target`, `cell_conflict`, …). */
export interface DetectionWarning {
  code: string;
  message: string;
  row?: number;
  col?: number;
}

/** `detection` — diagnostics, throttled to ≤ 5 Hz. */
export interface DetectionMessage {
  type: 'detection';
  /** Pipeline throughput, smoothed. `0` signals a stopped pipeline. */
  fps: number;
  board: BoardState;
  markers: MarkerObs[];
  warnings: DetectionWarning[];
}

/** Camera source kinds (also used by `select_camera`). */
export type CameraKind = 'cv2' | 'picamera2' | 'push' | 'replay';

export interface CameraStatus {
  kind: CameraKind;
  name?: string;
  connected: boolean;
}

export interface BackendStatus {
  enabled: boolean;
  healthy: boolean;
}

/** `status` — sent on connect and on every change. */
export interface StatusMessage {
  type: 'status';
  camera: CameraStatus;
  backend: BackendStatus;
  /** Current `/ws/state` client count. */
  clients: number;
}

/** Booth display mode (booth-v2). Golf is hidden until implemented. */
export type DisplayMode = 'composer' | 'golf' | 'attract';

/** Which side the sidebar docks on (booth-v2). */
export type SidebarSide = 'right' | 'left';

/**
 * How many wires the booth editor + histogram DISPLAY (booth-v2). Purely
 * cosmetic — the physical table and recognized circuit are always five qubits;
 * `compact` shows the used rows (floor 3, auto-grows to 4/5), `all` shows 5.
 *
 * The `Wires` union has one canonical home in `@shared/display/wires` (SC1);
 * re-exported here so protocol consumers keep importing it from `ws/messages`.
 */
import type { Wires } from '@shared/display/wires';
export type { Wires };

/**
 * `layout` — panel/mode state (additive, booth-v2).
 *
 * `panels` are registry names in display order (`results`, `state`, `qasm`,
 * `qsphere`, `scorecard`, `minicircuit`, `branding`, …). Unknown names are
 * ignored by clients (forward-compatible). Broadcast on change; the latest is
 * replayed to new clients after `status`.
 */
export interface LayoutMessage {
  type: 'layout';
  mode: DisplayMode;
  sidebar: SidebarSide;
  panels: string[];
  wires: Wires;
}

/**
 * `hello_ack` — server's reply to a `hello` (additive). Tells the socket its
 * standing: `operator` when the `hello` carried a matching operator `key`,
 * else `viewer`. Viewers may still read all state; only operators may send the
 * `select_*` control messages.
 */
export interface HelloAck {
  type: 'hello_ack';
  role: 'viewer' | 'operator';
}

/** Discriminated union of everything the server can push on `/ws/state`. */
export type ServerMessage =
  | CircuitMessage
  | DetectionMessage
  | StatusMessage
  | LayoutMessage
  | HelloAck;

// ---------------------------------------------------------------------------
// Client → server messages
// ---------------------------------------------------------------------------

/**
 * `display` / `debug` / `capture-ui` are courtesy labels; `operator` is the
 * privileged role that (with a matching `key`) unlocks the `select_*` controls.
 */
export type ClientRole = 'display' | 'debug' | 'capture-ui' | 'operator';

/** `hello` — courtesy metadata; the server must not require it. */
export interface ClientHello {
  type: 'hello';
  role: ClientRole;
  /** Free-form label, optional. */
  client?: string;
  /** Operator token — required only to act as `operator` (staff); others omit it. */
  key?: string;
}

/** `select_camera` — swap the pipeline's frame source at runtime. */
export interface SelectCamera {
  type: 'select_camera';
  kind: CameraKind;
  /** Only meaningful for `cv2`. */
  index?: number;
}

/** `select_mode` — switch the booth's display mode (additive, booth-v2). */
export interface SelectMode {
  type: 'select_mode';
  mode: DisplayMode;
}

/**
 * `select_layout` — reconfigure the panel layout (additive, booth-v2).
 * Partial: omitted fields keep their current server-side value.
 */
export interface SelectLayout {
  type: 'select_layout';
  sidebar?: SidebarSide;
  panels?: string[];
  wires?: Wires;
}

export type ClientMessage = ClientHello | SelectCamera | SelectMode | SelectLayout;

// ---------------------------------------------------------------------------
// Type-string tables (consumed by the parity test)
// ---------------------------------------------------------------------------

/** Every `type` the server can send on `/ws/state`. */
export const SERVER_MESSAGE_TYPES = [
  'circuit',
  'detection',
  'status',
  'layout',
  'hello_ack',
] as const;

/** Every `type` the client can send on `/ws/state`. */
export const CLIENT_MESSAGE_TYPES = [
  'hello',
  'select_camera',
  'select_mode',
  'select_layout',
] as const;

/** Union of all documented `type` discriminators (server + client). */
export const ALL_MESSAGE_TYPES = [
  ...SERVER_MESSAGE_TYPES,
  ...CLIENT_MESSAGE_TYPES,
] as const;

export type ServerMessageType = (typeof SERVER_MESSAGE_TYPES)[number];
export type ClientMessageType = (typeof CLIENT_MESSAGE_TYPES)[number];

/** Runtime guard: is this a recognized server message we should handle? */
export function isServerMessageType(t: unknown): t is ServerMessageType {
  return (
    typeof t === 'string' &&
    (SERVER_MESSAGE_TYPES as readonly string[]).includes(t)
  );
}
