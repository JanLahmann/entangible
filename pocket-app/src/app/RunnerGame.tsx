/**
 * RunnerGame — the pocket "Quantum Runner" surface (task #52, docs/runner.md).
 *
 * Based on Quantum Runner by the QAMPoser project. The runner exists in EVERY
 * basis-state lane at once as ghosts whose opacity is the lane probability; the
 * player taps gate buttons that reshape the live state in real time. Coins bank
 * the expected value (deliberately unmeasured); obstacles trigger a projective
 * measurement — the heart of the game — collapsing the ghosts into or away from
 * the obstacle lanes.
 *
 * All game + quantum logic lives in the pure engine (`@quantum/runner`); this
 * component only owns timing (a rAF tick loop), the phone-first DOM/CSS
 * rendering, and input. `prefers-reduced-motion` suppresses the snap/flash
 * effects (instant, no slow-mo) while keeping the game fully playable.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cryptoRng, type Rng } from '@shared/menu/sample';
import {
  GATE_BUTTONS,
  initRunner,
  laneLabels,
  probabilities,
  runnerReducer,
  type GateButton,
  type Level,
  type RunnerEvent,
  type RunnerState,
} from '@quantum/runner';
import './runnerGame.css';

/** Live `(prefers-reduced-motion: reduce)` match (mirrors the shared idiom). */
function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const m = window.matchMedia(query);
    const on = () => setReduced(m.matches);
    on();
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** Human labels for the gate buttons (kept out of the engine — pure UI). */
const GATE_LABEL: Record<GateButton, string> = {
  X0: 'X₀',
  H0: 'H₀',
  X1: 'X₁',
  H1: 'H₁',
  CX01: 'CX 0→1',
  CX10: 'CX 1→0',
};

/** Runner line as a % from the left; columns scroll from 100% down to this. */
const RUNNER_PCT = 14;
/** How long (seconds) a measurement snap/flash lingers before it fades. */
const FLASH_S = 0.6;
/** Distance shown scales the engine's field-widths into friendly "metres". */
const DIST_SCALE = 9;

/** Map a column's x∈[0,1] (1 = right edge, 0 = runner line) to a left %. */
function columnLeft(x: number): number {
  return RUNNER_PCT + x * (100 - RUNNER_PCT);
}

export interface RunnerGameProps {
  /** Injectable RNG (seeded in tests). Defaults to crypto for live play. */
  rng?: Rng;
  /** Drive the rAF tick loop (default true). Tests pass false for a static, gate-driven surface. */
  autoRun?: boolean;
  /** Starting level (default 1). */
  initialLevel?: Level;
  /** Injectable initial state (tests use it to render the game-over overlay). */
  initialState?: RunnerState;
}

