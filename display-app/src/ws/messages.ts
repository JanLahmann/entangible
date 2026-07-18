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

/** Discriminated union of everything the server can push on `/ws/state`. */
export type ServerMessage = CircuitMessage | DetectionMessage | StatusMessage;

// ---------------------------------------------------------------------------
// Client → server messages
// ---------------------------------------------------------------------------

export type ClientRole = 'display' | 'debug' | 'capture-ui';

/** `hello` — courtesy metadata; the server must not require it. */
export interface ClientHello {
  type: 'hello';
  role: ClientRole;
  /** Free-form label, optional. */
  client?: string;
}

/** `select_camera` — swap the pipeline's frame source at runtime. */
export interface SelectCamera {
  type: 'select_camera';
  kind: CameraKind;
  /** Only meaningful for `cv2`. */
  index?: number;
}

export type ClientMessage = ClientHello | SelectCamera;

// ---------------------------------------------------------------------------
// Type-string tables (consumed by the parity test)
// ---------------------------------------------------------------------------

/** Every `type` the server can send on `/ws/state`. */
export const SERVER_MESSAGE_TYPES = ['circuit', 'detection', 'status'] as const;

/** Every `type` the client can send on `/ws/state`. */
export const CLIENT_MESSAGE_TYPES = ['hello', 'select_camera'] as const;

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
