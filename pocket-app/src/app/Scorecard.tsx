/**
 * Golf scorecard panel (docs/pocket.md). Shows the current hole (name + target
 * ket), par, strokes (= gates on the board), live fidelity %, and the
 * best-of-device stroke count, plus a compact per-hole best list. Reads the
 * latched golf state and the live circuit.
 */
import type { Circuit } from '@qamposer/react';
import { HOLES, evaluate, scoreName, type GolfState } from './golf';

export function Scorecard({ state, circuit }: { state: GolfState; circuit: Circuit }) {
  const hole = HOLES[state.holeIndex];
  const ev = evaluate(circuit, hole);
  const holedIn = state.holedIn;
  const pct = (ev.fidelity * 100).toFixed(ev.fidelity >= 0.999 ? 0 : 1);
  const bestStrokes = state.best[hole.id];

  return (
    <div>
      <div className="pk-label">
        Scorecard · hole {hole.id}/{HOLES.length}
      </div>
      <div className="pk-well pk-golf">
        <div className="pk-golf-hole">
          <span className="pk-golf-name">{hole.name}</span>
          <span className="pk-golf-ket pk-mono">{hole.targetKet}</span>
        </div>
        <div className="pk-stats">
          <div className="pk-stat">
            par <b>{hole.par}</b>
          </div>
          <div className="pk-stat">
            strokes <b>{ev.strokes}</b>
          </div>
          <div className="pk-stat">
            fidelity <b className={holedIn ? 'is-holed' : undefined}>{pct}%</b>
          </div>
          <div className="pk-stat">
            best <b>{bestStrokes === undefined ? '—' : bestStrokes}</b>
          </div>
        </div>
        {holedIn && (
          <div className="pk-golf-holed">
            {scoreName(bestStrokes ?? ev.strokes, hole.par)} — clear the board for the next hole
          </div>
        )}
        <div className="pk-golf-list" aria-label="all holes">
          {HOLES.map((h) => (
            <div
              key={h.id}
              className={`pk-golf-chip ${h.id === hole.id ? 'is-current' : ''} ${
                state.best[h.id] !== undefined ? 'is-done' : ''
              }`}
              title={`${h.name} · par ${h.par}`}
            >
              <span>{h.id}</span>
              <span className="pk-golf-chip-best">
                {state.best[h.id] === undefined ? '·' : state.best[h.id]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Scorecard;
