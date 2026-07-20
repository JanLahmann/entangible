/**
 * Kiosk `/ws/state` binding — the big-screen booth skin's viewer socket
 * (Entangible One, phase U3; QN2 serve provisioning).
 *
 * STANDING INVARIANT (docs/quantina.md decision 6):
 *  - a KEYLESS kiosk is a read-only VIEWER — its `hello` is a plain
 *    `{role:'display'}` and the host silently ignores any control message. This
 *    is the default (the visitor QR is view-only).
 *  - a PROVISIONED kiosk (launched with `?key=<operator-token>` in its URL, e.g.
 *    the booth machine's `start-kiosk.sh` appends it) authenticates as an
 *    OPERATOR (`{role:'operator', client:'kiosk', key}` — the server promotes
 *    only staff roles) and gains a touch Serve button. Physical presence at the
 *    booth screen is the authorization; remote viewers can never serve.
 *
 * The resulting standing comes from the server's `hello_ack` (surfaced on the
 * snapshot as `operator`): only after the host confirms operator standing does
 * `kioskStanding` report `'operator'`. Serves are the ONLY control this socket
 * can carry, and they flow exclusively through `./serve` (`sendServe`) — pinned
 * by `tests/policy.test.ts`. `KioskView` never calls `sendMessage` directly.
 *
 * A module singleton so the socket opens once and every kiosk consumer reads
 * the same immutable snapshot via `useSyncExternalStore` (mirrors the display
 * app's `useEntangibleState`). The URL defaults to same-origin `/ws/state`,
 * which is exactly what the host serves at `/?kiosk`.
 */
import { useSyncExternalStore } from 'react';
import { StateSocket, type StateSnapshot } from '@shared/ws/stateSocket';
import { getOperatorKey } from '@shared/ws/operatorKey';

let singleton: StateSocket | null = null;

/**
 * Lazily create the shared kiosk socket. It resolves the operator key from the
 * launch URL (`?key=…`, persisted by the shared helper): present → an operator
 * `hello` (touch serve unlocked once the host acks); absent → a plain display
 * viewer, exactly as before ("keyless kiosk = viewer").
 */
export function getKioskSocket(): StateSocket {
  if (!singleton) {
    singleton = new StateSocket({
      role: 'display',
      client: 'kiosk',
      // QN2 (decision 6): a `?key=` in the launch URL promotes this socket to
      // operator standing (the StateSocket sends role 'operator' + key); a
      // keyless kiosk resolves to null → plain display hello, viewer standing.
      operatorKey: () => getOperatorKey(),
    });
  }
  return singleton;
}

/** This kiosk's resolved serving standing from the host's `hello_ack`. */
export type KioskStanding = 'viewer' | 'operator';

/**
 * Derive the kiosk's standing from a snapshot: `'operator'` only once the host
 * has acked operator standing (`snapshot.operator === true`), else `'viewer'`.
 * A keyless kiosk never authenticates, so it can never reach `'operator'`.
 */
export function kioskStanding(snapshot: StateSnapshot): KioskStanding {
  return snapshot.operator === true ? 'operator' : 'viewer';
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
