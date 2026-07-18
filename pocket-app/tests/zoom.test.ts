// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clampZoom,
  snapZoom,
  stepZoom,
  cropRect,
  pointerDistance,
  pinchZoom,
  loadZoom,
  saveZoom,
  ZOOM_MIN,
  ZOOM_MAX,
} from '../src/app/zoom';

describe('clampZoom', () => {
  it('clamps into [min, max]', () => {
    expect(clampZoom(2)).toBe(2);
    expect(clampZoom(0.5)).toBe(ZOOM_MIN);
    expect(clampZoom(9)).toBe(ZOOM_MAX);
  });
  it('respects a custom (native) range', () => {
    expect(clampZoom(5, 1, 8)).toBe(5);
    expect(clampZoom(9, 1, 8)).toBe(8);
    expect(clampZoom(0, 1, 8)).toBe(1);
  });
  it('falls back to min on non-finite input', () => {
    expect(clampZoom(NaN)).toBe(ZOOM_MIN);
    expect(clampZoom(Infinity, 2, 8)).toBe(2); // non-finite → safe min
    expect(clampZoom(NaN, 2, 8)).toBe(2);
  });
});

describe('snapZoom', () => {
  it('snaps to the nearest quarter step', () => {
    expect(snapZoom(1.37)).toBe(1.25);
    expect(snapZoom(1.4)).toBe(1.5);
    expect(snapZoom(2.99)).toBe(ZOOM_MAX);
  });
  it('produces clean decimals (no float dust)', () => {
    expect(snapZoom(1.75)).toBe(1.75);
    expect(snapZoom(2.5)).toBe(2.5);
  });
});

describe('stepZoom', () => {
  it('moves one step in from a snapped value', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1.37, 1)).toBe(1.5); // snaps 1.37→1.25 then +0.25
  });
  it('moves one step out and clamps at the floor', () => {
    expect(stepZoom(1.5, -1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(ZOOM_MIN);
  });
  it('clamps at the ceiling', () => {
    expect(stepZoom(3, 1)).toBe(ZOOM_MAX);
  });
});

describe('cropRect', () => {
  it('is the whole frame at zoom 1', () => {
    expect(cropRect(1, 1920, 1080)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
  });
  it('is the whole frame at zoom <= 1 (identity draw)', () => {
    expect(cropRect(0.5, 1280, 720)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
  });
  it('center-crops 1/zoom at 2×', () => {
    expect(cropRect(2, 1920, 1080)).toEqual({ sx: 480, sy: 270, sw: 960, sh: 540 });
  });
  it('rounds to integer pixels and centers', () => {
    const r = cropRect(3, 1920, 1080);
    expect(r).toEqual({ sx: 640, sy: 360, sw: 640, sh: 360 });
  });
  it('handles odd dimensions with rounding, staying in-bounds', () => {
    const r = cropRect(2, 1281, 721);
    expect(r.sw).toBe(641); // round(640.5)
    expect(r.sh).toBe(361); // round(360.5)
    expect(r.sx + r.sw).toBeLessThanOrEqual(1281);
    expect(r.sy + r.sh).toBeLessThanOrEqual(721);
    expect(r.sx).toBeGreaterThanOrEqual(0);
  });
  it('never produces a zero-size crop at extreme zoom', () => {
    const r = cropRect(1000, 100, 100);
    expect(r.sw).toBeGreaterThanOrEqual(1);
    expect(r.sh).toBeGreaterThanOrEqual(1);
  });
});

describe('pointerDistance', () => {
  it('is Euclidean', () => {
    expect(pointerDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('pinchZoom', () => {
  it('scales the start zoom by the distance ratio', () => {
    expect(pinchZoom(1, 100, 200)).toBe(2); // fingers spread 2× → zoom 2×
    expect(pinchZoom(2, 100, 50)).toBe(1); // fingers pinch in → zoom down, clamped floor
  });
  it('clamps to the active range', () => {
    expect(pinchZoom(2, 100, 400)).toBe(ZOOM_MAX); // would be 8, clamps to 3
    expect(pinchZoom(2, 100, 400, 1, 8)).toBe(8);
  });
  it('is a no-op when the start distance is non-positive', () => {
    expect(pinchZoom(1.5, 0, 200)).toBe(1.5);
  });
});

describe('persistence round-trip', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a saved zoom', () => {
    saveZoom('k', 2.25);
    expect(loadZoom('k')).toBe(2.25);
  });
  it('returns the fallback when nothing is stored', () => {
    expect(loadZoom('missing', 1.5)).toBe(1.5);
  });
  it('clamps a persisted value to the given range', () => {
    saveZoom('k', 9);
    expect(loadZoom('k', 1, 1, 3)).toBe(3);
  });
  it('ignores corrupt stored data', () => {
    localStorage.setItem('k', 'not-a-number');
    expect(loadZoom('k', 1.25)).toBe(1.25);
  });
});
