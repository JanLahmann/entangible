/**
 * Quantum Golf scorecard — shared panel (SC2), serving the booth (`bo-`, in
 * memory, no localStorage) and pocket (`pk-`, best-of-device) via `classPrefix`.
 *
 * Shows the current level ("Level N — name" + qubit count + target ket), par,
 * strokes (= gates on the board), live fidelity %, best stroke count, and a
 * compact per-level best list. Reads the latched golf state and the live
 * circuit.
 *
 * `monoKet` toggles the one pre-SC2 difference: pocket adds `pk-mono` to the
 * target-ket span; the booth does not tint its ket.
 */
import type { Circuit } from '@qamposer/react';
import { LEVELS, evaluate, scoreName, type GolfState } from '@quantum/golf';

export function Scorecard({
  state,
  circuit,
  classPrefix,
  monoKet = false,
  onNextLevel,
}: {
  state: GolfState;
  circuit: Circuit;
  classPrefix: string;
  monoKet?: boolean;
  /**
   * When set, the holed-in line renders a "Next level" button calling this
   * instead of the clear-the-board hint. Pocket passes it in build-on-screen
   * mode (it empties the manual board, which IS the advance trigger); camera
   * and booth surfaces omit it — physically clearing the table is the ritual.
   */
  onNextLevel?: () => void;
}) {
  const p = classPrefix;
  const level = LEVELS[state.levelIndex];
  const ev = evaluate(circuit, level);
  const holedIn = state.holedIn;
  const pct = (ev.fidelity * 100).toFixed(ev.fidelity >= 0.999 ? 0 : 1);
  const bestStrokes = state.best[level.level];

  return (
    <div>
      <div className={`${p}-label`}>
        Scorecard · level {level.level}/{LEVELS.length}
      </div>
      <div className={`${p}-well ${p}-golf`}>
        <div className={`${p}-golf-hole`}>
          <span className={`${p}-golf-name`}>
            Level {level.level} — {level.name}
          </span>
          <span className={`${p}-golf-qubits`}>
            {level.qubits} {level.qubits === 1 ? 'qubit' : 'qubits'}
          </span>
          <span className={`${p}-golf-ket${monoKet ? ` ${p}-mono` : ''}`}>{level.target}</span>
        </div>
        <div className={`${p}-stats`}>
          <div className={`${p}-stat`}>
            par <b>{level.par}</b>
          </div>
          <div className={`${p}-stat`}>
            strokes <b>{ev.strokes}</b>
          </div>
          <div className={`${p}-stat`}>
            fidelity <b className={holedIn ? 'is-holed' : undefined}>{pct}%</b>
          </div>
          <div className={`${p}-stat`}>
            best <b>{bestStrokes === undefined ? '—' : bestStrokes}</b>
          </div>
        </div>
        {holedIn && (
          <div className={`${p}-golf-holed`}>
            {scoreName(bestStrokes ?? ev.strokes, level.par)} —{' '}
            {onNextLevel ? (
              <button type="button" className={`${p}-golf-next`} onClick={onNextLevel}>
                Next level ▸
              </button>
            ) : (
              'clear the board for the next level'
            )}
          </div>
        )}
        <div className={`${p}-golf-list`} aria-label="all levels">
          {LEVELS.map((l) => (
            <div
              key={l.level}
              className={`${p}-golf-chip ${l.level === level.level ? 'is-current' : ''} ${
                state.best[l.level] !== undefined ? 'is-done' : ''
              }`}
              title={`Level ${l.level} · ${l.name} · par ${l.par}`}
            >
              <span>{l.level}</span>
              <span className={`${p}-golf-chip-best`}>
                {state.best[l.level] === undefined ? '·' : state.best[l.level]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Scorecard;
