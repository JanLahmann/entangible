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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ThemeProvider,
  QamposerProvider,
  CircuitEditor,
  Operations,
  createDefaultCircuit,
  type Circuit,
} from '@qamposer/react';
import { evaluateMoment, initialMomentState, type MomentState } from '@quantum/moments';
import { defaultStateUrl } from '@shared/ws/stateSocket';
import { friendlyWarning } from '@shared/display/warnings';
import type { WarningInput } from '@shared/display/warnings';
import type { Wires } from '@shared/display/wires';
import type { NoisePreset } from '@quantum/noise';
import type { ServedMessage } from '@shared/ws/messages';
import { LocalPipelineSource } from '../sources/LocalPipelineSource';
import { BoothSocketSource } from '../sources/BoothSocketSource';
import { CameraRoleSource } from '../sources/CameraRoleSource';
import { ManualEditSource, resolveActiveInput } from '../sources/ManualEditSource';
import type { BoothMode, ConnectionPhase, StateSource, StateUpdate } from '../sources/StateSource';
import { boothLink, useBoothLink } from './boothLink';
import { cameraRoleLink, useCameraRole } from './cameraRoleLink';
import { cameraSwitchAction, connectionPill, connectRequested } from '../sources/boothUrl';
import { cameraRoleOffered, framesUrlFromStateUrl, roleRequested } from '../sources/cameraRole';
import { getOperatorKey, withKey } from '@shared/ws/operatorKey';
import { framesSocketUrl } from '@shared/capture/streamController';
import type { FrameStreamerStatus } from '@shared/capture/frameStreamer';
import { useCamera } from './useCamera';
import { pinchZoom, pointerDistance, cropRect, type Point as PinchPoint } from './zoom';
import { detectMatRoi } from '../vision/matDetect';
import type { Rect } from '@shared/capture/matRoi';
import { MessageStrip, type StripMessage } from './MessageStrip';
import { Celebrations, LOW_POWER_PARTICLES, type CelebrationRequest } from './Celebrations';
import { ResultsHistogram, noiseSeries } from './ResultsHistogram';
import { QasmPanel } from './QasmPanel';
import { StatePanel } from '@shared/display/StatePanel';
import { ComposerHandoff } from './ComposerHandoff';
import { QSphereView } from '@quantum/QSphereView';
import { BlochView } from '@quantum/BlochView';
import { Scorecard } from './Scorecard';
import { DebugPanel } from './DebugPanel';
import { SettingsControl } from './SettingsDrawer';
import { TouchInspector } from './TouchInspector';
import { toggleFrozen } from './freeze';
import { GuidePage } from './GuidePage';
import { useRoute } from './hashNav';
import { settingsStore, useSettings, type Mode, type PanelId } from './settings';
import { QuantinaPanel, useQuantinaPack } from './QuantinaPanel';
import { displayCircuit } from '@shared/display/displayWires';
import { HINTS, HINT_ROTATE_MS } from '@shared/display/hints';
import { editorFit, editorNaturalHeight, type EditorFit } from './editorFit';
import {
  golfStep,
  initialGolfState,
  loadBest,
  saveBest,
  LEVELS,
  type GolfState,
} from '@quantum/golf';
import {
  detectEnv,
  exitFullscreen,
  fullscreenElement,
  loadHintDismissed,
  requestFullscreen,
  saveHintDismissed,
  shouldShowInstallHint,
} from './fullscreen';
import { BOARD } from '../vision/geometry';
import type { FrameResult } from '../vision/pipeline';
import type { DetectedMarker } from '../vision/detect';
import type { BoardResult } from '../vision/board';
import { CORNER_IDS } from '../vision/geometry';
import './pocket.css';

const BOARD_QUBITS = BOARD.rows;
const storage = typeof window !== 'undefined' ? window.localStorage : null;

const DEBUG_THROTTLE_MS = 250;

/** Element-Fullscreen state + toggle, feature-detected (hidden on iPhone). */
function useFullscreen() {
  const supported = useMemo(
    () =>
      typeof document !== 'undefined' &&
      detectEnv(window as Window & typeof globalThis).hasElementFullscreen,
    [],
  );
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!supported) return;
    const sync = () => setActive(fullscreenElement(document) != null);
    sync();
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, [supported]);
  const toggle = useCallback(() => {
    if (fullscreenElement(document) != null) exitFullscreen(document);
    else requestFullscreen(document.documentElement);
  }, []);
  return { supported, active, toggle };
}

/**
 * Stage variant class. In manual "build on screen" mode the stage also holds the
 * on-screen gate palette above the editor; `pk-stage--manual` scopes the phone
 * CSS that floors the editor's height so the palette can't collapse it (see
 * pocket.css). Camera/booth stages get the plain `.pk-stage` sizing. Pure and
 * exported so the seam is unit-testable without a DOM.
 */
export function stageClassName(manual: boolean): string {
  return manual ? 'pk-stage pk-stage--manual' : 'pk-stage';
}

/**
 * Effective panel set: while connected the booth's broadcast `panels` (registry
 * names, display order) override the local `settings.panels`; standalone (or
 * before a layout arrives, `boothPanels` null) the local set stands. Booth
 * control is an OVERLAY — the local settings are never written, so a disconnect
 * (boothPanels → null) restores them. Pure + exported so the seam is unit-testable.
 */
export function boothOrLocalPanels(
  boothPanels: readonly string[] | null,
  localPanels: readonly PanelId[],
): readonly string[] {
  return boothPanels ?? localPanels;
}

/**
 * Camera-UI visibility (viewer policy, design: read-only Display role). The
 * on-device camera is hidden entirely whenever the pipeline is not the active
 * source — `cameraHidden` (a connected booth viewer OR manual mode). So a booth
 * `panels` list containing `camera` NEVER surfaces camera UI while connected:
 * the operator-key-gated camera panel is a KIOSK affordance (task #49), not a
 * visitor-phone one. Pure + exported so the seam is unit-testable.
 */
export function showCameraUi(
  cameraHidden: boolean,
  hasCameraPanel: boolean,
  cameraActive: boolean,
): boolean {
  return !cameraHidden && (hasCameraPanel || cameraActive);
}

/**
 * Vertical auto-fit for the recognized-circuit editor. Measures the stage's
 * available height (ResizeObserver on the editor container) and derives a scale
 * from the editor's natural height (D wires x row height + chrome) so all
 * `displayQubits` wires always fit — no clipping. On roomy iPad/desktop stages
 * the available height already exceeds the natural height, so the scale stays 1
 * and nothing changes there.
 */
