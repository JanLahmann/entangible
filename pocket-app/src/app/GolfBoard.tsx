/**
 * Quantum Golf, the sidebar view — the sphere well (target ghost + live state,
 * goal line, the Next-hole button unless TapPlay carries it, the dealing
 * indicator), the course and scope pickers, and the scorecard. Driven by
 * `useGolfGame`; rendered by the site shell (`App`, golf mode) and by the
 * golf-only bundle (`GolfApp`), so a golf fix lands in both.
 *
 * Renders a fragment of three sidebar panels (`.pk-side` children), in the
 * order and with the classes the pocket stylesheet lays out: on phones the
 * first one (the sphere) becomes the top strip, on wide landscape screens the
 * `pk-side-hero` gets a column of its own.
 *
 * Surface differences come in as props: `challenge` (the site's challenge-a-
 * friend QR — the bundle has no QR code), `shareBase` (where a copied course
 * link points) and `courseExtra` (the bundle's code-entry / restart controls
 * under the pickers; the site passes nothing and renders exactly what it did)
 * and `underSphere` (`TapPlay`: clubs + tap grid, seated inside the sphere panel
 * so every layout keeps it directly under the target — build-on-screen only).
 *
 * Holing in (#13): the evolution replays once from the start (`replayKey`;
 * reduced motion shows the final step), and the step the scrubber is at goes
 * to tap-to-play through `GolfReplayContext`, which marks that grid column.
 * With tap-to-play present, "Next hole" is ITS business — it takes the clubs'
 * place in the flow, so nothing covers the scrubber or the goal line; without
 * it the button stays under the sphere as before.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { Circuit } from '@qamposer/react';
import { EvolvingState, type EvolutionStep } from '@shared/display/EvolvingState';
import { Scorecard, type ChallengeRenderer } from '@shared/display/Scorecard';
import { holeGoal } from '@shared/display/goalLine';
import { highestUsedRow } from '@shared/display/displayWires';
import { useT } from '@shared/i18n';
import { GOLF_SCOPES, holeHighlight, holeTargetState, scopeLabel } from '@quantum/golf';
import { CourseDealing } from './CourseDealing';
import type { GolfGame } from './useGolfGame';
import { GolfReplayContext } from './golfReplay';

export function GolfBoard({
  game,
  circuit,
  challenge,
  shareBase,
  courseExtra,
  underSphere,
}: {
  game: GolfGame;
  circuit: Circuit;
  challenge?: ChallengeRenderer;
  shareBase?: string;
  courseExtra?: ReactNode;
  underSphere?: ReactNode;
}) {
  const t = useT();
  const { state, currentLevel, dealing, advanceHole } = game;
  const targets = useMemo(() => holeHighlight(currentLevel), [currentLevel]);
  const targetState = useMemo(() => holeTargetState(currentLevel), [currentLevel]);
  // The hole's goal in plain words, under the target (derived from the target
  // state alone, so a generated hole reads exactly like a classic one).
  const goal = useMemo(() => holeGoal(currentLevel, t), [currentLevel, t]);
  // The Q-sphere and the bra-ket line show the HOLE's state space, not the full
  // five qubits: a level-2 hole gets a 4-node sphere and 2-bit kets. Untouched
  // qubits are exactly |0⟩, so restricting to the first 2^n amplitudes is
  // lossless; if play strays onto higher wires the space auto-grows with them.
  const stateQubits = Math.max(currentLevel.qubits, highestUsedRow(circuit) + 1);
  // The scrubber's step, for the tap grid's column mark — only once holed in
  // (while building, every tap replays and a sweeping mark would distract).
  const [step, setStep] = useState<EvolutionStep | null>(null);
  const replayKey = state.holedIn
    ? `${state.course}:${state.randomSeed}:${String(state.scope)}:${state.levelIndex}`
    : undefined;

  return (
    <>
      {/* `pk-side-hero` marks the sphere as THE panel of the mode: in golf +
          build-on-screen the wide-desktop CSS seats it in its own tall column
          of the sidebar with the course/scorecard/results beside it (#92). */}
      <div
        key="golfview"
        className={`pk-side-hero${underSphere ? ' has-gatebar' : ''}`}
        // The tap grid's row count — phone CSS sizes the sphere with it so a
        // 5-qubit hole still fits one screen (pocket.css "tap to play").
        style={underSphere ? ({ ['--rows' as string]: stateQubits } as CSSProperties) : undefined}
      >
        {/* The view names itself now (EvolvingState's view-label) — no extra
            panel label, it would double up. */}
        <div className={`pk-well${dealing ? ' is-dealing' : ''}`}>
          {/* A course being dealt covers the sphere: the target under it is
              the course being left, not the one about to be played. */}
          {dealing && <CourseDealing holesDone={dealing.holesDone} />}
          <EvolvingState
            circuit={circuit}
            view={currentLevel.view}
            targets={targets}
            targetState={targetState}
            n={stateQubits}
            showKet
            classPrefix="pk"
            replayKey={replayKey}
            onStep={underSphere ? setStep : undefined}
          />
          {/* The goal in plain words, right under the target ket. One line,
              ellipsized; the full sentence is the tooltip. Hidden while a
              course is dealt (the target is the course being left) and once
              the course is complete (there is no hole to aim at). */}
          {!dealing && !state.complete && (
            <p className="pk-golf-goal" title={goal}>
              {goal}
            </p>
          )}
          {advanceHole && state.holedIn && !underSphere && (
            <button type="button" className="pk-golf-next pk-golf-next--sphere" onClick={advanceHole}>
              {state.complete ? t.golf.playAgain : t.golf.nextHole}
            </button>
          )}
        </div>
        <GolfReplayContext.Provider value={state.holedIn ? step : null}>
          {underSphere}
        </GolfReplayContext.Provider>
      </div>
      <div key="golfcourse">
        <div className="pk-label">{t.golf.course}</div>
        <div className="pk-course-pick" role="group" aria-label={t.golf.courseAria}>
          <button
            type="button"
            className={`pk-course-btn${state.course === 'classic' ? ' is-active' : ''}`}
            aria-pressed={state.course === 'classic'}
            onClick={() => game.pickCourse('classic')}
          >
            {t.golf.classic18}
          </button>
          <button
            type="button"
            className={`pk-course-btn${state.course === 'random' ? ' is-active' : ''}`}
            aria-pressed={state.course === 'random'}
            onClick={() => game.pickCourse('random')}
          >
            {state.course === 'random' ? t.golf.newRandom18 : t.golf.random18}
          </button>
        </div>
        {/* What the round is a competition OVER (#102) — the full course, or
            one of its four rounds played as a contest of its own. */}
        <div className="pk-scope-pick" role="group" aria-label={t.golf.scopeAria}>
          {GOLF_SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              className={`pk-scope-btn${state.scope === s ? ' is-active' : ''}`}
              aria-pressed={state.scope === s}
              onClick={() => game.pickScope(s)}
            >
              {scopeLabel(s, t)}
            </button>
          ))}
        </div>
        {courseExtra}
      </div>
      <Scorecard
        key="scorecard"
        state={state}
        circuit={circuit}
        classPrefix="pk"
        monoKet
        challenge={challenge}
        shareBase={shareBase}
        onNextLevel={advanceHole}
        onReveal={game.takeReveal}
        onWipe={game.wipeBoard}
        onJump={game.jumpToHole}
      />
    </>
  );
}

export default GolfBoard;
