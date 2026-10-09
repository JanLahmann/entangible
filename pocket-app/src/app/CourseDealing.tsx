/**
 * Dealing a random golf course without freezing the page.
 *
 * A generated course (#70) is pure computation, and the first one of a session
 * is seconds of it — the club orbits (#77) are built on that deal, and a phone
 * is several times slower than the desktop that measured it (see "Cost" on
 * `generateCourse`). The render path reads the course synchronously
 * (`courseHoles`), so the app must never put a GolfState on a seed whose course
 * is not dealt yet. `useCourseDealer` is the one gate every "move onto a random
 * course" goes through:
 *
 *  - a seed that is already dealt (`isCourseReady`) moves IMMEDIATELY, in the
 *    same call — no indicator, no extra render, exactly as before;
 *  - any other seed is dealt by `prepareCourse` across macrotasks, with
 *    `dealing` set so the golf view can show `CourseDealing`, and the move runs
 *    once the course is memoized — after which every sync read is a cache hit.
 *
 * The latest request wins: a newer `deal` or a `cancel` (picking the classic
 * course, clearing the code) makes an older pending move a no-op. Its course
 * still finishes dealing in the background and stays memoized, which costs
 * nothing a later request would not have paid.
 */
import { useCallback, useRef, useState } from 'react';
import { isCourseReady, prepareCourse } from '@quantum/golfRandom';

/** Holes on a course — the indicator's denominator. */
const COURSE_HOLES = 18;

/** A course being dealt: its seed and how many of its holes are done. */
export interface Dealing {
  readonly seed: number;
  readonly holesDone: number;
}

export interface CourseDealer {
  /** The course being dealt right now, or null — drives the indicator. */
  readonly dealing: Dealing | null;
  /**
   * Run `apply` (the caller's "move onto course `seed`") now if the course is
   * dealt, or once `prepareCourse` has dealt it — unless superseded first.
   */
  readonly deal: (seed: number, apply: () => void) => void;
  /** Drop a pending move (its course keeps dealing in the background). */
  readonly cancel: () => void;
  /** The seed a move is pending on, read synchronously (for effects and
   *  frame callbacks, which must not wait for a render to see it). */
  readonly pendingSeed: () => number | null;
}

export function useCourseDealer(): CourseDealer {
  const [dealing, setDealing] = useState<Dealing | null>(null);
  const tokenRef = useRef(0);
  const pendingRef = useRef<number | null>(null);

  /** Supersede whatever is pending; touches state only if something was, so
   *  the ready-course path stays render-for-render what it was. */
  const cancel = useCallback(() => {
    tokenRef.current += 1;
    if (pendingRef.current === null) return;
    pendingRef.current = null;
    setDealing(null);
  }, []);

  const deal = useCallback(
    (seed: number, apply: () => void) => {
      cancel();
      if (isCourseReady(seed)) {
        apply();
        return;
      }
      const token = tokenRef.current;
      pendingRef.current = seed;
      setDealing({ seed, holesDone: 0 });
      const live = () => tokenRef.current === token;
      const finish = () => {
        if (!live()) return;
        pendingRef.current = null;
        setDealing(null);
        // On a failed deal this still moves, and the synchronous read in
        // render then behaves exactly as it did before dealing existed.
        apply();
      };
      prepareCourse(seed, (holesDone) => {
        if (live()) setDealing({ seed, holesDone });
      }).then(finish, finish);
    },
    [cancel],
  );

  const pendingSeed = useCallback(() => pendingRef.current, []);

  return { dealing, deal, cancel, pendingSeed };
}

/**
 * The dealing indicator: a quiet card over the golf view's sphere while a
 * course is dealt, so the stale target underneath is visibly not the one in
 * play. Not a modal — the course picker, the mode switch and the drawer stay
 * usable, and picking Classic is how you call a deal off.
 */
export function CourseDealing({ holesDone }: { holesDone: number }) {
  const current = Math.min(holesDone + 1, COURSE_HOLES);
  const pct = Math.round((holesDone / COURSE_HOLES) * 100);
  return (
    <div className="pk-golf-dealing" role="status" aria-live="polite">
      <div className="pk-golf-dealing-card">
        <span className="pk-golf-dealing-text">
          <span className="pk-golf-dealing-dot" aria-hidden="true" />
          Dealing course — hole {current}/{COURSE_HOLES}…
        </span>
        <span
          className="pk-golf-dealing-bar"
          role="progressbar"
          aria-label="holes dealt"
          aria-valuemin={0}
          aria-valuemax={COURSE_HOLES}
          aria-valuenow={holesDone}
        >
          <span style={{ width: `${pct}%` }} />
        </span>
      </div>
    </div>
  );
}
