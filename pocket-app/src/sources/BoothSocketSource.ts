/**
 * BoothSocketSource — reads a booth host's `/ws/state` as a read-only VIEWER
 * and maps it into neutral {@link StateUpdate}s (Entangible One, phase U1b).
 *
 * VIEWER POLICY (docs/design.md — the visitor QR is view-only): this source
 * connects with a plain `hello {role:'display'}` and NO operator key, and it
 * has NO code path that sends any control message (camera/mode/layout swaps or
 * anything else). It only reads. Reconnect + `seq` dedupe come for free from
 * the shared `StateSocket`.
 *
 * Mapping (see @shared/ws/messages): the latest `circuit` message → circuit +
 * qasm; `detection.warnings` → the shared `friendlyWarning` envelope; the
 * `layout` message → boothMode (`golf`/`quantina` | else composer) + boothWires +
 * boothNoise + boothMenu (QN2); the latest `served` broadcast → boothServed (the
 * viewer's synced reveal); the socket's connection state → a coarse phase.
 */
import type { Circuit } from '@qamposer/react';
import {
  StateSocket,
  type ConnectionState,
  type StateSnapshot,
} from '@shared/ws/stateSocket';
import type { DetectionWarning } from '@shared/ws/messages';
import type { WarningInput } from '@shared/display/warnings';
import type {
  BoothMode,
  ConnectionPhase,
  StateListener,
  StateSource,
  StateUpdate,
} from './StateSource';

/** The physical board is always five qubits (matches the booth + pipeline). */
const BOARD_QUBITS = 5;

/** Detection warning (`code`) → shared `friendlyWarning` envelope. */
export function detectionWarningToInput(w: DetectionWarning): WarningInput {
  return { code: w.code, col: w.col ?? undefined, message: w.message };
}

/** Collapse the socket's connection state into the UI's three phases. */
export function connectionPhase(state: ConnectionState): ConnectionPhase {
  switch (state) {
    case 'open':
      return 'open';
    case 'closed':
      return 'closed';
    default:
      return 'connecting'; // 'connecting' | 'reconnecting'
  }
}

/**
 * Pure mapping from a socket snapshot to a neutral update. `fallbackCircuit`
 * is used before the first `circuit` message arrives so the reference stays
 * stable (App dedupes downstream work by circuit identity).
 */
export function snapshotToUpdate(
  snap: StateSnapshot,
  fallbackCircuit: Circuit,
): StateUpdate {
  const layout = snap.layout;
  const boothMode: BoothMode | undefined = layout
    ? layout.mode === 'golf'
      ? 'golf'
      : layout.mode === 'quantina'
        ? 'quantina'
        : 'composer'
    : undefined;
  return {
    source: 'booth',
    circuit: snap.circuit?.circuit ?? fallbackCircuit,
    qasm: snap.circuit?.qasm,
    warnings: (snap.detection?.warnings ?? []).map(detectionWarningToInput),
    boothMode,
    boothWires: layout?.wires,
    boothNoise: layout?.noise,
    // QN2: surface the active pack id (present ⟺ a layout arrived) and the
    // latest served broadcast so a viewer phone reveals the booth's order.
    boothMenu: layout ? layout.menu : undefined,
    boothServed: snap.served,
    connection: connectionPhase(snap.connectionState),
  };
}

export interface BoothSocketOptions {
  /** Full `ws(s)://…/ws/state` URL to connect to. */
  url: string;
  /** Injectable WebSocket implementation (tests supply a mock). */
  WebSocketImpl?: typeof WebSocket;
  setTimeoutImpl?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutImpl?: (id: ReturnType<typeof setTimeout>) => void;
  random?: () => number;
}

export class BoothSocketSource implements StateSource {
  readonly kind = 'booth' as const;
  private readonly socket: StateSocket;
  private readonly listeners = new Set<StateListener>();
  private readonly fallbackCircuit: Circuit;
  private unsubscribeSocket: (() => void) | null = null;

  constructor(options: BoothSocketOptions) {
    // An empty five-qubit circuit, used only until the first `circuit` message
    // arrives. Built as a plain object (not `createDefaultCircuit`) so this
    // source carries no runtime dependency on the heavy editor bundle.
    this.fallbackCircuit = { qubits: BOARD_QUBITS, gates: [] } as Circuit;
    this.socket = new StateSocket({
      url: options.url,
      role: 'display', // read-only viewer; the server treats this as a viewer ack
      client: 'pocket-viewer',
      WebSocketImpl: options.WebSocketImpl,
      setTimeoutImpl: options.setTimeoutImpl,
      clearTimeoutImpl: options.clearTimeoutImpl,
      random: options.random,
      // No operatorKey: a pocket viewer never authenticates as operator, so the
      // hello carries no key and the host silently ignores any control message
      // (which this source never sends anyway).
    });
  }

  start(): void {
    if (!this.unsubscribeSocket) {
      this.unsubscribeSocket = this.socket.subscribe((snap) => this.emit(snap));
    }
    this.socket.start();
    // Surface the initial (connecting) phase immediately so the pill shows.
    this.emit(this.socket.getSnapshot());
  }

  stop(): void {
    this.unsubscribeSocket?.();
    this.unsubscribeSocket = null;
    this.socket.stop();
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(snap: StateSnapshot): void {
    const update = snapshotToUpdate(snap, this.fallbackCircuit);
    for (const listener of this.listeners) listener(update);
  }
}
