/**
 * Game events of the app bundles (golf: docs/golf-bundle.md, runner:
 * docs/runner-bundle.md) — through the HOST's bridge only.
 *
 * The Fun with Quantum iOS app injects `window.umami` (the tracker API,
 * `track(name, data)`) into every page it shows and forwards each call
 * natively. The bundle itself loads no script and makes no request: with no
 * bridge (a plain page, a browser) `hostTrack` does nothing.
 *
 * Same event names and data as the site's `trackGame` (src/app/analytics.ts):
 * `<Site>: <what>`, undefined values dropped, every value sent as a string.
 * The site label is hard-coded here — analytics.ts pulls in the family
 * manifest — and src/bundle/hostEvents.test.ts pins it to the site's
 * SITE_LABEL. scripts/check-bundle.mjs allows exactly the `window.umami`
 * access this module makes and nothing else Umami.
 */

/** This site's label in event names (= analytics.ts SITE_LABEL, test-pinned). */
export const HOST_SITE_LABEL = 'Entangible';

/** What happened in a game — the part after `<Site>: ` (= the site's GameEvent). */
export type HostGameEvent = 'runner start' | 'runner finish' | 'golf hole finished' | 'golf round finished';

type Bridge = { track?: unknown };

/**
 * Report a game event to the host bridge, if one is injected — looked up at
 * call time (the host may inject after load). Never throws.
 */
export function hostTrack(what: HostGameEvent, data: Record<string, string | number | undefined> = {}): void {
  try {
    if (typeof window === 'undefined') return;
    const bridge = (window as unknown as { umami?: Bridge }).umami;
    if (typeof bridge?.track !== 'function') return;
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) if (v !== undefined) clean[k] = String(v);
    (bridge.track as (name: string, data: Record<string, string>) => void).call(
      bridge,
      `${HOST_SITE_LABEL}: ${what}`,
      clean,
    );
  } catch {
    /* best-effort: the game never depends on the host */
  }
}
