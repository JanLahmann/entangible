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

/**
 * Board fiducial state within a `detection` message.
 *
 * Everything below `reprojectionErrorMm` is additive (tasks #94/#95) and absent
 * on older hosts: since corner *blocks* replaced the printed mat, the four
 * fiducials may span any rectangle, so the detector reports the rectangle it
 * measured, which model interpreted the frame, the resulting lattice size and
 * how many qubit-wire blocks (if any) are driving the rows.
 */
export interface BoardState {
  found: boolean;
  /** Corner markers currently visible (0-4). */
  corners: number;
  /** null when the board is not found. */
  reprojectionErrorMm: number | null;
  /**
   * The rectangle the corner markers span, in board mm — measured the same way
   * the mat is (margins included), so a mat-sized layout reports 720x500.
   * null when the board is not found; absent on older hosts.
   */
  rectMm?: { widthMm: number; heightMm: number } | null;
  /**
   * Which model interpreted the frame: `mat` (the rectangle is the printed
   * mat's, within tolerance — classic geometry, unchanged output), or the
   * active `BoardLayout` for anything else.
   */
  layout?: BoardModelKind;
  /** Active lattice size. */
  rows?: number;
  cols?: number;
  /**
   * Qubit-wire blocks driving the rows (task #95), or null when the model's own
   * rows are used. The emitted circuit's qubit count follows this.
   */
  wires?: number | null;
  /**
   * Wires with a paired measurement block (task #97), or null when no wire
   * blocks drive the rows. A REFINEMENT counter, never a qubit count: it is at
   * most `wires`, and zero is a perfectly normal board.
   */
  measures?: number | null;
  /**
   * Measurement blocks that matched no wire block and were ignored (task #97).
   * Each one also raises an `unpaired_measure` warning.
   */
  unpairedMeasures?: number;
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

/** Booth display mode (booth-v2; `quantina` added with QN2, `runner` with the
 * Quantum Runner game — task #52). */
export type DisplayMode = 'composer' | 'golf' | 'quantina' | 'runner' | 'attract';

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
 * Booth-wide in-browser noise-model preset (additive). One per IBM chip
 * generation (oldest → newest) plus `off`; the canonical union lives in
 * `@quantum/noise` (type-only import — no runtime dependency on the simulator),
 * re-exported here so protocol consumers keep importing it from `ws/messages`.
 */
import type { NoisePreset } from '@quantum/noise';
export type { NoisePreset };

/**
 * How a corner-block board that is NOT the printed mat becomes a lattice
 * (task #94). `stretch` scales the 5x8 board into the measured rectangle
 * (same cells, bigger); `grid` (the default) keeps the mat's 70 mm pitch and
 * derives the COLUMN count from the measured width, so a wider table means
 * more columns. A mat-sized board ignores it entirely.
 *
 * The canonical union lives in the pocket vision package
 * (`vision/boardModel`); it is restated here rather than imported so the
 * protocol module keeps its no-runtime-dependency shape (the `NoisePreset`
 * pattern), and `BoardModelKind` adds the `mat` value only the detector reports.
 */
export type BoardLayout = 'stretch' | 'grid';
export type BoardModelKind = 'mat' | BoardLayout;

/**
 * `layout` — panel/mode state (additive, booth-v2).
 *
 * `panels` are registry names in display order (`results`, `state`, `qasm`,
 * `qsphere`, `scorecard`, `minicircuit`, `branding`, …). Unknown names are
 * ignored by clients (forward-compatible). Broadcast on change; the latest is
 * replayed to new clients after `status`.
 *
 * `noise` is the operator-controlled noise-model preset (default `off`);
 * viewers/kiosk honor the broadcast value, overriding their local setting.
 */
export interface LayoutMessage {
  type: 'layout';
  mode: DisplayMode;
  sidebar: SidebarSide;
  panels: string[];
  wires: Wires;
  noise: NoisePreset;
  /**
   * Active Quantina menu-pack id, or `null` when none is chosen (additive,
   * QN2). In quantina mode clients fall back to the built-in `coffee` pack
   * when `null` or when the id resolves to no bundled/loaded pack.
   */
  menu: string | null;
  /**
   * Booth-wide board layout for non-mat corner-block boards (additive, #94).
   * Default `grid`. Clients that detect locally honor the broadcast value over
   * their own setting; clients that only display ignore it.
   */
  boardLayout: BoardLayout;
}

/**
 * Where a Quantina serve's sample came from (additive, QN2). The canonical
 * union lives in `@shared/menu/pack` (type-only import — no runtime dependency
 * on the menu code), re-exported here so protocol consumers keep importing it
 * from `ws/messages` — the `NoisePreset` pattern.
 */
import type { ShotSource } from '@shared/menu/pack';
export type { ShotSource };

/**
 * `served` — a Quantina serve, broadcast to every client (additive, QN2).
 * The host is the authority: it stamps `seq` and `packId` (the active
 * `layout.menu`) and fans out, so kiosk and viewer phones reveal the same
 * result in sync. Clients resolve `outcomes` → items via `shared/menu/`.
 * The latest `served` is replayed to late joiners after `layout`.
 */
export interface ServedMessage {
  type: 'served';
  /** Host-stamped serve counter, monotonic per host process. */
  seq: number;
  /** The menu pack that was active when served. */
  packId: string;
  /** 1 bitstring for single/subset, k for shots mode (leftmost char = q0). */
  outcomes: string[];
  shotSource: ShotSource;
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
  | ServedMessage
  | HelloAck;

// ---------------------------------------------------------------------------
// Client → server messages
// ---------------------------------------------------------------------------

/**
 * `display` / `debug` / `capture-ui` are courtesy labels; `operator` is the
 * privileged role that (with a matching `key`) unlocks the `select_*` controls.
 * `camera` is the pocket app's staff CAMERA role (U2): a phone streaming frames
 * to the booth — it carries the operator `key` and is granted operator standing
 * (so its `select_camera {kind:'push'}` is honored), while the distinct label
 * lets the host log/list it as a camera rather than a generic operator.
 */
export type ClientRole = 'display' | 'debug' | 'capture-ui' | 'camera' | 'operator';

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

/**
 * `select_noise` — set the booth-wide noise-model preset (additive).
 * Operator-only; a viewer's attempt is silently ignored (as with the other
 * `select_*`). An unknown preset value is ignored server-side.
 */
export interface SelectNoise {
  type: 'select_noise';
  preset: NoisePreset;
}

/**
 * `select_board_layout` — set the booth-wide board layout (additive, #94).
 * Operator-only; a viewer's attempt is silently ignored (as with the other
 * `select_*`). An unknown value is ignored server-side.
 */
export interface SelectBoardLayout {
  type: 'select_board_layout';
  layout: BoardLayout;
}

/**
 * `select_menu` — activate a Quantina menu pack (additive, QN2). Operator-only
 * (silently ignored from viewers). The host validates the id's FORMAT only
 * (lowercase `[a-z0-9-]`) — it cannot know which packs a client bundles —
 * persists `layout.menu`, and broadcasts the new layout.
 */
export interface SelectMenu {
  type: 'select_menu';
  pack: string;
}

/**
 * `serve` — perform a Quantina serve (additive, QN2). Sent by the serving
 * surface (a provisioned kiosk's touch button or the `/debug` serve card);
 * the sampler runs where the simulation runs (the client), the host stamps
 * `seq`/`packId` and fans out a `served`. Operator-only; ignored when
 * `layout.menu` is null. `outcomes`: 1..20 bitstrings (1-5 chars of 0/1;
 * more than one only in shots mode).
 */
export interface Serve {
  type: 'serve';
  outcomes: string[];
  /** Default `ideal` when omitted. */
  shotSource?: ShotSource;
}

export type ClientMessage =
  | ClientHello
  | SelectCamera
  | SelectMode
  | SelectLayout
  | SelectNoise
  | SelectBoardLayout
  | SelectMenu
  | Serve;

// ---------------------------------------------------------------------------
// Type-string tables (consumed by the parity test)
// ---------------------------------------------------------------------------

/** Every `type` the server can send on `/ws/state`. */
export const SERVER_MESSAGE_TYPES = [
  'circuit',
  'detection',
  'status',
  'layout',
  'served',
  'hello_ack',
] as const;

/** Every `type` the client can send on `/ws/state`. */
export const CLIENT_MESSAGE_TYPES = [
  'hello',
  'select_camera',
  'select_mode',
  'select_layout',
  'select_noise',
  'select_board_layout',
  'select_menu',
  'serve',
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
