/**
 * Framework-agnostic client for the Entangible `/ws/state` channel.
 *
 * Implements the client half of `docs/protocol.md`:
 *  - connects to `ws(s)://<origin>/ws/state` (protocol inferred from location),
 *  - sends a `hello` on open,
 *  - reconnects forever with exponential backoff 0.5 s → 8 s, jittered,
 *  - replays are handled naturally: the server re-sends the latest
 *    circuit/detection/status on connect; `seq` dedupe drops the repeated
 *    circuit, and a *lower* replayed `seq` is treated as a host restart
 *    (accepted, counter reset — never discarded as stale).
 *
 * Framework-agnostic and neutral (SC1/U1: lives in `shared/ws`, aliased
 * `@shared/ws`). The operator-key provider is injected via `operatorKey`; the
 * display app supplies it and owns the `getStateSocket()` singleton, while the
 * pocket viewer constructs a keyless (read-only) socket. The pocket
 * `BoothSocketSource` and the display `useEntangibleState` hook both wrap it.
 */
import type {
  CircuitMessage,
  ClientHello,
  ClientMessage,
  ClientRole,
  DetectionMessage,
  HelloAck,
  LayoutMessage,
  ServerMessage,
  StatusMessage,
} from './messages';

export type ConnectionState =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed';

export interface StateSnapshot {
  /** Latest `circuit` message (undefined until first received). */
  readonly circuit?: CircuitMessage;
  /** Latest `detection` message. */
  readonly detection?: DetectionMessage;
  /** Latest `status` message. */
  readonly status?: StatusMessage;
  /** Latest `layout` message (panel/mode state; booth-v2, additive). */
  readonly layout?: LayoutMessage;
  readonly connectionState: ConnectionState;
  /** Last accepted circuit `seq`, or null before any circuit arrives. */
  readonly lastSeq: number | null;
  /**
   * Operator standing from the server's `hello_ack`: `true` when this socket
   * authenticated as an operator, `false` after a viewer ack, `undefined`
   * before any ack. Drives the `/debug` "wrong key" affordance.
   */
  readonly operator?: boolean;
}

// Backoff bounds (see protocol.md "Reconnect rules").
const BASE_MS = 500;
const MAX_MS = 8000;

/** Raw (unjittered) backoff for a 0-based attempt: 500 → 8000, capped. */
export function baseBackoff(attempt: number): number {
  return Math.min(MAX_MS, BASE_MS * 2 ** attempt);
}

/**
 * Equal-jitter backoff: delay lands in [base/2, base]. With a max-jitter RNG
 * (`() => 1`) the sequence is exactly 500, 1000, 2000, 4000, 8000, 8000, …
 */
export function jitteredBackoff(attempt: number, random: () => number): number {
  const base = baseBackoff(attempt);
  return base / 2 + random() * (base / 2);
}

type TimeoutId = ReturnType<typeof setTimeout>;

export interface StateSocketOptions {
  /** Full URL to `/ws/state`. Defaults to one derived from `location`. */
  url?: string;
  role?: ClientRole;
  /** Optional free-form client label sent in `hello`. */
  client?: string;
  /** Injectable WebSocket implementation (tests supply a mock). */
  WebSocketImpl?: typeof WebSocket;
  setTimeoutImpl?: (fn: () => void, ms: number) => TimeoutId;
  clearTimeoutImpl?: (id: TimeoutId) => void;
  /** Jitter source in [0, 1). Injected for deterministic tests. */
  random?: () => number;
  /**
   * Resolves the operator token to send in `hello` (staff surfaces only).
   * When it returns a non-empty string the `hello` is sent as
   * `{role:'operator', key}` — unlocking the `select_*` controls. Omitted (or
   * returning null) → a plain viewer `hello`, exactly as before.
   */
  operatorKey?: () => string | null | undefined;
}

export type Listener = (snapshot: StateSnapshot) => void;

