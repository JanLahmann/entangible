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
 *
 * Used by the site's runner mode (App) and by the runner-only bundle for the
 * iOS app (src/runner/RunnerApp.tsx, docs/runner-bundle.md), so it imports no
 * analytics: game events go to the optional `onEvent` (the site passes
 * `trackGame`, the bundle nothing).
 *
 * Pause: the run holds whenever the page is hidden (`visibilitychange`), the
 * window loses focus (`blur`) or the page is put away (`pagehide`), on the ⏸
 * button, and while the caller says `suspended` (a sheet over the game). It
 * never resumes by itself: Resume starts a 3-2-1 countdown (one number a
 * second), then the run goes on.
 *
 * Reset (HUD, beside pause): every qubit back to |0⟩ — the engine's
 * non-unitary `reset` event, free of charge; obstacles still measure as usual.
 *
 * VoiceOver: every gate button is named ("Apply H to qubit 0"); one polite live
 * region speaks each coin / obstacle (lane probabilities, lives, score) —
 * throttled to one line per `announceGapMs`, the latest pending line spoken at
 * the end of the gap — and, at once, game over, a new run, pause and the
 * countdown.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cryptoRng, type Rng } from '@shared/menu/sample';
import {
  GATE_BUTTONS,
  GATE_COLUMNS,
  initRunner,
  laneLabels,
  probabilities,
  resetAmplitudes,
  runnerReducer,
  type GateButton,
  type Level,
  type RunnerEvent,
  type RunnerState,
} from '@quantum/runner';
import './runnerGame.css';
import { useT, type Messages } from '@shared/i18n';
import {
  defaultRunnerStorage,
  loadRunnerBests,
  recordRunnerScore,
  type KeyStorage,
  type RunnerBests,
} from './runnerBest';

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

/**
 * One polite live region, throttled: a line is spoken at once when the last
 * one is at least `gapMs` old; otherwise it waits, and only the LATEST waiting
 * line is spoken when the gap ends. `urgent` lines (game over, new run, pause,
 * countdown) skip the queue and drop whatever was waiting.
 */
export function useThrottledAnnouncer(gapMs: number) {
  const [text, setText] = useState('');
  const lastAt = useRef(Number.NEGATIVE_INFINITY);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A repeated identical line would not be re-read; alternate a trailing
  // no-break space so each announcement is a change.
  const flip = useRef(false);

  const speak = useCallback((msg: string) => {
    flip.current = !flip.current;
    lastAt.current = Date.now();
    setText(flip.current ? msg : `${msg} `);
  }, []);

  const announce = useCallback(
    (msg: string, urgent = false) => {
      const now = Date.now();
      if (urgent || now - lastAt.current >= gapMs) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        pending.current = null;
        speak(msg);
        return;
      }
      pending.current = msg;
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        const next = pending.current;
        pending.current = null;
        if (next !== null) speak(next);
      }, gapMs - (now - lastAt.current));
    },
    [gapMs, speak],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return { text, announce };
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

/** The VoiceOver name of a gate button. */
export function gateAria(t: Messages['runner'], g: GateButton): string {
  switch (g) {
    case 'X0':
      return t.applyGate('X', 0);
    case 'H0':
      return t.applyGate('H', 0);
    case 'X1':
      return t.applyGate('X', 1);
    case 'H1':
      return t.applyGate('H', 1);
    case 'CX01':
      return t.applyCx(0, 1);
    case 'CX10':
      return t.applyCx(1, 0);
  }
}

/** Lane probabilities as spoken: "|00⟩ 50%, |11⟩ 50%" (lanes that round to 0 % left out). */
export function laneSummary(level: Level, probs: readonly number[]): string {
  const labels = laneLabels(level);
  return labels
    .map((label, i) => [label, Math.round((probs[i] ?? 0) * 100)] as const)
    .filter(([, pct]) => pct > 0)
    .map(([label, pct]) => `${label} ${pct}%`)
    .join(', ');
}

/** Runner line as a % from the left; columns scroll from 100% down to this. */
const RUNNER_PCT = 14;
/** How long (seconds) a measurement snap/flash lingers before it fades. */
const FLASH_S = 0.6;
/** Distance shown scales the engine's field-widths into friendly "metres". */
const DIST_SCALE = 9;
/** Resume countdown: this many numbers, one per second. */
const COUNTDOWN_FROM = 3;
const COUNTDOWN_STEP_MS = 1000;