function useEditorFit(displayQubits: number): {
  containerRef: React.RefObject<HTMLDivElement>;
  fit: EditorFit & { natural: number };
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const natural = editorNaturalHeight(displayQubits);
  const [fit, setFit] = useState<EditorFit>({ scale: 1, scroll: false });

  useLayoutEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      if (!container) return;
      const next = editorFit(container.clientHeight, natural);
      setFit((prev) => (prev.scale === next.scale && prev.scroll === next.scroll ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [natural]);

  return { containerRef, fit: { ...fit, natural } };
}

function FullscreenButton({ variant }: { variant: 'bar' | 'cam' }) {
  const { supported, active, toggle } = useFullscreen();
  if (!supported) return null;
  const label = active ? 'Exit fullscreen' : 'Fullscreen';
  return (
    <button
      type="button"
      className={`pk-fs pk-fs--${variant}`}
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        {active ? (
          <path
            fill="currentColor"
            d="M9 9V4H7v3H4v2h5Zm6 0h5V7h-3V4h-2v5ZM9 15H4v2h3v3h2v-5Zm6 0v5h2v-3h3v-2h-5Z"
          />
        ) : (
          <path
            fill="currentColor"
            d="M4 9V4h5v2H6v3H4Zm11-5h5v5h-2V6h-3V4ZM6 15v3h3v2H4v-5h2Zm12 0h2v5h-5v-2h3v-3Z"
          />
        )}
      </svg>
      {variant === 'bar' && <span className="pk-fs-label">{active ? 'Exit' : 'Fullscreen'}</span>}
    </button>
  );
}

/** iPhone-only "Add to Home Screen" hint — shown once the camera has run. */
function InstallHint({ cameraStarted }: { cameraStarted: boolean }) {
  const env = useMemo(() => detectEnv(window as Window & typeof globalThis), []);
  const [dismissed, setDismissed] = useState(() => loadHintDismissed(storage));
  if (!shouldShowInstallHint(env, { cameraStarted, dismissed })) return null;
  return (
    <div className="pk-install-hint" role="note">
      <span>
        For fullscreen, add Entangible to your Home Screen: <b>Share → Add to Home Screen</b>.
      </span>
      <button
        type="button"
        className="pk-install-hint-x"
        aria-label="Dismiss"
        onClick={() => {
          saveHintDismissed(storage);
          setDismissed(true);
        }}
      >
        ✕
      </button>
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

/**
 * Draw the just-detected mat ROI as a dashed rectangle over the camera preview
 * (task #34) — a ~1.5 s confirmation before the stream locks to it. The ROI is in
 * source px; the preview shows the current `crop` (zoom region) upscaled to fill
 * the frame, so we map ROI → that displayed space, matching `drawOverlay`'s
 * convention (canvas sized to the full frame, CSS-scaled over the video).
 */
function drawMatOverlay(
  canvas: HTMLCanvasElement,
  roi: Rect,
  crop: { sx: number; sy: number; sw: number; sh: number },
  w: number,
  h: number,
): void {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);
  const kx = w / crop.sw;
  const ky = h / crop.sh;
  const x = (roi.sx - crop.sx) * kx;
  const y = (roi.sy - crop.sy) * ky;
  const rw = roi.sw * kx;
  const rh = roi.sh * ky;
  // Dim everything outside the ROI so the kept region reads instantly.
  ctx.fillStyle = 'rgba(9, 11, 16, 0.55)';
  ctx.fillRect(0, 0, w, h);
  ctx.clearRect(x, y, rw, rh);
  ctx.lineWidth = Math.max(2, w / 320);
  ctx.setLineDash([Math.max(6, w / 90), Math.max(4, w / 140)]);
  ctx.strokeStyle = 'rgba(47, 191, 113, 0.95)';
  ctx.strokeRect(x, y, rw, rh);
}

/** Clear a canvas used only for the transient mat-ROI overlay. */
function clearCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
}

/** Status-pill label + style hook for the CAMERA role's streaming connection. */
function cameraStreamPill(status: FrameStreamerStatus | null): { label: string; cls: string } {
  if (!status || status.connection === 'connecting')
    return { label: 'Connecting to booth…', cls: 'is-searching' };
  if (status.connection === 'reconnecting') return { label: 'Reconnecting…', cls: 'is-searching' };
  if (status.connection === 'closed') return { label: 'Stream stopped', cls: 'is-off' };
  return { label: `Streaming to booth · ${Math.round(status.fps)} fps`, cls: 'is-live' };
}

export function App() {
  const settings = useSettings();
  const route = useRoute();
  const boothUrl = useBoothLink().url;
  // Connected as a booth viewer when a link target is set (design: read-only
  // Display role — the visitor QR is view-only).
  const connected = boothUrl !== null;
  // Input-source precedence (docs/design.md "Entangible One"): a connected booth
  // viewer ALWAYS wins over `?input=manual`; otherwise the persisted/URL input
  // mode picks manual (build-on-screen) vs the local camera pipeline.
  const manual = resolveActiveInput({ connected, input: settings.input }) === 'manual';
  // The on-device camera is hidden + stopped whenever the pipeline is not the
  // active source — as a booth viewer OR in manual mode (same hand-off machinery).
  const cameraHidden = connected || manual;
  // Staff CAMERA role (U2): the phone streams frames to a host as its camera.
  const cameraRoleState = useCameraRole();
  const cameraRole = cameraRoleState.active;
  // Operator credential present? (from `?key=`, or previously stored.) Reading
  // it once here also persists any URL key and scrubs it from the address bar
  // (shared operatorKey helper) — the credential is never shown in the UI.
  const operatorKeyPresent = useMemo(() => getOperatorKey() != null, []);
  const [circuit, setCircuit] = useState<Circuit>(() => createDefaultCircuit(BOARD_QUBITS));
  const [warnings, setWarnings] = useState<WarningInput[]>([]);
  // Booth-driven metadata (null while standalone). `boothMode`/`boothWires`
  // override the local settings while connected.
  const [conn, setConn] = useState<ConnectionPhase | null>(null);
  const [boothMode, setBoothMode] = useState<BoothMode | null>(null);
  const [boothWires, setBoothWires] = useState<Wires | null>(null);
  // Booth-driven panel set (registry names, display order); null while
  // standalone. When connected it overrides the local `settings.panels`.
  const [boothPanels, setBoothPanels] = useState<string[] | null>(null);
  const [boothNoise, setBoothNoise] = useState<NoisePreset | null>(null);
  // Booth-driven Quantina pack id + the latest booth serve (QN2). Both null
  // while standalone; when connected they drive the synced menu + reveal.
  const [boothMenu, setBoothMenu] = useState<string | null>(null);
  const [boothServed, setBoothServed] = useState<ServedMessage | null>(null);
  // Served by a booth host? (its own origin answers /api/info) — enables the
  // "Connect to booth" affordance. Cheap probe on startup; failures ignored.
  const [servedByHost, setServedByHost] = useState(false);
  const [corners, setCorners] = useState(0);
  const [strip, setStrip] = useState<StripMessage | null>(null);
  const [celebration, setCelebration] = useState<CelebrationRequest | null>(null);
  const [hintIndex, setHintIndex] = useState(0);
  const [golfState, setGolfState] = useState<GolfState>(() => initialGolfState(loadBest(storage)));
  const [, setDebugTick] = useState(0);
  // Freeze: session-momentary; starts unfrozen and persists nothing.
  const [frozen, setFrozen] = useState(false);
  // CAMERA role streaming status (fps + connection) for the status pill.
  const [streamStatus, setStreamStatus] = useState<FrameStreamerStatus | null>(null);
  // CAMERA role, "Frame the mat" lock (task #34): the source-space mat ROI the
  // stream is locked to, or null (full/zoomed frame). Session-only — a physical
  // re-aim invalidates it, so it deliberately persists nothing.
  const [matLock, setMatLock] = useState<Rect | null>(null);

  const overlayRef = useRef<HTMLCanvasElement>(null);
  const matOverlayTimerRef = useRef<number | null>(null);
  const fpsRef = useRef(0);
  const momentStateRef = useRef<MomentState>(initialMomentState);
  const prevCircuitRef = useRef<Circuit>(createDefaultCircuit(BOARD_QUBITS));
  const tokenRef = useRef(0);
  const golfStateRef = useRef<GolfState>(golfState);
  const lastFrameRef = useRef<FrameResult | null>(null);
  const debugTickAtRef = useRef(0);
  // State-source seam (Entangible One U1b): the local pipeline adapter is fed by
  // the camera frame loop; the booth source is created on demand while
  // connected. `appliedCircuitRef` dedupes downstream work (moments/golf) by
  // circuit identity, so booth detection/status frames don't re-run it.
  const localSourceRef = useRef<LocalPipelineSource>(new LocalPipelineSource());
  // Manual-edit source (no-camera build-on-screen mode). Held for the session so
  // re-entering manual keeps the last on-screen circuit.
  const manualSourceRef = useRef<ManualEditSource>(new ManualEditSource());
  const appliedCircuitRef = useRef<Circuit | null>(null);
  // Remembers whether the camera was running when we entered booth mode, so a
  // disconnect can resume the local pipeline cleanly.
  const resumeCameraRef = useRef(false);
  // CAMERA role streaming controller (frames socket + operator select_camera).
  const cameraRoleSourceRef = useRef<CameraRoleSource | null>(null);

  // Keep frame-loop closures reading the current mode/debug flags.
  const modeRef = useRef(settings.mode);
  modeRef.current = settings.mode;
  const debugRef = useRef(settings.debug);
  debugRef.current = settings.debug;

  const pushStrip = useCallback((text: string) => {
    setStrip({ text, token: ++tokenRef.current });
  }, []);

  // Apply one neutral update from the active state source. The circuit +
  // moment/golf handling is IDENTICAL whether the update came from the local
  // pipeline or the booth (design: the booth feeds the exact same downstream).
  // Downstream work runs only when the circuit reference actually changed, so
  // booth detection/status frames (same circuit ref) don't re-fire it.
  const applyUpdate = useCallback(
    (update: StateUpdate) => {
      if (update.source === 'booth') {
        if (update.connection) setConn(update.connection);
        setBoothMode(update.boothMode ?? null);
        setBoothWires(update.boothWires ?? null);
        setBoothPanels(update.boothPanels ?? null);
        setBoothNoise(update.boothNoise ?? null);
        setBoothMenu(update.boothMenu ?? null);
        if (update.boothServed) setBoothServed(update.boothServed);
      }

      if (update.circuit === appliedCircuitRef.current) return;
      appliedCircuitRef.current = update.circuit;

      const next = update.circuit;
      setCircuit(next);
      setWarnings(update.warnings);

      // The booth's mode (when broadcast) overrides the local setting. The booth
      // only broadcasts composer/golf today (QN2 adds quantina); a local
      // quantina session falls through to the composer moment path below.
      const effectiveMode: Mode = update.boothMode ?? modeRef.current;
      if (effectiveMode === 'golf') {
        const step = golfStep(golfStateRef.current, next);
        golfStateRef.current = step.state;
        setGolfState(step.state);
        if (step.justHoledIn && step.scoreName) {
          saveBest(storage, step.state.best);
          setCelebration({
            kind: step.level.qubits >= 3 ? 'ghz' : 'bell',
            k: step.level.qubits,
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

  const onResult = useCallback((result: FrameResult, video: HTMLVideoElement) => {
    // Overlay every processed frame (cheap; keeps the debug view live). This +
    // corners + debug stats stay in App because they are tightly video-coupled;
    // the source seam sits at "circuit + warnings out" (LocalPipelineSource).
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

    // Hand the frame to the local source; it emits a neutral update (→
    // applyUpdate) only when the stable circuit changed. Ignored while a booth
    // viewer owns the subscription (the camera is stopped then anyway).
    localSourceRef.current.ingest(result);
  }, []);

  // Manual mode: the editor's native on-screen editing is the source of truth.
  // Each `onCircuitChange` pushes into the manual source, which emits through the
  // SAME applyUpdate as the camera/booth paths (simulation, moments, golf,
  // celebrations and the Composer handoff all work identically). The source
  // dedupes structurally, so the controlled value flowing back into the editor
  // never re-emits (no feedback loop).
  const onEditorChange = useCallback((next: Circuit) => {
    manualSourceRef.current.setFromEditor(next);
  }, []);

  // A chosen camera that no longer resolves: useCamera has already fallen back
  // to the default device — clear the stale id and give a gentle heads-up.
  const onCameraFallback = useCallback(() => {
    settingsStore.update({ cameraId: null });
    pushStrip('Selected camera unavailable — using default');
  }, [pushStrip]);

  // CAMERA role sink: hand each zoomed camera frame to the streaming controller
  // (which paces + JPEG-encodes + pushes it to the host). Reads the controller
  // through a ref so its identity is stable; `undefined` while not in the role
  // keeps useCamera on the normal detection path.
  const onFrame = useCallback((canvas: HTMLCanvasElement) => {
    cameraRoleSourceRef.current?.offerFrame(canvas);
  }, []);

  const camera = useCamera({
    onResult,
    lowPower: settings.lowpower,
    paused: frozen,
    cameraId: settings.cameraId,
    onCameraFallback,
    onFrame: cameraRole ? onFrame : undefined,
    // Only the camera role streams, so only it can lock to a mat ROI.
    matCrop: cameraRole ? matLock : null,
  });
  fpsRef.current = camera.fps;

  // Clear the transient mat-ROI overlay + its pending timer.
  const clearMatOverlay = useCallback(() => {
    if (matOverlayTimerRef.current !== null) {
      window.clearTimeout(matOverlayTimerRef.current);
      matOverlayTimerRef.current = null;
    }
    clearCanvas(overlayRef.current);
  }, []);

  // "Frame the mat": one-shot detect on the current (zoomed) frame, then lock the
  // stream to the mat ROI. On success flash the ROI for ~1.5 s; on failure toast
  // and stay unlocked. Re-running re-detects (table nudged).
  const handleFrameMat = useCallback(() => {
    const video = camera.videoRef.current;
    if (!video || video.readyState < 2) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!(w > 0 && h > 0)) return;
    // Detect within whatever the sink currently streams: the digital-zoom crop
    // (native zoom already baked into the sensor pixels, so its crop is full).
    const digitalZoom = camera.zoomMode === 'digital' ? camera.zoom : 1;
    const crop = cropRect(digitalZoom, w, h);
    const result = detectMatRoi(video, crop);
    if (!result.ok) {
      pushStrip("Can't find the mat — all four corners in view?");
      return;
    }
    setMatLock(result.roi);
    if (overlayRef.current) drawMatOverlay(overlayRef.current, result.roi, crop, w, h);
    if (matOverlayTimerRef.current !== null) window.clearTimeout(matOverlayTimerRef.current);
    matOverlayTimerRef.current = window.setTimeout(() => {
      matOverlayTimerRef.current = null;
      clearCanvas(overlayRef.current);
    }, 1500);
  }, [camera.videoRef, camera.zoom, camera.zoomMode, pushStrip]);

  const handleUnlockMat = useCallback(() => {
    setMatLock(null);
    clearMatOverlay();
  }, [clearMatOverlay]);

  // Drop any mat lock (and its overlay) whenever streaming isn't live — leaving
  // the camera role or stopping the camera; a re-aim would invalidate it anyway.
  useEffect(() => {
    if (!cameraRole || camera.status !== 'running') {
      setMatLock(null);
      clearMatOverlay();
    }
  }, [cameraRole, camera.status, clearMatOverlay]);

  // Camera controls read through refs so the source/camera-switch effects can
  // key on `boothUrl`/`connected` alone (camera.start's identity changes with
  // zoom; re-running the switch effect then would clobber the resume flag).
  const cameraStatusRef = useRef(camera.status);
  cameraStatusRef.current = camera.status;
  const cameraStartRef = useRef(camera.start);
  cameraStartRef.current = camera.start;
  const cameraStopRef = useRef(camera.stop);
  cameraStopRef.current = camera.stop;

  // Subscribe to the ACTIVE source. PRECEDENCE (docs/design.md): a connected
  // booth viewer wins over `?input=manual`; otherwise manual mode uses the
  // ManualEditSource, else the local camera pipeline. Switching (connect /
  // disconnect / input toggle) tears the previous subscription down cleanly.
  useEffect(() => {
    if (boothUrl !== null) {
      // Booth viewer (read-only). A fresh source resets the applied-circuit guard.
      setConn('connecting');
      appliedCircuitRef.current = null;
      const source = new BoothSocketSource({ url: boothUrl });
      const unsub = source.subscribe(applyUpdate);
      source.start();
      return () => {
        unsub();
        source.stop();
      };
    }
    // Standalone: clear any booth metadata, listen to manual or the local pipeline.
    setConn(null);
    setBoothMode(null);
    setBoothWires(null);
    setBoothPanels(null);
    setBoothNoise(null);
    setBoothMenu(null);
    setBoothServed(null);
    appliedCircuitRef.current = null;
    const source: StateSource = manual ? manualSourceRef.current : localSourceRef.current;
    const unsub = source.subscribe(applyUpdate);
    source.start();
    return () => {
      unsub();
      source.stop();
    };
  }, [boothUrl, manual, applyUpdate]);

  // Camera hand-off when the active source switches (design: hide the camera
  // while viewing the booth OR building on screen; resume the local pipeline
  // when we return to camera input if it was running before we left). The same
  // machinery serves both the booth viewer and manual mode via `cameraHidden`.
  useEffect(() => {
    const cameraActive =
      cameraStatusRef.current === 'running' || cameraStatusRef.current === 'starting';
    const action = cameraSwitchAction(cameraHidden, cameraActive, resumeCameraRef.current);
    if (action.stop) cameraStopRef.current();
    if (action.start) void cameraStartRef.current();
    resumeCameraRef.current = action.remember;
  }, [cameraHidden]);

  // Probe our own origin for a booth host (served-by-host trigger). Cheap;
  // failures (e.g. entangible.org standalone) are ignored.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/info')
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (!cancelled && info && typeof info === 'object') setServedByHost(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Visitor-QR auto-connect: `?connect=1` connects to the serving host's
  // `/ws/state` (same origin) as a read-only viewer — UNLESS the staff QR also
  // asked for the camera role (`?connect=1&role=camera`), which is handled below.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const search = window.location.search;
    if (connectRequested(search) && roleRequested(search) === null) {
      boothLink.connect(defaultStateUrl());
    }
  }, []);

  // Staff-QR camera-role auto-entry: `?connect=1&role=camera&key=<token>` opens
  // the pocket app already streaming as the booth's camera. Requires the
  // operator key (else the host would reject the frames socket); the serving
  // origin IS the host, so we enter with the same-origin target (stateUrl null).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (roleRequested(window.location.search) === 'camera' && operatorKeyPresent) {
      cameraRoleLink.enter(null);
    }
  }, [operatorKeyPresent]);

  // CAMERA role lifecycle: while active, open the streaming controller (frames
  // socket + operator `select_camera {kind:'push'}` on /ws/state) and poll its
  // fps for the status pill. Cleanup on exit tears both sockets down; the still-
  // running camera then falls back to the local pipeline (onFrame → undefined).
  useEffect(() => {
    if (!cameraRole) {
      setStreamStatus(null);
      return;
    }
    const stateUrl = cameraRoleState.stateUrl ?? defaultStateUrl();
    const framesBase = cameraRoleState.stateUrl
      ? framesUrlFromStateUrl(cameraRoleState.stateUrl)
      : framesSocketUrl();
    const source = new CameraRoleSource({
      framesUrl: withKey(framesBase),
      stateUrl,
      operatorKey: () => getOperatorKey(),
    });
    cameraRoleSourceRef.current = source;
    const unsub = source.subscribe(setStreamStatus);
    source.start();
    setStreamStatus(source.getStatus());
    const poll = window.setInterval(() => setStreamStatus(source.getStatus()), 500);
    return () => {
      window.clearInterval(poll);
      unsub();
      source.stop();
      cameraRoleSourceRef.current = null;
    };
  }, [cameraRole, cameraRoleState.stateUrl]);

  // Entering the camera role auto-starts the camera (staff scan a QR and expect
  // it streaming); leaving it keeps the camera running so the local pipeline
  // resumes (design: "returning to standalone mode, local pipeline resumes").
  useEffect(() => {
    if (!cameraRole) return;
    if (cameraStatusRef.current === 'idle' || cameraStatusRef.current === 'error') {
      void cameraStartRef.current();
    }
  }, [cameraRole]);

  const toggleFreeze = useCallback(() => setFrozen((f) => toggleFrozen(f)), []);

  // Freeze is only meaningful while the camera runs; drop it whenever the camera
  // is not running so it always starts unfrozen on the next start.
  useEffect(() => {
    if (camera.status !== 'running') setFrozen(false);
  }, [camera.status]);

  // Keyboard: 'f' toggles freeze (ignore when typing or with modifiers).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (camera.status !== 'running') return;
      e.preventDefault();
      toggleFreeze();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFreeze, camera.status]);

  // Latch "the camera has run once" — gates the iPhone install hint so it never
  // clutters the very first impression.
  const [cameraEverStarted, setCameraEverStarted] = useState(false);
  useEffect(() => {
    if (camera.status === 'starting' || camera.status === 'running') setCameraEverStarted(true);
  }, [camera.status]);

  useEffect(() => {
    const id = window.setInterval(
      () => setHintIndex((i) => (i + 1) % HINTS.length),
      HINT_ROTATE_MS,
    );
    return () => window.clearInterval(id);
  }, []);

  const qamposerConfig = useMemo(() => ({ maxQubits: BOARD_QUBITS }), []);

  // While connected the booth's broadcast mode/wires/noise override the local
  // settings; standalone they fall back to the settings store.
  const effectiveMode: Mode = boothMode ?? settings.mode;
  const effectiveWires: Wires = boothWires ?? settings.wires;
  const effectiveNoise: NoisePreset = boothNoise ?? settings.noise;
  // Panels follow the same overlay rule: the booth's set wins while connected,
  // the local settings stand otherwise (see `boothOrLocalPanels`).
  const effectivePanels = boothOrLocalPanels(boothPanels, settings.panels);

  // Display-only wire count: the recognized `circuit` is always 5 qubits, but
  // the editor draws `effectiveWires` wires (compact auto-grows 3→5). Panels,
  // simulation, histogram and QASM all keep the physical 5-qubit `circuit`.
  const displayed = useMemo(() => displayCircuit(circuit, effectiveWires), [circuit, effectiveWires]);

  // Auto-fit the editor so every displayed wire is visible on short phone
  // stages; a no-op (scale 1) on roomy iPad/desktop stages.
  const { containerRef: editorContainerRef, fit: editorFitState } = useEditorFit(displayed.qubits);
  const scaling = editorFitState.scale < 1;
  const editorScaleStyle: React.CSSProperties | undefined = scaling
    ? {
        flex: 'none',
        height: `${editorFitState.natural}px`,
        width: `${100 / editorFitState.scale}%`,
        transform: `scale(${editorFitState.scale})`,
        transformOrigin: 'top left',
        // Reclaim the layout space the shrunk editor no longer occupies (top-left
        // origin leaves scaled-away space to its right and below) so the column
        // doesn't gain phantom horizontal/vertical scroll.
        marginBottom: `${-(editorFitState.natural * (1 - editorFitState.scale))}px`,
        marginRight: `${-(100 / editorFitState.scale - 100)}%`,
      }
    : undefined;

  const running = camera.status === 'running';
  const boardLocked = corners >= 3;
  const camPill = running
    ? boardLocked
      ? { cls: 'is-live', label: `board locked · ${camera.fps} fps` }
      : { cls: 'is-searching', label: 'searching…' }
    : { cls: 'is-off', label: 'camera off' };

  const isGolf = effectiveMode === 'golf';
  const isQuantina = effectiveMode === 'quantina';
  // Quantina pack resolution (settings menu id + optional `?menupack=` fetch).
  // Called unconditionally (hook rules); App needs the pack for the histogram's
  // qubit count and the mode pill even before the quantina sidebar mounts. When
  // connected the booth's active pack (`boothMenu`) overrides the local setting
  // (`boothMenu ?? settings.menu`, resolved inside the QN1 hook).
  const quantina = useQuantinaPack(boothMenu);
  // Booth-synced serve (viewer): show the host's `served` result, keyed on its
  // seq so the reveal re-animates; a connected viewer can't serve locally.
  const quantinaExternal =
    connected && boothServed
      ? {
          packId: boothServed.packId,
          outcomes: boothServed.outcomes,
          shotSource: boothServed.shotSource,
        }
      : null;
  const hasPanel = (p: PanelId) => effectivePanels.includes(p);
  // Viewer policy (design: read-only Display role): while connected to a booth
  // — or building on screen in manual mode — the camera UI is hidden entirely.
  const showCamera = showCameraUi(cameraHidden, hasPanel('camera'), camera.status !== 'idle');
  const boothPill = connectionPill(conn ?? 'connecting');
  // Camera-role offer gating (design: "connected to a host, camera role
  // selected"): only when a host is known AND an operator key is present.
  const hostKnown = servedByHost || settings.boothUrl != null;
  const cameraRoleAvailable = cameraRoleOffered({ hostKnown, hasKey: operatorKeyPresent });
  const streamPill = cameraStreamPill(streamStatus);
  const currentLevel = LEVELS[golfState.levelIndex];
  const golfTargets = useMemo(
    () => new Set<number>([0, (1 << currentLevel.qubits) - 1]),
    [currentLevel.qubits],
  );

  // In-browser noise model (composer only — golf stays ideal). Memoized on
  // (circuit, preset, mode): the density-matrix sim is ~ms but must not re-run
  // every render. `undefined` when off → the ideal-only chart is unchanged.
  const noisyProbs = useMemo(
    () => noiseSeries(circuit, effectiveNoise, isGolf),
    [circuit, effectiveNoise, isGolf],
  );

  // iPhone camera expand (#47): freeze the stage at its pre-expansion height so
  // the growing camera pushes content below the fold (pk-main scrolls) instead
  // of shrinking the circuit. Measured in the click handler, before re-layout.
  const stageRef = useRef<HTMLElement | null>(null);
  const [camExpanded, setCamExpanded] = useState(false);
  const [stageMinH, setStageMinH] = useState<number | undefined>(undefined);
  const toggleCamExpanded = () => {
    setStageMinH(camExpanded ? undefined : stageRef.current?.getBoundingClientRect().height);
    setCamExpanded(!camExpanded);
  };

  const cameraPanel = (
    <CameraPanel
      key="camera"
      camera={camera}
      overlayRef={overlayRef}
      boardLocked={boardLocked}
      visible={hasPanel('camera')}
      frozen={frozen}
      onToggleFreeze={toggleFreeze}
      onBuildOnScreen={() => settingsStore.update({ input: 'manual' })}
      expanded={camExpanded}
      onToggleExpand={toggleCamExpanded}
    />
  );

  const composerPanels = effectivePanels
    .filter((p) => p !== 'camera')
    .map((p) => {
      switch (p) {
        case 'results':
          return (
            <ResultsHistogram
              key="results"
              circuit={circuit}
              displayQubits={displayed.qubits}
              noisy={noisyProbs}
            />
          );
        case 'state':
          return <StatePanel key="state" circuit={circuit} classPrefix="pk" />;
        case 'qasm':
          return <QasmPanel key="qasm" circuit={circuit} />;
        default:
          return null;
      }
    });

  const sidebar = isGolf ? (
    <>
      {showCamera && cameraPanel}
      <div key="golfview">
        <div className="pk-label">{currentLevel.view === 'bloch' ? 'Bloch sphere' : 'Q-sphere'}</div>
        <div className="pk-well">
          {currentLevel.view === 'bloch' ? (
            <BlochView circuit={circuit} classPrefix="pk" />
          ) : (
            <QSphereView circuit={circuit} targets={golfTargets} classPrefix="pk" />
          )}
        </div>
      </div>
      <Scorecard
        key="scorecard"
        state={golfState}
        circuit={circuit}
        // Build-on-screen has no physical board to clear, so the scorecard gets
        // an explicit Next-level button; it empties the manual board, which IS
        // the golf advance trigger (camera mode keeps the physical ritual).
        onNextLevel={manual ? () => manualSourceRef.current.clear() : undefined}
      />
      {hasPanel('results') && (
        <ResultsHistogram key="results" circuit={circuit} displayQubits={displayed.qubits} />
      )}
      {hasPanel('state') && <StatePanel key="state" circuit={circuit} classPrefix="pk" />}
      {hasPanel('qasm') && <QasmPanel key="qasm" circuit={circuit} />}
      <ComposerHandoff key="transfer" circuit={circuit} onToast={pushStrip} />
      {settings.debug && <DebugPanel key="debug" frame={lastFrameRef.current} fps={camera.fps} />}
    </>
  ) : isQuantina ? (
    // Quantina: the live menu + serve surface. Quantina is NOT golf — the noise
    // preset stays active (noisyProbs feeds both the menu and the histogram), and
    // the histogram is sized to the pack's qubit count.
    <>
      {showCamera && cameraPanel}
      <QuantinaPanel
        key="quantina"
        pack={quantina.pack}
        error={quantina.error}
        circuit={circuit}
        noisyProbs={noisyProbs}
        externalResult={quantinaExternal}
        externalSeq={boothServed?.seq ?? 0}
        canServe={!connected}
      />
      {hasPanel('results') && (
        <ResultsHistogram
          key="results"
          circuit={circuit}
          displayQubits={quantina.pack.qubits}
          noisy={noisyProbs}
        />
      )}
      <ComposerHandoff key="transfer" circuit={circuit} onToast={pushStrip} />
      {settings.debug && <DebugPanel key="debug" frame={lastFrameRef.current} fps={camera.fps} />}
    </>
  ) : (
    <>
      {showCamera && cameraPanel}
      {composerPanels}
      <ComposerHandoff key="transfer" circuit={circuit} onToast={pushStrip} />
      {settings.debug && <DebugPanel key="debug" frame={lastFrameRef.current} fps={camera.fps} />}
    </>
  );

  // CAMERA role: a focused streaming screen (design: "streams JPEG frames to the
  // host with pocket's camera UI"). The circuit stage is the host's job now, so
  // the phone shows only its camera preview (zoom + freeze) + streaming status.
  if (cameraRole) {
    return (
      <div className="pk pk--camera-role">
        <header className="pk-topbar">
          <div className="pk-brand">
            <span className="en">En</span>
            <span className="pk-brand-rest">tangible</span>
            <small>camera</small>
          </div>
          <span className="pk-spacer" />
          <span className={`pk-pill ${streamPill.cls}`} aria-label={streamPill.label} title={streamPill.label}>
            <span className="pk-dot" aria-hidden="true" />
            <span className="pk-pill-label">{streamPill.label}</span>
          </span>
          <a className="pk-help" href="#guide" aria-label="Guide and about" title="Guide & about">
            ?
          </a>
          <FullscreenButton variant="bar" />
          <SettingsControl cameraRoleAvailable={cameraRoleAvailable} />
          <button className="pk-btn is-stop" onClick={() => cameraRoleLink.exit()}>
            Stop
          </button>
        </header>
        <main className="pk-main pk-camera-role-main">
          <section className="pk-stage">
            <CameraPanel
              camera={camera}
              overlayRef={overlayRef}
              boardLocked={boardLocked}
              visible
              frozen={frozen}
              onToggleFreeze={toggleFreeze}
              stream={streamStatus}
              onFrameMat={handleFrameMat}
              matLocked={matLock !== null}
              onUnlockMat={handleUnlockMat}
            />
          </section>
        </main>
        {route === 'guide' && <GuidePage />}
      </div>
    );
  }

  return (
    <div className="pk">
      <header className="pk-topbar">
        <div className="pk-brand">
          <span className="en">En</span>
          <span className="pk-brand-rest">tangible</span>
          <small>pocket</small>
        </div>
        {isGolf && <span className="pk-pill pk-pill--mode">Quantum Golf</span>}
        {isQuantina && (
          <span className="pk-pill pk-pill--mode">
            {quantina.loading ? 'Quantina' : quantina.pack.title}
          </span>
        )}
        <span className="pk-spacer" />
        {connected ? (
          // Viewer: booth status pill (never a camera pill — no local pipeline).
          <span
            className={`pk-pill ${boothPill.cls}`}
            aria-label={boothPill.label}
            title={boothPill.label}
          >
            <span className="pk-dot" aria-hidden="true" />
            <span className="pk-pill-label">{boothPill.label}</span>
          </span>
        ) : manual ? (
          // Manual build: no camera — the pill states the mode (switch back via
          // the "Use camera" action button).
          <span className="pk-pill pk-pill--mode" aria-label="Manual build" title="Manual build">
            <span className="pk-pill-label">Manual build</span>
          </span>
        ) : (
          <span className={`pk-pill ${camPill.cls}`} aria-label={camPill.label} title={camPill.label}>
            <span className="pk-dot" aria-hidden="true" />
            <span className="pk-pill-label">{camPill.label}</span>
          </span>
        )}
        <a className="pk-help" href="#guide" aria-label="Guide and about" title="Guide & about">
          ?
        </a>
        <FullscreenButton variant="bar" />
        <SettingsControl cameraRoleAvailable={cameraRoleAvailable} />
        {/* Connected → a Disconnect button (returns to the local pipeline). The
            served-by-host probe offers a one-tap Connect. Standalone → the
            Start ↔ Stop camera toggle. */}
        {connected ? (
          <button className="pk-btn is-stop" onClick={() => boothLink.disconnect()}>
            Disconnect
          </button>
        ) : manual ? (
          // Switch-back-to-camera action (returns to the local pipeline).
          <button className="pk-btn" onClick={() => settingsStore.update({ input: 'camera' })}>
            Use camera
          </button>
        ) : servedByHost ? (
          <button className="pk-btn" onClick={() => boothLink.connect(defaultStateUrl())}>
            Connect to booth
          </button>
        ) : running ? (
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
        {/* CONTROLLED editor. In manual mode `onCircuitChange` is wired so native
            on-screen editing drives the ManualEditSource; in camera/booth mode it
            is omitted, so the recognized circuit is the source of truth and any
            stray drag reverts (the pipeline re-asserts). */}
        <QamposerProvider
          circuit={displayed}
          config={qamposerConfig}
          onCircuitChange={manual ? onEditorChange : undefined}
        >
          <main className={`pk-main ${settings.side === 'left' ? 'pk-side-left' : ''}`}>
            {/* Phone-only amber toast (footer hint ticker is hidden on phones);
                CSS reveals it only under the phone breakpoints. */}
            {warnings.length > 0 && (
              <div className="pk-toast" role="status">
                <span className="pk-warnicon" aria-hidden="true">
                  ⚠
                </span>
                <span>{warnings.map((w) => friendlyWarning(w)).join('  ·  ')}</span>
              </div>
            )}
            {/* `pk-stage--manual` scopes the phone-only editor min-height + no-shrink
                sizing so the on-screen gate palette can't collapse the editor; camera
                and booth stages keep the base `.pk-stage` sizing untouched. */}
            <section
              className={stageClassName(manual)}
              ref={stageRef}
              style={stageMinH !== undefined ? { minHeight: stageMinH } : undefined}
            >
              {/* Manual mode: the library's own gate palette — the visible
                  build-on-screen affordance (drag a gate onto a wire). */}
              {manual && (
                <div className="pk-manual-palette">
                  <Operations />
                </div>
              )}
              <div
                className={`pk-stage-editor ${editorFitState.scroll ? 'is-scroll' : ''}`}
                ref={editorContainerRef}
              >
                <div className="pk-editor-scale" style={editorScaleStyle}>
                  <CircuitEditor />
                </div>
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

      <InstallHint cameraStarted={cameraEverStarted} />

      <Celebrations
        celebration={celebration}
        maxParticles={settings.lowpower ? LOW_POWER_PARTICLES : undefined}
      />

      {/* Tap-to-inspect: always on (a phone is a touch device). Reads the live
          5-qubit circuit; its gates array is identical to the displayed one. */}
      <TouchInspector circuit={circuit} />

      {/* The Guide renders as an overlay over the still-mounted app, so an active
          camera stream keeps running while it is open (docs/pocket.md). */}
      {route === 'guide' && <GuidePage />}
    </div>
  );
}

/** iPhone fallback: Safari there has no element Fullscreen API (the ⛶ button
 *  feature-detects away), so the camera gets a plain CSS expand toggle that
 *  swaps the docked 22vh strip for the desktop 4/3 geometry. */
function CamExpandButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { supported } = useFullscreen();
  if (supported) return null;
  const label = expanded ? 'Shrink camera' : 'Expand camera';
  return (
    <button type="button" className="pk-fs pk-fs--cam" onClick={onToggle} aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        {expanded ? (
          <path
            fill="currentColor"
            d="M9 9V4H7v3H4v2h5Zm6 0h5V7h-3V4h-2v5ZM9 15H4v2h3v3h2v-5Zm6 0v5h2v-3h3v-2h-5Z"
          />
        ) : (
          <path
            fill="currentColor"
            d="M4 9V4h5v2H6v3H4Zm11-5h5v5h-2V6h-3V4ZM6 15v3h3v2H4v-5h2Zm12 0h2v5h-5v-2h3v-3Z"
          />
        )}
      </svg>
    </button>
  );
}

function CameraPanel({
  camera,
  overlayRef,
  boardLocked,
  visible,
  frozen,
  onToggleFreeze,
  stream = null,
  onFrameMat,
  matLocked = false,
  onUnlockMat,
  onBuildOnScreen,
  expanded,
  onToggleExpand,
}: {
  camera: ReturnType<typeof useCamera>;
  overlayRef: React.RefObject<HTMLCanvasElement>;
  boardLocked: boolean;
  visible: boolean;
  frozen: boolean;
  onToggleFreeze: () => void;
  /**
   * Standalone camera-idle screen: a secondary "No camera? Build on screen"
   * action — the natural discovery point for manual mode. Omitted in the camera
   * role (streaming), where building on screen makes no sense.
   */
  onBuildOnScreen?: () => void;
  /**
   * iPhone expand toggle, App-controlled in the main layout so the stage can
   * freeze its pre-expansion height (the camera then pushes content below the
   * fold instead of shrinking the circuit). Omitted → panel-local state.
   */
  expanded?: boolean;
  onToggleExpand?: () => void;
  /**
   * CAMERA role: when set, the panel is streaming to a host — the fps chip
   * reflects the stream (not the local pipeline) and the hint reads "Streaming
   * to booth" instead of the board-lock prompt. `null` → normal detection panel.
   */
  stream?: FrameStreamerStatus | null;
  /**
   * CAMERA role, "Frame the mat" (task #34): when provided, a control appears to
   * one-shot detect the mat and lock the stream to it. `matLocked` swaps in the
   * "Mat only" badge + hides the zoom pill; `onUnlockMat` clears the lock.
   */
  onFrameMat?: () => void;
  matLocked?: boolean;
  onUnlockMat?: () => void;
}) {
  const { status, error, fps, videoRef, zoom, zoomRange, previewScale, setZoom, stepZoom, resetZoom } =
    camera;
  const streaming = stream != null;
  const canFrameMat = onFrameMat != null;

  // Pinch-to-zoom (two pointers) + double-tap-to-reset on the preview.
  const pointersRef = useRef<Map<number, PinchPoint>>(new Map());
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);
  const lastTapRef = useRef(0);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Expanded state is App-owned in the main layout (so the stage can freeze its
  // height); the camera-role instance passes no props and keeps local state.
  const [ownExpanded, setOwnExpanded] = useState(false);
  const camExpanded = expanded ?? ownExpanded;
  const toggleExpand = onToggleExpand ?? (() => setOwnExpanded((v) => !v));

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
          className={`pk-cam ${frozen ? 'is-frozen' : ''} ${camExpanded ? 'is-expanded' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ touchAction: 'none' }}
        >
          <video ref={videoRef} playsInline muted style={{ transform: `scale(${previewScale})` }} />
          <canvas ref={overlayRef} className="pk-overlay" />
          <FullscreenButton variant="cam" />
          <CamExpandButton expanded={camExpanded} onToggle={toggleExpand} />
          <span className="pk-cam-fps">{streaming ? Math.round(stream!.fps) : fps} fps</span>
          <FreezePill frozen={frozen} onToggle={onToggleFreeze} />
          {canFrameMat && matLocked && <MatBadge onUnlock={onUnlockMat} />}
          {/* Re-framing needs a live frame, so hide it while frozen (pump paused). */}
          {canFrameMat && !frozen && <MatButton locked={matLocked} onFrame={onFrameMat!} />}
          {/* Locked → the mat crop replaces the digital zoom, so the pill hides. */}
          {!matLocked && (
            <ZoomPill
              zoom={zoom}
              min={zoomRange.min}
              max={zoomRange.max}
              onIn={() => stepZoom(1)}
              onOut={() => stepZoom(-1)}
            />
          )}
          {frozen ? (
            <div className="pk-frozen-msg" role="status">
              <span aria-hidden="true">❄</span> Frozen — {streaming ? 'stream paused' : 'circuit locked'}
            </div>
          ) : streaming ? (
            <div className="pk-cam-hint">
              {stream!.connection === 'open'
                ? 'Streaming to the booth — this phone is the camera'
                : 'Connecting to the booth…'}
            </div>
          ) : (
            !boardLocked && (
              <div className="pk-cam-hint">Point at the board — all four corners in view</div>
            )
          )}
        </div>
      ) : (
        <div className="pk-cam is-idle">
          {/* Keep the video element mounted so the ref is stable across starts. */}
          <video ref={videoRef} playsInline muted style={{ display: 'none' }} />
          <div className={`pk-startcard ${status === 'error' ? 'is-error' : ''}`}>
            <h2>
              {status === 'error'
                ? 'Camera unavailable'
                : streaming
                  ? 'Starting the booth camera…'
                  : 'Point your iPad at the board'}
            </h2>
            <p>
              {status === 'error'
                ? error
                : streaming
                  ? 'This phone is streaming its camera to the booth. Point it at the board from above; the booth screen shows the recognized circuit.'
                  : 'Start the camera, then frame the printed mat so all four corner markers are visible. Place tiles and watch the circuit build itself.'}
            </p>
            {!streaming && (
              <a className="pk-startcard-link" href="#guide">
                New here? Read the guide
              </a>
            )}
            {!streaming && onBuildOnScreen && status !== 'error' && (
              <button type="button" className="pk-startcard-alt" onClick={onBuildOnScreen}>
                No camera? Build on screen
              </button>
            )}
            {/* Permission denied / no camera: still offer the on-screen fallback. */}
            {!streaming && onBuildOnScreen && status === 'error' && (
              <button type="button" className="pk-startcard-alt" onClick={onBuildOnScreen}>
                Build on screen instead
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Freeze toggle — a ≥44px pill on the camera strip (bottom-left). */
function FreezePill({ frozen, onToggle }: { frozen: boolean; onToggle: () => void }) {
  // Swallow pointer events so the pinch handler on the preview never sees them.
  const swallow = (e: React.PointerEvent) => e.stopPropagation();
  const label = frozen ? 'Unfreeze camera' : 'Freeze camera';
  return (
    <button
      type="button"
      className={`pk-freeze ${frozen ? 'is-frozen' : ''}`}
      aria-label={label}
      aria-pressed={frozen}
      title={label}
      onClick={onToggle}
      onPointerDown={swallow}
      onPointerUp={swallow}
    >
      <span className="pk-freeze__glyph" aria-hidden="true">
        ❄
      </span>
      <span className="pk-freeze__label">{frozen ? 'Frozen' : 'Freeze'}</span>
    </button>
  );
}

/** "Frame the mat" trigger — top-centre pill; re-tapping while locked re-detects. */
function MatButton({ locked, onFrame }: { locked: boolean; onFrame: () => void }) {
  const swallow = (e: React.PointerEvent) => e.stopPropagation();
  const label = locked ? 'Re-frame the mat' : 'Frame the mat';
  return (
    <button
      type="button"
      className={`pk-mat-btn ${locked ? 'is-locked' : ''}`}
      aria-label={label}
      title={label}
      onClick={onFrame}
      onPointerDown={swallow}
      onPointerUp={swallow}
    >
      <span className="pk-mat-btn__glyph" aria-hidden="true">
        ▣
      </span>
      <span className="pk-mat-btn__label">{label}</span>
    </button>
  );
}

/** "Mat only" badge (top-left) shown while locked; its ✕ returns the full frame. */
function MatBadge({ onUnlock }: { onUnlock?: () => void }) {
  const swallow = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <div className="pk-mat-badge" role="status" onPointerDown={swallow} onPointerUp={swallow}>
      <span className="pk-mat-badge__glyph" aria-hidden="true">
        ▣
      </span>
      <span>Mat only</span>
      <button
        type="button"
        className="pk-mat-badge__x"
        aria-label="Unlock — stream the full frame"
        title="Unlock — stream the full frame"
        onClick={onUnlock}
      >
        ✕
      </button>
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
