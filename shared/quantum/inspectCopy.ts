/**
 * Tap-to-inspect copy helpers — the framework-free logic shared by every
 * surface that lets a visitor tap a gate or an outcome column for a
 * one-sentence explanation (booth big-screen + pocket hand-held).
 *
 * These are pure (no DOM, no URL, no React) so they unit-test in isolation and
 * both apps import them from here. The DOM-delegation plumbing that turns a tap
 * into "which gate / which outcome" lives per-app in its `TouchInspector.tsx`;
 * the booth's `booth/touch.ts` re-exports these for its own callers, and the
 * `?touch` enable decision stays booth-local (touch is always on in pocket).
 */
import type { Gate } from '@qamposer/react';
import { en, type Messages } from '@shared/i18n/en';

/** How long a popover stays before auto-dismissing. */
export const POPOVER_MS = 6000;

/** Format a rotation parameter (radians) as a fraction of π, e.g. `0.50π`. */
export function formatAngle(parameter: number | undefined): string {
  const p = parameter ?? 0;
  return `${(p / Math.PI).toFixed(2)}π`;
}

const CLOSE = 1e-3;
function near(a: number, b: number): boolean {
  return Math.abs(a - b) < CLOSE;
}

/**
 * One friendly sentence explaining what a gate does, per {@link Gate} type.
 * Covers the library `GateType`s; the printed S and T tiles reach the display as
 * `RZ` with a fixed angle (π/2, π/4), which we name back for the visitor, while
 * the on-screen palette drops native `S`/`T` gates — both get the same sentence.
 */
export function gateInspectCopy(gate: Gate, t: Messages = en): string {
  const m = t.inspect;
  const q = `q${gate.qubit ?? 0}`;
  switch (gate.type) {
    case 'H':
      return m.h(q);
    case 'X':
      return m.x(q);
    case 'Y':
      return m.y(q);
    case 'Z':
      return m.z(q);
    case 'S':
      return m.s(q);
    case 'T':
      return m.t(q);
    case 'CNOT':
      return m.cnot(`q${gate.control ?? 0}`, `q${gate.target ?? 0}`);
    case 'RX':
      return m.rx(q, formatAngle(gate.parameter));
    case 'RY':
      return m.ry(q, formatAngle(gate.parameter));
    case 'RZ': {
      const p = gate.parameter ?? 0;
      if (near(p, Math.PI / 2)) return m.sAsRz(q, formatAngle(p));
      if (near(p, Math.PI / 4)) return m.tAsRz(q, formatAngle(p));
      return m.rz(q, formatAngle(p));
    }
    default:
      // Forward-compatible: an unknown gate type still gets a sane sentence.
      return m.other(q);
  }
}

/** Percentage phrasing that never reads "0%" for a non-zero outcome. */
function percentPhrase(prob: number): string {
  const pct = prob * 100;
  if (pct >= 0.95) return `${Math.round(pct)}%`;
  if (pct > 0) return '<1%';
  return '0%';
}

/**
 * What a tapped outcome column means. `bits` is one char per DISPLAYED row,
 * leftmost = q0, so bit `i` is qubit `i` directly (the histogram marginalizes
 * onto the first D physical rows). Example:
 *   ("110", 0.5) → "110: q0=1, q1=1, q2=0 — seen in 50% of runs".
 */
export function outcomeInspectCopy(bits: string, prob: number, t: Messages = en): string {
  const pairs = bits.split('').map((b, i) => `q${i}=${b}`);
  return t.inspect.outcome(bits, pairs.join(', '), percentPhrase(prob));
}
