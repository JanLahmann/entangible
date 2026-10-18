/**
 * EvolvingState — animates the golf state stepping THROUGH the circuit (task
 * #53) instead of only showing the final state.
 *
 * It wraps the shared `QSphereView` / `BlochView` (which it must not edit) and
 * drives them purely through their `statevector` prop: the evolution engine
 * (`@quantum/evolution`) gives one statevector snapshot per circuit column, and
 * this component interpolates between consecutive snapshots (see
 * `evolutionAnimation`) to feed a smoothly-transitioning state into the view.
 *
 *   - Auto-play: every circuit change animates through to the final state, so
 *     at rest the view always shows the CURRENT state. How (whole replay from
 *     the start, or only the changed steps) and how fast (travel + dwell per
 *     step) is the `timing` prop: the booth keeps the original 500 ms/step
 *     full replay, the pocket app a calmer pace (`evolutionAnimation`).
 *   - Scrubber: replay + prev/next + step dots to replay / inspect any column,
 *     with a "start" / "after layer N" label. Unobtrusive; hidden when the
 *     board is empty (a single snapshot has nothing to step through).
 *   - prefers-reduced-motion: no tweening — steps jump instantly; the scrubber
 *     still works, and no travelers are drawn.
 *   - Roll-the-ball (#57, Q-sphere only): on top of the cross-fade, balls of
 *     probability mass TRAVEL the surface between basis nodes — one ball splits
 *     into two when a gate creates superposition, balls arrive together when
 *     paths merge. The transport map comes from `@quantum/evolution`; this
 *     component only places the balls for the current (segment, fraction).
 *   - Bra-ket line (#59, opt-in via `showKet`): `KetDisplay` typesets the SAME
 *     animated statevector under the view, so the notation moves with the balls.
 *
 * Structural only: every element carries a `${classPrefix}-evo-*` class so the
 * pocket (`pk-`) and booth (`bo-`) skins style it, exactly like the other shared
 * components.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Circuit } from '@qamposer/react';
import { QSphereView, nodeRadius, type QTraveler } from '@quantum/QSphereView';
import { BlochView } from '@quantum/BlochView';
import {
  evolutionSteps,
  lerpHue,
  occupiedColumns,
  surfacePath,
  transportEdges,
} from '@quantum/evolution';
import { layout, type Vec3 } from '@quantum/qsphere';
import { bestBlochQubit, blochVector, type BlochVector } from '@quantum/bloch';
import type { StateVector } from '@quantum/statevector';
import { KetDisplay } from './KetDisplay';
import { useT } from '@shared/i18n';
import type { Messages } from '@shared/i18n/en';
import { basisVisuals } from '@quantum/qsphere';
import {
  easeInOutCubic,
  interpolateStatevector,
  slerpBloch,
  blochToStatevector,
  BOOTH_EVOLUTION_TIMING,
  firstChangedStep,
  paceProgress,
  type EvolutionPace,
  type EvolutionTiming,
} from './evolutionAnimation';

export {
  BOOTH_EVOLUTION_TIMING,
  POCKET_EVOLUTION_TIMING,
  type EvolutionPace,
  type EvolutionTiming,
} from './evolutionAnimation';

/** The step the view rests on (or passes) — reported through `onStep`. */
export interface EvolutionStep {
  /** 0 = the start state, i = after the i-th occupied column. */
  readonly index: number;
  /** The last step's index (= the number of occupied columns). */
  readonly last: number;
  /** The circuit column (gate `position`) step `index` is after; null at the start. */
  readonly column: number | null;
}

/** Traveler opacity below which a ball is not worth drawing (#57). */
const FADE_EPS = 1e-3;

