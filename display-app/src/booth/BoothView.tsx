/**
 * BoothView — the big-screen kiosk view.
 *
 * The physical table is the source of truth: the composer runs in CONTROLLED
 * mode (its `circuit` prop is driven entirely by the `/ws/state` feed and local
 * on-screen edits are ignored — see note below). `realtimeAdapter={localAdapter()}`
 * makes the histogram and Q-sphere update in-browser on every stable change, so
 * no backend is required.
 *
 * No celebrations here yet — those land in M3.
 */
import { useMemo } from 'react';
import { Qamposer } from '@qamposer/react/visualization';
import { createDefaultCircuit, localAdapter, type Circuit } from '@qamposer/react';
import { useEntangibleState } from '../ws/useEntangibleState';
import { friendlyWarning } from './warnings';
import type { ConnectionState } from '../ws/stateSocket';

const BOARD_QUBITS = 5; // matches @qamposer/react default maxQubits and the board mat

function connectionLabel(state: ConnectionState): { text: string; cls: string } {
  switch (state) {
    case 'open':
      return { text: 'Live', cls: 'is-live' };
    case 'connecting':
      return { text: 'Connecting…', cls: 'is-pending' };
    case 'reconnecting':
      return { text: 'Reconnecting…', cls: 'is-pending' };
    case 'closed':
    default:
      return { text: 'Disconnected', cls: 'is-down' };
  }
}

export function BoothView() {
  const { circuit, detection, connectionState } = useEntangibleState();

  // Stable local simulator instance for realtime ideal results.
  const realtimeAdapter = useMemo(() => localAdapter(), []);

  const liveCircuit: Circuit = circuit?.circuit ?? createDefaultCircuit(BOARD_QUBITS);
  const isEmpty = liveCircuit.gates.length === 0;

  const qasmLineCount = circuit?.qasm
    ? circuit.qasm.trimEnd().split('\n').length
    : 0;

  const warnings = detection?.warnings ?? [];
  const conn = connectionLabel(connectionState);

  return (
    <div className="booth">
      <header className="booth__header">
        <h1 className="booth__title">Entangible</h1>
        <span className="booth__tag">QAMPoser physical composer</span>
      </header>

      <main className="booth__main">
        <div className="booth__composer">
          {/*
            Controlled mode: `circuit` is fully driven by the table. We do NOT
            wire `onCircuitChange`, so any drag/drop on screen cannot persist —
            the next WS frame re-asserts the physical layout. This is how the
            design's "on-screen editing disabled" is expressed in the 0.2 API
            (there is no explicit readOnly prop).
          */}
          <Qamposer
            circuit={liveCircuit}
            realtimeAdapter={realtimeAdapter}
            defaultTheme="dark"
            showThemeToggle={false}
            showHeader={false}
            title="Entangible"
          />
          {isEmpty && (
            <div className="booth__empty-hint" role="status">
              Place a tile on the board to begin
            </div>
          )}
        </div>
      </main>

      {warnings.length > 0 && (
        <div className="booth__warnings" role="status">
          {warnings.map((w, i) => (
            <span className="booth__warning" key={`${w.code}-${w.col ?? i}`}>
              {friendlyWarning(w)}
            </span>
          ))}
        </div>
      )}

      <footer className="booth__footer">
        <span className={`booth__conn ${conn.cls}`}>
          <span className="booth__dot" aria-hidden="true" />
          {conn.text}
        </span>
        <span className="booth__qasm">
          {qasmLineCount} QASM {qasmLineCount === 1 ? 'line' : 'lines'}
        </span>
      </footer>
    </div>
  );
}

export default BoothView;
