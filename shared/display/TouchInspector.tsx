/**
 * TouchInspector — the tap-to-inspect layer, shared by both apps (SC2).
 *
 * A tap on a gate or an outcome column pops one plain-English sentence about it
 * (copy from `@quantum/inspectCopy`); one popover at a time, auto-dismissing
 * after {@link POPOVER_MS}. It NEVER mutates the circuit — the physical table is
 * the editor, and both apps render a controlled `CircuitEditor`, so a stray drag
 * no-ops and the next recognised frame re-asserts the circuit.
 *
 * It attaches ONE delegated `click` listener (click fires on tap but not while
 * scrolling/dragging, so it never fights the editor's scroll or a sphere's
 * drag-to-rotate) and resolves the tapped element to either a gate or an
 * outcome column:
 *   - Gate: the `@qamposer/react` editor renders each gate as a
 *     `.circuit-editor__gate` (single-qubit box) / `.circuit-editor__controlled`
 *     (the controlled family CNOT/CY/CZ/CH/CS/CT/CCX, drawn as control dot +
 *     line + target) child of
 *     `.circuit-editor__gates`, in `circuit.gates` order with no DOM id. We map
 *     the tapped element to its Gate by its index among those siblings — the
 *     circuit is controlled (never reordered) and the wire-trim transform keeps
 *     the same `gates` array, so DOM sibling index i is `circuit.gates[i]`.
 *   - Outcome: the histogram columns (`.${classPrefix}-h-col`) carry
 *     `data-bits` / `data-prob`.
 *
 * Per-app seams (both apps' pre-SC2 behaviour is preserved exactly):
 *   - `classPrefix` — outcome column selector `.${p}-h-col` and the popover
 *     class `${p}-inspect`.
 *   - `enabled` — the booth gates touch on `?touch=1` / a coarse pointer; pocket
 *     is always on (default true).
 *   - `aboveThreshold` / `halfMaxCap` / `edgeOffset` — the drop-below cutoff and
 *     the on-screen clamp (booth 140 / 220 / 12; pocket 120 / 180 / 10).
 *   - `dismissGuard` — an optional selector whose matches must NOT dismiss an
 *     open popover on an empty-space tap (pocket protects the camera + sphere
 *     views so pinch/rotate never closes a popover; the booth has none).
 */
import { useEffect, useRef, useState } from 'react';
import type { Circuit } from '@qamposer/react';
import { POPOVER_MS, gateInspectCopy, outcomeInspectCopy } from '@quantum/inspectCopy';

interface Popover {
  text: string;
  /** Anchor centre X (viewport px). */
  x: number;
  /** Anchor top / bottom edge the popover attaches to (viewport px). */
  y: number;
  /** Render below the anchor (true) or above it (false). */
  below: boolean;
  token: number;
}

/**
 * Gate copy for the gate at DOM sibling `index` (which equals its index in
 * `circuit.gates`), or null when the index is out of range. Pure — testable
 * without a DOM.
 */
export function gateInspectAt(circuit: Circuit, index: number): string | null {
  const gate = index >= 0 ? circuit.gates[index] : undefined;
  return gate ? gateInspectCopy(gate) : null;
}

/**
 * Outcome copy from a column's `data-bits` / `data-prob` attribute values, or
 * null when either is missing or `data-prob` is not a finite number. Pure.
 */
export function outcomeInspectFromAttrs(
  bits: string | null,
  probAttr: string | null,
): string | null {
  if (bits === null || probAttr === null) return null;
  const prob = Number(probAttr);
  if (!Number.isFinite(prob)) return null;
  return outcomeInspectCopy(bits, prob);
}

/** The editor's per-gate elements: a plain box, or a controlled-gate shape. */
export const GATE_ELEMENT_SELECTOR = '.circuit-editor__gate, .circuit-editor__controlled';

/** Resolve a tapped gate element to its Gate copy via sibling index order. */
function gateFromElement(el: Element, circuit: Circuit): string | null {
  const container = el.closest('.circuit-editor__gates');
  if (!container) return null; // preview / toolbar gate — not a real gate
  const siblings = Array.from(
    container.querySelectorAll(
      ':scope > .circuit-editor__gate, :scope > .circuit-editor__controlled',
    ),
  );
  return gateInspectAt(circuit, siblings.indexOf(el));
}

export function TouchInspector({
  circuit,
  classPrefix,
  enabled = true,
  inspectGates = true,
  aboveThreshold,
  halfMaxCap,
  edgeOffset,
  dismissGuard,
}: {
  circuit: Circuit;
  classPrefix: string;
  enabled?: boolean;
  /**
   * Whether taps on editor gates pop an inspect sentence. The pocket turns this
   * OFF in manual (build-on-screen) mode: there the editor is live, and a gate
   * tap must reach the editor's own selection toolbar (edit/delete) without an
   * info popover landing on top of it. Outcome-column popovers stay on.
   */
  inspectGates?: boolean;
  aboveThreshold: number;
  halfMaxCap: number;
  edgeOffset: number;
  dismissGuard?: string;
}) {
  const p = classPrefix;
  const circuitRef = useRef(circuit);
  circuitRef.current = circuit;

  const [popover, setPopover] = useState<Popover | null>(null);
  const timerRef = useRef<number | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const show = (text: string, rect: DOMRect) => {
      const below = rect.top < aboveThreshold; // not enough room above → drop below
      const token = ++tokenRef.current;
      setPopover({
        text,
        x: rect.left + rect.width / 2,
        y: below ? rect.bottom : rect.top,
        below,
        token,
      });
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        setPopover((cur) => (cur && cur.token === token ? null : cur));
      }, POPOVER_MS);
    };

    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;

      const gateEl = inspectGates ? target.closest(GATE_ELEMENT_SELECTOR) : null;
      if (gateEl) {
        const text = gateFromElement(gateEl, circuitRef.current);
        if (text) {
          show(text, gateEl.getBoundingClientRect());
          return;
        }
      }

      const colEl = target.closest(`.${p}-h-col`);
      if (colEl) {
        const text = outcomeInspectFromAttrs(
          colEl.getAttribute('data-bits'),
          colEl.getAttribute('data-prob'),
        );
        if (text) {
          show(text, colEl.getBoundingClientRect());
          return;
        }
      }

      // A tap on a guarded surface (e.g. the camera preview's pinch-zoom or a
      // sphere view's drag-to-rotate) must never dismiss an open popover;
      // anywhere else in the app an empty-space tap closes it.
      if (dismissGuard && target.closest(dismissGuard)) return;
      clearTimer();
      setPopover(null);
    };

    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      clearTimer();
    };
  }, [enabled, inspectGates, p, aboveThreshold, dismissGuard]);

  if (!popover) return null;

  // Clamp the centre so the popover stays on-screen.
  const halfMax = Math.min(halfMaxCap, window.innerWidth / 2 - edgeOffset);
  const x = Math.max(
    halfMax + edgeOffset,
    Math.min(window.innerWidth - halfMax - edgeOffset, popover.x),
  );

  return (
    <div
      className={`${p}-inspect ${popover.below ? 'is-below' : 'is-above'}`}
      role="status"
      style={{ left: `${x}px`, top: `${popover.y}px` }}
    >
      {popover.text}
    </div>
  );
}

export default TouchInspector;
