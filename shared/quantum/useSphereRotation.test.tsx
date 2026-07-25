// @vitest-environment jsdom
/**
 * useSphereRotation home policy (#58): the view auto-faces the action, but the
 * moment the user drags it stops following — until they reset.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useSphereRotation, type SphereOrientation } from './useSphereRotation';

afterEach(cleanup);

const drag = (result: { current: ReturnType<typeof useSphereRotation> }, dx: number) => {
  act(() => {
    result.current.handlers.onPointerDown({
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      currentTarget: {},
    } as never);
  });
  act(() => {
    result.current.handlers.onPointerMove({ clientX: dx, clientY: 0 } as never);
  });
  act(() => {
    result.current.handlers.onPointerUp({} as never);
  });
};

describe('useSphereRotation home', () => {
  it('starts at the home orientation when one is given', () => {
    const { result } = renderHook(() => useSphereRotation({ home: { yaw: 1.2, pitch: -0.4 } }));
    expect(result.current.yaw).toBeCloseTo(1.2);
    expect(result.current.pitch).toBeCloseTo(-0.4);
  });

  it('drags like a trackball: the sphere follows the finger', () => {
    // Under the Rx(pitch)·Rz(yaw) camera, +yaw moves front content LEFT and
    // +pitch moves it UP — so a rightward drag must DECREASE yaw and a
    // downward drag must DECREASE pitch (front content moves right / down,
    // with the finger). Pins the sign convention (Jan: it turned the other way).
    const { result } = renderHook(() => useSphereRotation({ home: { yaw: 0, pitch: 0 } }));
    act(() => {
      result.current.handlers.onPointerDown({
        clientX: 0,
        clientY: 0,
        pointerId: 1,
        currentTarget: {},
      } as never);
    });
    act(() => {
      result.current.handlers.onPointerMove({ clientX: 50, clientY: 30 } as never);
    });
    expect(result.current.yaw).toBeLessThan(0);
    expect(result.current.pitch).toBeLessThan(0);
  });

  it('falls back to the default orientation without a home', () => {
    const { result } = renderHook(() => useSphereRotation());
    expect(result.current.yaw).toBe(0);
    expect(result.current.pitch).toBeCloseTo(0.35);
  });

  it('snaps to a NEW home while the user has not dragged', () => {
    const { result, rerender } = renderHook(
      ({ home }: { home: SphereOrientation }) => useSphereRotation({ home }),
      { initialProps: { home: { yaw: 0, pitch: 0 } } },
    );
    rerender({ home: { yaw: 1, pitch: 0.5 } });
    expect(result.current.yaw).toBeCloseTo(1);
    expect(result.current.pitch).toBeCloseTo(0.5);
  });

  it('does not fight a user who has dragged', () => {
    const { result, rerender } = renderHook(
      ({ home }: { home: SphereOrientation }) => useSphereRotation({ home }),
      { initialProps: { home: { yaw: 0, pitch: 0 } } },
    );
    drag(result, 50);
    const dragged = result.current.yaw;
    expect(dragged).not.toBe(0);
    rerender({ home: { yaw: 1, pitch: 0.5 } });
    expect(result.current.yaw).toBeCloseTo(dragged);
    expect(result.current.pitch).toBeCloseTo(0);
  });

  it('resets to the CURRENT home and resumes following it', () => {
    const { result, rerender } = renderHook(
      ({ home }: { home: SphereOrientation }) => useSphereRotation({ home }),
      { initialProps: { home: { yaw: 0, pitch: 0 } } },
    );
    drag(result, 50);
    rerender({ home: { yaw: 1, pitch: 0.5 } });
    act(() => result.current.reset());
    expect(result.current.yaw).toBeCloseTo(1);
    expect(result.current.pitch).toBeCloseTo(0.5);
    // Control handed back: the next home change snaps again.
    rerender({ home: { yaw: -0.75, pitch: 0.2 } });
    expect(result.current.yaw).toBeCloseTo(-0.75);
  });

  it('ignores home jitter below the snap threshold', () => {
    const { result, rerender } = renderHook(
      ({ home }: { home: SphereOrientation }) => useSphereRotation({ home }),
      { initialProps: { home: { yaw: 0, pitch: 0 } } },
    );
    rerender({ home: { yaw: 0.001, pitch: 0.001 } });
    expect(result.current.yaw).toBe(0);
  });
});
