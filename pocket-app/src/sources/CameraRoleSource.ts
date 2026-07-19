/**
 * CameraRoleSource — drives the pocket app's staff CAMERA role (U2).
 *
 * When a phone serves as the booth's camera it does two things, and this class
 * owns both:
 *
 *  1. **Stream frames** to the host's token-gated `/ws/frames` via the shared
 *     {@link FrameStreamer} (pacing + backpressure + reconnect). `App` feeds it
 *     the live camera canvas each animation frame through {@link offerFrame};
 *     the local vision pipeline is stopped (the HOST does detection now).
 *  2. **Announce + control** on `/ws/state` as an authenticated operator: it
 *     connects with `hello {role:'camera', key}` (so the host lists it as a
 *     camera in the `/debug` fleet) and, once open, sends `select_camera
 *     {kind:'push'}` so the host hot-swaps its pipeline onto the push source —
 *     exactly what the display app's `/capture` page does today, mirrored here.
 *
 * Zoom/freeze semantics come from the frame source (pocket's camera UI): the
 * streamed canvas is already the zoomed crop, and freeze pauses the frame pump
 * upstream (App stops calling `offerFrame`). The operator key is provided by the
 * shared `getOperatorKey` and is never rendered into the UI.
 */
import { StateSocket } from '@shared/ws/stateSocket';
import {
  FrameStreamer,
  type FrameStreamerStatus,
  type StatusListener,
} from '@shared/capture/frameStreamer';
import type { StreamControllerOptions } from '@shared/capture/streamController';

type TimeoutId = ReturnType<typeof setTimeout>;

export interface CameraRoleOptions {
  /** Full `ws(s)://…/ws/frames?key=<token>` URL (operator key already appended). */
  framesUrl: string;
  /** Full `ws(s)://…/ws/state` URL to announce + control on. */
  stateUrl: string;
  /** Resolves the operator token for the `/ws/state` `hello` (staff credential). */
  operatorKey: () => string | null | undefined;
  /** Injectable WebSocket implementation (tests supply a mock). */
  WebSocketImpl?: typeof WebSocket;
  controller?: StreamControllerOptions;
  setTimeoutImpl?: (fn: () => void, ms: number) => TimeoutId;
  clearTimeoutImpl?: (id: TimeoutId) => void;
  random?: () => number;
  /** JPEG quality for streamed frames (0..1); default 0.7 — matches /capture. */
  jpegQuality?: number;
}

/** Encode a canvas to JPEG bytes, or `null` when it cannot be encoded. */
function encodeCanvas(canvas: HTMLCanvasElement, quality: number): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        blob.arrayBuffer().then(resolve).catch(() => resolve(null));
      },
      'image/jpeg',
      quality,
    );
  });
}

export class CameraRoleSource {
  private readonly streamer: FrameStreamer;
  private readonly stateSocket: StateSocket;
  private readonly jpegQuality: number;
  private stateUnsub: (() => void) | null = null;
  private selectSent = false;

  constructor(options: CameraRoleOptions) {
    this.jpegQuality = options.jpegQuality ?? 0.7;
    this.streamer = new FrameStreamer({
      url: options.framesUrl,
      WebSocketImpl: options.WebSocketImpl,
      controller: options.controller,
      setTimeoutImpl: options.setTimeoutImpl,
      clearTimeoutImpl: options.clearTimeoutImpl,
      random: options.random,
    });
    this.stateSocket = new StateSocket({
      url: options.stateUrl,
      role: 'camera', // staff camera; the key promotes it to operator standing
      client: 'pocket-camera',
      operatorKey: options.operatorKey,
      WebSocketImpl: options.WebSocketImpl,
      setTimeoutImpl: options.setTimeoutImpl,
      clearTimeoutImpl: options.clearTimeoutImpl,
      random: options.random,
    });
  }

  /** Open both sockets. On the first `/ws/state` open, request the push source. */
  start(): void {
    this.streamer.start();
    this.stateUnsub = this.stateSocket.subscribe((snap) => {
      if (snap.connectionState === 'open') {
        if (!this.selectSent) {
          this.selectSent = true;
          // Operator-gated; the host honors it because our hello carried the key.
          this.stateSocket.send({ type: 'select_camera', kind: 'push' });
        }
      } else {
        // Re-request on the next open after a drop (host may have reset).
        this.selectSent = false;
      }
    });
    this.stateSocket.start();
  }

  /**
   * Offer the current camera canvas for streaming. The shared pacing core
   * decides whether this frame is due (target fps + backpressure); the canvas is
   * JPEG-encoded only then. Freeze is handled upstream (App stops calling this).
   */
  offerFrame(canvas: HTMLCanvasElement): void {
    const hidden = typeof document !== 'undefined' ? document.hidden : false;
    this.streamer.offerFrame(hidden, () => encodeCanvas(canvas, this.jpegQuality));
  }

  /** Tear down both sockets. Does NOT switch the host's camera back — booth
   *  staff decide the active camera (mirrors `/capture`'s stop behavior). */
  stop(): void {
    this.stateUnsub?.();
    this.stateUnsub = null;
    this.selectSent = false;
    this.stateSocket.stop();
    this.streamer.stop();
  }

  subscribe(listener: StatusListener): () => void {
    return this.streamer.subscribe(listener);
  }

  getStatus(): FrameStreamerStatus {
    return this.streamer.getStatus();
  }
}
