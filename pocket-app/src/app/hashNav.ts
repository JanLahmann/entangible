/**
 * Hash-based routing between the main app (#/empty) and the Guide (#guide).
 *
 * The app is a single-page, serverless deploy (docs/pocket.md), so navigation
 * is just the URL fragment: entering the Guide sets `#guide`, which pushes a
 * history entry so the browser Back button (and the topbar back pill) return to
 * the main app. The camera is never torn down — the Guide renders as an overlay
 * over the still-mounted app (see App.tsx), so an active stream keeps running.
 *
 * The Guide is split into sections (#82), each deep-linkable as a sub-path:
 * `#guide/print`, `#guide/play`, … Everything under `guide/` is still the guide
 * ROUTE, so App's overlay condition is unchanged and a plain `#guide` — which is
 * what every link in the app uses — still opens the first section. Which slugs
 * exist is GuidePage's business, not this module's: `parseGuideSection` only
 * reads the sub-path and validates its SHAPE, so an unknown or malformed one
 * falls back to the first section rather than breaking the route.
 *
 * The parse/apply/back helpers are pure (a minimal `NavWindow` is injectable for
 * tests); `useRoute` is the tiny hashchange-backed hook.
 */
import { useEffect, useState } from 'react';

export type Route = 'main' | 'guide';

export const GUIDE_HASH = '#guide';

/** Minimal window surface the navigation helpers touch (injectable for tests). */
export interface NavWindow {
  location: { hash: string };
  history: { back(): void; length: number };
}

/** A hash reduced to its bare path: no leading '#', no surrounding space, lower. */
function hashPath(hash: string | null | undefined): string {
  return (hash ?? '').trim().replace(/^#/, '').trim().toLowerCase();
}

/**
 * Parse a location hash into a route. `guide` and anything under `guide/`
 * (a section deep link, #82) are the Guide; everything else is the main app.
 */
export function parseRoute(hash: string | null | undefined): Route {
  const h = hashPath(hash);
  return h === 'guide' || h.startsWith('guide/') ? 'guide' : 'main';
}

/**
 * The Guide section a hash names — `#guide/print` → `'print'` — or `null` for a
 * bare `#guide`, a non-guide hash, or a sub-path that is not a plain slug.
 * Which slugs actually exist is GuidePage's business; an unrecognised one lands
 * on the first section there.
 */
export function parseGuideSection(hash: string | null | undefined): string | null {
  const h = hashPath(hash);
  if (!h.startsWith('guide/')) return null;
  const section = h.slice('guide/'.length).replace(/\/+$/, '');
  return /^[a-z0-9-]+$/.test(section) ? section : null;
}

/** The deep link for a Guide section (`'print'` → `'#guide/print'`). */
export function guideSectionHash(section: string): string {
  return `${GUIDE_HASH}/${section}`;
}

/** The hash a route should apply. Main clears the fragment; guide sets `#guide`. */
export function routeToHash(route: Route): string {
  return route === 'guide' ? GUIDE_HASH : '';
}

/** Navigate to a route by applying its hash (pushes a history entry for guide). */
export function navigateTo(win: NavWindow, route: Route): void {
  win.location.hash = routeToHash(route);
}

/**
 * Leave the Guide. Prefer real browser-back so we don't pile up history entries
 * (returns to wherever the visitor was); fall back to clearing the hash when the
 * Guide was opened directly (deep link, empty history).
 */
export function goBack(win: NavWindow): void {
  if (win.history.length > 1) win.history.back();
  else win.location.hash = '';
}

/** Current route, kept in sync with the browser via `hashchange`. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(typeof window !== 'undefined' ? window.location.hash : ''),
  );
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}
