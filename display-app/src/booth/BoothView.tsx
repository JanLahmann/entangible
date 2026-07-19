/**
 * BoothView — the big-screen kiosk view, v2 exhibit design (variant A).
 *
 * Spec: docs/booth-ux.md. Layered surfaces; topbar with status pills and the
 * event-branding slot; the circuit full-bleed as the stage with celebrations,
 * message strip and attract mode as overlays; a sidebar of stacked panels
 * (RESULTS bit-stack histogram / STATE / OPENQASM) driven by the layout
 * message when present; a footer hint ticker that warnings replace.
 *
 * The physical table is the source of truth: the editor is CONTROLLED (no
 * `onCircuitChange`), so on-screen drags cannot persist. The moment engine
 * fires on LIVE circuit changes only (deduped snapshot + message identity
 * guard, so StrictMode can never double-fire a celebration).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ThemeProvider,
  QamposerProvider,
  CircuitEditor,
  createDefaultCircuit,
  type Circuit,
} from '@qamposer/react';
import { useEntangibleState } from '../ws/useEntangibleState';
import { friendlyWarning } from '@shared/display/warnings';
import type { ConnectionState } from '../ws/stateSocket';
import type { CircuitMessage } from '../ws/messages';
import {
  evaluateMoment,
  initialMomentState,
  type MomentState,
} from '@quantum/moments';
import { shouldAttract } from './attract';
import { Histogram } from './Histogram';
import { MessageStrip, type StripMessage } from './MessageStrip';
import { Celebrations, type CelebrationRequest } from './Celebrations';
import { AttractMode } from './AttractMode';
import { VisitorQr } from './VisitorQr';
import { NoisyRun } from './NoisyRun';
import { TouchInspector } from './TouchInspector';
import { Scorecard } from './Scorecard';
import { isTouchEnabled } from './touch';
import { displayCircuit } from '@shared/display/displayWires';
import type { Wires } from '../ws/messages';
import { HINTS, HINT_ROTATE_MS } from '@shared/display/hints';
import { QSphereView } from '@quantum/QSphereView';
import { BlochView } from '@quantum/BlochView';
import { golfStep, initialGolfState, LEVELS, type GolfState } from '@quantum/golf';
import { QasmPanel as SharedQasmPanel } from '@shared/display/QasmPanel';
import { StatePanel } from '@shared/display/StatePanel';
import './booth-v2.css';

const BOARD_QUBITS = 5;
const DEFAULT_PANELS = ['results', 'state', 'qasm'];

interface Branding {
  name?: string | null;
  logoUrl?: string | null;
}

function connectionInfo(state: ConnectionState): { label: string; cls: string } {
  switch (state) {
    case 'open':
      return { label: 'live', cls: '' };
    case 'connecting':
    case 'reconnecting':
      return { label: 'reconnecting', cls: 'is-pending' };
    default:
      return { label: 'offline', cls: 'is-down' };
  }
}

/**
 * OPENQASM panel — booth binding of the shared QasmPanel. The QASM arrives
 * pre-rendered from the host; show its last 7 non-empty lines, and hide the
 * panel entirely when there is nothing to show.
 */
function QasmPanel({ qasm }: { qasm: string | undefined }) {
  const lines = useMemo(() => {
    const all = (qasm ?? '').split('\n').filter((l) => l.trim().length > 0);
    return all.slice(-7);
  }, [qasm]);
  return <SharedQasmPanel lines={lines} classPrefix="bo" hideWhenEmpty />;
}

