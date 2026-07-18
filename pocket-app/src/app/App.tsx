/**
 * Entangible Pocket — app shell (docs/pocket.md).
 *
 * Landscape-primary layout on the booth-v2 token system (pocket-prefixed):
 *   topbar (brand · camera pill · start/stop) │ stage (recognized circuit,
 *   controlled CircuitEditor + message strip) │ side (camera preview with
 *   detection overlay + RESULTS bit-stack histogram + STATE) │ footer (hint
 *   ticker / warnings). Celebrations + moment engine are wired exactly like the
 *   booth's BoothView, on LIVE circuit changes only — the physical table is the
 *   editor, so the on-screen circuit is CONTROLLED.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ThemeProvider,
  QamposerProvider,
  CircuitEditor,
  createDefaultCircuit,
  type Circuit,
} from '@qamposer/react';
import { activeQubits } from '@quantum/statevector';
import { evaluateMoment, initialMomentState, type MomentState } from '@quantum/moments';
import { useCamera } from './useCamera';
import { pinchZoom, pointerDistance, type Point as PinchPoint } from './zoom';
import { MessageStrip, type StripMessage } from './MessageStrip';
import { Celebrations, type CelebrationRequest } from './Celebrations';
import { ResultsHistogram } from './ResultsHistogram';
import { friendlyWarning } from './warnings';
import { BOARD } from '../vision/geometry';
import type { FrameResult } from '../vision/pipeline';
import type { BuildWarning } from '../vision/circuitBuilder';
import type { DetectedMarker } from '../vision/detect';
import type { BoardResult } from '../vision/board';
import { CORNER_IDS } from '../vision/geometry';
import './pocket.css';

const BOARD_QUBITS = BOARD.rows;

const HINTS = [
  '● and ⊕ in the same column make a CNOT — entanglement in one move.',
  'An H tile puts a qubit into superposition — 0 and 1 at once.',
  'Place tiles left-to-right; each column is one step in time.',
  'Two entangled qubits always agree — measure one, know the other.',
];
const HINT_ROTATE_MS = 7000;

function StatePanel({ circuit }: { circuit: Circuit }) {
  const touched = activeQubits(circuit).length;
  const columns = new Set(circuit.gates.map((g) => g.position)).size;
  return (
    <div>
      <div className="pk-label">State</div>
      <div className="pk-stats">
        <div className="pk-stat">
          qubits touched <b>{touched}</b>
        </div>
        <div className="pk-stat">
          gates <b>{circuit.gates.length}</b>
        </div>
        <div className="pk-stat">
          columns <b>{columns}</b>
        </div>
      </div>
    </div>
  );
}

function drawOverlay(
  canvas: HTMLCanvasElement,
  detected: DetectedMarker[],
  board: BoardResult | null,
  w: number,
  h: number,
): void {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = Math.max(2, w / 400);

  // Board quad (purple) — map the mat corners board-mm → image px.
  if (board) {
    const mat: Array<[number, number]> = [
      [0, 0],
      [BOARD.matWidth, 0],
      [BOARD.matWidth, BOARD.matHeight],
      [0, BOARD.matHeight],
    ];
    ctx.strokeStyle = 'rgba(122, 92, 255, 0.9)';
    ctx.beginPath();
    mat.forEach((mm, i) => {
      const [x, y] = board.boardToImage(mm);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }

  // Marker outlines — corners green, gate tiles cyan.
  for (const m of detected) {
    const isCorner = String(m.id) in CORNER_IDS;
    ctx.strokeStyle = isCorner ? 'rgba(47, 191, 113, 0.9)' : 'rgba(51, 177, 255, 0.95)';
    ctx.beginPath();
    m.corners.forEach((c, i) => {
      if (i === 0) ctx.moveTo(c[0], c[1]);
      else ctx.lineTo(c[0], c[1]);
    });
    ctx.closePath();
    ctx.stroke();
  }
}

export function App() {
  const [circuit, setCircuit] = useState<Circuit>(() => createDefaultCircuit(BOARD_QUBITS));
  const [warnings, setWarnings] = useState<BuildWarning[]>([]);
  const [corners, setCorners] = useState(0);
  const [strip, setStrip] = useState<StripMessage | null>(null);
  const [celebration, setCelebration] = useState<CelebrationRequest | null>(null);
  const [hintIndex, setHintIndex] = useState(0);

  const overlayRef = useRef<HTMLCanvasElement>(null);
  const momentStateRef = useRef<MomentState>(initialMomentState);
  const prevCircuitRef = useRef<Circuit>(createDefaultCircuit(BOARD_QUBITS));
  const tokenRef = useRef(0);

  const pushStrip = useCallback((text: string) => {
    setStrip({ text, token: ++tokenRef.current });
  }, []);

  const onResult = useCallback(
    (result: FrameResult, video: HTMLVideoElement) => {
      // Overlay every processed frame (cheap; keeps the debug view live).
      if (overlayRef.current) {
        drawOverlay(overlayRef.current, result.detected, result.board, video.videoWidth, video.videoHeight);
      }
      setCorners(result.corners);

      if (!result.changed) return;

      const next = result.circuit as unknown as Circuit;
      setCircuit(next);
      setWarnings(result.warnings);

      // Moment engine — identical to BoothView, on live changes only.
      const outcome = evaluateMoment(prevCircuitRef.current, next, momentStateRef.current, Date.now());
      momentStateRef.current = outcome.state;
      prevCircuitRef.current = next;
      if (outcome.stripMessage) pushStrip(outcome.stripMessage);
      if (outcome.celebration) {
        setCelebration({ ...outcome.celebration, token: ++tokenRef.current });
      }
    },
    [pushStrip],
  );

  const camera = useCamera({ onResult });

  useEffect(() => {
    const id = window.setInterval(
      () => setHintIndex((i) => (i + 1) % HINTS.length),
      HINT_ROTATE_MS,
    );
    return () => window.clearInterval(id);
  }, []);

  const qamposerConfig = useMemo(() => ({ maxQubits: BOARD_QUBITS }), []);

  const running = camera.status === 'running';
  const boardLocked = corners >= 3;
  const camPill = running
    ? boardLocked
      ? { cls: 'is-live', label: `board locked · ${camera.fps} fps` }
      : { cls: 'is-searching', label: 'searching…' }
    : { cls: 'is-off', label: 'camera off' };

  return (
    <div className="pk">
      <header className="pk-topbar">
        <div className="pk-brand">
          <span className="en">En</span>tangible<small>pocket</small>
        </div>
        <span className="pk-spacer" />
        <span className={`pk-pill ${camPill.cls}`}>
          <span className="pk-dot" aria-hidden="true" />
          {camPill.label}
        </span>
        {running ? (
          <button className="pk-btn is-stop" onClick={camera.stop}>
            Stop
          </button>
        ) : (
          <button className="pk-btn" onClick={camera.start} disabled={camera.status === 'starting'}>
            {camera.status === 'starting' ? 'Starting…' : 'Start camera'}
          </button>
        )}
      </header>

      <ThemeProvider defaultTheme="dark">
        <QamposerProvider circuit={circuit} config={qamposerConfig}>
          <main className="pk-main">
            <section className="pk-stage">
              <div className="pk-stage-editor">
                <CircuitEditor />
              </div>
              <MessageStrip message={strip} />
            </section>

            <aside className="pk-side">
              <CameraPanel camera={camera} overlayRef={overlayRef} boardLocked={boardLocked} />
              <ResultsHistogram circuit={circuit} />
              <StatePanel circuit={circuit} />
            </aside>
          </main>
        </QamposerProvider>
      </ThemeProvider>

      <footer className={`pk-footer ${warnings.length > 0 ? 'has-warnings' : ''}`}>
        {warnings.length > 0 ? (
          <>
            <span className="pk-warnicon" aria-hidden="true">
              ⚠
            </span>
            <div role="status">{warnings.map((w) => friendlyWarning(w)).join('  ·  ')}</div>
          </>
        ) : (
          <div key={hintIndex}>{HINTS[hintIndex]}</div>
        )}
      </footer>

      <Celebrations celebration={celebration} />
    </div>
  );
}

function CameraPanel({
  camera,
  overlayRef,
  boardLocked,
}: {
  camera: ReturnType<typeof useCamera>;
  overlayRef: React.RefObject<HTMLCanvasElement>;
  boardLocked: boolean;
}) {
  const { status, error, fps, videoRef, start, zoom, zoomRange, previewScale, setZoom, stepZoom, resetZoom } =
    camera;

  // Pinch-to-zoom (two pointers) + double-tap-to-reset on the preview.
  const pointersRef = useRef<Map<number, PinchPoint>>(new Map());
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);
  const lastTapRef = useRef(0);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchStartRef.current = { dist: pointerDistance(a, b), zoom: zoomRef.current };
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const start = pinchStartRef.current;
      if (start && pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()];
        setZoom(pinchZoom(start.zoom, start.dist, pointerDistance(a, b), zoomRange.min, zoomRange.max));
      }
    },
    [setZoom, zoomRange.min, zoomRange.max],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const wasSolo = pointersRef.current.size === 1;
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchStartRef.current = null;
      // Double-tap (single-finger) resets to 1×.
      if (wasSolo) {
        const now = e.timeStamp || performance.now();
        if (now - lastTapRef.current < 300) {
          resetZoom();
          lastTapRef.current = 0;
        } else {
          lastTapRef.current = now;
        }
      }
    },
    [resetZoom],
  );

  return (
    <div>
      <div className="pk-label">Camera</div>
      {status === 'running' ? (
        <div
          className="pk-cam"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ touchAction: 'none' }}
        >
          <video ref={videoRef} playsInline muted style={{ transform: `scale(${previewScale})` }} />
          <canvas ref={overlayRef} className="pk-overlay" />
          <span className="pk-cam-fps">{fps} fps</span>
          <ZoomPill
            zoom={zoom}
            min={zoomRange.min}
            max={zoomRange.max}
            onIn={() => stepZoom(1)}
            onOut={() => stepZoom(-1)}
          />
          {!boardLocked && (
            <div className="pk-cam-hint">Point at the board — all four corners in view</div>
          )}
        </div>
      ) : (
        <div className="pk-cam is-idle">
          {/* Keep the video element mounted so the ref is stable across starts. */}
          <video ref={videoRef} playsInline muted style={{ display: 'none' }} />
          <div className={`pk-startcard ${status === 'error' ? 'is-error' : ''}`}>
            <h2>{status === 'error' ? 'Camera unavailable' : 'Point your iPad at the board'}</h2>
            <p>
              {status === 'error'
                ? error
                : 'Start the camera, then frame the printed mat so all four corner markers are visible. Place tiles and watch the circuit build itself.'}
            </p>
            <button className="pk-btn" onClick={start} disabled={status === 'starting'}>
              {status === 'starting' ? 'Starting…' : 'Start camera'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ZoomPill({
  zoom,
  min,
  max,
  onIn,
  onOut,
}: {
  zoom: number;
  min: number;
  max: number;
  onIn: () => void;
  onOut: () => void;
}) {
  // Stop pointer events from reaching the pinch handler on the preview.
  const swallow = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <div className="pk-zoom" onPointerDown={swallow} onPointerUp={swallow}>
      <button
        type="button"
        className="pk-zoom__btn"
        aria-label="Zoom out"
        onClick={onOut}
        disabled={zoom <= min + 1e-6}
      >
        −
      </button>
      <span className="pk-zoom__val">{zoom.toFixed(1)}×</span>
      <button
        type="button"
        className="pk-zoom__btn"
        aria-label="Zoom in"
        onClick={onIn}
        disabled={zoom >= max - 1e-6}
      >
        +
      </button>
    </div>
  );
}

export default App;