/** Map a column's x∈[0,1] (1 = right edge, 0 = runner line) to a left %. */
function columnLeft(x: number): number {
  return RUNNER_PCT + x * (100 - RUNNER_PCT);
}

/** What happened in a run — the part of an analytics event name after `<Site>: `. */
export type RunnerGameEvent = 'runner start' | 'runner finish';

/**
 * Whether the run is moving: 'run'; held with a Resume card ('paused'); a
 * fresh run waiting for Start ('ready'); or counting down to 'run'.
 */
type Hold = 'run' | 'paused' | 'ready' | 'countdown';

export interface RunnerGameProps {
  /** Injectable RNG (seeded in tests). Defaults to crypto for live play. */
  rng?: Rng;
  /** Drive the rAF tick loop (default true). Tests pass false for a static, gate-driven surface. */
  autoRun?: boolean;
  /** Starting level (default 1). */
  initialLevel?: Level;
  /** Controlled level: a change starts a fresh run at that level (the bundle's toolbar). */
  level?: Level;
  /** Show the 1/2-qubit picker in the HUD (default true; the bundle has it in its toolbar). */
  showLevelPicker?: boolean;
  /**
   * Hold every new run behind Start + countdown (default false: the site's
   * runner starts at once). "Run again" and a level change then count down.
   */
  startPaused?: boolean;
  /** Hold the run while true (e.g. a sheet is open over the game); Resume after. */
  suspended?: boolean;
  /** Injectable initial state (tests use it to render the game-over overlay). */
  initialState?: RunnerState;
  /** Game events (start / finish) — the site passes its analytics; optional. */
  onEvent?: (what: RunnerGameEvent, data: Record<string, string | number | undefined>) => void;
  /** Where the best score lives (default: the page's localStorage, if usable). */
  storage?: KeyStorage | null;
  /** Minimum gap between two event announcements (default 2000 ms). */
  announceGapMs?: number;
}

