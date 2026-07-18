/**
 * BoothView — the big-screen kiosk view (M3 "booth experience").
 *
 * Layout follows docs/booth-ux.md: a header (wordmark + connection dot), a
 * 62/38 split of circuit | histogram, a message strip beneath the histogram,
 * and a hint-ticker footer that warnings temporarily replace. Over the top sit
 * three overlays: celebrations (confetti + banner), attract mode (idle loop),
 * and the optional staff-only noisy-Run control.
 *
 * The physical table is the source of truth. The circuit editor runs in
 * CONTROLLED mode — its `circuit` prop is driven entirely by `/ws/state` and we
 * do not wire `onCircuitChange`, so on-screen drags cannot persist (the next WS
 * frame re-asserts the physical layout). The histogram is computed locally from
 * the statevector, so no backend is required.
 *
 * The moment engine is wired on LIVE circuit changes only: `useEntangibleState`
 * exposes the deduped snapshot (a replayed/duplicate `seq` never advances it),
 * and we additionally guard on the message object identity so React StrictMode's
 * double-invoke can never double-fire a celebration.
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
import { friendlyWarning } from './warnings';
import type { ConnectionState } from '../ws/stateSocket';
import type { CircuitMessage } from '../ws/messages';
import {
  evaluateMoment,
  initialMomentState,
  type MomentState,
} from '../quantum/moments';
import { shouldAttract } from './attract';
import { Histogram } from './Histogram';
import { MessageStrip, type StripMessage } from './MessageStrip';
import { Celebrations, type CelebrationRequest } from './Celebrations';
import { AttractMode } from './AttractMode';
import { NoisyRun } from './NoisyRun';

const BOARD_QUBITS = 5;

const HINTS = [
  '● and ⊕ in the same column make a CNOT — entanglement in one move.',
  'An H tile puts a qubit into superposition — 0 and 1 at once.',
  'Place tiles left-to-right; each column is one step in time.',
  'Two entangled qubits always agree — measure one, know the other.',
];
const HINT_ROTATE_MS = 7000;

function connectionInfo(state: ConnectionState): { label: string; cls: string } {
  switch (state) {
    case 'open':
      return { label: 'Connected', cls: 'is-live' };
    case 'connecting':
      return { label: 'Connecting', cls: 'is-pending' };
    case 'reconnecting':
      return { label: 'Reconnecting', cls: 'is-pending' };
    default:
      return { label: 'Disconnected', cls: 'is-down' };
  }
}

export function BoothView() {
  const { circuit, detection, connectionState } = useEntangibleState();

  const liveCircuit: Circuit = circuit?.circuit ?? createDefaultCircuit(BOARD_QUBITS);
  const warnings = detection?.warnings ?? [];
  const markersPresent = (detection?.markers?.length ?? 0) > 0;
  const conn = connectionInfo(connectionState);

  // --- moment engine (live circuit changes only) ---------------------------
  const momentStateRef = useRef<MomentState>(initialMomentState);
  const prevCircuitRef = useRef<Circuit>(createDefaultCircuit(BOARD_QUBITS));
  const processedMsgRef = useRef<CircuitMessage | null>(null);
  const tokenRef = useRef(0);
  const [strip, setStrip] = useState<StripMessage | null>(null);
  const [celebration, setCelebration] = useState<CelebrationRequest | null>(null);

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

  // Run the moment engine whenever a new (deduped) circuit message arrives.
  useEffect(() => {
    if (!circuit) return;
    if (processedMsgRef.current === circuit) return; // StrictMode / re-render guard
    processedMsgRef.current = circuit;

    const next = circuit.circuit;
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

    // Any live circuit change is activity → leave attract instantly.
    lastActivityRef.current = Date.now();
    setAttract(false);
  }, [circuit]);

  // Markers (a hand at the table) are activity too → instant attract exit.
  useEffect(() => {
    if (markersPresent) {
      lastActivityRef.current = Date.now();
      setAttract(false);
    }
  }, [detection, markersPresent]);

  // Slow poll: engage attract once the idle window elapses on an empty board.
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

  // --- rotating hint ticker -------------------------------------------------
  const [hintIndex, setHintIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setHintIndex((i) => (i + 1) % HINTS.length), HINT_ROTATE_MS);
    return () => window.clearInterval(id);
  }, []);

  const qamposerConfig = useMemo(() => ({ maxQubits: BOARD_QUBITS }), []);

  return (
    <div className="booth">
      <header className="booth__header">
        <span className={`booth__conn ${conn.cls}`} title={conn.label}>
          <span className="booth__dot" aria-hidden="true" />
        </span>
        <h1 className="booth__title">Entangible</h1>
        <span className="booth__conn-label">{conn.label}</span>
      </header>

      <ThemeProvider defaultTheme="dark">
        <QamposerProvider circuit={liveCircuit} config={qamposerConfig}>
          <main className="booth__main">
            <section className="booth__circuit">
              <CircuitEditor />
            </section>

            <aside className="booth__side">
              <div className="booth__histo">
                <Histogram circuit={liveCircuit} />
                <NoisyRun circuit={liveCircuit} onMessage={pushStrip} />
              </div>
              <MessageStrip message={strip} />
            </aside>
          </main>
        </QamposerProvider>
      </ThemeProvider>

      <footer className={`booth__footer ${warnings.length > 0 ? 'has-warnings' : ''}`}>
        {warnings.length > 0 ? (
          <div className="booth__warnings" role="status">
            {warnings.map((w, i) => (
              <span className="booth__warning" key={`${w.code}-${w.col ?? i}`}>
                {friendlyWarning(w)}
              </span>
            ))}
          </div>
        ) : (
          <div className="booth__hint" key={hintIndex}>
            {HINTS[hintIndex]}
          </div>
        )}
      </footer>

      <Celebrations celebration={celebration} />
      {attract && <AttractMode />}
    </div>
  );
}

export default BoothView;
