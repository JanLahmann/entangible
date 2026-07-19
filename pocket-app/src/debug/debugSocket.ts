/**
 * Debug `/ws/state` binding — the OPERATOR socket for the staff `/debug` surface
 * (Entangible One, phase U3; the former display-app operator-aware
 * `getStateSocket` singleton, now living in the unified pocket app).
 *
 * VIEWER-POLICY BOUNDARY (docs/design.md): this is the ONE socket in the pocket
 * app that authenticates as an operator and can therefore have its `select_*`
 * controls honored by the host. It carries the stored operator key (from the
 * staff `/debug?key=…` QR or a keyed prompt); on the open kiosk/viewer surfaces
 * there is no such socket. Keeping the operator socket isolated in this module —
 * and the `select_*` sends inside `DebugView`'s Layout card — is what preserves
 * the guarantee "no `select_*` from viewer surfaces" (enforced by
 * `tests/policy.test.ts`).
 */
import { useSyncExternalStore } from 'react';
import { StateSocket, type StateSnapshot } from '@shared/ws/stateSocket';
import { getOperatorKey } from '@shared/ws/operatorKey';

let singleton: StateSocket | null = null;

/** Lazily create (and start) the shared debug operator socket. */
export function getDebugSocket(): StateSocket {
  if (!singleton) {
    // Carries the operator key when one is stored (the staff QR opens
    // /debug?key=… → localStorage), so the Layout card's select_* controls are
    // honored; a keyless visit stays a plain viewer (and the prompt appears).
    singleton = new StateSocket({
      role: 'display',
      client: 'debug-screen',
      operatorKey: () => getOperatorKey(),
    });
  }
  return singleton;
}

const SERVER_SNAPSHOT: StateSnapshot = {
  connectionState: 'connecting',
  lastSeq: null,
};

/** Subscribe a /debug component to the live state (operator socket). */
export function useDebugState(): StateSnapshot {
  const socket = getDebugSocket();
  return useSyncExternalStore(
    (onChange) => {
      socket.start();
      return socket.subscribe(onChange);
    },
    () => socket.getSnapshot(),
    () => SERVER_SNAPSHOT,
  );
}
