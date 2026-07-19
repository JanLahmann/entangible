/**
 * ComposerQrCard — the kiosk sidebar "Your circuit → IBM Composer" card (Task
 * 37, kiosk surface). A compact live QR that a booth visitor scans to open the
 * circuit currently on the table in the IBM Quantum Composer on their own phone
 * — a zero-typing take-home even for someone who never connected as a viewer.
 *
 * It is deliberately quiet so it doesn't fight the footer visitor QR: that one
 * is "follow along" (connect as a viewer); THIS one is "your circuit → Composer"
 * (scan the finished circuit onto your phone). It appears only for a SETTLED,
 * non-empty circuit (debounced via `useStable`) and hides on an empty board.
 *
 * The encoded payload is exactly `composerUrl(qasm)` — same verified `?initial=`
 * URL as everywhere else (composerTransfer.ts); the QR is a canvas-free SVG.
 */
import type { Circuit } from '@qamposer/react';
import { canTransfer, usedQubits, SIGN_IN_HINT } from '../app/composerTransfer';
import { qasmForCircuit } from '../app/qasm';
import { QR_DEBOUNCE_MS, useComposerQr, useStable } from '../app/composerQrCode';

export function ComposerQrCard({
  circuit,
  qasm,
}: {
  circuit: Circuit;
  /** Host-supplied QASM (authoritative); falls back to a local emission. */
  qasm?: string | undefined;
}) {
  // Empty board → '' sentinel; otherwise prefer the host's QASM.
  const live = canTransfer(circuit) ? qasm ?? qasmForCircuit(circuit) : '';
  // Only surface a code once the circuit has settled (no flicker mid-build).
  const stable = useStable(live, QR_DEBOUNCE_MS);
  const active = stable !== '';
  const { svg } = useComposerQr(stable, active);
  // Reuse the card's existing label text slot for the 5-qubit sign-in hint.
  const usesAll5 = active && usedQubits(stable) === 5;

  if (!active || !svg) return null;

  return (
    <div className="bo-composer-qr">
      <div className="bo-label">Your circuit → IBM Composer</div>
      <div className="bo-composer-qr__body">
        <div
          className="bo-composer-qr__code"
          // qrcode emits a self-contained SVG string; safe, locally generated.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <span className="bo-composer-qr__label">
          Scan to open this circuit in the IBM Quantum Composer — independent
          project, not affiliated with IBM.
          {usesAll5 && ` ${SIGN_IN_HINT}`}
        </span>
      </div>
    </div>
  );
}

export default ComposerQrCard;
