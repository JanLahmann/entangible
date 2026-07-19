/**
 * ComposerHandoff — the sidebar "take it home" action group (docs/design.md,
 * "Take it home"). One place that stacks the three IBM-Composer affordances so
 * App mounts them together in both the standalone and booth-viewer sidebars:
 *
 *   - Transfer to IBM Composer — one-shot open + clipboard copy (composerTransfer).
 *   - Live Composer            — a tab that FOLLOWS the table (Task 36, composerSync).
 *   - QR                       — scan YOUR circuit onto your phone (Task 37, ComposerQr).
 *
 * All three self-gate on a non-empty circuit, so the group is empty (renders
 * nothing) until the visitor has placed at least one tile.
 */
import type { Circuit } from '@qamposer/react';
import { canTransfer, usedQubits, SIGN_IN_HINT } from './composerTransfer';
import { qasmForCircuit } from './qasm';
import { TransferButton } from './TransferButton';
import { LiveComposerButton } from './LiveComposerButton';
import { ComposerQr } from './ComposerQr';

export function ComposerHandoff({
  circuit,
  onToast,
}: {
  circuit: Circuit;
  onToast: (text: string) => void;
}) {
  if (!canTransfer(circuit)) return null;
  // The recognized board is always 5 wires; the Composer only simulates ≤4 for
  // an anonymous visitor, so flag it when the circuit actually touches all five.
  const usesAll5 = usedQubits(qasmForCircuit(circuit)) === 5;
  return (
    <div className="pk-composer-handoff">
      <TransferButton circuit={circuit} onToast={onToast} />
      <div className="pk-composer-actions">
        <LiveComposerButton circuit={circuit} onToast={onToast} />
        <ComposerQr circuit={circuit} />
      </div>
      {usesAll5 && <p className="pk-transfer-note">{SIGN_IN_HINT}</p>}
    </div>
  );
}

export default ComposerHandoff;
