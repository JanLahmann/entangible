/**
 * Kiosk `/ws/state` binding — the big-screen booth skin's read-only viewer
 * socket (Entangible One, phase U3; the former display-app `booth-screen`
 * socket now living in the unified pocket app).
 *
 * VIEWER POLICY (docs/design.md — the visitor QR is view-only): the kiosk is a
 * Display-role VIEWER. This socket is constructed WITHOUT an operator key, so
 * its `hello` is a plain `{role:'display'}` and the host silently ignores any
 * control message. `KioskView` never calls `sendMessage`, and this module is
 * the only socket the kiosk touches — so the kiosk can never emit `select_*`.
 * (The operator-aware socket lives in `../debug/debugSocket`, the sole surface
 * that sends `select_*`.)
 *
 * A module singleton so the socket opens once and every kiosk consumer reads
 * the same immutable snapshot via `useSyncExternalStore` (mirrors the display
 * app's `useEntangibleState`). The URL defaults to same-origin `/ws/state`,
 * which is exactly what the host serves at `/?kiosk`.
 */
import { useSyncExternalStore } from 'react';
import { StateSocket, type StateSnapshot } from '@shared/ws/stateSocket';

let singleton: StateSocket | null = null;

/** Lazily create the shared kiosk (viewer) socket. No operator key, ever. */
export function getKioskSocket(): StateSocket {
  if (!singleton) {
    singleton = new StateSocket({
      role: 'display',
      client: 'kiosk-screen',
      // Deliberately NO operatorKey: the kiosk is a read-only viewer.
    });
  }
  return singleton;
}

const SERVER_SNAPSHOT: StateSnapshot = {
  connectionState: 'connecting',
  lastSeq: null,
};

/**
 * Subscribe a kiosk component to the live booth state. Starts the socket on the
 * first subscription and returns the latest immutable snapshot.
 */
export function useKioskState(): StateSnapshot {
  const socket = getKioskSocket();
  return useSyncExternalStore(
    (onChange) => {
      socket.start();
      return socket.subscribe(onChange);
    },
    () => socket.getSnapshot(),
    () => SERVER_SNAPSHOT,
  );
}
