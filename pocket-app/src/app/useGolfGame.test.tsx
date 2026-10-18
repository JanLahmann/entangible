// @vitest-environment jsdom
/**
 * `useGolfGame` — the golf driver shared by the site shell and the golf-only
 * bundle. Driven the way both callers drive it: `step()` with each new board,
 * the scorecard's actions, the course-code option.
 *
 * Covered: playing a hole (strokes, hole-in, celebration, event, best saved),
 * the next-hole advance on the on-screen board, the paid mid-hole reveal and
 * its storage, a wipe, a jump, a course switch writing the code setting, a
 * random course dealt from a code (and its bests kept off the device card),
 * and that without `clearBoard` (camera / booth) the on-screen actions do not
 * exist.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Circuit } from '@qamposer/react';
import { GOLF_HOLES_KEY, GOLF_REVEALED_KEY, HOLES } from '@quantum/golf';
import { parseCourseCode } from '@quantum/golfRandom';
import { useGolfGame, type GolfGameOptions } from './useGolfGame';

vi.setConfig({ testTimeout: 60_000 });

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

const EMPTY: Circuit = { qubits: 5, gates: [] } as Circuit;

/** Hole 1's worked answer on the five-wire board. */
function holeOneAnswer(): Circuit {
  const solution = HOLES[0].solution!;
  return { qubits: 5, gates: solution.gates } as Circuit;
}

function setup(over: Partial<GolfGameOptions> = {}) {
  const storage = memoryStorage();
  const calls = {
    celebrate: vi.fn(),
    event: vi.fn(),
    code: vi.fn(),
    scope: vi.fn(),
    clear: vi.fn(),
  };
  const base: GolfGameOptions = {
    storage,
    courseCode: null,
    courseScope: null,
    setCourseCode: calls.code,
    setCourseScope: calls.scope,
    clearBoard: calls.clear,
    circuit: EMPTY,
    onCelebrate: calls.celebrate,
    onEvent: calls.event,
    ...over,
  };
  const hook = renderHook((props: GolfGameOptions) => useGolfGame(props), { initialProps: base });
  const play = (c: Circuit) => {
    act(() => hook.result.current.step(c));
    hook.rerender({ ...base, circuit: c });
  };
  return { hook, storage, calls, play, base };
}

describe('useGolfGame — playing the classic course', () => {
  it('starts on the classic hole 1 with nothing played', () => {
    const { hook } = setup();
    const g = hook.result.current;
    expect(g.state.course).toBe('classic');
    expect(g.currentLevel.hole).toBe(1);
    expect(g.state.strokes).toBe(0);
    expect(g.holes).toHaveLength(18);
  });

  it('holes in with the worked answer: strokes, celebration, event and a saved best', () => {
    const { hook, storage, calls, play } = setup();
    play(EMPTY);
    play(holeOneAnswer());
    const g = hook.result.current;
    expect(g.state.holedIn).toBe(true);
    expect(g.state.strokes).toBe(HOLES[0].solution!.gates.length);
    expect(g.state.best[1]).toBe(g.state.strokes);
    expect(JSON.parse(storage.getItem(GOLF_HOLES_KEY)!)).toEqual({ 1: g.state.strokes });
    expect(calls.celebrate).toHaveBeenCalledTimes(1);
    expect(calls.celebrate.mock.calls[0][0].banner).toMatch(/!$/);
    expect(calls.event).toHaveBeenCalledWith(
      'golf hole finished',
      expect.objectContaining({ course: 'classic' }),
    );
  });

  it('keeps step() identity-stable across renders (no re-subscription)', () => {
    const { hook, play } = setup();
    const first = hook.result.current.step;
    play(holeOneAnswer());
    expect(hook.result.current.step).toBe(first);
  });

  it('advances on the on-screen board: Next hole clears the board, the cleared board tees hole 2', () => {
    const { hook, calls, play } = setup();
    play(EMPTY);
    play(holeOneAnswer());
    act(() => hook.result.current.advanceHole!());
    expect(calls.clear).toHaveBeenCalledTimes(1);
    // The manual source then emits the empty board — the engine's advance trigger.
    play(EMPTY);
    expect(hook.result.current.currentLevel.hole).toBe(2);
    expect(hook.result.current.state.strokes).toBe(0);
  });

  it('charges the mid-hole reveal once and remembers it on the device', () => {
    const { hook, storage } = setup();
    act(() => hook.result.current.takeReveal(1));
    expect(hook.result.current.state.revealed[1]).toBe(true);
    expect(JSON.parse(storage.getItem(GOLF_REVEALED_KEY)!)).toEqual({ 1: true });
    const before = hook.result.current.state;
    act(() => hook.result.current.takeReveal(1));
    expect(hook.result.current.state).toBe(before);
  });

  it('wipes the board for one stroke and clears it', () => {
    const { hook, calls, play } = setup();
    play(EMPTY);
    const x: Circuit = { qubits: 5, gates: [{ id: 'g1', type: 'X', qubit: 0, position: 0 }] } as Circuit;
    play(x);
    expect(hook.result.current.state.strokes).toBe(1);
    act(() => hook.result.current.wipeBoard!());
    expect(hook.result.current.state.strokes).toBe(2);
    expect(calls.clear).toHaveBeenCalledTimes(1);
  });

  it('jumps to a hole from the chip strip', () => {
    const { hook } = setup();
    act(() => hook.result.current.jumpToHole(6));
    expect(hook.result.current.currentLevel.hole).toBe(6);
  });

  it('re-tees on a scope pick and persists the scope code', () => {
    const { hook, calls } = setup();
    act(() => hook.result.current.pickScope('medium'));
    expect(hook.result.current.state.scope).toBe('medium');
    expect(hook.result.current.currentLevel.round).toBe('medium');
    expect(calls.scope).toHaveBeenCalledWith('M');
    expect(calls.clear).toHaveBeenCalled();
  });

  it('picking Classic writes a null course code and clears the board', () => {
    const { hook, calls } = setup();
    act(() => hook.result.current.pickCourse('classic'));
    expect(calls.code).toHaveBeenCalledWith(null);
    expect(calls.clear).toHaveBeenCalledTimes(1);
  });

  it('offers no on-screen advance or wipe without a board to clear (camera / booth)', () => {
    const { hook } = setup({ clearBoard: undefined });
    expect(hook.result.current.advanceHole).toBeUndefined();
    expect(hook.result.current.wipeBoard).toBeUndefined();
  });
});

describe('useGolfGame — a random course from its code', () => {
  it('deals the coded course, moves onto it, and keeps its bests off the device card', async () => {
    const code = 'abc12';
    const seed = parseCourseCode(code)!;
    const { hook, storage, calls } = setup({ courseCode: code });
    // A cold code opens on the classic card while the course is dealt.
    expect(hook.result.current.state.course).toBe('classic');
    await waitFor(() => expect(hook.result.current.state.course).toBe('random'), {
      timeout: 55_000,
    });
    const g = hook.result.current;
    expect(g.state.randomSeed).toBe(seed);
    expect(g.dealing).toBeNull();
    expect(g.holes).toHaveLength(18);
    expect(calls.clear).toHaveBeenCalled();

    // Hole-in on the generated hole 1: celebrated, but nothing written.
    const answer = { qubits: 5, gates: g.currentLevel.solution!.gates } as Circuit;
    act(() => hook.result.current.step(EMPTY));
    act(() => hook.result.current.step(answer));
    expect(hook.result.current.state.holedIn).toBe(true);
    expect(calls.celebrate).toHaveBeenCalled();
    expect(storage.getItem(GOLF_HOLES_KEY)).toBeNull();
  });
});
