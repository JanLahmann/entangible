/**
 * FrameStreamer — the reusable `/ws/frames` push client (shared, U2).
 *
 * Wraps a binary `/ws/frames` WebSocket around the pure {@link StreamController}
 * pacing core: it owns the socket lifecycle (connect + reconnect with jittered
 * backoff), applies backpressure via `WebSocket.bufferedAmount`, and paces
 * frames to a target fps. The caller drives it once per animation frame with
 * `offerFrame(hidden, encode)`; `encode` is invoked (to JPEG-encode the current
 * canvas) only when the controller decides this frame is due — so the DOM /
 * canvas plumbing stays with the caller and this module unit-tests in node with
 * a mock WebSocket.
 *
 * The display app's `/capture` page keeps its own inline pump (unchanged until
 * U3); the pocket app's CAMERA role streams through this class, reusing pocket's
 * camera UI (preview, zoom, freeze) as the frame source. The `?key=` operator
 * token is expected to be baked into `url` already (see `withKey`).
 */
import {
  StreamController,
  type StreamControllerOptions,
} from './streamController';

export type FramesConnection = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** A live snapshot of the stream for the status pill. */
export interface FrameStreamerStatus {
  readonly connection: FramesConnection;
  /** Smoothed frames-per-second actually sent. */
  readonly fps: number;
  readonly sent: number;
  /** Frames due but skipped for in-flight / backpressure. */
  readonly dropped: number;
}

/** Encode the current frame to bytes, or `null` to skip (e.g. canvas not ready). */
export type FrameEncoder = () => Promise<ArrayBuffer | null>;

type TimeoutId = ReturnType<typeof setTimeout>;

export interface FrameStreamerOptions {
  /** Full `ws(s)://…/ws/frames?key=<token>` URL (key already appended). */
  url: string;
  /** Injectable WebSocket implementation (tests supply a mock). */
  WebSocketImpl?: typeof WebSocket;
  /** Pacing/backpressure knobs forwarded to the {@link StreamController}. */
  controller?: StreamControllerOptions;
  setTimeoutImpl?: (fn: () => void, ms: number) => TimeoutId;
  clearTimeoutImpl?: (id: TimeoutId) => void;
  /** Jitter source in [0, 1). Injected for deterministic tests. */
  random?: () => number;
}

// Backoff bounds — mirror the `/ws/state` client (protocol.md "Reconnect rules").
const BASE_MS = 500;
const MAX_MS = 8000;

export type StatusListener = (status: FrameStreamerStatus) => void;

export class FrameStreamer {
  private readonly url: string;
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly setTimeoutImpl: (fn: () => void, ms: number) => TimeoutId;
  private readonly clearTimeoutImpl: (id: TimeoutId) => void;
  private readonly random: () => number;
  private readonly controller: StreamController;

  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: TimeoutId | null = null;
  private stopped = false;
  private connection: FramesConnection = 'connecting';
  private readonly listeners = new Set<StatusListener>();

  constructor(options: FrameStreamerOptions) {
    this.url = options.url;
    this.WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
    this.setTimeoutImpl = options.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutImpl = options.clearTimeoutImpl ?? ((id) => clearTimeout(id));
    this.random = options.random ?? Math.random;
    this.controller = new StreamController(options.controller);
  }

  // --- public API ---------------------------------------------------------

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
    this.setConnection('closed');
  }

  /**
   * Offer the current frame. When the socket is open and the pacing core says
   * this frame is due, `encode()` runs and the resulting bytes are sent; on any
   * other outcome the frame is skipped (paced / backpressure / hidden / closed).
   * Safe to call every animation frame.
   */
  offerFrame(hidden: boolean, encode: FrameEncoder): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== this.WebSocketImpl.OPEN) return;
    const decision = this.controller.decide({ bufferedAmount: ws.bufferedAmount, hidden });
    if (!decision.send) return;
    encode()
      .then((buf) => {
        const sock = this.ws;
        if (buf && sock && sock.readyState === this.WebSocketImpl.OPEN) {
          sock.send(buf);
          this.controller.markSent();
        } else {
          this.controller.markSendFailed();
        }
      })
      .catch(() => this.controller.markSendFailed());
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): FrameStreamerStatus {
    return {
      connection: this.connection,
      fps: this.controller.fps(),
      sent: this.controller.sentCount,
      dropped: this.controller.droppedCount,
    };
  }

  // --- internals ----------------------------------------------------------

  private open(): void {
    this.setConnection(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new this.WebSocketImpl(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      try {
        // Optional courtesy hello (the server ignores text on /ws/frames).
        ws.send(JSON.stringify({ type: 'hello', role: 'camera' }));
      } catch {
        /* ignore send-before-ready races */
      }
      this.setConnection('open');
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
    this.setConnection('reconnecting');
    const base = Math.min(MAX_MS, BASE_MS * 2 ** this.reconnectAttempt);
    const delay = base / 2 + this.random() * (base / 2);
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.setTimeoutImpl(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.open();
    }, delay);
  }

  private setConnection(next: FramesConnection): void {
    if (this.connection === next) return;
    this.connection = next;
    const status = this.getStatus();
    for (const listener of this.listeners) listener(status);
  }
}