/** Derive the `/ws/state` URL from the current page origin. */
export function defaultStateUrl(loc: Location | undefined = globalThis.location): string {
  if (!loc) return 'ws://localhost:8443/ws/state';
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws/state`;
}

export class StateSocket {
  private readonly url: string;
  private readonly role: ClientRole;
  private readonly client?: string;
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly setTimeoutImpl: (fn: () => void, ms: number) => TimeoutId;
  private readonly clearTimeoutImpl: (id: TimeoutId) => void;
  private readonly random: () => number;
  private readonly operatorKey?: () => string | null | undefined;

  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: TimeoutId | null = null;
  private stopped = false;

  private readonly listeners = new Set<Listener>();
  private snapshot: StateSnapshot = {
    connectionState: 'connecting',
    lastSeq: null,
  };

  constructor(options: StateSocketOptions = {}) {
    this.url = options.url ?? defaultStateUrl();
    this.role = options.role ?? 'display';
    this.client = options.client;
    this.WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
    this.setTimeoutImpl =
      options.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutImpl = options.clearTimeoutImpl ?? ((id) => clearTimeout(id));
    this.random = options.random ?? Math.random;
    this.operatorKey = options.operatorKey;
  }

  // --- public API ---------------------------------------------------------

  getSnapshot(): StateSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Open the socket (idempotent while already connecting/open). */
  start(): void {
    this.stopped = false;
    if (this.ws) return;
    this.open();
  }

  /** Close permanently; cancels any pending reconnect. */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      this.clearTimeoutImpl(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.patch({ connectionState: 'closed' });
  }

  /** Send a client message (e.g. `select_camera`) if the socket is open. */
  send(message: ClientMessage): boolean {
    if (this.ws && this.ws.readyState === this.WebSocketImpl.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  /**
   * Send any client message (alias of {@link send}). Named for call sites that
   * push `select_mode` / `select_layout` from the /debug Layout card.
   */
  sendMessage(message: ClientMessage): boolean {
    return this.send(message);
  }

  // --- internals ----------------------------------------------------------

  private open(): void {
    this.patch({
      connectionState: this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting',
    });
    const ws = new this.WebSocketImpl(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      const hello: ClientHello = { type: 'hello', role: this.role };
      if (this.client) hello.client = this.client;
      // Authenticate as operator when a key is available (staff surfaces). The
      // server grants operator standing for a staff role ('operator' | 'camera')
      // with a matching key, so we attach the key and — for a plain courtesy
      // role (display/debug/capture-ui) — promote it to 'operator'. An explicit
      // staff role keeps its label (the pocket CAMERA role stays 'camera' so the
      // host can list it as a camera). Viewer sockets (no key) keep their role.
      const key = this.operatorKey?.();
      if (key) {
        if (hello.role !== 'operator' && hello.role !== 'camera') {
          hello.role = 'operator';
        }
        hello.key = key;
      }
      try {
        ws.send(JSON.stringify(hello));
      } catch {
        /* ignore send-before-ready races */
      }
      this.patch({ connectionState: 'open' });
    };

    ws.onmessage = (event: MessageEvent) => {
      this.handleRaw(event.data);
    };

    ws.onerror = () => {
      // Errors are followed by close on browsers; nothing to do here.
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      if (this.stopped) return;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    this.patch({ connectionState: 'reconnecting' });
    const delay = jitteredBackoff(this.reconnectAttempt, this.random);
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.setTimeoutImpl(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.open();
    }, delay);
  }

  private handleRaw(data: unknown): void {
    if (typeof data !== 'string') return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return; // malformed frames are ignored, never fatal
    }
    if (!msg || typeof (msg as { type?: unknown }).type !== 'string') return;
    this.handleMessage(msg as ServerMessage);
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'circuit':
        this.handleCircuit(msg);
        break;
      case 'detection':
        this.patch({ detection: msg });
        break;
      case 'status':
        this.patch({ status: msg });
        break;
      case 'layout':
        this.patch({ layout: msg });
        break;
      case 'hello_ack':
        this.patch({ operator: (msg as HelloAck).role === 'operator' });
        break;
      default:
        // Unknown `type` — additive protocol change; ignore per spec.
        break;
    }
  }

  private handleCircuit(msg: CircuitMessage): void {
    const last = this.snapshot.lastSeq;
    if (last !== null) {
      if (msg.seq === last) {
        return; // duplicate (e.g. replay of the latest) — ignore
      }
      // A lower seq means the host restarted its counter: accept and reset.
      // (Both the restart case and the normal forward case fall through to
      // the accept below; we simply never discard a lower seq as "stale".)
    }
    this.patch({ circuit: msg, lastSeq: msg.seq });
  }

  private patch(partial: Partial<StateSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
