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
 *   - Scrubber: prev/next + step dots to replay / inspect any column, with a
 *     "start" / "after column N" label. Unobtrusive; hidden when the board is
 *     empty (a single snapshot has nothing to step through).
 *   - prefers-reduced-motion: no tweening — steps jump instantly; the scrubber
 *     still works.
 *
 * Structural only: every element carries a `${classPrefix}-evo-*` class so the
 * pocket (`pk-`) and booth (`bo-`) skins style it, exactly like the other shared
 * components.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Circuit } from '@qamposer/react';
import { QSphereView } from '@quantum/QSphereView';
import { BlochView } from '@quantum/BlochView';
import { evolutionSteps } from '@quantum/evolution';
import { bestBlochQubit, blochVector, type BlochVector } from '@quantum/bloch';
import type { StateVector } from '@quantum/statevector';
import {
  easeInOutCubic,
  interpolateStatevector,
  slerpBloch,
  blochToStatevector,
} from './evolutionAnimation';

/** Per-column transition duration (ms) — within the 400–600 ms spec window. */
const PER_STEP_MS = 500;

export interface EvolvingStateProps {
  /** The live golf circuit. */
  circuit: Circuit;
  /** Which view the current level plays on. */
  view: 'bloch' | 'qsphere';
  /** Basis indices to outline as targets (Q-sphere golf). */
  targets?: ReadonlySet<number>;
  /** Qubit count of the displayed space (Q-sphere). */
  n?: number;
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

export function EvolvingState({ circuit, view, targets, n = 5, classPrefix }: EvolvingStateProps) {
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

  const showScrubber = lastIndex > 0;

  return (
    <div className={`${p}-evo`}>
      {view === 'bloch' ? (
        <BlochView statevector={sv} qubit={blochQubit} classPrefix={p} />
      ) : (
        <QSphereView statevector={sv} targets={targets} n={n} classPrefix={p} />
      )}
      {showScrubber && (
        <div className={`${p}-evo-scrubber`} role="group" aria-label="State evolution steps">
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
