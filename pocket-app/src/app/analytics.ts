/**
 * Umami events, Fun with Quantum family taxonomy (Fun-with-Quantum/family/EVENTS.md).
 * Best-effort: no-ops when the tracker isn't loaded (dev, kiosk LAN, offline).
 */
type Umami = { track: (name: string, data?: Record<string, string>) => void };

function umami(): Umami | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { umami?: Umami }).umami;
}

/** `game` — name: runner | golf; step: start | finish (+ free-form context). */
export function trackGame(
  name: 'runner' | 'golf',
  step: 'start' | 'finish',
  data: Record<string, string | number | undefined> = {},
): void {
  try {
    const clean: Record<string, string> = { name, step };
    for (const [k, v] of Object.entries(data)) if (v !== undefined) clean[k] = String(v);
    umami()?.track('game', clean);
  } catch {
    /* analytics is best-effort */
  }
}
