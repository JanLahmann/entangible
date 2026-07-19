import { describe, it, expect } from 'vitest';
import { isTouchEnabled } from './touch';

// The copy/decision helpers (gateInspectCopy, outcomeInspectCopy, formatAngle,
// POPOVER_MS) live in @quantum/inspectCopy and are covered by
// inspectCopy.test.ts; touch.ts now owns only the kiosk's ?touch decision.

describe('isTouchEnabled', () => {
  it('honours ?touch=1 / true / on regardless of pointer', () => {
    for (const q of ['?touch=1', '?touch=true', '?touch=on', 'touch=yes']) {
      expect(isTouchEnabled(q, false)).toBe(true);
    }
  });

  it('honours ?touch=0 to force off even on a coarse pointer', () => {
    expect(isTouchEnabled('?touch=0', true)).toBe(false);
    expect(isTouchEnabled('?touch=false', true)).toBe(false);
  });

  it('falls back to the coarse-pointer signal when unset', () => {
    expect(isTouchEnabled('', true)).toBe(true);
    expect(isTouchEnabled('?other=1', false)).toBe(false);
  });
});
