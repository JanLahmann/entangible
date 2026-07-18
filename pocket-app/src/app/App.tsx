/**
 * Entangible Pocket — app shell (docs/pocket.md).
 *
 * Landscape-primary layout on the booth-v2 token system (pocket-prefixed):
 *   topbar (brand · camera pill · gear · start/stop) │ stage (recognized
 *   circuit, controlled CircuitEditor + message strip) │ side (panels per
 *   settings; golf swaps in Q-sphere + scorecard) │ footer (hint / warnings).
 *   Celebrations + moment engine are wired like the booth on LIVE circuit
 *   changes; golf drives its own celebrations (hole-in banner). Settings live in
 *   localStorage with URL overrides; a debug panel appends the pipeline stats.
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
import { Celebrations, LOW_POWER_PARTICLES, type CelebrationRequest } from './Celebrations';
import { ResultsHistogram } from './ResultsHistogram';
import { QasmPanel } from './QasmPanel';
import { QSphere2D } from './QSphere2D';
import { Scorecard } from './Scorecard';
import { DebugPanel } from './DebugPanel';
import { SettingsControl } from './SettingsDrawer';
import { useSettings, type PanelId } from './settings';
import {
  golfStep,
  initialGolfState,
  loadBest,
  saveBest,
  HOLES,
  type GolfState,
} from './golf';
import { friendlyWarning } from './warnings';
import { BOARD } from '../vision/geometry';
import type { FrameResult } from '../vision/pipeline';
import type { BuildWarning } from '../vision/circuitBuilder';
import type { DetectedMarker } from '../vision/detect';
import type { BoardResult } from '../vision/board';
import { CORNER_IDS } from '../vision/geometry';
import './pocket.css';

const BOARD_QUBITS = BOARD.rows;
const storage = typeof window !== 'undefined' ? window.localStorage : null;

const HINTS = [
  '● and ⊕ in the same column make a CNOT — entanglement in one move.',
  'An H tile puts a qubit into superposition — 0 and 1 at once.',
  'Place tiles left-to-right; each column is one step in time.',
  'Two entangled qubits always agree — measure one, know the other.',
];
const HINT_ROTATE_MS = 7000;
const DEBUG_THROTTLE_MS = 250;

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
  stats: FrameResult['stats'],
  fps: number,
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

  // Debug counters HUD (top-left) — doubles as the /debug view (docs/pocket.md).
  const fontPx = Math.max(11, Math.round(w / 95));
  const pad = Math.round(fontPx * 0.8);
  ctx.font = `${fontPx}px ui-monospace, SFMono-Regular, monospace`;
  ctx.textBaseline = 'top';
  const line = `cand ${stats.candidates} · blind ${stats.blindHits} · guided ${stats.guidedRescues} · ${fps} fps`;
  ctx.lineWidth = Math.max(3, fontPx / 4);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.strokeText(line, pad, pad);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.fillText(line, pad, pad);
}

export function App() {
  const settings = useSettings();
  const [circuit, setCircuit] = useState<Circuit>(() => createDefaultCircuit(BOARD_QUBITS));
  const [warnings, setWarnings] = useState<BuildWarning[]>([]);
  const [corners, setCorners] = useState(0);
  const [strip, setStrip] = useState<StripMessage | null>(null);
  const [celebration, setCelebration] = useState<CelebrationRequest | null>(null);
  const [hintIndex, setHintIndex] = useState(0);
  const [golfState, setGolfState] = useState<GolfState>(() => initialGolfState(loadBest(storage)));
  const [, setDebugTick] = useState(0);

  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fpsRef = useRef(0);
  const momentStateRef = useRef<MomentState>(initialMomentState);
  const prevCircuitRef = useRef<Circuit>(createDefaultCircuit(BOARD_QUBITS));
  const tokenRef = useRef(0);
  const golfStateRef = useRef<GolfState>(golfState);
  const lastFrameRef = useRef<FrameResult | null>(null);
  const debugTickAtRef = useRef(0);

  // Keep frame-loop closures reading the current mode/debug flags.
  const modeRef = useRef(settings.mode);
  modeRef.current = settings.mode;
  const debugRef = useRef(settings.debug);
  debugRef.current = settings.debug;

  const pushStrip = useCallback((text: string) => {
    setStrip({ text, token: ++tokenRef.current });
  }, []);

  const onResult = useCallback(
    (result: FrameResult, video: HTMLVideoElement) => {
      // Overlay every processed frame (cheap; keeps the debug view live).
      if (overlayRef.current) {
        drawOverlay(
          overlayRef.current,
          result.detected,
          result.board,
          video.videoWidth,
          video.videoHeight,
          result.stats,
          fpsRef.current,
        );
      }
      setCorners(result.corners);

      lastFrameRef.current = result;
      if (debugRef.current) {
        const now = performance.now();
        if (now - debugTickAtRef.current > DEBUG_THROTTLE_MS) {
          debugTickAtRef.current = now;
          setDebugTick((t) => t + 1);
        }
      }

      if (!result.changed) return;

      const next = result.circuit as unknown as Circuit;
      setCircuit(next);
      setWarnings(result.warnings);

      if (modeRef.current === 'golf') {
        const step = golfStep(golfStateRef.current, next);
        golfStateRef.current = step.state;
        setGolfState(step.state);
        if (step.justHoledIn && step.scoreName) {
          saveBest(storage, step.state.best);
          setCelebration({
            kind: step.hole.k >= 3 ? 'ghz' : 'bell',
            k: step.hole.k,
            banner: `${step.scoreName}!`,
            token: ++tokenRef.current,
          });
        }
        prevCircuitRef.current = next;
        return;
      }

      // Composer moment engine — identical to BoothView, on live changes only.
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

  const camera = useCamera({ onResult, lowPower: settings.lowpower });
  fpsRef.current = camera.fps;

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

  const isGolf = settings.mode === 'golf';
  const hasPanel = (p: PanelId) => settings.panels.includes(p);
  const showCamera = hasPanel('camera') || camera.status !== 'idle';
  const currentHole = HOLES[golfState.holeIndex];
  const golfTargets = useMemo(
    () => new Set<number>([0, (1 << currentHole.k) - 1]),
    [currentHole.k],
  );

  const cameraPanel = (
    <CameraPanel
      key="camera"
      camera={camera}
      overlayRef={overlayRef}
      boardLocked={boardLocked}
      visible={hasPanel('camera')}
    />
  );

  const composerPanels = settings.panels
    .filter((p) => p !== 'camera')
    .map((p) => {
      switch (p) {
        case 'results':
          return <ResultsHistogram key="results" circuit={circuit} />;
        case 'state':
          return <StatePanel key="state" circuit={circuit} />;
        case 'qasm':
          return <QasmPanel key="qasm" circuit={circuit} />;
        default:
          return null;
      }
    });

  const sidebar = isGolf ? (
    <>
      {showCamera && cameraPanel}
      <QSphere2D key="qsphere" circuit={circuit} targets={golfTargets} />
      <Scorecard key="scorecard" state={golfState} circuit={circuit} />
      {hasPanel('results') && <ResultsHistogram key="results" circuit={circuit} />}
      {hasPanel('state') && <StatePanel key="state" circuit={circuit} />}
      {hasPanel('qasm') && <QasmPanel key="qasm" circuit={circuit} />}
      {settings.debug && <DebugPanel key="debug" frame={lastFrameRef.current} fps={camera.fps} />}
    </>
  ) : (
    <>
      {showCamera && cameraPanel}
      {composerPanels}
      {settings.debug && <DebugPanel key="debug" frame={lastFrameRef.current} fps={camera.fps} />}
    </>
  );

  return (
    <div className="pk">
      <header className="pk-topbar">
        <div className="pk-brand">
          <span className="en">En</span>tangible<small>pocket</small>
        </div>
        {isGolf && <span className="pk-pill pk-pill--mode">golf</span>}
        <span className="pk-spacer" />
        <span className={`pk-pill ${camPill.cls}`}>
          <span className="pk-dot" aria-hidden="true" />
          {camPill.label}
        </span>
        <SettingsControl />
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
          <main className={`pk-main ${settings.side === 'left' ? 'pk-side-left' : ''}`}>
            <section className="pk-stage">
              <div className="pk-stage-editor">
                <CircuitEditor />
              </div>
              <MessageStrip message={strip} />
            </section>

            <aside className="pk-side">{sidebar}</aside>
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

      <Celebrations
        celebration={celebration}
        maxParticles={settings.lowpower ? LOW_POWER_PARTICLES : undefined}
      />
    </div>
  );
}

function CameraPanel({
  camera,
  overlayRef,
  boardLocked,
  visible,
}: {
  camera: ReturnType<typeof useCamera>;
  overlayRef: React.RefObject<HTMLCanvasElement>;
  boardLocked: boolean;
  visible: boolean;
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

  // Camera panel toggled off but the stream must keep running: keep the <video>
  // element mounted (hidden) so the ref — and the frame loop — stay alive.
  if (!visible) {
    return (
      <div style={{ display: 'none' }} aria-hidden="true">
        <video ref={videoRef} playsInline muted />
        <canvas ref={overlayRef} />
      </div>
    );
  }

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
