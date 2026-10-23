/**
 * Surface detection — which top-level screen the unified pocket app renders
 * (Entangible One, phase U3). One app, three surfaces:
 *
 *   - `app`   — the standalone / camera / booth-viewer pocket app (default).
 *   - `kiosk` — the big-screen booth skin, selected by `?kiosk` (the host's
 *     kiosk launcher opens `/?kiosk&connect=1`).
 *   - `debug` — the staff calibration screen, served by the host at `/debug`
 *     (matched on `location.pathname`).
 *
 * Pure + injectable (pathname/search) so it is unit-testable. `?kiosk=0`
 * (or false/off/no) explicitly opts back out, so a stray param can be undone.
 */
export type Surface = 'app' | 'kiosk' | 'debug';

function boolish(v: string | null): boolean {
  // A bare `?kiosk` (empty value) counts as on; only explicit falsey opts out.
  if (v === null) return false;
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

export function detectSurface(pathname: string, search: string): Surface {
  // `/debug`, `/debug/`, or `…/debug` (host serves the SPA there).
  if (/(^|\/)debug\/?$/.test(pathname)) return 'debug';
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.has('kiosk') && boolish(params.get('kiosk'))) return 'kiosk';
  return 'app';
}

/** Detect the current surface from `window.location` (SSR-safe default 'app'). */
export function currentSurface(): Surface {
  if (typeof window === 'undefined') return 'app';
  return detectSurface(window.location.pathname, window.location.search);
}

/**
 * The public site's hostnames (GitHub Pages, custom domain). The same `dist/`
 * is also served by a booth host, so the build cannot tell the two apart —
 * only the origin it is loaded from can.
 */
export const PUBLIC_SITE_HOSTS: readonly string[] = ['entangible.org', 'www.entangible.org'];

/**
 * Should the app probe its own origin's `/api/info` for a booth host? Not on
 * the public site: no booth host ever serves entangible.org, and the probe's
 * 404 there is logged by the browser as a console error ("Failed to load
 * resource") that no `.catch` can prevent — it cost the home page its
 * Lighthouse best-practices score. Everywhere else (a booth host's LAN IP or
 * name, localhost, a preview) the probe runs as before.
 */
export function boothHostProbeWanted(hostname: string): boolean {
  return !PUBLIC_SITE_HOSTS.includes(hostname.toLowerCase());
}
