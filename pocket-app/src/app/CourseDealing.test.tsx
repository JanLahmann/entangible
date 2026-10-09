// @vitest-environment jsdom
/**
 * Dealing a random course off the critical path: a dealt course moves at once,
 * an undealt one moves only after `prepareCourse`, behind the indicator, and
 * the latest request always wins. The generator itself is mocked — its own
 * equivalence and liveness are pinned in `golfRandom.test.ts`.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, cleanup, screen, renderHook, act } from '@testing-library/react';

const ready = new Set<number>();
const pending = new Map<
  number,
  { resolve: () => void; reject: (e: Error) => void; progress?: (n: number) => void }
>();

vi.mock('@quantum/golfRandom', () => ({
  isCourseReady: (seed: number) => ready.has(seed),
  prepareCourse: (seed: number, progress?: (n: number) => void) =>
    new Promise<void>((resolve, reject) => {
      pending.set(seed, {
        resolve: () => {
          ready.add(seed);
          resolve();
        },
        reject,
        progress,
      });
    }),
}));

const { CourseDealing, useCourseDealer } = await import('./CourseDealing');

beforeEach(() => {
  ready.clear();
  pending.clear();
});
afterEach(cleanup);

describe('useCourseDealer', () => {
  it('moves onto a course that is already dealt synchronously — no indicator at all', () => {
    ready.add(7);
    const { result } = renderHook(() => useCourseDealer());
    const apply = vi.fn();
    act(() => result.current.deal(7, apply));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.dealing).toBeNull();
    expect(result.current.pendingSeed()).toBeNull();
    expect(pending.size).toBe(0); // never asked to deal
  });

  it('deals an undealt course first, reporting progress, and only then moves', async () => {
    const { result } = renderHook(() => useCourseDealer());
    const apply = vi.fn();
    act(() => result.current.deal(42, apply));
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.dealing).toEqual({ seed: 42, holesDone: 0 });
    expect(result.current.pendingSeed()).toBe(42);

    act(() => pending.get(42)!.progress?.(3));
    expect(result.current.dealing).toEqual({ seed: 42, holesDone: 3 });

    await act(async () => pending.get(42)!.resolve());
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.dealing).toBeNull();
    expect(result.current.pendingSeed()).toBeNull();
  });

  it('lets the latest request win — a newer deal supersedes an older one', async () => {
    const { result } = renderHook(() => useCourseDealer());
    const first = vi.fn();
    const second = vi.fn();
    act(() => result.current.deal(1, first));
    act(() => result.current.deal(2, second));
    // The older deal's progress no longer drives the indicator…
    act(() => pending.get(1)!.progress?.(9));
    expect(result.current.dealing).toEqual({ seed: 2, holesDone: 0 });
    // …and its finish moves nothing.
    await act(async () => pending.get(1)!.resolve());
    expect(first).not.toHaveBeenCalled();
    expect(result.current.dealing).toEqual({ seed: 2, holesDone: 0 });
    await act(async () => pending.get(2)!.resolve());
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('a ready course picked mid-deal moves at once and calls the deal off', async () => {
    ready.add(5);
    const { result } = renderHook(() => useCourseDealer());
    const cold = vi.fn();
    const warm = vi.fn();
    act(() => result.current.deal(1, cold));
    act(() => result.current.deal(5, warm));
    expect(warm).toHaveBeenCalledTimes(1);
    expect(result.current.dealing).toBeNull();
    await act(async () => pending.get(1)!.resolve());
    expect(cold).not.toHaveBeenCalled();
  });

  it('cancel drops a pending move (picking Classic, clearing the code)', async () => {
    const { result } = renderHook(() => useCourseDealer());
    const apply = vi.fn();
    act(() => result.current.deal(3, apply));
    act(() => result.current.cancel());
    expect(result.current.dealing).toBeNull();
    expect(result.current.pendingSeed()).toBeNull();
    await act(async () => pending.get(3)!.resolve());
    expect(apply).not.toHaveBeenCalled();
  });

  it('still moves if dealing fails, so render falls back to the synchronous path', async () => {
    const { result } = renderHook(() => useCourseDealer());
    const apply = vi.fn();
    act(() => result.current.deal(9, apply));
    await act(async () => pending.get(9)!.reject(new Error('boom')));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.dealing).toBeNull();
  });
});

describe('CourseDealing indicator', () => {
  it('names the hole being dealt and shows progress, as a polite status', () => {
    render(<CourseDealing holesDone={2} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Dealing course — hole 3/18…');
    const bar = screen.getByRole('progressbar', { name: 'holes dealt' });
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('18');
  });

  it('never counts past the last hole', () => {
    render(<CourseDealing holesDone={18} />);
    expect(screen.getByRole('status').textContent).toContain('hole 18/18');
  });
});