export function RunnerGame({
  rng,
  autoRun = true,
  initialLevel = 1,
  initialState,
}: RunnerGameProps) {
  const reduced = usePrefersReducedMotion();
  const rngRef = useRef<Rng>(rng ?? cryptoRng());
  const [state, setState] = useState<RunnerState>(() => initialState ?? initRunner(initialLevel));

  const dispatch = useCallback((ev: RunnerEvent) => {
    setState((s) => runnerReducer(s, ev, rngRef.current));
  }, []);

  const playing = state.status === 'playing';

  // rAF tick loop — the ONLY timing source (the engine is pure). Runs while a
  // level is being played; a restart re-enters 'playing' and the effect restarts.
  useEffect(() => {
    if (!autoRun || !playing) return;
    if (typeof requestAnimationFrame === 'undefined') return;
    let raf = 0;
    let last = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const frame = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setState((s) => (s.status === 'playing' ? runnerReducer(s, { type: 'tick', dt }, rngRef.current) : s));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [autoRun, playing]);

  const level = state.level;
  const labels = laneLabels(level);
  const probs = probabilities(state.amps);
  const laneCount = labels.length;

  // A recent measurement drives the snap/flash (suppressed under reduced motion).
  const flash = state.flash;
  const flashActive =
    !reduced &&
    flash != null &&
    flash.kind === 'measure' &&
    flash.p > 0 &&
    state.elapsed - flash.at < FLASH_S;
  const coinFlash =
    flash != null && flash.kind === 'coin' && state.elapsed - flash.at < FLASH_S ? flash : null;

  return (
    <div className={`pk-runner ${flashActive ? 'is-flash' : ''}`} data-status={state.status}>
      <div className="pk-runner-hud">
        <div className="pk-runner-stat">
          <span className="pk-runner-stat-label">Score</span>
          <span className="pk-runner-score" aria-live="polite">
            {state.score.toFixed(1)}
          </span>
        </div>
        <div className="pk-runner-lives" aria-label={`${state.lives} lives`}>
          {Array.from({ length: Math.max(state.lives, 0) }, (_, i) => (
            <span key={i} className="pk-runner-heart" aria-hidden="true">
              ♥
            </span>
          ))}
        </div>
        <div className="pk-runner-levelpick" role="group" aria-label="Level">
          {([1, 2] as Level[]).map((lv) => (
            <button
              key={lv}
              type="button"
              className={`pk-runner-lvl ${level === lv ? 'is-active' : ''}`}
              aria-pressed={level === lv}
              onClick={() => dispatch({ type: 'setLevel', level: lv })}
            >
              {lv === 1 ? '1 qubit' : '2 qubits'}
            </button>
          ))}
        </div>
      </div>

      <div
        className="pk-runner-field"
        style={{ ['--lanes' as string]: laneCount }}
        data-lanes={laneCount}
      >
        {/* The runner line the columns scroll toward. */}
        <div className="pk-runner-line" style={{ left: `${RUNNER_PCT}%` }} aria-hidden="true" />

        {labels.map((label, lane) => {
          const p = probs[lane] ?? 0;
          return (
            <div className="pk-runner-lane" key={lane} style={{ top: `${(lane / laneCount) * 100}%` }}>
              <span className="pk-runner-lane-label">{label}</span>
              {/* The ghost runner in this lane — opacity IS the probability. */}
              <span
                className="pk-runner-ghost"
                data-lane={lane}
                data-prob={p.toFixed(3)}
                style={{ left: `${RUNNER_PCT}%`, opacity: Math.max(0.05, p) }}
                aria-hidden="true"
              >
                🏃
              </span>
              <span className="pk-runner-lane-prob" aria-hidden="true">
                {(p * 100).toFixed(0)}%
              </span>
            </div>
          );
        })}

        {/* Scrolling coin / obstacle columns. */}
        {state.columns.map((col) =>
          col.lanes.map((lane) => (
            <span
              key={`${col.id}-${lane}`}
              className={`pk-runner-cell pk-runner-cell--${col.kind}`}
              data-kind={col.kind}
              style={{
                left: `${columnLeft(col.x)}%`,
                top: `${(lane / laneCount) * 100}%`,
                height: `${100 / laneCount}%`,
              }}
              aria-hidden="true"
            >
              {col.kind === 'coin' ? '◉' : ''}
            </span>
          )),
        )}

        {/* Floating coin gain (+0.7 style). */}
        {coinFlash && (
          <div className="pk-runner-coinflash" aria-hidden="true">
            +{coinFlash.amount.toFixed(1)}
          </div>
        )}
      </div>

      {/* Gate thumb-row (bottom): the whole control surface for the game. */}
      <div className="pk-runner-gates" role="group" aria-label="Gates">
        {GATE_BUTTONS[level].map((g) => (
          <button
            key={g}
            type="button"
            className="pk-btn pk-runner-gate"
            disabled={!playing}
            onClick={() => dispatch({ type: 'gate', gate: g })}
          >
            {GATE_LABEL[g]}
          </button>
        ))}
      </div>

      {state.status === 'over' && (
        <div className="pk-runner-over" role="dialog" aria-label="Game over">
          <div className="pk-runner-over-card">
            <h2>Measurement got you</h2>
            <p className="pk-runner-over-flavour">
              A projective measurement collapsed you into an obstacle one time too many.
            </p>
            <div className="pk-runner-over-stats">
              <div>
                <span className="pk-runner-stat-label">Score</span>
                <strong>{state.score.toFixed(1)}</strong>
              </div>
              <div>
                <span className="pk-runner-stat-label">Distance</span>
                <strong>{Math.round(state.distance * DIST_SCALE)} m</strong>
              </div>
            </div>
            <button
              type="button"
              className="pk-btn pk-runner-restart"
              onClick={() => dispatch({ type: 'restart' })}
            >
              Run again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default RunnerGame;
