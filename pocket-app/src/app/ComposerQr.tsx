/**
 * ComposerQr — a "QR" button beside the Transfer button (Task 37). Tap it and a
 * centered overlay shows a large QR encoding `composerUrl(qasm)` for the CURRENT
 * circuit: a visitor scans it and their circuit opens in the IBM Quantum
 * Composer on their own phone, zero typing. Nothing is sent to our host.
 *
 * The QR is live: while the overlay is open the physical table can keep
 * changing, and the code re-renders (debounced ~1 s — see composerQr.ts). Over-
 * long circuits (past the `?initial=` budget) can't be pre-loaded into a URL, so
 * the caption switches to point the visitor at the Transfer button + clipboard.
 *
 * Overlay conventions match the app's fullscreen viewer (pk- styling, tap-
 * outside / X / Escape to close).
 */
import { useCallback, useEffect, useState } from 'react';
import type { Circuit } from '@qamposer/react';
import { qasmForCircuit } from './qasm';
import { canTransfer, usedQubits, SIGN_IN_HINT } from './composerTransfer';
import { useComposerQr } from './composerQrCode';

const CAPTION =
  'Scan to open YOUR circuit in the IBM Quantum Composer — sign in (free) to run it on a real quantum computer';
const CAPTION_OVERLONG =
  'This circuit is too large to pack into a QR — use the Transfer button (it also copies the QASM to your clipboard) to open it in the IBM Quantum Composer.';
const DISCLAIMER = 'Independent project — not affiliated with IBM.';

export function ComposerQr({ circuit }: { circuit: Circuit }) {
  const [open, setOpen] = useState(false);
  const show = canTransfer(circuit);
  // Only compute QASM (and the QR) while the overlay is actually open.
  const qasm = open && show ? qasmForCircuit(circuit) : '';
  const { svg, plan } = useComposerQr(qasm, open && show);
  // A 5-qubit circuit opens fine but needs a sign-in to SIMULATE on the anon
  // Composer (tops out at 4) — surfaced only when the circuit is pre-loadable.
  const usesAll5 = qasm !== '' && !plan.overLong && usedQubits(qasm) === 5;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!show) return null;

  return (
    <>
      <button
        type="button"
        className="pk-qr-btn"
        onClick={() => setOpen(true)}
        aria-label="Show a QR code for your circuit"
        title="QR — open your circuit in the IBM Quantum Composer"
      >
        <span className="pk-qr-glyph" aria-hidden="true">
          ▦
        </span>
        QR
      </button>

      {open && (
        <div
          className="pk-qr-overlay"
          role="dialog"
          aria-label="QR code — open your circuit in the IBM Quantum Composer"
          onClick={close}
        >
          <div className="pk-qr-card" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="pk-qr-close"
              aria-label="Close"
              onClick={close}
            >
              ✕
            </button>
            <div
              className="pk-qr-code"
              // qrcode emits a self-contained SVG string; safe, locally generated.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <p className="pk-qr-caption">{plan.overLong ? CAPTION_OVERLONG : CAPTION}</p>
            {usesAll5 && <p className="pk-qr-disclaimer">{SIGN_IN_HINT}</p>}
            <p className="pk-qr-disclaimer">{DISCLAIMER}</p>
          </div>
        </div>
      )}
    </>
  );
}

export default ComposerQr;
