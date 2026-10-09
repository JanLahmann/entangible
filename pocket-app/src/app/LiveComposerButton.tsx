/**
 * LiveComposerButton — the "Live Composer" toggle (Task 36 UI). OFF by default.
 *
 * Turning it ON opens a real IBM Quantum Composer tab that then FOLLOWS the
 * physical table: every settled circuit change re-navigates that one tab (the
 * named-target trick — see composerSync.ts). The first open MUST happen inside
 * this click handler so popup blockers let it through; after that a `useEffect`
 * feeds circuit changes to the sync engine. Turning it OFF stops syncing and
 * leaves the tab alone. Nothing about this survives a reload (a dead tab handle
 * across reloads is meaningless), so there is no settings field for it.
 *
 * Rendered next to the Transfer button in the sidebar (standalone + booth-viewer
 * roles — both have a live circuit; NOT the kiosk, which is unattended).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Circuit } from '@qamposer/react';
import { qasmForCircuit } from './qasm';
import { canTransfer } from './composerTransfer';
import { ComposerSync } from './composerSync';
import { useT } from '@shared/i18n';

/** QASM for a circuit, or `''` for an empty board (sync's empty sentinel). */
function syncQasm(circuit: Circuit): string {
  return canTransfer(circuit) ? qasmForCircuit(circuit) : '';
}

export function LiveComposerButton({
  circuit,
  onToast,
}: {
  circuit: Circuit;
  onToast: (text: string) => void;
}) {
  const t = useT().composer;
  const sync = useMemo(() => new ComposerSync(), []);
  const [on, setOn] = useState(false);

  // Feed settled circuit changes to the sync engine while it is active.
  useEffect(() => {
    if (!on) return;
    sync.update(syncQasm(circuit));
  }, [on, sync, circuit]);

  // Stop syncing if the component ever unmounts (role switch, etc.).
  useEffect(() => () => sync.stop(), [sync]);

  const toggle = useCallback(() => {
    if (sync.isActive) {
      sync.stop();
      setOn(false);
      return;
    }
    // First open happens in this user gesture (popup blockers).
    sync.start(syncQasm(circuit));
    setOn(true);
    onToast(t.syncEnabled);
  }, [sync, circuit, onToast, t]);

  if (!canTransfer(circuit)) return null;

  return (
    <button
      type="button"
      className={`pk-livesync ${on ? 'is-on' : ''}`}
      onClick={toggle}
      aria-pressed={on}
      title={on ? t.liveOnTitle : t.liveOffTitle}
    >
      <span className={`pk-livesync-dot ${on ? 'is-on' : ''}`} aria-hidden="true" />
      {on ? t.liveSyncing : t.live}
    </button>
  );
}

export default LiveComposerButton;
