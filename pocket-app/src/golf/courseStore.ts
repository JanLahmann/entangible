/**
 * Which course the golf bundle is on — the bundle's stand-in for the two golf
 * fields of the site's settings store (`courseCode`, `courseScope`).
 *
 * Persisted under its own key, `entangible.golf.course`, as
 * `{"courseCode": "<base36>" | null, "courseScope": "E"|"M"|"D"|"X" | null}`,
 * so the bundle never reads or writes the site's whole settings object (mode,
 * camera, booth link …), none of which exists here. The per-hole bests and the
 * paid-for reveals use the SITE's keys through the shared engine
 * (`entangible.pocket.golf.v2.holes`, `entangible.pocket.golf.v2.revealed`) — same
 * logic, same course versioning; in the iOS app the bundle's origin is its own, so the
 * two never meet anyway (docs/golf-bundle.md "Storage").
 *
 * `?course=<code>` / `&scope=<E|M|D|X>` in the page URL override the stored
 * value on load, exactly like a shared site link.
 */
import { parseScope, scopeCode } from '@quantum/golf';
import { parseCourseCode } from '@quantum/golfRandom';

export const GOLF_COURSE_KEY = 'entangible.golf.course';

export interface CourseChoice {
  readonly courseCode: string | null;
  readonly courseScope: string | null;
}

export const CLASSIC: CourseChoice = { courseCode: null, courseScope: null };

type KeyStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** A valid course code (canonical lower case), or null. */
export function cleanCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/^#/, '').toLowerCase();
  return parseCourseCode(text) === null ? null : text;
}

/** A valid scope code (`E`/`M`/`D`/`X`), or null for the full course. */
export function cleanScope(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return scopeCode(parseScope(value.trim().toUpperCase()));
}

/** Stored choice, then URL overrides; anything malformed falls back to classic. */
export function loadCourse(storage: KeyStorage | null, search: string): CourseChoice {
  let stored: CourseChoice = CLASSIC;
  try {
    const raw = storage?.getItem(GOLF_COURSE_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Record<string, unknown>;
      stored = { courseCode: cleanCode(r.courseCode), courseScope: cleanScope(r.courseScope) };
    }
  } catch {
    /* unreadable → classic */
  }
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const urlCode = cleanCode(params.get('course'));
  const urlScope = cleanScope(params.get('scope'));
  return {
    courseCode: urlCode ?? stored.courseCode,
    courseScope: params.has('scope') ? urlScope : urlCode !== null ? null : stored.courseScope,
  };
}

export function saveCourse(storage: KeyStorage | null, choice: CourseChoice): void {
  try {
    storage?.setItem(GOLF_COURSE_KEY, JSON.stringify(choice));
  } catch {
    /* storage full / blocked: the game still plays, it just forgets */
  }
}