export interface EvolvingStateProps {
  /** The live golf circuit. */
  circuit: Circuit;
  /** Which view the current level plays on. */
  view: 'bloch' | 'qsphere';
  /** Basis indices to outline as targets (Q-sphere golf). */
  targets?: ReadonlySet<number>;
  /** The hole's target statevector — drawn as Q-sphere ghost rings (#58). */
  targetState?: StateVector;
  /** Qubit count of the displayed space (Q-sphere). */
  n?: number;
  /** Show the live bra-ket notation under the view (#59). */
  showKet?: boolean;
  /** CSS class prefix, e.g. 'pk' or 'bo'. */
  classPrefix: string;
  /**
   * Replay trigger: whenever this changes to a defined value the evolution
   * plays once from the start (golf: holing in, #13). Under reduced motion it
   * just shows the final step. Undefined = no extra replays.
   */
  replayKey?: string;
  /** Called with the visible (rounded) step whenever it changes. */
  onStep?: (step: EvolutionStep) => void;
  /**
   * Step timing (travel / dwell per step, per kind of animation). Defaults to
   * the booth's original timing; the pocket app passes its calmer one.
   */
  timing?: EvolutionTiming;
}

/** Live `(prefers-reduced-motion: reduce)` match. */
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

function stepLabel(i: number, t: Messages['evolving']): string {
  return i <= 0 ? t.start : t.afterLayer(i);
}

