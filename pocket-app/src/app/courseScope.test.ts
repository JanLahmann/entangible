/**
 * The competition scope as it travels (#102): `?scope=<letter>` in a link or a
 * challenge QR, and the persisted setting behind it.
 *
 * The load-bearing case is the one that is NOT here in the URL: every course
 * link and QR handed out before #102 says nothing about scope, and must keep
 * meaning the full eighteen holes. `parseScope` is the authority on what a
 * scope string means (tested in `@quantum/golf`); this covers the doorway.
 */
import { describe, it, expect } from 'vitest';
import { parseScope, scopeCode } from '@quantum/golf';
import { parseUrlOverrides } from './settings';

describe('?scope= — the competition a link opens (#102)', () => {
  it('reads a round letter, in either case', () => {
    expect(parseUrlOverrides('?scope=E').courseScope).toBe('E');
    expect(parseUrlOverrides('?scope=x').courseScope).toBe('X');
    expect(parseUrlOverrides('?course=1z9k4h&scope=D')).toEqual({
      courseCode: '1z9k4h',
      courseScope: 'D',
    });
  });

  it('ignores anything that is not a round, and says nothing when absent', () => {
    // No key at all — so the stored/default scope wins rather than being reset.
    expect('courseScope' in parseUrlOverrides('?course=abc')).toBe(false);
    expect('courseScope' in parseUrlOverrides('?scope=')).toBe(false);
    expect('courseScope' in parseUrlOverrides('?scope=easy')).toBe(false);
    expect('courseScope' in parseUrlOverrides('?scope=EE')).toBe(false);
  });

  it('round-trips what the card puts in a share link', () => {
    for (const scope of ['easy', 'medium', 'difficult', 'extra'] as const) {
      const code = scopeCode(scope) as string;
      expect(parseScope(parseUrlOverrides(`?scope=${code}`).courseScope)).toBe(scope);
    }
    // A pre-#102 link: no parameter, full course.
    expect(parseScope(parseUrlOverrides('?course=abc').courseScope ?? null)).toBe('full');
  });
});
