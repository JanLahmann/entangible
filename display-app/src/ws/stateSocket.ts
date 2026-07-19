/**
 * Display-app binding of the neutral `/ws/state` client.
 *
 * The framework-agnostic `StateSocket` (reconnect + seq semantics) moved to
 * `shared/ws` (U1) so the pocket viewer can reuse it. This shim re-exports it
 * and keeps the display app's operator-aware singleton — the one seam that must
 * stay here, because `operatorKey.ts` (the staff credential) is display-app
 * only. Viewer surfaces (pocket) construct a keyless socket directly.
 */
export * from '@shared/ws/stateSocket';

import { StateSocket } from '@shared/ws/stateSocket';
import { getOperatorKey } from './operatorKey';

let singleton: StateSocket | null = null;

/** Lazily create (and start) the shared display-role socket. */
export function getStateSocket(): StateSocket {
  if (!singleton) {
    // Carries the operator key when one is stored (e.g. on `/debug`), so the
    // staff Layout controls are honored; on the open booth screen there is no
    // key and the socket stays a plain viewer.
    singleton = new StateSocket({
      role: 'display',
      client: 'booth-screen',
      operatorKey: () => getOperatorKey(),
    });
  }
  return singleton;
}
