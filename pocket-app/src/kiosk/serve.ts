/**
 * Kiosk serve send-site (docs/quantina.md decision 6) — the ONE kiosk-side
 * module that emits a `{type:'serve', …}` control message. `tests/policy.test.ts`
 * pins this: any `serve`/`select_*` send anywhere else on the viewer surfaces
 * fails the static scan.
 *
 * A provisioned kiosk samples where the simulation runs: `KioskView` draws the
 * outcome vector from the SAME `menuOutcomes` its menu shows (the live circuit +
 * the active `layout.noise` preset) via `cryptoRng`, then hands the drawn
 * bitstrings here. The kiosk does NOT reveal locally — it waits for the host's
 * `served` broadcast so every screen (kiosk + viewer phones) reveals in sync.
 *
 * `sendServe` is guarded on operator standing (the socket's own `hello_ack`):
 * a keyless viewer kiosk is a silent no-op, so a stray call can never leak a
 * serve onto the wire.
 */
import type { StateSocket } from '@shared/ws/stateSocket';
import type { ShotSource } from '@shared/menu/pack';

/**
 * Send a Quantina serve from the kiosk. No-op (returns `false`) unless the
 * socket has authenticated as an operator — physical presence at the booth
 * screen is the authorization. Returns whether the frame was sent.
 */
export function sendServe(
  socket: StateSocket,
  outcomes: string[],
  shotSource: ShotSource,
): boolean {
  // Operator standing is the gate: the host only honors serves from operators,
  // but we also refuse to emit one from a viewer socket at all.
  if (socket.getSnapshot().operator !== true) return false;
  return socket.send({ type: 'serve', outcomes, shotSource });
}