export function BoothView() {
  const snapshot = useEntangibleState();
  const { circuit, detection, status, connectionState } = snapshot;
  // Layout arrives via an additive message; tolerate its absence.
  const layout = (
    snapshot as { layout?: { panels?: string[]; mode?: string; wires?: Wires } }
  ).layout;
  const panels = layout?.panels ?? DEFAULT_PANELS;
  const mode = layout?.mode ?? 'composer';
  const wires: Wires = layout?.wires ?? 'compact';

  const liveCircuit: Circuit = circuit?.circuit ?? createDefaultCircuit(BOARD_QUBITS);
  // Display-only wire trim: the editor + histogram follow `wires`; every other
  // consumer (moments, QASM, state) keeps the full five-qubit truth.
  const displayedCircuit = displayCircuit(liveCircuit, wires);
  const displayedQubits = displayedCircuit.qubits;
  const warnings = detection?.warnings ?? [];
  const markersPresent = (detection?.markers?.length ?? 0) > 0;
  const conn = connectionInfo(connectionState);

  // --- event branding (config-gated; absent endpoint → hidden) -------------
  const [branding, setBranding] = useState<Branding | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/branding')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!cancelled && b && (b.name || b.logoUrl)) setBranding(b);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // --- moment engine (live circuit changes only) ---------------------------
  const momentStateRef = useRef<MomentState>(initialMomentState);
  const prevCircuitRef = useRef<Circuit>(createDefaultCircuit(BOARD_QUBITS));
  const processedMsgRef = useRef<CircuitMessage | null>(null);
  const tokenRef = useRef(0);
  const [strip, setStrip] = useState<StripMessage | null>(null);
  const [celebration, setCelebration] = useState<CelebrationRequest | null>(null);

  // --- golf engine (booth mode === 'golf'; best-of-session in memory) ------
  const [golfState, setGolfState] = useState<GolfState>(() => initialGolfState());
  const golfStateRef = useRef<GolfState>(golfState);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // --- touch-to-inspect (optional: ?touch=1 or a coarse pointer) -----------
  const [touch] = useState(() =>
    isTouchEnabled(
      typeof window !== 'undefined' ? window.location.search : '',
      typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches,
    ),
  );

  // --- attract mode bookkeeping --------------------------------------------
  const lastActivityRef = useRef<number>(Date.now());
  const boardEmptyRef = useRef(true);
  const markersRef = useRef(false);
  const [attract, setAttract] = useState(false);

  boardEmptyRef.current = liveCircuit.gates.length === 0;
  markersRef.current = markersPresent;

  function pushStrip(text: string) {
    setStrip({ text, token: ++tokenRef.current });
  }

  useEffect(() => {
    if (!circuit) return;
    if (processedMsgRef.current === circuit) return;
    processedMsgRef.current = circuit;

    const next = circuit.circuit;

    if (modeRef.current === 'golf') {
      // Golf drives its own celebrations (hole-in banner); the composer moment
      // engine is skipped entirely (as in the pocket app).
      const step = golfStep(golfStateRef.current, next);
      golfStateRef.current = step.state;
      setGolfState(step.state);
      if (step.justHoledIn && step.scoreName) {
        setCelebration({
          kind: step.level.qubits >= 3 ? 'ghz' : 'bell',
          k: step.level.qubits,
          banner: `${step.scoreName}!`,
          token: ++tokenRef.current,
        });
      }
      prevCircuitRef.current = next;
      lastActivityRef.current = Date.now();
      setAttract(false);
      return;
    }

    const result = evaluateMoment(
      prevCircuitRef.current,
      next,
      momentStateRef.current,
      Date.now(),
    );
    momentStateRef.current = result.state;
    prevCircuitRef.current = next;

    if (result.stripMessage) pushStrip(result.stripMessage);
    if (result.celebration) {
      setCelebration({ ...result.celebration, token: ++tokenRef.current });
    }

    lastActivityRef.current = Date.now();
    setAttract(false);
  }, [circuit]);

  useEffect(() => {
    if (markersPresent) {
      lastActivityRef.current = Date.now();
      setAttract(false);
    }
  }, [detection, markersPresent]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setAttract(
        shouldAttract({
          boardEmpty: boardEmptyRef.current,
          markersPresent: markersRef.current,
          msSinceActivity: Date.now() - lastActivityRef.current,
        }),
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const [hintIndex, setHintIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setHintIndex((i) => (i + 1) % HINTS.length), HINT_ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);

  const qamposerConfig = useMemo(() => ({ maxQubits: BOARD_QUBITS }), []);

  const panelFor = (name: string) => {
    switch (name) {
      case 'results':
        return (
          <div key="results">
            <Histogram circuit={liveCircuit} displayQubits={displayedQubits} />
            <NoisyRun circuit={liveCircuit} onMessage={pushStrip} />
          </div>
        );
      case 'state':
        return <StatePanel key="state" circuit={liveCircuit} classPrefix="bo" />;
      case 'qasm':
        return <QasmPanel key="qasm" qasm={circuit?.qasm} />;
      default:
        return null; // unknown panels (forward-compatible) and not-yet-built ones
    }
  };

  // --- golf sidebar (mode === 'golf') --------------------------------------
  // Host golf preset panels are ['scorecard', 'minicircuit', 'results']. The
  // view (Q-sphere / Bloch) + scorecard are rendered structurally (like pocket),
  // so they show regardless of the preset; the remaining recognised panels
  // (e.g. 'results') follow the list. 'scorecard'/'minicircuit'/'qsphere'/
  // 'bloch' names are absorbed here to avoid duplication.
  const currentLevel = LEVELS[golfState.levelIndex];
  const golfTargets = useMemo(
    () => new Set<number>([0, (1 << currentLevel.qubits) - 1]),
    [currentLevel.qubits],
  );
  const GOLF_STRUCTURAL = new Set(['scorecard', 'minicircuit', 'qsphere', 'bloch']);
  const golfSidebar = (
    <>
      <div key="golfview">
        <div className="bo-label">{currentLevel.view === 'bloch' ? 'Bloch sphere' : 'Q-sphere'}</div>
        <div className="bo-well">
          {currentLevel.view === 'bloch' ? (
            <BlochView circuit={liveCircuit} classPrefix="bo" />
          ) : (
            <QSphereView circuit={liveCircuit} targets={golfTargets} classPrefix="bo" />
          )}
        </div>
      </div>
      <Scorecard key="scorecard" state={golfState} circuit={liveCircuit} />
      {panels.filter((name) => !GOLF_STRUCTURAL.has(name)).map(panelFor)}
    </>
  );

  // A tap anywhere counts as activity and exits attract instantly (spec: touch
  // also breaks attract). Only wired when touch is enabled.
  const onRootPointerDown = touch
    ? () => {
        lastActivityRef.current = Date.now();
        setAttract(false);
      }
    : undefined;

  return (
    <div className="bo" onPointerDown={onRootPointerDown}>
      <header className="bo-topbar">
        <div className="bo-brand">
          <span className="en">En</span>tangible
        </div>
        <span className="bo-pill">{mode}</span>
        <span className="bo-spacer" />
        {status?.camera && (
          <span className="bo-pill is-camera">
            <span className="bo-dot" aria-hidden="true" />
            {status.camera.kind === 'push' ? 'iPhone camera' : status.camera.kind}
          </span>
        )}
        <span className={`bo-pill ${conn.cls}`}>
          <span className="bo-dot" aria-hidden="true" />
          {conn.label}
        </span>
        {(status?.clients ?? 0) > 1 && (
          <span className="bo-pill">{status?.clients} viewers</span>
        )}
        {branding && (
          <div className="bo-evbrand">
            <span className="bo-ev-eyebrow">presented at</span>
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt={branding.name ?? 'event logo'} />
            ) : (
              <span className="bo-ev-name">{branding.name}</span>
            )}
          </div>
        )}
      </header>

      <ThemeProvider defaultTheme="dark">
        <QamposerProvider circuit={displayedCircuit} config={qamposerConfig}>
          <main className="bo-main">
            <section className="bo-stage">
              <div className="bo-stage-editor">
                <CircuitEditor />
              </div>
              <MessageStrip message={strip} />
            </section>
            <aside className="bo-side">{mode === 'golf' ? golfSidebar : panels.map(panelFor)}</aside>
          </main>
        </QamposerProvider>
      </ThemeProvider>

      <footer className={`bo-footer ${warnings.length > 0 ? 'has-warnings' : ''}`}>
        {warnings.length > 0 ? (
          <>
            <span className="bo-warnicon" aria-hidden="true">⚠</span>
            <div role="status">{warnings.map((w) => friendlyWarning(w)).join('  ·  ')}</div>
          </>
        ) : (
          <div key={hintIndex}>{HINTS[hintIndex]}</div>
        )}
        {/* Visitor QR — subtle, footer-sized (take-it-home T2). */}
        <VisitorQr variant="footer" />
      </footer>

      <Celebrations celebration={celebration} />
      {attract && <AttractMode branding={branding} />}
      <TouchInspector circuit={liveCircuit} enabled={touch} />
    </div>
  );
}

export default BoothView;