export function EvolvingState({
  circuit,
  view,
  targets,
  targetState,
  n = 5,
  showKet = false,
  classPrefix,
  replayKey,
  onStep,
  timing = BOOTH_EVOLUTION_TIMING,
}: EvolvingStateProps) {
  const p = classPrefix;
  const t = useT().evolving;
  const reduced = usePrefersReducedMotion();

  // Column snapshots. Keyed on a structural signature so a genuine circuit
  // change re-triggers auto-play, but an identical circuit re-render does not.
  const circuitKey = useMemo(
    () =>
      [...circuit.gates]
        .map((g) => `${g.type}:${g.position}:${g.qubit ?? ''}:${g.control ?? ''}:${g.target ?? ''}`)
        .sort()
        .join('|'),
    [circuit],
  );
  const steps = useMemo<StateVector[]>(() => evolutionSteps(circuit), [circuitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastIndex = steps.length - 1;

  // Bloch: pick the display qubit from the FINAL state, then track that qubit's
  // reduced vector across every step (level-1 golf builds one qubit throughout).
  const blochQubit = useMemo(
    () => (view === 'bloch' ? bestBlochQubit(steps[lastIndex]) : 0),
    [view, steps, lastIndex],
  );
  const blochStepVectors = useMemo<BlochVector[]>(
    () => (view === 'bloch' ? steps.map((s) => blochVector(s, blochQubit)) : []),
    [view, steps, blochQubit],
  );

  // Animation position — a float in [0, lastIndex]. `pos` drives rendering;
  // `posRef` is the source of truth the rAF loop and nav read synchronously.
  const [pos, setPos] = useState(lastIndex);
  const posRef = useRef(lastIndex);
  const rafRef = useRef<number | null>(null);
  const animRef = useRef<{ from: number; to: number; start: number; pace: EvolutionPace } | null>(null);

  const setPosBoth = useCallback((v: number) => {
    posRef.current = v;
    setPos(v);
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    animRef.current = null;
  }, []);

  const animateTo = useCallback(
    (goal: number, from: number, pace: EvolutionPace) => {
      stop();
      const clamped = Math.max(0, Math.min(lastIndex, goal));
      if (reduced || from === clamped || typeof requestAnimationFrame === 'undefined') {
        setPosBoth(clamped);
        return;
      }
      animRef.current = { from, to: clamped, start: performance.now(), pace };
      setPosBoth(from);
      const tick = (now: number) => {
        const a = animRef.current;
        if (!a) return;
        // Travel, dwell on the step reached, travel on… (see `paceProgress`).
        const dist = Math.abs(a.to - a.from);
        const done = paceProgress(now - a.start, dist, a.pace);
        setPosBoth(a.from + Math.sign(a.to - a.from) * done);
        if (done < dist) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          setPosBoth(a.to);
          animRef.current = null;
          rafRef.current = null;
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [lastIndex, reduced, setPosBoth, stop],
  );

  // The explicit replays (↻, holing in) — the calm `replay` pace from the start.
  const replay = useCallback(() => animateTo(lastIndex, 0, timing.replay), [animateTo, lastIndex, timing]);
  // Manual stepping (‹ ›, dots): a short glide, no dwell.
  const stepTo = useCallback(
    (goal: number) => animateTo(goal, posRef.current, { travelMs: timing.stepMs, dwellMs: 0 }),
    [animateTo, timing],
  );

  // Auto-play on every circuit change, at the `live` pace (or jump straight to
  // the final state under reduced-motion). `liveFrom: 'start'` replays from the
  // start state; `'change'` starts just before the first step the change
  // altered (appending a gate animates only the new step) and simply lands on
  // the final state when nothing before it changed (a trailing column removed).
  // `before` = the evolution before the current circuit (kept per key, so a
  // StrictMode re-run of this effect compares against the same predecessor).
  const seenRef = useRef<{ key: string; steps: StateVector[]; before: StateVector[] | null } | null>(null);
  useEffect(() => {
    const seen = seenRef.current;
    const prev = seen?.key === circuitKey ? seen.before : (seen?.steps ?? null);
    seenRef.current = { key: circuitKey, steps, before: prev };
    let from = 0;
    if (timing.liveFrom === 'change' && prev) {
      const changed = firstChangedStep(prev, steps);
      from = changed === null ? lastIndex : changed - 1;
    }
    animateTo(lastIndex, from, timing.live);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuitKey]);

  // An explicit replay (golf: the hole just holed in) — once per new key.
  useEffect(() => {
    if (replayKey === undefined) return;
    replay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayKey]);

  useEffect(() => stop, [stop]);

  // Current segment + eased fraction. `pos` in [seg, seg+1] tweens step[seg] →
  // step[seg+1]; at the final step frac = 1 lands exactly on the real state.
  const seg = Math.max(0, Math.min(lastIndex - 1, Math.floor(pos)));
  const eased = easeInOutCubic(pos - seg);
  const visibleStep = Math.max(0, Math.min(lastIndex, Math.round(pos)));

  // Report the visible step (rounded, so once per step, not per frame).
  const columns = useMemo(() => occupiedColumns(circuit), [circuitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  useEffect(() => {
    onStepRef.current?.({
      index: visibleStep,
      last: lastIndex,
      column: visibleStep > 0 ? (columns[visibleStep - 1] ?? null) : null,
    });
  }, [visibleStep, lastIndex, columns]);

  const sv = useMemo<StateVector>(() => {
    if (lastIndex === 0) return steps[0];
    if (view === 'bloch') {
      const v = slerpBloch(blochStepVectors[seg], blochStepVectors[seg + 1], eased);
      return blochToStatevector(v, blochQubit);
    }
    return interpolateStatevector(steps[seg], steps[seg + 1], eased);
  }, [view, steps, blochStepVectors, blochQubit, seg, eased, lastIndex]);

  // ---- roll-the-ball travelers (#57) -------------------------------------
  // The transport map is computed ONCE per circuit (all segments), never per
  // frame; only the cheap placement below runs on every rAF tick.
  const qsphere = view === 'qsphere';
  const edgesBySegment = useMemo(
    () => (qsphere && !reduced && lastIndex > 0 ? transportEdges(circuit, steps) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [circuitKey, qsphere, reduced, lastIndex],
  );
  const nodePos = useMemo(() => {
    const m = new Map<number, Vec3>();
    for (const node of layout(n)) m.set(node.index, node.pos);
    return m;
  }, [n]);

  const travelers = useMemo<QTraveler[]>(() => {
    // sin(π·t): a ball fades in as it leaves and out as it lands, so it never
    // double-draws with the source/destination node it overlaps at the ends.
    // Below FADE_EPS nothing is visible — and at rest (eased exactly 0 or 1,
    // where sin() is 0 up to float noise) no traveler is emitted at all.
    const fade = Math.sin(Math.PI * eased);
    const edges = edgesBySegment[seg];
    if (!edges || fade <= FADE_EPS) return [];
    const out: QTraveler[] = [];
    for (const e of edges) {
      // Mass that stays put is already the base node cross-fade's job.
      if (e.from === e.to) continue;
      const a = nodePos.get(e.from);
      const b = nodePos.get(e.to);
      if (!a || !b) continue; // outside the displayed 2^n lattice
      const pos = surfacePath(a, b, eased);
      out.push({
        ...pos,
        radius: nodeRadius(e.weight),
        hue: lerpHue(e.fromHue, e.toHue, eased),
        opacity: fade,
      });
    }
    return out;
  }, [edgesBySegment, seg, eased, nodePos]);

  // Level-1 flag: the hole's own target on the Bloch sphere. The canonical
  // target lives on qubit 0 (holeTargetState builds on the lowest qubits);
  // undefined outside golf keeps BlochView's legacy |+> flag.
  const blochTarget = useMemo(
    () => (view === 'bloch' && targetState ? blochVector(targetState, 0) : undefined),
    [view, targetState],
  );

  // Which TARGET terms the live state does not match yet — magnitude off, or
  // (the killer that hides in plain sight) a differing relative phase like a
  // missed − sign. Reference-aligned via basisVisuals so global phase never
  // trips it. Cheap (2·2^n entries) and re-derived per animation frame.
  const ketDiff = useMemo<ReadonlySet<number> | undefined>(() => {
    if (!showKet || !targetState) return undefined;
    const dim = 1 << n;
    const live = basisVisuals(sv, dim);
    const goal = basisVisuals(targetState, dim);
    const out = new Set<number>();
    for (let i = 0; i < dim; i++) {
      const tp = goal[i]?.prob ?? 0;
      if (tp <= 1e-6) continue; // only terms the target line shows
      const lp = live[i]?.prob ?? 0;
      const dPhase = Math.abs((((goal[i].phaseDeg - (live[i]?.phaseDeg ?? 0)) % 360) + 540) % 360 - 180);
      if (Math.abs(tp - lp) > 0.01 || (lp > 1e-6 && dPhase > 10)) out.add(i);
    }
    return out;
  }, [showKet, targetState, sv, n]);

  const showScrubber = lastIndex > 0;

  return (
    <div className={`${p}-evo`}>
      {/* Name what the visitor is looking at — a Bloch sphere (one qubit) and
          a Q-sphere (many) read identically to a newcomer. */}
      <span className={`${p}-view-label`}>
        {view === 'bloch' ? t.bloch : t.qsphere}
      </span>
      {view === 'bloch' ? (
        <BlochView statevector={sv} qubit={blochQubit} target={blochTarget} classPrefix={p} />
      ) : (
        <QSphereView
          statevector={sv}
          targets={targets}
          targetState={targetState}
          travelers={travelers}
          n={n}
          classPrefix={p}
        />
      )}
      {/* The notation is fed the ANIMATED `sv`, so it moves with the balls. */}
      {showKet && (
        <KetDisplay statevector={sv} n={n} classPrefix={p} label={targetState ? t.state : undefined} maxTerms={16} />
      )}
      {/* The goal, clearly labelled right under the live state (Jan: the target
          must be readable next to the actual state, not only as sphere ghosts). */}
      {showKet && targetState && (
        <KetDisplay
          statevector={targetState}
          n={n}
          classPrefix={p}
          label={t.target}
          highlight={ketDiff}
          maxTerms={16}
        />
      )}
      {showScrubber && (
        <div className={`${p}-evo-scrubber`} role="group" aria-label={t.stepsAria}>
          <button
            type="button"
            className={`${p}-evo-replay`}
            aria-label={t.replay}
            onClick={replay}
          >
            ↻
          </button>
          <button
            type="button"
            className={`${p}-evo-nav`}
            aria-label={t.prev}
            disabled={visibleStep <= 0}
            onClick={() => stepTo(Math.round(posRef.current) - 1)}
          >
            ‹
          </button>
          <div className={`${p}-evo-dots`}>
            {steps.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`${p}-evo-dot${i === visibleStep ? ` ${p}-evo-dot--active` : ''}`}
                aria-label={t.goTo(stepLabel(i, t))}
                aria-current={i === visibleStep ? 'step' : undefined}
                onClick={() => stepTo(i)}
              />
            ))}
          </div>
          <button
            type="button"
            className={`${p}-evo-nav`}
            aria-label={t.next}
            disabled={visibleStep >= lastIndex}
            onClick={() => stepTo(Math.round(posRef.current) + 1)}
          >
            ›
          </button>
          <span className={`${p}-evo-label`}>{stepLabel(visibleStep, t)}</span>
        </div>
      )}
    </div>
  );
}

export default EvolvingState;
