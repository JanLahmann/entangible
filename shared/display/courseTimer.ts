/**
 * Course wall-clock (#83) — how long a whole round took.
 *
 * The clock starts at the FIRST stroke of the course, on whatever hole that is,
 * and stops when the eighteenth hole is cleared and the course completes. It
 * deliberately does not start when a course is dealt: a player reading the first
 * target, or leaving the app open on the tee, is not playing yet, and a timer
 * that punished them for thinking would be measuring the wrong thing (the same
 * principle as #79's stuck timer).
 *
 * ## Why this lives here and not in the engine
 * `@quantum/golf` is pure and clockless: same (state, circuit) in, same step
 * out, forever. A clock inside it would have to be threaded through every
 * caller, every test and every replay, and would make `golfStep` non-
 * deterministic. So the timing is UI state, kept beside the display layer.
 *
 * ## Why a module-level store rather than component state
 * Two places need the same number: the scorecard, which shows it ticking and
 * then frozen, and each app's golf driver, which puts it in the completion
 * celebration's copy (#80). They do not share a component, and threading a
 * timestamp through both apps' props would spread the clock across four files
 * to avoid one small store. `tickCourseTimer` is an idempotent state machine —
 * calling it twice with the same state changes nothing — so both callers may
 * drive it on every update without coordinating.
 *
 * Keyed by course identity, so switching courses (or drawing a new random seed,
 * or changing what is being competed over) starts a fresh clock, while
 * advancing between holes of the same round keeps the one that is running.
 */
import type { GolfState } from '@quantum/golf';

/** The timing of one course: null start = not begun, null finish = running. */
export interface CourseTiming {
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
}

const NOT_STARTED: CourseTiming = { startedAt: null, finishedAt: null };

/**
 * Which course a timing belongs to. A random round is identified by its seed —
 * a new deal is a new course and deserves a new clock — while every classic
 * round shares one key, and a restart is detected from the state transition
 * instead (see `tickCourseTimer`).
 */
export function courseKey(
  state: Pick<GolfState, 'course' | 'randomSeed' | 'scope'>,
): string {
  return `${state.course}:${state.randomSeed}:${state.scope}`;
}

/** Live timings, one per course seen. Bounded: a session cannot leak clocks. */
const TIMINGS = new Map<string, CourseTiming>();
const TIMINGS_LIMIT = 8;

/**
 * Fold one observation of the golf state into the course's clock, and return it.
 *
 * Idempotent by construction — every branch is a transition test, never an
 * increment — so the scorecard may call it on each render and the driver on each
 * golf step without either having to know about the other.
 *
 * The transitions:
 *  - a finished clock seen with an unfinished course means the player restarted,
 *    so the clock is thrown away and waits for a first stroke again;
 *  - the first observation with strokes on the board starts it;
 *  - the first observation of a complete course stops it — which is the frame
 *    `golfStep` reports `justCompleted`, i.e. the eighteenth hole-in.
 */
export function tickCourseTimer(
  state: Pick<GolfState, 'course' | 'randomSeed' | 'scope' | 'strokes' | 'complete'>,
  now: number,
): CourseTiming {
  const key = courseKey(state);
  let timing = TIMINGS.get(key) ?? NOT_STARTED;

  // Play resumed on a course whose clock had already stopped → a restart.
  if (timing.finishedAt !== null && !state.complete) timing = NOT_STARTED;

  if (timing.startedAt === null && !state.complete && state.strokes > 0) {
    timing = { startedAt: now, finishedAt: null };
  }
  if (state.complete && timing.startedAt !== null && timing.finishedAt === null) {
    timing = { startedAt: timing.startedAt, finishedAt: now };
  }

  if (!TIMINGS.has(key) && TIMINGS.size >= TIMINGS_LIMIT) TIMINGS.clear();
  TIMINGS.set(key, timing);
  return timing;
}

/**
 * Milliseconds played on this course so far, or `null` before the first stroke.
 * Frozen once the course is complete, so the summary and the celebration quote
 * the same number however long the screen is left open.
 */
export function courseElapsed(timing: CourseTiming, now: number): number | null {
  if (timing.startedAt === null) return null;
  return (timing.finishedAt ?? now) - timing.startedAt;
}

/**
 * Per-HOLE clocks — when the stuck-help offer (#79) becomes due.
 *
 * ## Why this moved out of the card (#98)
 * The window used to live in a `useRef` inside the scorecard, stamped during
 * the render that first saw a stroke, and it was re-evaluated by ONE
 * `setTimeout` armed to fire exactly at the sixty-second mark. Both halves were
 * fragile in the field:
 *
 *  - a ref is born empty on every MOUNT, so any remount of the card while a
 *    hole was in play re-stamped the window from "now" — the clock restarted
 *    and never reached a minute, however long the player had really been stuck;
 *  - the single timer was never re-armed, so if it fired a hair early (browsers
 *    truncate fractional `setTimeout` delays) the condition read false once and
 *    was not looked at again until some other render happened to occur.
 *
 * That is exactly the shape of the bug report: the strokes >= par+3 door still
 * worked, because that one is derived from engine state that survives a
 * remount, while the time door never opened. So the timestamp now lives here,
 * beside the course clock, keyed by course + seed + hole, and the card re-reads
 * it on a plain one-second tick instead of trying to wake up on the exact
 * millisecond.
 */
const HOLE_STARTS = new Map<string, number>();
const HOLE_LIMIT = 24;

/** Which hole a stuck-clock belongs to: the course, its deal, and the hole. */
export function holeKey(
  state: Pick<GolfState, 'course' | 'randomSeed'>,
  holeNumber: number,
): string {
  return `${state.course}:${state.randomSeed}:${holeNumber}`;
}

/**
 * Fold one observation of the hole in play into its stuck-clock, and return the
 * milliseconds since its FIRST stroke (`null` before it).
 *
 * Idempotent like `tickCourseTimer`, so the card may call it on every render.
 * A hole seen with no strokes is a hole that has not been teed off — its clock
 * is dropped, which is what resets the window on a hole advance and on a
 * course restart (both arrive as strokes back at 0).
 */
export function tickHoleTimer(
  state: Pick<GolfState, 'course' | 'randomSeed' | 'strokes'>,
  holeNumber: number,
  now: number,
): number | null {
  const key = holeKey(state, holeNumber);
  if (state.strokes <= 0) {
    HOLE_STARTS.delete(key);
    return null;
  }
  const at = HOLE_STARTS.get(key);
  if (at !== undefined) return now - at;
  if (HOLE_STARTS.size >= HOLE_LIMIT) HOLE_STARTS.clear();
  HOLE_STARTS.set(key, now);
  return 0;
}

/** Forget every clock — for tests, which must not inherit each other's. */
export function resetCourseTimers(): void {
  TIMINGS.clear();
  HOLE_STARTS.clear();
}
