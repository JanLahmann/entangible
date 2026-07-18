/**
 * Pure streaming-loop logic for the phone capture page (`CaptureView`).
 *
 * This module has *no* DOM dependencies so the pacing / backpressure / fps
 * bookkeeping can be unit-tested with a fake clock. `CaptureView` owns the
 * `getUserMedia` video, the canvas `toBlob`, and the `/ws/frames` WebSocket;
 * it asks this controller, once per animation frame, whether to capture and
 * send the current frame.
 *
 * Decision order (see `docs/protocol.md` — the *client* paces itself and
 * enforces backpressure via `WebSocket.bufferedAmount`):
 *   1. `hidden`       — tab is backgrounded → pause (never a "drop").
 *   2. `paced`        — not yet due for the next frame at the target fps.
 *   3. `in-flight`    — a previous `toBlob`/send hasn't completed → skip (drop).
 *   4. `backpressure` — `bufferedAmount` over the cap → skip (drop).
 *   otherwise         — capture this frame.
 *
 * "Dropped" counts only frames that were *due* but skipped for `in-flight` or
 * `backpressure` — pacing and hidden skips are expected, not drops.
 */

export type SkipReason = 'hidden' | 'paced' | 'in-flight' | 'backpressure';

export interface StreamDecision {
  /** True when the caller should capture + send this frame. */
  send: boolean;
  /** Why the frame was skipped, or null when `send` is true. */
  reason: SkipReason | null;
}

export interface DecideInput {
  /** `WebSocket.bufferedAmount` for the `/ws/frames` socket, in bytes. */
  bufferedAmount: number;
  /** `document.hidden` — pause the loop while the tab is backgrounded. */
  hidden: boolean;
}

export interface StreamControllerOptions {
  /** Target capture rate; default 10 fps (see design M4). */
  targetFps?: number;
  /** Skip when `bufferedAmount` exceeds this; default 256 KB. */
  maxBufferedBytes?: number;
  /** Rolling window for the sent-fps estimate; default 1000 ms. */
  fpsWindowMs?: number;
  /** Injectable monotonic clock in ms (tests supply a fake). */
  now?: () => number;
}

export const DEFAULT_TARGET_FPS = 10;
export const DEFAULT_MAX_BUFFERED_BYTES = 256 * 1024;
export const DEFAULT_FPS_WINDOW_MS = 1000;

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export class StreamController {
  private readonly intervalMs: number;
  private readonly maxBuffered: number;
  private readonly fpsWindowMs: number;
  private readonly now: () => number;

  private lastCaptureAt = Number.NEGATIVE_INFINITY;
  private inFlight = false;
  private sentTimestamps: number[] = [];
  private _sent = 0;
  private _dropped = 0;

  constructor(options: StreamControllerOptions = {}) {
    const fps = options.targetFps ?? DEFAULT_TARGET_FPS;
    this.intervalMs = fps > 0 ? 1000 / fps : 0;
    this.maxBuffered = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
    this.fpsWindowMs = options.fpsWindowMs ?? DEFAULT_FPS_WINDOW_MS;
    this.now = options.now ?? defaultNow;
  }

  /**
   * Decide whether to capture+send now. When it returns `{send:true}` the
   * controller marks a capture in flight and records the time — the caller must
   * then call exactly one of `markSent()` / `markSendFailed()` when the async
   * `toBlob`+send resolves.
   */
  decide(input: DecideInput): StreamDecision {
    if (input.hidden) return { send: false, reason: 'hidden' };

    const t = this.now();
    if (t - this.lastCaptureAt < this.intervalMs) {
      return { send: false, reason: 'paced' };
    }
    if (this.inFlight) {
      this._dropped += 1;
      return { send: false, reason: 'in-flight' };
    }
    if (input.bufferedAmount > this.maxBuffered) {
      this._dropped += 1;
      return { send: false, reason: 'backpressure' };
    }

    this.lastCaptureAt = t;
    this.inFlight = true;
    return { send: true, reason: null };
  }

  /** Record a successful send (clears in-flight, feeds the fps window). */
  markSent(): void {
    this.inFlight = false;
    this._sent += 1;
    this.sentTimestamps.push(this.now());
    this.trim();
  }

  /** A capture/send failed: clear in-flight without counting it as sent. */
  markSendFailed(): void {
    this.inFlight = false;
  }

  /** Total frames sent since construction. */
  get sentCount(): number {
    return this._sent;
  }

  /** Frames that were due but skipped for in-flight/backpressure. */
  get droppedCount(): number {
    return this._dropped;
  }

  /** Smoothed frames-per-second actually sent over the rolling window. */
  fps(): number {
    this.trim();
    return this.sentTimestamps.length / (this.fpsWindowMs / 1000);
  }

  private trim(): void {
    const cutoff = this.now() - this.fpsWindowMs;
    while (this.sentTimestamps.length > 0 && this.sentTimestamps[0] < cutoff) {
      this.sentTimestamps.shift();
    }
  }
}

/** Derive the `/ws/frames` URL from the current page origin (pure, testable). */
export function framesSocketUrl(loc: Location | undefined = globalThis.location): string {
  if (!loc) return 'ws://localhost:8443/ws/frames';
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws/frames`;
}

/** True when `getUserMedia` can run here (secure context + API present). */
export function canCapture(
  win: { isSecureContext?: boolean } | undefined = typeof window !== 'undefined' ? window : undefined,
  nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined,
): boolean {
  const secure = win?.isSecureContext ?? false;
  const hasGum = !!nav?.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function';
  return secure && hasGum;
}
