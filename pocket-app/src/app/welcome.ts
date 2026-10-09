/**
 * The welcome card's three ways in (camera · build on screen · Quantum Golf).
 *
 * A visitor who opens Entangible cold — usually from a QR code — gets one card
 * that says what the thing is and offers three paths, the camera first and
 * visually dominant because the printed board IS the exhibit. Everyone who
 * arrived with a purpose skips it, exactly as they always skipped the plain
 * camera card's extras: a shared course or round (`?course=` / `?scope=`), a
 * Quantina menu (`?menu=` / `?menupack=`), the booth's own surfaces (`?kiosk`,
 * `?connect=1`, the staff `?role=camera`), and any explicit `?mode=`. Those
 * links already name where to land; a menu of options would only stand between
 * the visitor and it.
 *
 * Pure + exported so the gate is unit-testable without rendering the app.
 */
import type { CameraStatus } from './useCamera';
import type { Mode, Settings } from './settings';

/**
 * URL params that mean "this visitor was sent somewhere specific". Present at
 * all — any value — and the welcome paths stay out of the way.
 */
export const WELCOME_BYPASS_PARAMS: readonly string[] = [
  'kiosk',
  'connect',
  'role',
  'course',
  'scope',
  'menu',
  'menupack',
  'mode',
];

export interface WelcomeInputs {
  /** `window.location.search` as the page was opened. */
  readonly search: string;
  /** The local camera's state: the card is for a camera that has not run yet. */
  readonly status: CameraStatus;
  /** Following a booth (read-only viewer): the booth owns the screen. */
  readonly connected: boolean;
  /** Streaming as the booth's camera (staff role). */
  readonly cameraRole: boolean;
  /** The effective mode: only the default composer landing is a welcome. */
  readonly mode: Mode;
}

/** True when the URL carries any param that bypasses the welcome paths. */
export function welcomeBypassed(search: string): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return WELCOME_BYPASS_PARAMS.some((p) => params.has(p));
}

/**
 * Show the three-path welcome instead of the plain camera card? Only on the
 * idle composer landing: the camera has not started (or is just starting from
 * the card's own primary button — the card holds still rather than flashing
 * the old one), no booth link, no camera role, and no purposeful URL. A camera
 * ERROR keeps its own card ("Camera unavailable" + the on-screen fallback).
 */
export function welcomeEligible(i: WelcomeInputs): boolean {
  if (i.status !== 'idle' && i.status !== 'starting') return false;
  if (i.connected || i.cameraRole) return false;
  if (i.mode !== 'composer') return false;
  return !welcomeBypassed(i.search);
}

/**
 * "Play Quantum Golf" from the welcome card: golf, built on screen. It is the
 * very same settings write the drawer's Mode and Input pickers make — the app's
 * one golf entry — so the course dealer, the persisted card and a stored course
 * code all take it from there exactly as they do from the drawer. No second
 * golf-entry path exists to drift.
 */
export const GOLF_ON_SCREEN: Pick<Settings, 'mode' | 'input'> = { mode: 'golf', input: 'manual' };

/** "Build on screen" from the welcome card — the drawer's Input picker write. */
export const BUILD_ON_SCREEN: Pick<Settings, 'input'> = { input: 'manual' };
