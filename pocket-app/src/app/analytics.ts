/**
 * Umami events, Fun with Quantum family taxonomy v2 (Fun-with-Quantum/family/EVENTS.md): every
 * family site reports to one shared Umami website, so each event is named `<Site>: <what happened>`
 * (lower case after the colon). The site label comes from the family manifest, never hard-coded.
 * Best-effort: no-ops when the tracker isn't loaded (dev, kiosk LAN, offline).
 *
 * Events sent by this app:
 * - `Entangible: runner start`        — level
 * - `Entangible: runner finish`       — level, score
 * - `Entangible: golf hole finished`  — qubits, score (birdie, par, …), course
 * - `Entangible: golf round finished` — course, scope
 * - `Entangible: family footer click` — to (manifest id; a `data-umami-event` link in the guide)
 */
import fwqFamily from '../data/fwq-family.json';

type Umami = { track: (name: string, data?: Record<string, string>) => void };

type Member = { id: string; name: string; label?: string };
const self = (fwqFamily.members as Member[]).find((m) => m.id === 'entangible');

/** This site's label in event names: the manifest's `label ?? name`. */
export const SITE_LABEL = self?.label ?? self?.name ?? 'Entangible';

/** Full v2 event name for `what` (lower case, e.g. 'family footer click'). */
export function eventName(what: string): string {
  return `${SITE_LABEL}: ${what}`;
}

/** What happened in a game — the part after `<Site>: `. */
export type GameEvent = 'runner start' | 'runner finish' | 'golf hole finished' | 'golf round finished';

function umami(): Umami | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { umami?: Umami }).umami;
}

export function trackGame(what: GameEvent, data: Record<string, string | number | undefined> = {}): void {
  try {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) if (v !== undefined) clean[k] = String(v);
    umami()?.track(eventName(what), clean);
  } catch {
    /* analytics is best-effort */
  }
}
