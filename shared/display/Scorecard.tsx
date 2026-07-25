/**
 * Quantum Golf scorecard — shared panel (SC2), serving the booth (`bo-`, in
 * memory, no localStorage) and pocket (`pk-`, best-of-device) via `classPrefix`.
 *
 * The course is 18 holes across four rounds (see `@quantum/golf`). The card
 * shows the current round + hole ("Medium · hole 7/18"), the round's "clubs"
 * gate-set hint, the target ket, par, live strokes/fidelity, the per-hole best,
 * a running total-vs-par across completed holes, and a round-grouped chip strip.
 * "Strokes" is the hole's CUMULATIVE count from the golf state (#68) — every
 * add and delete since tee-off, not the gates currently on the board; fidelity
 * still comes from evaluating the live circuit.
 * When the course is finished it shows the final total-vs-par summary.
 *
 * The card is course-agnostic (#70): the hole list comes from `courseHoles`, so
 * a RANDOM round renders its generated holes (names, kets and generator-sized
 * pars) through the same layout, plus a "Random round" chip in the header.
 *
 * `monoKet` toggles the one pre-SC2 difference: pocket adds `pk-mono` to the
 * target-ket span; the booth does not tint its ket.
 */
import type { Circuit } from '@qamposer/react';
import {
  ROUND_LABEL,
  COURSE_PAR,
  coursePar,
  evaluate,
  scoreName,
  courseTotals,
  formatVsPar,
  type GolfRound,
  type GolfState,
  type Hole,
} from '@quantum/golf';
import { courseHoles } from '@quantum/golfRandom';

const ROUNDS: readonly GolfRound[] = ['easy', 'medium', 'difficult', 'extra'];

/** The "you are not on the fixed course" marker (#70) — rendered only when a
 *  generated round is in play, so the classic card is unchanged. */
function CourseChip({ p, state }: { p: string; state: GolfState }) {
  if (state.course !== 'random') return null;
  return <span className={`${p}-golf-random`}>Random round</span>;
}

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
   * When set, the holed-in line renders a "Next hole" button calling this
   * instead of the clear-the-board hint (and, on the finished course, a "Play
   * again" button). Pocket passes it in build-on-screen mode (it empties the
   * manual board, which IS the advance/restart trigger); camera and booth
   * surfaces omit it — physically clearing the table is the ritual.
   */
  onNextLevel?: () => void;
}) {
  const p = classPrefix;
  // The course in play: the fixed 18, or this session's generated ones (#70).
  const holes = courseHoles(state);
  const hole = holes[state.levelIndex];
  const totals = courseTotals(state.best, holes);
  const totalLabel = totals.completed > 0 ? formatVsPar(totals.vsPar) : 'E';
  // A generated course sums its own pars; the fixed one keeps the constant.
  const fullPar = state.course === 'random' ? coursePar(holes) : COURSE_PAR;

  // Course finished — show the final scorecard summary.
  if (state.complete) {
    return (
      <div>
        <div className={`${p}-label`}>
          Scorecard · course complete
          <CourseChip p={p} state={state} />
        </div>
        <div className={`${p}-well ${p}-golf`}>
          <div className={`${p}-golf-hole`}>
            <span className={`${p}-golf-name`}>Course complete! ⛳</span>
            <span className={`${p}-golf-qubits`}>
              {totals.strokes} strokes · par {fullPar}
            </span>
            <span className={`${p}-golf-total`}>
              {formatVsPar(totals.vsPar)} <small>vs par</small>
            </span>
          </div>
          <div className={`${p}-golf-holed`}>
            {onNextLevel ? (
              <button type="button" className={`${p}-golf-next`} onClick={onNextLevel}>
                Play again ▸
              </button>
            ) : (
              'clear the board to play again'
            )}
          </div>
          <ChipStrip p={p} holes={holes} currentHole={-1} best={state.best} />
        </div>
      </div>
    );
  }

  const ev = evaluate(circuit, hole);
  const holedIn = state.holedIn;
  const pct = (ev.fidelity * 100).toFixed(ev.fidelity >= 0.999 ? 0 : 1);
  const bestStrokes = state.best[hole.hole];

  return (
    <div>
      <div className={`${p}-label`}>
        Scorecard · {ROUND_LABEL[hole.round]} · hole {hole.hole}/{holes.length}
        <CourseChip p={p} state={state} />
      </div>
      <div className={`${p}-well ${p}-golf`}>
        <div className={`${p}-golf-hole`}>
          <span className={`${p}-golf-name`}>
            {hole.code} — {hole.name}
          </span>
          <span className={`${p}-golf-qubits`}>
            {hole.qubits} {hole.qubits === 1 ? 'qubit' : 'qubits'} · clubs: {hole.clubs.join(' · ')}
          </span>
          <span className={`${p}-golf-ket${monoKet ? ` ${p}-mono` : ''}`}>
            <span className={`${p}-ket-label`}>Target</span>
            {hole.targetKet}
          </span>
        </div>
        <div className={`${p}-stats`}>
          <div className={`${p}-stat`}>
            par <b>{hole.par}</b>
          </div>
          <div className={`${p}-stat`}>
            strokes <b>{state.strokes}</b>
          </div>
          <div className={`${p}-stat`}>
            fidelity <b className={holedIn ? 'is-holed' : undefined}>{pct}%</b>
          </div>
          <div className={`${p}-stat`}>
            best <b>{bestStrokes === undefined ? '—' : bestStrokes}</b>
          </div>
          <div className={`${p}-stat`}>
            total <b>{totalLabel}</b>
          </div>
        </div>
        {holedIn && (
          <div className={`${p}-golf-holed`}>
            {scoreName(bestStrokes ?? state.strokes, hole.par)} —{' '}
            {onNextLevel ? (
              <button type="button" className={`${p}-golf-next`} onClick={onNextLevel}>
                Next hole ▸
              </button>
            ) : (
              'clear the board for the next hole'
            )}
          </div>
        )}
        <ChipStrip p={p} holes={holes} currentHole={hole.hole} best={state.best} />
      </div>
    </div>
  );
}

/** Round-grouped strip of all 18 holes; the current hole is outlined, done
 *  holes show their best stroke count. */
function ChipStrip({
  p,
  holes,
  currentHole,
  best,
}: {
  p: string;
  holes: readonly Hole[];
  currentHole: number;
  best: Readonly<Record<number, number>>;
}) {
  return (
    <div className={`${p}-golf-course`} aria-label="all holes">
      {ROUNDS.map((round) => (
        <div key={round} className={`${p}-golf-row`}>
          <span className={`${p}-golf-round`}>{ROUND_LABEL[round].charAt(0)}</span>
          <div className={`${p}-golf-list`}>
            {holes.filter((h) => h.round === round).map((h) => (
              <div
                key={h.hole}
                className={`${p}-golf-chip ${h.hole === currentHole ? 'is-current' : ''} ${
                  best[h.hole] !== undefined ? 'is-done' : ''
                }`}
                title={`${h.code} · ${h.name} · par ${h.par}`}
              >
                <span>{h.code}</span>
                <span className={`${p}-golf-chip-best`}>
                  {best[h.hole] === undefined ? '·' : best[h.hole]}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default Scorecard;
