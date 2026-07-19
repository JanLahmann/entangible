/**
 * Camera-role helpers — pure, testable (Entangible One, phase U2).
 *
 * The pocket app's staff CAMERA role turns a phone into the booth's camera: it
 * streams JPEG frames to the host's `/ws/frames` and drives `select_camera
 * {kind:'push'}` on `/ws/state` as an authenticated operator (see
 * `CameraRoleSource`). This module holds the framework-free bits — the URL
 * trigger (`?connect=1&role=camera`, what the staff QR encodes), the offer
 * gating, and the `/ws/state` → `/ws/frames` URL derivation.
 *
 * OFFER GATING (design: "connected to a host, camera role selected"): the role
 * is offered ONLY when a booth host is known AND an operator key is present. A
 * plain viewer (no key) never sees the affordance — the camera role is
 * operator-gated.
 */

/**
 * Does the URL request the camera role? The staff QR encodes
 * `…/pocket?connect=1&role=camera&key=<token>`, so `?role=camera` is the
 * trigger (the `key` is consumed by the shared operator-key helper, which also
 * scrubs it from the address bar).
 */
export function roleRequested(search: string): 'camera' | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return params.get('role') === 'camera' ? 'camera' : null;
}

/**
 * Is the camera-role affordance offered here? True only when a booth host is
 * known (served by a host, or a manual booth URL is saved) AND an operator key
 * is present. Standalone (no host, no key) → false, so entangible.org shows no
 * new UI.
 */
export function cameraRoleOffered(opts: { hostKnown: boolean; hasKey: boolean }): boolean {
  return opts.hostKnown && opts.hasKey;
}

/**
 * Derive the `/ws/frames` URL from a normalized `/ws/state` URL (same host).
 * `boothUrl.ts` always normalizes to `…/ws/state`, so a plain suffix swap is
 * exact; a query string (unusual here) is preserved.
 */
export function framesUrlFromStateUrl(stateUrl: string): string {
  return stateUrl.replace(/\/ws\/state(\?|$)/, '/ws/frames$1');
}
