/**
 * "Transfer to IBM Composer" action row (docs/design.md, "Take it home").
 *
 * A single full-width primary-blue button in the sidebar, shown whenever a
 * circuit exists (≥1 gate), independent of which panels are toggled on. On tap
 * it generates the 5-qubit QASM locally, copies it to the clipboard and opens
 * IBM Quantum Composer in a new tab, then surfaces a toast via the shared
 * MessageStrip (`onToast` → App's `pushStrip`).
 */
import { useCallback } from 'react';
import type { Circuit } from '@qamposer/react';
import { qasmForCircuit } from './qasm';
import { canTransfer, transferToComposer } from './composerTransfer';
import { useT } from '@shared/i18n';

export function TransferButton({
  circuit,
  onToast,
}: {
  circuit: Circuit;
  onToast: (text: string) => void;
}) {
  const t = useT().composer;
  const onClick = useCallback(() => {
    const qasm = qasmForCircuit(circuit);
    // Fire-and-forget: the tab always opens; the toast reports the copy result
    // (worded in the visitor's language — `r.message` is the English one).
    void transferToComposer(qasm).then((r) => onToast(r.copied ? t.copied : t.noCopy));
  }, [circuit, onToast, t]);

  if (!canTransfer(circuit)) return null;

  return (
    <div className="pk-transfer">
      <button type="button" className="pk-transfer-btn" onClick={onClick}>
        <span className="pk-transfer-glyph" aria-hidden="true">
          ⚛
        </span>
        {t.transfer}
      </button>
      <p className="pk-transfer-note">{t.transferNote}</p>
    </div>
  );
}

export default TransferButton;
