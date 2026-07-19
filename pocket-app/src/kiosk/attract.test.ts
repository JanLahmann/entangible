import { describe, it, expect } from 'vitest';
import { ATTRACT_IDLE_MS, shouldAttract } from './attract';

describe('attract mode timing', () => {
  it('engages only after the idle window on an empty board', () => {
    expect(
      shouldAttract({ boardEmpty: true, markersPresent: false, msSinceActivity: ATTRACT_IDLE_MS - 1 }),
    ).toBe(false);
    expect(
      shouldAttract({ boardEmpty: true, markersPresent: false, msSinceActivity: ATTRACT_IDLE_MS }),
    ).toBe(true);
  });

  it('never engages while the board has gates', () => {
    expect(
      shouldAttract({ boardEmpty: false, markersPresent: false, msSinceActivity: 10 * ATTRACT_IDLE_MS }),
    ).toBe(false);
  });

  it('exits (stays live) the instant markers appear, even long after idle', () => {
    expect(
      shouldAttract({ boardEmpty: true, markersPresent: true, msSinceActivity: 10 * ATTRACT_IDLE_MS }),
    ).toBe(false);
  });
});
