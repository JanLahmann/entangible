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
 * Keyed by course identity, so switching courses (or drawing a new random seed)
 * starts a fresh clock, while advancing between holes of the same course keeps
 * the one that is running.
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
export function courseKey(state: Pick<GolfState, 'course' | 'randomSeed'>): string {
  return `${state.course}:${state.randomSeed}`;
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
  state: Pick<GolfState, 'course' | 'randomSeed' | 'strokes' | 'complete'>,
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

/** Forget every clock — for tests, which must not inherit each other's. */
export function resetCourseTimers(): void {
  TIMINGS.clear();
}
