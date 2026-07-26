import { describe, it, expect, beforeEach } from 'vitest';
import { initialGolfState } from '@quantum/golf';
import { courseElapsed, courseKey, resetCourseTimers, tickCourseTimer } from './courseTimer';

beforeEach(resetCourseTimers);

/** A golf state as the timer sees it: which course, how many strokes, done? */
const at = (strokes: number, complete = false, seed = 0, course: 'classic' | 'random' = 'classic') => ({
  ...initialGolfState({}, course, seed),
  strokes,
  complete,
});

describe('course timer (#83)', () => {
  it('starts at the first stroke, not when the course is dealt', () => {
    // Dealt and read, but untouched: reading the target is not playing.
    expect(tickCourseTimer(at(0), 1_000)).toEqual({ startedAt: null, finishedAt: null });
    expect(courseElapsed(tickCourseTimer(at(0), 60_000), 60_000)).toBeNull();

    // The first stroke starts the clock, at the moment it lands.
    const started = tickCourseTimer(at(1), 100_000);
    expect(started.startedAt).toBe(100_000);
    expect(started.finishedAt).toBeNull();
    expect(courseElapsed(started, 130_000)).toBe(30_000);
  });

  it('keeps running across holes, and is not restarted by a stroke count reset', () => {
    tickCourseTimer(at(1), 1_000);
    // Advancing a hole zeroes `strokes` (#68) — the COURSE clock must not care.
    expect(tickCourseTimer(at(0), 5_000).startedAt).toBe(1_000);
    expect(tickCourseTimer(at(3), 9_000).startedAt).toBe(1_000);
    expect(courseElapsed(tickCourseTimer(at(2), 61_000), 61_000)).toBe(60_000);
  });

  it('freezes at completion and stays frozen however long the summary is open', () => {
    tickCourseTimer(at(1), 1_000);
    const done = tickCourseTimer(at(0, true), 61_000);
    expect(done.finishedAt).toBe(61_000);
    expect(courseElapsed(done, 61_000)).toBe(60_000);
    // Ten minutes on the summary screen do not change the result.
    const later = tickCourseTimer(at(0, true), 661_000);
    expect(later).toEqual(done);
    expect(courseElapsed(later, 661_000)).toBe(60_000);
  });

  it('is idempotent — the card and the driver may both drive it', () => {
    tickCourseTimer(at(1), 1_000);
    const a = tickCourseTimer(at(2), 5_000);
    const b = tickCourseTimer(at(2), 5_000);
    const c = tickCourseTimer(at(2), 7_000);
    expect(a).toEqual(b);
    expect(c.startedAt).toBe(1_000); // a later observation does not re-start it
  });

  it('resets on a restart, and waits for the next first stroke', () => {
    tickCourseTimer(at(1), 1_000);
    tickCourseTimer(at(0, true), 61_000);
    // The board-clear that restarts a finished course: clock thrown away …
    expect(tickCourseTimer(at(0), 70_000)).toEqual({ startedAt: null, finishedAt: null });
    // … and it waits, again, for a stroke rather than starting on the tee.
    expect(tickCourseTimer(at(0), 200_000).startedAt).toBeNull();
    expect(tickCourseTimer(at(1), 300_000).startedAt).toBe(300_000);
  });

  it('gives every course its own clock, so a new deal starts fresh', () => {
    expect(courseKey(at(0, false, 42, 'random'))).toBe('random:42');
    expect(courseKey(at(0))).toBe('classic:0');

    tickCourseTimer(at(1, false, 42, 'random'), 1_000);
    // A different seed is a different course: its clock has not begun.
    expect(tickCourseTimer(at(0, false, 43, 'random'), 5_000).startedAt).toBeNull();
    // Switching to the classic course likewise.
    expect(tickCourseTimer(at(0), 5_000).startedAt).toBeNull();
    // …and the original round is still running, untouched.
    expect(tickCourseTimer(at(2, false, 42, 'random'), 9_000).startedAt).toBe(1_000);
  });
});
