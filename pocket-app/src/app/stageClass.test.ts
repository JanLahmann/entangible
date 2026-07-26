// @vitest-environment jsdom
/**
 * Regression seam for the phone "build on screen" bug: in manual mode the stage
 * carries `pk-stage--manual`, which pocket.css uses to floor the editor height so
 * the on-screen gate palette can't collapse the wires. Camera/booth stages must
 * stay the plain `.pk-stage` (their phone sizing is unchanged), so the class is
 * strictly manual-only.
 */
import { describe, it, expect } from 'vitest';
import { stageClassName, mainClassName } from './App';

describe('stageClassName', () => {
  it('adds the manual variant only in manual mode', () => {
    expect(stageClassName(true)).toBe('pk-stage pk-stage--manual');
  });

  it('is the plain stage in camera/booth mode', () => {
    expect(stageClassName(false)).toBe('pk-stage');
    expect(stageClassName(false)).not.toContain('pk-stage--manual');
  });
});

/**
 * #92: golf played WITH the on-screen editor flips the landscape split so the
 * Bloch/Q-sphere column is the dominant one. The class is the only seam — every
 * other mode/input pair must come out byte-for-byte as before, so this asserts
 * the whole {golf, other} x {manual, camera} x {side right, left} matrix.
 */
describe('mainClassName', () => {
  it('marks golf + build-on-screen as the sphere-forward layout', () => {
    expect(mainClassName(false, true)).toBe('pk-main pk-main--golf-manual');
  });

  it('keeps the classic split for golf-in-camera and non-golf manual', () => {
    // golfManual is App's `isGolf && manual`, so both misses land here.
    expect(mainClassName(false, false)).toBe('pk-main');
  });

  it('composes with the sidebar-side setting', () => {
    expect(mainClassName(true, false)).toBe('pk-main pk-side-left');
    expect(mainClassName(true, true)).toBe('pk-main pk-side-left pk-main--golf-manual');
  });

  it('never leaves a trailing/double space (the old template literal did)', () => {
    for (const sideLeft of [false, true]) {
      for (const golfManual of [false, true]) {
        const cls = mainClassName(sideLeft, golfManual);
        expect(cls).toBe(cls.trim());
        expect(cls).not.toContain('  ');
      }
    }
  });
});
