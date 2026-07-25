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
 *   - Auto-play: every circuit change replays from the start column through to
 *     the final state, so at rest the view always shows the CURRENT state (the
 *     old default behaviour is preserved — the animation just lands there).
 *   - Scrubber: replay + prev/next + step dots to replay / inspect any column,
 *     with a "start" / "after column N" label. Unobtrusive; hidden when the
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
import { evolutionSteps, lerpHue, surfacePath, transportEdges } from '@quantum/evolution';
import { layout, type Vec3 } from '@quantum/qsphere';
import { bestBlochQubit, blochVector, type BlochVector } from '@quantum/bloch';
import type { StateVector } from '@quantum/statevector';
import { KetDisplay } from './KetDisplay';
import { basisVisuals } from '@quantum/qsphere';
import {
  easeInOutCubic,
  interpolateStatevector,
  slerpBloch,
  blochToStatevector,
} from './evolutionAnimation';

/** Per-column transition duration (ms) — within the 400–600 ms spec window. */
const PER_STEP_MS = 500;
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

function stepLabel(i: number): string {
  return i <= 0 ? 'start' : `after column ${i}`;
}

export function EvolvingState({
  circuit,
  view,
  targets,
  targetState,
  n = 5,
  showKet = false,
  classPrefix,
}: EvolvingStateProps) {
  const p = classPrefix;
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
  const animRef = useRef<{ from: number; to: number; start: number; dur: number } | null>(null);

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
    (goal: number, from: number = posRef.current) => {
      stop();
      const clamped = Math.max(0, Math.min(lastIndex, goal));
      if (reduced || from === clamped || typeof requestAnimationFrame === 'undefined') {
        setPosBoth(clamped);
        return;
      }
      const dist = Math.abs(clamped - from);
      animRef.current = { from, to: clamped, start: performance.now(), dur: PER_STEP_MS * dist };
      setPosBoth(from);
      const tick = (now: number) => {
        const a = animRef.current;
        if (!a) return;
        const raw = a.dur <= 0 ? 1 : Math.min(1, (now - a.start) / a.dur);
        setPosBoth(a.from + (a.to - a.from) * raw);
        if (raw < 1) {
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

  // Auto-play on every circuit change: replay from the start through the final
  // state (or jump straight there under reduced-motion).
  useEffect(() => {
    animateTo(lastIndex, 0);
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuitKey]);

  useEffect(() => stop, [stop]);

  // Current segment + eased fraction. `pos` in [seg, seg+1] tweens step[seg] →
  // step[seg+1]; at the final step frac = 1 lands exactly on the real state.
  const seg = Math.max(0, Math.min(lastIndex - 1, Math.floor(pos)));
  const eased = easeInOutCubic(pos - seg);
  const visibleStep = Math.max(0, Math.min(lastIndex, Math.round(pos)));

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
        <KetDisplay statevector={sv} n={n} classPrefix={p} label={targetState ? 'State' : undefined} maxTerms={16} />
      )}
      {/* The goal, clearly labelled right under the live state (Jan: the target
          must be readable next to the actual state, not only as sphere ghosts). */}
      {showKet && targetState && (
        <KetDisplay
          statevector={targetState}
          n={n}
          classPrefix={p}
          label="Target"
          highlight={ketDiff}
          maxTerms={16}
        />
      )}
      {showScrubber && (
        <div className={`${p}-evo-scrubber`} role="group" aria-label="State evolution steps">
          <button
            type="button"
            className={`${p}-evo-replay`}
            aria-label="Replay animation"
            onClick={() => animateTo(lastIndex, 0)}
          >
            ↻
          </button>
          <button
            type="button"
            className={`${p}-evo-nav`}
            aria-label="Previous step"
            disabled={visibleStep <= 0}
            onClick={() => animateTo(Math.round(posRef.current) - 1)}
          >
            ‹
          </button>
          <div className={`${p}-evo-dots`}>
            {steps.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`${p}-evo-dot${i === visibleStep ? ` ${p}-evo-dot--active` : ''}`}
                aria-label={`Go to ${stepLabel(i)}`}
                aria-current={i === visibleStep ? 'step' : undefined}
                onClick={() => animateTo(i)}
              />
            ))}
          </div>
          <button
            type="button"
            className={`${p}-evo-nav`}
            aria-label="Next step"
            disabled={visibleStep >= lastIndex}
            onClick={() => animateTo(Math.round(posRef.current) + 1)}
          >
            ›
          </button>
          <span className={`${p}-evo-label`}>{stepLabel(visibleStep)}</span>
        </div>
      )}
    </div>
  );
}

export default EvolvingState;