export function RunnerGame({
  rng,
  autoRun = true,
  initialLevel = 1,
  level: levelProp,
  showLevelPicker = true,
  startPaused = false,
  suspended = false,
  initialState,
  onEvent,
  storage: storageProp,
  announceGapMs = 2000,
}: RunnerGameProps) {
  const t = useT().runner;
  const reduced = usePrefersReducedMotion();
  const rngRef = useRef<Rng>(rng ?? cryptoRng());
  const [state, setState] = useState<RunnerState>(
    () => initialState ?? initRunner(levelProp ?? initialLevel),
  );
  const [hold, setHold] = useState<Hold>(startPaused ? 'ready' : 'run');
  const [count, setCount] = useState(COUNTDOWN_FROM);
  const storage = useMemo(
    () => (storageProp === undefined ? defaultRunnerStorage() : storageProp),
    [storageProp],
  );
  const [bests, setBests] = useState<RunnerBests>(() => loadRunnerBests(storage));
  const [newBest, setNewBest] = useState(false);
  const { text: announcement, announce } = useThrottledAnnouncer(announceGapMs);

  const tRef = useRef(t);
  tRef.current = t;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const dispatch = useCallback((ev: RunnerEvent) => {
    setState((s) => runnerReducer(s, ev, rngRef.current));
  }, []);

  const startCountdown = useCallback(() => {
    setCount(COUNTDOWN_FROM);
    setHold('countdown');
  }, []);

  /** A fresh run (Run again, a level change): at once on the site, counted down in the bundle. */
  const newRun = useCallback(
    (ev: RunnerEvent) => {
      dispatch(ev);
      setNewBest(false);
      if (startPaused) startCountdown();
      else setHold('run');
    },
    [dispatch, startPaused, startCountdown],
  );

  // Controlled level (the bundle's toolbar): a change is a fresh run.
  const levelPropRef = useRef(levelProp);
  useEffect(() => {
    if (levelProp === undefined || levelProp === levelPropRef.current) return;
    levelPropRef.current = levelProp;
    newRun({ type: 'setLevel', level: levelProp });
  }, [levelProp, newRun]);

  const playing = state.status === 'playing';
  const running = playing && hold === 'run' && !suspended;

  // Pause on everything that takes the page away. Never resumes by itself.
  const pause = useCallback(() => {
    setHold((h) => (h === 'run' || h === 'countdown' ? 'paused' : h));
  }, []);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const holdRef = useRef(hold);
  holdRef.current = hold;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const away = () => {
      if (!playingRef.current) return;
      if (holdRef.current === 'run' || holdRef.current === 'countdown') {
        pause();
        announce(tRef.current.announcePaused, true);
      }
    };
    const onVisibility = () => {
      if (document.hidden) away();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', away);
    window.addEventListener('pagehide', away);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', away);
      window.removeEventListener('pagehide', away);
    };
  }, [pause, announce]);
  useEffect(() => {
    if (suspended) pause();
  }, [suspended, pause]);

  // The countdown: 3, 2, 1 (one a second, each spoken), then the run goes on.
  useEffect(() => {
    if (hold !== 'countdown' || suspended) return;
    const id = setInterval(() => setCount((c) => c - 1), COUNTDOWN_STEP_MS);
    return () => clearInterval(id);
  }, [hold, suspended]);
  useEffect(() => {
    if (hold !== 'countdown') return;
    if (count <= 0) {
      setHold('run');
      announce(tRef.current.announceGo, true);
    } else {
      announce(String(count), true);
    }
  }, [hold, count, announce]);

  // Game events (`runner start` / `runner finish` for the site's analytics), the
  // best score and the game-over / new-run announcements. A run starts when the
  // status enters 'playing' (also on mount) and finishes when it leaves it.
  // Level/score are read through a ref so the effect only reacts to status changes.
  const latestRef = useRef(state);
  latestRef.current = state;
  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = state.status;
    if (prev === state.status) return;
    const { level, score, distance } = latestRef.current;
    const tt = tRef.current;
    if (state.status === 'playing') {
      onEventRef.current?.('runner start', { level });
      if (prev !== null) announce(tt.announceNewRun(level === 1 ? tt.oneQubit : tt.twoQubits), true);
    } else if (prev === 'playing') {
      onEventRef.current?.('runner finish', { level, score: Math.round(score) });
      const rec = recordRunnerScore(storage, level, score);
      setBests(rec.bests);
      setNewBest(rec.isNewBest);
      const best = rec.bests[level];
      const over = tt.announceOver(score.toFixed(1), tt.meters(Math.round(distance * DIST_SCALE)));
      announce(
        rec.isNewBest ? `${over} ${tt.newBest}` : best ? `${over} ${tt.announceBest(best.toFixed(1))}` : over,
        true,
      );
    }
  }, [state.status, storage, announce]);

  // A level change on the site's own picker also announces itself (status stays
  // 'playing', so the effect above does not see it).
  const prevLevelRef = useRef(state.level);
  useEffect(() => {
    if (prevLevelRef.current === state.level) return;
    prevLevelRef.current = state.level;
    const tt = tRef.current;
    announce(tt.announceNewRun(state.level === 1 ? tt.oneQubit : tt.twoQubits), true);
  }, [state.level, announce]);

  // Each coin / obstacle event: what happened, the lane probabilities, lives, score.
  const lastFlashAt = useRef<number | null>(state.flash?.at ?? null);
  useEffect(() => {
    const f = state.flash;
    if (!f || f.at === lastFlashAt.current) {
      if (!f) lastFlashAt.current = null;
      return;
    }
    lastFlashAt.current = f.at;
    if (state.status !== 'playing') return; // the game-over line says it all
    const tt = tRef.current;
    const what =
      f.kind === 'coin' ? tt.announceCoin(f.amount.toFixed(1)) : f.hit ? tt.announceHit : tt.announceSafe;
    const status = tt.announceStatus(
      laneSummary(state.level, probabilities(state.amps)),
      tt.lives(state.lives),
      state.score.toFixed(1),
    );
    announce(`${what} ${status}`);
  }, [state.flash, state.status, state.level, state.amps, state.lives, state.score, announce]);

  // rAF tick loop — the ONLY timing source (the engine is pure). Runs while a
  // level is being played and not held; a restart or resume restarts it.
  useEffect(() => {
    if (!autoRun || !running) return;
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
  }, [autoRun, running]);

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
  const best = bests[level];

  return (
    <div
      className={`pk-runner ${flashActive ? 'is-flash' : ''}`}
      data-status={state.status}
      data-level={state.level}
      data-hold={suspended && playing ? 'paused' : hold}
      data-elapsed={state.elapsed.toFixed(3)}
    >
      <div className="pk-runner-hud">
        <div className="pk-runner-stat">
          <span className="pk-runner-stat-label">{t.score}</span>
          <span className="pk-runner-score">{state.score.toFixed(1)}</span>
        </div>
        <div className="pk-runner-lives" role="img" aria-label={t.lives(state.lives)}>
          {Array.from({ length: Math.max(state.lives, 0) }, (_, i) => (
            <span key={i} className="pk-runner-heart" aria-hidden="true">
              ♥
            </span>
          ))}
        </div>
        {showLevelPicker && (
          <div className="pk-runner-levelpick" role="group" aria-label={t.level}>
            {([1, 2] as Level[]).map((lv) => (
              <button
                key={lv}
                type="button"
                className={`pk-runner-lvl ${level === lv ? 'is-active' : ''}`}
                aria-pressed={level === lv}
                onClick={() => newRun({ type: 'setLevel', level: lv })}
              >
                {lv === 1 ? t.oneQubit : t.twoQubits}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="pk-runner-reset"
          aria-label={t.resetAria(level)}
          disabled={!running}
          onClick={() => {
            dispatch({ type: 'reset' });
            announce(t.announceReset(laneSummary(level, probabilities(resetAmplitudes(state.amps)))));
          }}
        >
          {t.reset(level)}
        </button>
        <button
          type="button"
          className="pk-runner-pause"
          aria-label={t.pause}
          disabled={!running}
          onClick={() => {
            pause();
            announce(t.announcePaused, true);
          }}
        >
          <span className="pk-runner-pause-icon" aria-hidden="true" />
        </button>
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

      {/* Gate grid (bottom): one row of two at level 1; two rows of three at
          level 2, X₀ H₀ CX 0→1 over X₁ H₁ CX 1→0 (the GATE_BUTTONS order). */}
      <div
        className="pk-runner-gates"
        role="group"
        aria-label={t.gates}
        data-cols={GATE_COLUMNS[level]}
        style={{ ['--gate-cols' as string]: GATE_COLUMNS[level] }}
      >
        {GATE_BUTTONS[level].map((g) => (
          <button
            key={g}
            type="button"
            className="pk-btn pk-runner-gate"
            aria-label={gateAria(t, g)}
            disabled={!running}
            onClick={() => dispatch({ type: 'gate', gate: g })}
          >
            {GATE_LABEL[g]}
          </button>
        ))}
      </div>

      {/* The one live region: throttled event lines, urgent state changes. */}
      <div className="pk-runner-sr" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {playing && (hold === 'paused' || hold === 'ready') && (
        <div className="pk-runner-over pk-runner-hold" role="dialog" aria-label={hold === 'ready' ? t.readyTitle : t.pausedTitle}>
          <div className="pk-runner-over-card">
            <h2>{hold === 'ready' ? t.readyTitle : t.pausedTitle}</h2>
            <p className="pk-runner-over-flavour">{hold === 'ready' ? t.readyHint : t.pausedHint}</p>
            <button type="button" className="pk-btn pk-runner-restart" onClick={startCountdown}>
              {hold === 'ready' ? t.start : t.resume}
            </button>
          </div>
        </div>
      )}
      {playing && hold === 'countdown' && (
        <div className="pk-runner-countdown" aria-hidden="true">
          <span key={count}>{Math.max(count, 1)}</span>
        </div>
      )}

      {state.status === 'over' && (
        <div className="pk-runner-over" role="dialog" aria-label={t.gameOver}>
          <div className="pk-runner-over-card">
            <h2>{t.overTitle}</h2>
            <p className="pk-runner-over-flavour">
              {t.overFlavour}
            </p>
            <div className="pk-runner-over-stats">
              <div>
                <span className="pk-runner-stat-label">{t.score}</span>
                <strong>{state.score.toFixed(1)}</strong>
              </div>
              <div>
                <span className="pk-runner-stat-label">{t.distance}</span>
                <strong>{t.meters(Math.round(state.distance * DIST_SCALE))}</strong>
              </div>
              {best !== undefined && (
                <div>
                  <span className="pk-runner-stat-label">{t.best}</span>
                  <strong>{best.toFixed(1)}</strong>
                </div>
              )}
            </div>
            {newBest && <p className="pk-runner-newbest">{t.newBest}</p>}
            <button
              type="button"
              className="pk-btn pk-runner-restart"
              onClick={() => newRun({ type: 'restart' })}
            >
              {t.runAgain}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default RunnerGame;
