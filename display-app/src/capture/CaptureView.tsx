/**
 * CaptureView (/capture) — the phone camera page (M4).
 *
 * Streams the phone's rear camera to the booth host as JPEG frames:
 *   getUserMedia → <video> → canvas.toBlob('image/jpeg', 0.7)
 *     → ArrayBuffer over a dedicated `/ws/frames` WebSocket.
 *
 * The pure pacing / backpressure / fps bookkeeping lives in `streamController`
 * (unit-tested without a DOM); this component owns only the browser plumbing:
 * the media stream, the canvas, the two WebSockets, the wake lock, and the UI.
 *
 * On start it also opens a `capture-ui` `/ws/state` socket and sends
 * `select_camera {kind:'push'}` so the host swaps its pipeline onto the shared
 * push source. On stop it just stops sending frames — it deliberately does NOT
 * switch the source back (booth staff decide the active camera).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  StreamController,
  framesSocketUrl,
  canCapture,
} from './streamController';
import { StateSocket } from '../ws/stateSocket';
import './capture.css';

type Phase = 'idle' | 'streaming' | 'error';
type FramesConn = 'connecting' | 'open' | 'closed';

interface ErrorInfo {
  title: string;
  body: React.ReactNode;
  retryable: boolean;
}

const UNSUPPORTED_ERROR: ErrorInfo = {
  title: 'Camera not available on this page',
  retryable: false,
  body: (
    <>
      <p>
        The camera only works over a secure connection. Open this page via its{' '}
        <code>https://</code> address (scan the booth QR code), then tap through
        the certificate warning: <strong>Advanced → Proceed</strong>.
      </p>
      <p>After the page reloads over HTTPS, tap “Start camera” and allow camera access.</p>
    </>
  ),
};

// Minimal Wake Lock typing (not in the DOM lib on all TS targets).
type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
};

export function CaptureView() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [framesConn, setFramesConn] = useState<FramesConn>('connecting');
  const [wakeOn, setWakeOn] = useState(false);
  const [stats, setStats] = useState({ fps: 0, dropped: 0, sent: 0 });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const framesWsRef = useRef<WebSocket | null>(null);
  const stateSocketRef = useRef<StateSocket | null>(null);
  const stateUnsubRef = useRef<(() => void) | null>(null);
  const selectSentRef = useRef(false);
  const controllerRef = useRef<StreamController | null>(null);
  const rafRef = useRef<number | null>(null);
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const streamingRef = useRef(false);

  // Feature-detect once on mount: no secure context / no getUserMedia → error.
  useEffect(() => {
    if (!canCapture()) {
      setError(UNSUPPORTED_ERROR);
      setPhase('error');
    }
  }, []);

  const acquireWakeLock = useCallback(async () => {
    const wl = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!wl) return;
    try {
      const sentinel = await wl.request('screen');
      wakeLockRef.current = sentinel;
      setWakeOn(true);
      sentinel.addEventListener('release', () => setWakeOn(false));
    } catch {
      setWakeOn(false);
    }
  }, []);

  const onVisibility = useCallback(() => {
    // The OS drops the wake lock when the tab is backgrounded; re-acquire it
    // when we return to the foreground. The capture loop pauses on its own
    // while `document.hidden` (see StreamController).
    if (document.visibilityState === 'visible' && streamingRef.current) {
      void acquireWakeLock();
    }
  }, [acquireWakeLock]);

  const captureLoop = useCallback(() => {
    rafRef.current = requestAnimationFrame(captureLoop);
    const ws = framesWsRef.current;
    const controller = controllerRef.current;
    if (!ws || !controller || ws.readyState !== WebSocket.OPEN) return;

    const decision = controller.decide({
      bufferedAmount: ws.bufferedAmount,
      hidden: document.hidden,
    });
    if (!decision.send) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const w = video?.videoWidth ?? 0;
    const h = video?.videoHeight ?? 0;
    if (!video || !canvas || video.readyState < 2 || !w || !h) {
      controller.markSendFailed();
      return;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      controller.markSendFailed();
      return;
    }
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          controller.markSendFailed();
          return;
        }
        blob
          .arrayBuffer()
          .then((buf) => {
            const sock = framesWsRef.current;
            if (sock && sock.readyState === WebSocket.OPEN) {
              sock.send(buf);
              controller.markSent();
            } else {
              controller.markSendFailed();
            }
          })
          .catch(() => controller.markSendFailed());
      },
      'image/jpeg',
      0.7,
    );
  }, []);

  const stop = useCallback(() => {
    streamingRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (statsTimerRef.current !== null) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
    document.removeEventListener('visibilitychange', onVisibility);

    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;

    const ws = framesWsRef.current;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      framesWsRef.current = null;
    }

    if (stateUnsubRef.current) {
      stateUnsubRef.current();
      stateUnsubRef.current = null;
    }
    if (stateSocketRef.current) {
      stateSocketRef.current.stop();
      stateSocketRef.current = null;
    }
    selectSentRef.current = false;

    const wl = wakeLockRef.current;
    if (wl) {
      void wl.release().catch(() => undefined);
      wakeLockRef.current = null;
    }
    setWakeOn(false);
  }, [onVisibility]);

  const start = useCallback(async () => {
    if (!canCapture()) {
      setError(UNSUPPORTED_ERROR);
      setPhase('error');
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      setPhase('streaming');
      streamingRef.current = true;

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          /* autoplay policies — the <video autoPlay> attribute covers this */
        }
      }

      // Fresh controller per session so counters/fps start clean.
      controllerRef.current = new StreamController();

      // Dedicated binary frames socket.
      setFramesConn('connecting');
      const ws = new WebSocket(framesSocketUrl());
      ws.binaryType = 'arraybuffer';
      framesWsRef.current = ws;
      ws.onopen = () => {
        setFramesConn('open');
        try {
          ws.send(JSON.stringify({ type: 'hello', role: 'capture' }));
        } catch {
          /* optional hello */
        }
      };
      ws.onclose = () => setFramesConn('closed');
      ws.onerror = () => {
        /* close follows */
      };

      // capture-ui state socket → ask the host to swap onto the push source.
      selectSentRef.current = false;
      const stateSocket = new StateSocket({ role: 'capture-ui', client: 'phone' });
      stateSocketRef.current = stateSocket;
      stateUnsubRef.current = stateSocket.subscribe((snap) => {
        if (snap.connectionState === 'open' && !selectSentRef.current) {
          selectSentRef.current = true;
          stateSocket.send({ type: 'select_camera', kind: 'push' });
        }
      });
      stateSocket.start();

      // Wake lock + re-acquire on foreground.
      document.addEventListener('visibilitychange', onVisibility);
      void acquireWakeLock();

      // Chip refresh + capture loop.
      statsTimerRef.current = setInterval(() => {
        const c = controllerRef.current;
        if (c) setStats({ fps: c.fps(), dropped: c.droppedCount, sent: c.sentCount });
      }, 500);
      rafRef.current = requestAnimationFrame(captureLoop);
    } catch (err) {
      streamingRef.current = false;
      const name = (err as { name?: string })?.name ?? '';
      const denied = name === 'NotAllowedError' || name === 'SecurityError';
      setError({
        title: denied ? 'Camera permission needed' : 'Could not start the camera',
        retryable: true,
        body: denied ? (
          <p>
            Allow camera access when prompted, then tap “Start camera” again. If you
            dismissed the prompt, enable the camera for this site in your browser
            settings and retry.
          </p>
        ) : (
          <p>
            The camera could not be started ({name || 'unknown error'}). Make sure no
            other app is using it, then tap “Start camera” again.
          </p>
        ),
      });
      setPhase('error');
    }
  }, [acquireWakeLock, captureLoop, onVisibility]);

  // Clean up everything if the page unmounts mid-stream.
  useEffect(() => stop, [stop]);

  const connDotClass =
    framesConn === 'open' ? 'cap__dot--ok' : framesConn === 'connecting' ? 'cap__dot--warn' : 'cap__dot--bad';

  return (
    <div className={`cap${phase !== 'streaming' ? ' cap--landing' : ''}`}>
      {phase !== 'streaming' && (
        <div className="cap__card">
          <h1 className="cap__wordmark">
            Entang<span>ible</span>
          </h1>
          {phase === 'error' && error ? (
            <>
              <p className="cap__lead">Point your phone at the board from above.</p>
              <div className="cap__error" role="alert">
                <h2>{error.title}</h2>
                {error.body}
              </div>
              {error.retryable && (
                <button className="cap__start" type="button" onClick={() => void start()} style={{ marginTop: '1rem' }}>
                  Start camera
                </button>
              )}
            </>
          ) : (
            <>
              <p className="cap__lead">Point your phone at the board from above.</p>
              <button className="cap__start" type="button" onClick={() => void start()}>
                Start camera
              </button>
            </>
          )}
        </div>
      )}

      <video
        ref={videoRef}
        className="cap__video"
        playsInline
        muted
        autoPlay
        style={{ display: phase === 'streaming' ? 'block' : 'none' }}
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {phase === 'streaming' && (
        <div className="cap__overlay">
          <div className="cap__chips">
            <span className="cap__chip">
              <span className={`cap__dot ${connDotClass}`} />
              {framesConn === 'open' ? 'streaming' : framesConn}
            </span>
            <span className="cap__chip">{stats.fps.toFixed(1)} fps</span>
            <span className="cap__chip">{stats.dropped} dropped</span>
            <span className="cap__chip">
              <span className={`cap__dot ${wakeOn ? 'cap__dot--ok' : 'cap__dot--warn'}`} />
              {wakeOn ? 'screen awake' : 'wake lock off'}
            </span>
          </div>
          <div className="cap__footer">
            <button className="cap__stop" type="button" onClick={stop}>
              Stop
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CaptureView;
