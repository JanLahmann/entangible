/**
 * Rotating footer "hint ticker" copy, shared by the kiosk booth skin and the
 * pocket surfaces. Both footers cycle the same four teaching lines on the same
 * interval when no warning is showing; SC1 gives them one home so the copy
 * can't drift. The rotation state/effect stays in each surface's component.
 *
 * The lines themselves live in the messages (`t.hints`, shared/i18n); `HINTS`
 * is the English set, kept for callers and tests that read it directly.
 *
 * (App-specific hints — e.g. Pocket's iOS "Add to Home Screen" install hint —
 * are NOT here; they are not duplicated across the two apps.)
 */
import { en } from '@shared/i18n/en';

export const HINTS: readonly string[] = en.hints;

/** Milliseconds between hint rotations. */
export const HINT_ROTATE_MS = 7000;
