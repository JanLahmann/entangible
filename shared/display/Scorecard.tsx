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
 * Once a hole is holed in, the score line also offers "Show solution" (#71): a
 * toggle that DRAWS the hole's `solution` as a compact circuit diagram
 * (`MiniCircuit`). The drawing is inert — pure props, pointer-transparent,
 * never applied to the board — so a reveal cannot cost a stroke, and it is
 * scoped to the hole it was opened on, so the next hole starts hidden again.
 *
 * The first reveal of a hole also starts an OPTIMAL search (#72, `@quantum/
 * optimal`) in the background. If it finds something shorter than the stored
 * answer, a second drawing appears under it, labelled "Optimal (N gates)"; if it
 * proves nothing shorter exists, the stored one is labelled "Solution —
 * optimal" instead. If it runs out of budget, nothing is said — an unproven
 * hole looks exactly as it did before. The search is async, chunked and cached
 * per (course, seed, hole), so it runs once and never blocks a paint.
 *
 * The card is course-agnostic (#70): the hole list comes from `courseHoles`, so
 * a RANDOM round renders its generated holes (names, kets and generator-sized
 * pars) through the same layout, plus a "Random round" chip in the header.
 *
 * `monoKet` toggles the one pre-SC2 difference: pocket adds `pk-mono` to the
 * target-ket span; the booth does not tint its ket.
 */
import { useEffect, useState } from 'react';
import type { Circuit } from '@qamposer/react';
import {
  ROUND_LABEL,
  COURSE_PAR,
  coursePar,
  clubGateTypes,
  evaluate,
  holeTargetState,
  scoreName,
  courseTotals,
  formatVsPar,
  type GolfRound,
  type GolfState,
  type Hole,
} from '@quantum/golf';
import { courseHoles } from '@quantum/golfRandom';
import { findOptimalAsync, type OptimalResult } from '@quantum/optimal';
import { MiniCircuit } from './MiniCircuit';

const ROUNDS: readonly GolfRound[] = ['easy', 'medium', 'difficult', 'extra'];

/**
 * Finished optimal searches, and the ones still running (#72). A module memo,
 * not component state: the answer for a hole does not change while an app is
 * open, and re-mounting the card (or opening the reveal a second time) must not
 * pay for the search again. Keyed by course + seed + hole, because hole 3 of one
 * random deal has nothing to do with hole 3 of another.
 */
const OPTIMAL_CACHE = new Map<string, OptimalResult>();
const OPTIMAL_RUNNING = new Map<string, Promise<OptimalResult>>();

function optimalKey(state: GolfState, hole: Hole): string {
  return `${state.course}:${state.randomSeed}:${hole.hole}`;
}

/**
 * The optimal search for `hole`, started on the first reveal and cached
 * thereafter; `null` while it is still running (or before it starts).
 *
 * `maxDepth` is the stored solution's length − 1: the only question worth
 * asking is whether something SHORTER exists, and bounding the depth is what
 * makes "no, the stored one is optimal" a cheap answer rather than an infinite
 * one. A search that outruns its state budget resolves to `'unknown'` and the
 * card simply says nothing.
 */
function useOptimal(state: GolfState, hole: Hole, enabled: boolean): OptimalResult | null {
  const key = optimalKey(state, hole);
  const [, bump] = useState(0);
  const solution = hole.solution;

  useEffect(() => {
    if (!enabled || !solution || OPTIMAL_CACHE.has(key)) return;
    let live = true;
    let run = OPTIMAL_RUNNING.get(key);
    if (!run) {
      run = findOptimalAsync(holeTargetState(hole), clubGateTypes(hole), hole.qubits, {
        maxDepth: solution.gates.length - 1,
      });
      OPTIMAL_RUNNING.set(key, run);
      // Registered first, so the cache is written before any waiter re-renders.
      void run.then((result) => {
        OPTIMAL_CACHE.set(key, result);
        OPTIMAL_RUNNING.delete(key);
      });
    }
    void run.then(() => {
      if (live) bump((n) => n + 1);
    });
    return () => {
      live = false; // the search runs on; only this card stops listening
    };
  }, [enabled, key, hole, solution]);

  return OPTIMAL_CACHE.get(key) ?? null;
}

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
  // Which hole's solution is currently revealed (#71). Keyed by hole NUMBER
  // rather than a boolean, so the reveal is scoped to the hole it was asked for
  // and the next hole starts hidden again without an effect to reset it.
  const [solutionFor, setSolutionFor] = useState<number | null>(null);
  // The course in play: the fixed 18, or this session's generated ones (#70).
  const holes = courseHoles(state);
  const hole = holes[state.levelIndex];
  // The optimal search starts with the reveal and outlives it (#72). Declared
  // before the course-complete return, because hooks may not be conditional.
  const revealed = state.holedIn && !state.complete && solutionFor === hole.hole;
  const optimal = useOptimal(state, hole, revealed);
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
            <SolutionToggle
              p={p}
              hole={hole}
              shown={solutionFor === hole.hole}
              onToggle={() => setSolutionFor(solutionFor === hole.hole ? null : hole.hole)}
            />
          </div>
        )}
        {revealed && <Solutions p={p} state={state} hole={hole} optimal={optimal} />}
        <ChipStrip p={p} holes={holes} currentHole={hole.hole} best={state.best} />
      </div>
    </div>
  );
}

/**
 * "Show solution" (#71) — the reveal offered next to the score line once the
 * hole is holed in. Pedagogy: a player who fumbled to +4 has earned the sight of
 * a clean path, and the ball is already in, so nothing is given away. Renders
 * nothing for a hole with no solution (defensive — every hole on both courses
 * carries one).
 */
function SolutionToggle({
  p,
  hole,
  shown,
  onToggle,
}: {
  p: string;
  hole: Hole;
  shown: boolean;
  onToggle: () => void;
}) {
  if (!hole.solution) return null;
  return (
    <button
      type="button"
      className={`${p}-golf-solution-btn`}
      aria-expanded={shown}
      onClick={onToggle}
    >
      {shown ? 'Hide solution' : 'Show solution'}
    </button>
  );
}

/**
 * The revealed answer, DRAWN (#71): the solution as a compact circuit diagram
 * rather than a line of text chips — a circuit is a picture, and the picture is
 * what a player can actually read back onto the board. The drawing is inert
 * (`MiniCircuit` is pure and pointer-transparent), so looking at it can never
 * touch the live circuit or cost a stroke (#68), and it scales to the card's
 * width like the ket lines rather than widening it.
 */
function SolutionCircuit({
  p,
  circuit,
  n,
  label,
}: {
  p: string;
  circuit: Circuit;
  n: number;
  label: string | null;
}) {
  return (
    <div className={`${p}-golf-solution`}>
      {label && <div className={`${p}-golf-sol-label`}>{label}</div>}
      <MiniCircuit circuit={circuit} n={n} classPrefix={p} />
    </div>
  );
}

/**
 * The reveal: the stored solution, and — once the background search has
 * something to say (#72) — either a shorter one drawn beneath it, or a label
 * promoting the stored one to optimal.
 *
 * While the search runs, and if it runs out of budget, the block says nothing
 * extra: an unproven hole must look exactly like it did before, never like a
 * claim we cannot back. "Dealt solution" names the random course's answer for
 * what it is — the circuit that dealt the hole, not an attempt at a good one.
 */
function Solutions({
  p,
  state,
  hole,
  optimal,
}: {
  p: string;
  state: GolfState;
  hole: Hole;
  optimal: OptimalResult | null;
}) {
  if (!hole.solution) return null;
  const storedLabel =
    optimal?.status === 'minimal'
      ? 'Solution — optimal'
      : optimal?.status === 'shorter'
        ? state.course === 'random'
          ? 'Dealt solution'
          : 'Solution'
        : null;
  return (
    <>
      <SolutionCircuit
        p={p}
        circuit={hole.solution}
        n={hole.qubits}
        label={storedLabel}
      />
      {optimal?.status === 'shorter' && (
        <SolutionCircuit
          p={p}
          circuit={{ qubits: hole.qubits, gates: optimal.gates }}
          n={hole.qubits}
          label={`Optimal (${optimal.gates.length} ${
            optimal.gates.length === 1 ? 'gate' : 'gates'
          })`}
        />
      )}
    </>
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
