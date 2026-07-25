/**
 * Shared view-rotation interaction for the Q-sphere and Bloch views.
 *
 * VIEW motion only (per the Quantum Golf spec) and drag-only, matching the IBM
 * Quantum Composer Q-sphere ("select, hold, and drag to rotate"): pointer-drag
 * rotates (yaw free, pitch clamped ±80°); there is NO idle auto-spin. Orientation
 * is reset via an explicit control (`reset`, wired to the panel's rewind-arrow
 * button), not a double-tap. The hook owns yaw/pitch and returns pointer handlers
 * to spread onto the SVG.
 *
 * An optional `home` orientation lets a view point itself at the action (#58):
 * it is the starting orientation, `reset()` returns to whatever home is CURRENT,
 * and a NEW home snaps the view — but only while the user has not dragged. Once
 * they have taken the view over we never fight them; `reset()` hands control back.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { clampPitch } from './qsphere';

const DRAG_GAIN = 0.008; // rad per px
/** Home changes below this (rad, summed over yaw+pitch) are not worth a snap. */
const HOME_EPS = 0.01;

export interface SphereOrientation {
  readonly yaw: number;
  readonly pitch: number;
}

export interface SphereRotation {
  readonly yaw: number;
  readonly pitch: number;
  readonly dragging: boolean;
  /** Return the view to its current home orientation. */
  readonly reset: () => void;
  readonly handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}

export function useSphereRotation(
  initial: { yaw?: number; pitch?: number; home?: SphereOrientation } = {},
): SphereRotation {
  const homeYaw = initial.home ? initial.home.yaw : initial.yaw ?? 0;
  const homePitch = clampPitch(initial.home ? initial.home.pitch : initial.pitch ?? 0.35);

  const [yaw, setYaw] = useState(homeYaw);
  const [pitch, setPitch] = useState(homePitch);
  const [dragging, setDragging] = useState(false);

  const draggingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  // The home last applied (or last seen while the user was in control) and
  // whether the user has taken the view over since.
  const homeRef = useRef<SphereOrientation>({ yaw: homeYaw, pitch: homePitch });
  const userMovedRef = useRef(false);

  useEffect(() => {
    const prev = homeRef.current;
    if (Math.abs(prev.yaw - homeYaw) + Math.abs(prev.pitch - homePitch) < HOME_EPS) return;
    homeRef.current = { yaw: homeYaw, pitch: homePitch };
    if (userMovedRef.current) return; // don't fight a user-chosen orientation
    setYaw(homeYaw);
    setPitch(homePitch);
  }, [homeYaw, homePitch]);

  const reset = useCallback(() => {
    userMovedRef.current = false;
    setYaw(homeYaw);
    setPitch(homePitch);
  }, [homeYaw, homePitch]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    lastRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current || !lastRef.current) return;
    const dx = e.clientX - lastRef.current.x;
    const dy = e.clientY - lastRef.current.y;
    lastRef.current = { x: e.clientX, y: e.clientY };
    if (dx !== 0 || dy !== 0) userMovedRef.current = true;
    setYaw((y) => y + dx * DRAG_GAIN);
    setPitch((p) => clampPitch(p + dy * DRAG_GAIN));
  }, []);

  const endDrag = useCallback(() => {
    draggingRef.current = false;
    setDragging(false);
    lastRef.current = null;
  }, []);

  return {
    yaw,
    pitch,
    dragging,
    reset,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
