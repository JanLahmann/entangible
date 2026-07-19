/**
 * boothLink — a tiny external store for the ACTIVE booth connection target
 * (Entangible One, phase U1b).
 *
 * `null` means standalone (local pipeline). A non-null `url` is the normalized
 * `/ws/state` endpoint the pocket viewer is connected to. Both `App` (which
 * owns the `BoothSocketSource` lifecycle) and the settings drawer's Booth
 * section read/write this store, so the connect/disconnect controls stay
 * decoupled from the render tree — the same pattern as `settingsStore`.
 */
import { useSyncExternalStore } from 'react';
import { normalizeBoothUrl } from '../sources/boothUrl';

export interface BoothLinkState {
  /** Normalized `ws(s)://…/ws/state` URL, or `null` when standalone. */
  readonly url: string | null;
}

type Listener = () => void;

let state: BoothLinkState = { url: null };
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export const boothLink = {
  get: (): BoothLinkState => state,
  /**
   * Connect to a booth. `raw` is normalized to a `/ws/state` URL; returns
   * `false` (and does nothing) if it cannot be. `raw` may also be an already
   * normalized URL (e.g. from the visitor-QR auto-connect).
   */
  connect(raw: string): boolean {
    const url = normalizeBoothUrl(raw);
    if (!url) return false;
    if (state.url === url) return true;
    state = { url };
    emit();
    return true;
  },
  disconnect(): void {
    if (state.url !== null) {
      state = { url: null };
      emit();
    }
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useBoothLink(): BoothLinkState {
  return useSyncExternalStore(boothLink.subscribe, boothLink.get, boothLink.get);
}
