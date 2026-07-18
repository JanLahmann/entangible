import { describe, it, expect } from 'vitest';
import { TileStabilizer, tileKey } from '../src/vision/stabilizer';

// Mirrors packages/qamposer-vision/tests/test_stabilizer.py.
const T = tileKey(10, 0, 0); // an H tile at (0,0)
const U = tileKey(14, 0, 1); // a second, unrelated tile

function run(seq: boolean[]) {
  const stab = new TileStabilizer();
  return seq.map((present) => stab.update(present ? [T] : []));
}

describe('TileStabilizer (asymmetric hysteresis)', () => {
  it('appears at exactly five of seven', () => {
    const results = run(Array(8).fill(true));
    const flags = results.map((r) => r.stable.has(T));
    expect(flags).toEqual([false, false, false, false, true, true, true, true]);
    const changed = results.flatMap((r, i) => (r.changed ? [i] : []));
    expect(changed).toEqual([4]);
    expect([...results[4].added]).toEqual([T]);
  });

  it('four-of-seven flicker never appears', () => {
    const pattern = Array(4).fill(0).flatMap(() => [true, true, true, true, false, false, false]);
    const results = run(pattern);
    expect(results.every((r) => r.stable.size === 0)).toBe(true);
    expect(results.every((r) => !r.changed)).toBe(true);
  });

  it('disappears only after exactly twelve absent frames', () => {
    const stab = new TileStabilizer();
    for (let i = 0; i < 5; i++) stab.update([T]);
    expect(stab.stable.has(T)).toBe(true);
    for (let i = 0; i < 11; i++) {
      const res = stab.update([]);
      expect(res.stable.has(T)).toBe(true);
      expect(res.changed).toBe(false);
    }
    const res = stab.update([]);
    expect(res.stable.has(T)).toBe(false);
    expect(res.changed).toBe(true);
    expect([...res.removed]).toEqual([T]);
  });

  it('an eleven-frame occlusion does not drop the tile', () => {
    const stab = new TileStabilizer();
    for (let i = 0; i < 5; i++) stab.update([T]);
    for (let i = 0; i < 11; i++) {
      const res = stab.update([]);
      expect(res.stable.has(T)).toBe(true);
      expect(res.changed).toBe(false);
    }
    const res = stab.update([T]);
    expect(res.stable.has(T)).toBe(true);
    expect(res.changed).toBe(false);
  });

  it('changed fires only on transitions', () => {
    const seq = [
      ...Array(6).fill(true),
      ...Array(12).fill(false),
      ...Array(6).fill(true),
    ];
    const results = run(seq);
    const changed = results.flatMap((r, i) => (r.changed ? [i] : []));
    expect(changed).toEqual([4, 17, 22]);
  });

  it('tracks two tiles independently', () => {
    const stab = new TileStabilizer();
    const seq = [[T], [T], [T], [T, U], [T, U], [T, U], [T, U], [T, U]];
    const results = seq.map((obs) => stab.update(obs));
    expect(results[4].stable.has(T)).toBe(true);
    expect(results[4].stable.has(U)).toBe(false);
    expect([...results[4].added]).toEqual([T]);
    expect([...results[7].added]).toEqual([U]);
    expect(results[7].stable.size).toBe(2);
  });

  // Dial rotation-key behaviour (mirrors the Python stabilizer tests): a dial's
  // rotation is part of its key, so turning it in place is a real change while a
  // within-quadrant wiggle keeps the same key.
  const DIAL_R1 = tileKey(42, 0, 0, 1);
  const DIAL_R2 = tileKey(42, 0, 0, 2);

  it('re-emits when a dial is turned in place (after hysteresis)', () => {
    const stab = new TileStabilizer();
    for (let i = 0; i < 5; i++) stab.update([DIAL_R1]);
    expect(stab.stable.has(DIAL_R1)).toBe(true);

    let r2StableAt: number | null = null;
    let r1RemovedAt: number | null = null;
    for (let i = 0; i < 12; i++) {
      const res = stab.update([DIAL_R2]);
      if (r2StableAt === null && res.stable.has(DIAL_R2)) r2StableAt = i;
      if (r1RemovedAt === null && res.removed.has(DIAL_R1)) r1RemovedAt = i;
    }
    expect(r2StableAt).toBe(4); // new rotation appears on the 5th present frame
    expect(r1RemovedAt).toBe(11); // old rotation drops after 12 absent frames
    expect([...stab.stable]).toEqual([DIAL_R2]);
  });

  it('a within-quadrant wiggle keeps one key (no change after appearing)', () => {
    const stab = new TileStabilizer();
    let changes = 0;
    for (let i = 0; i < 20; i++) {
      const res = stab.update([DIAL_R1]);
      if (res.changed) changes++;
    }
    expect(changes).toBe(1);
    expect([...stab.stable]).toEqual([DIAL_R1]);
  });
});
