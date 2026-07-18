/**
 * Pure timing logic for attract mode (`docs/booth-ux.md` → Attract mode).
 *
 * Enter: board empty AND no circuit change for 90 s.
 * Exit:  ANY detection event with markers, OR a circuit change → instant cut.
 *
 * "Activity" is either a live circuit change or a detection frame that carries
 * markers (a hand placing tiles). The component tracks the timestamp of the
 * last activity; this helper decides, given that gap, whether attract is due.
 * Kept pure so the 90 s boundary is unit-testable without timers.
 */

/** Idle window before attract mode engages. */
export const ATTRACT_IDLE_MS = 90_000;

export interface AttractInput {
  /** The live circuit currently has no gates. */
  readonly boardEmpty: boolean;
  /** A detection frame reported one or more (non-corner) markers this instant. */
  readonly markersPresent: boolean;
  /** Milliseconds since the last activity (circuit change or markers seen). */
  readonly msSinceActivity: number;
}

/**
 * Whether the attract overlay should be showing right now. A non-empty board or
 * any live markers force the live view; otherwise attract engages once the idle
 * window elapses.
 */
export function shouldAttract(input: AttractInput): boolean {
  if (!input.boardEmpty) return false;
  if (input.markersPresent) return false;
  return input.msSinceActivity >= ATTRACT_IDLE_MS;
}
