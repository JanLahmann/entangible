/**
 * Client-side QR of the Composer URL for the current circuit (Task 37, sibling
 * of composerTransfer.ts). A visitor scans it to open THEIR circuit in the IBM
 * Quantum Composer with zero typing — the phone never talks to our host, so
 * this is a pure take-home surface (viewer policy untouched).
 *
 * The QR payload is exactly `composerUrl(qasm)` (the same verified `?initial=`
 * URL the Transfer button opens — see composerTransfer.ts). This module owns
 * the two decisions that make the scan reliable and the pixels legible:
 *
 *   - CAPACITY / ERROR-CORRECTION: shorter URLs get level M (more redundancy,
 *     easier scans across a booth); longer ones drop to L to keep the module
 *     count — and therefore the printed/on-screen density — sane. The 1800-char
 *     threshold sits comfortably above a typical 5-qubit circuit (Bell ≈ 240,
 *     GHZ-5 ≈ 269 chars) yet below the point where an M-level code gets too fine
 *     to scan on a phone screen.
 *   - OVER-LONG FALLBACK: when a circuit is so large that `composerUrl` gives up
 *     and returns the bare COMPOSER_BASE (its 7500-char budget), the QR would no
 *     longer carry the circuit. We surface that (`overLong`) so the UI can swap
 *     the caption to "use the Transfer button + clipboard instead".
 *
 * The QR itself is rendered as an SVG string by the `qrcode` package's pure-JS
 * `toString` renderer (no <canvas>, so it works in jsdom tests too).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { COMPOSER_BASE, composerUrl } from './composerTransfer';

/** URLs up to this length use the sturdier level M; longer ones fall to L. */
export const QR_EC_M_MAX_CHARS = 1800;

/** Debounce for re-rendering the QR while the live table keeps changing. */
export const QR_DEBOUNCE_MS = 1000;

export interface QrPlan {
  /** The exact payload encoded — always equal to `composerUrl(qasm)`. */
  readonly url: string;
  readonly ecLevel: 'M' | 'L';
  /** The circuit was too big to pre-load; `url` is the bare Composer. */
  readonly overLong: boolean;
}

/**
 * Decide the QR payload + error-correction level for a circuit's QASM (or `''`
 * for an empty board). Pure — the single testable seam for the capacity guard.
 */
export function planComposerQr(qasm: string): QrPlan {
  const url = composerUrl(qasm);
  const overLong = qasm !== '' && url === COMPOSER_BASE;
  const ecLevel = url.length <= QR_EC_M_MAX_CHARS ? 'M' : 'L';
  return { url, ecLevel, overLong };
}

/** Render a URL to an SVG-markup QR string (pure JS; canvas-free). The
 *  `qrcode` library is its own chunk, fetched the first time a QR is drawn
 *  (code splitting) — callers already wait on this promise. */
export async function renderQrSvg(url: string, ecLevel: 'M' | 'L'): Promise<string> {
  const { default: QRCode } = await import('qrcode');
  return QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: ecLevel,
    margin: 2,
  });
}

/**
 * React hook: keep an SVG QR in sync with `qasm` while `active`. The first
 * render after activation is immediate (so opening the overlay shows the code at
 * once); subsequent changes — the live table shifting under an open overlay —
 * are debounced by `debounceMs` so a mid-build burst doesn't thrash the QR.
 * Returns the current SVG string (`''` until the first render resolves) and the
 * plan (payload + EC level + over-long flag) for captioning.
 */
export function useComposerQr(
  qasm: string,
  active: boolean,
  debounceMs = QR_DEBOUNCE_MS,
): { svg: string; plan: QrPlan } {
  const plan = useMemo(() => planComposerQr(qasm), [qasm]);
  const [svg, setSvg] = useState('');
  const firstRef = useRef(true);

  useEffect(() => {
    if (!active) {
      firstRef.current = true;
      setSvg('');
      return;
    }
    let cancelled = false;
    const run = () => {
      renderQrSvg(plan.url, plan.ecLevel)
        .then((next) => {
          if (!cancelled) setSvg(next);
        })
        .catch(() => {
          /* leave the previous QR in place on a render failure */
        });
    };
    if (firstRef.current) {
      firstRef.current = false;
      run();
      return () => {
        cancelled = true;
      };
    }
    const t = setTimeout(run, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [active, plan.url, plan.ecLevel, debounceMs]);

  return { svg, plan };
}

/**
 * React hook: return `value` only once it has stayed unchanged for `ms`; before
 * that (and whenever it changes) it returns the previous stable value. Used by
 * the kiosk card so the take-home QR appears only for a SETTLED circuit and
 * doesn't flicker while a visitor is still placing tiles.
 */
export function useStable<T>(value: T, ms: number): T {
  const [stable, setStable] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setStable(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return stable;
}
