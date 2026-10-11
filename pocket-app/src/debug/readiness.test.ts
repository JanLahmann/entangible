/**
 * READY traffic-light logic: the full sweep of {camera lost, camera offline,
 * fps 0, board missing} — READY only when none is set — plus the row details
 * staff read at the booth.
 */
import { describe, it, expect } from 'vitest';
import {
  BOARD_RECENT_MS,
  CAMERA_MISSING_HINT,
  FRAME_STALE_MS,
  READINESS_HINTS,
  readiness,
  type ReadinessInput,
} from './readiness';

function green(): ReadinessInput {
  return {
    connectionState: 'open',
    camera: { kind: 'cv2', name: 'cv2:0', connected: true, lost: false },
    fps: 12,
    detectionAgeMs: 200,
    boardFound: true,
    boardSeenAgoMs: 200,
  };
}

const FAULTS = ['cameraLost', 'cameraOffline', 'fps0', 'boardMissing'] as const;
type Fault = (typeof FAULTS)[number];

function withFaults(faults: Set<Fault>): ReadinessInput {
  const input = green();
  input.camera = {
    ...input.camera!,
    lost: faults.has('cameraLost'),
    connected: !faults.has('cameraOffline'),
  };
  if (faults.has('fps0')) input.fps = 0;
  if (faults.has('boardMissing')) input.boardFound = false;
  return input;
}

const COMBOS: Set<Fault>[] = Array.from({ length: 1 << FAULTS.length }, (_, mask) =>
  new Set(FAULTS.filter((_f, i) => mask & (1 << i))),
);

describe('readiness sweep', () => {
  it('covers all 16 combinations', () => {
    expect(COMBOS).toHaveLength(16);
  });

  it.each(COMBOS.map((c) => [[...c].join('+') || 'none', c] as const))(
    'faults: %s',
    (_name, faults) => {
      const { ready, rows } = readiness(withFaults(faults));
      const ok = Object.fromEntries(rows.map((r) => [r.key, r.ok]));
      expect(ok.link).toBe(true);
      expect(ok.camera).toBe(!faults.has('cameraLost') && !faults.has('cameraOffline'));
      expect(ok.frames).toBe(!faults.has('fps0'));
      expect(ok.board).toBe(!faults.has('boardMissing'));
      expect(ready).toBe(faults.size === 0);
    },
  );
});

describe('readiness rows', () => {
  it('always yields the four rows in order, each with its fix hint', () => {
    const { rows } = readiness(green());
    expect(rows.map((r) => r.key)).toEqual(['link', 'camera', 'frames', 'board']);
    for (const r of rows) expect(r.hint).toBe(READINESS_HINTS[r.key]);
  });

  it.each(['connecting', 'reconnecting', 'closed'] as const)(
    'host link %s is not ready',
    (connectionState) => {
      const r = readiness({ ...green(), connectionState });
      expect(r.ready).toBe(false);
      expect(r.rows[0]).toMatchObject({ key: 'link', ok: false, detail: `ws ${connectionState}` });
    },
  );

  it('no status yet → camera red', () => {
    const r = readiness({ ...green(), camera: undefined });
    expect(r.rows[1]).toMatchObject({ ok: false, detail: 'no status from host' });
  });

  it('frames: fps > 0 but stale (no detection for > 3 s) is red', () => {
    const r = readiness({ ...green(), detectionAgeMs: FRAME_STALE_MS + 1000 });
    expect(r.rows[2]).toMatchObject({ ok: false, detail: 'last detection 4s ago' });
    expect(readiness({ ...green(), detectionAgeMs: FRAME_STALE_MS }).rows[2].ok).toBe(true);
  });

  it('frames: no detection ever is red', () => {
    const r = readiness({ ...green(), fps: undefined, detectionAgeMs: null });
    expect(r.rows[2]).toMatchObject({ ok: false, detail: 'no detection yet' });
  });

  it('board: says how long ago it was last seen while it is recent', () => {
    const r = readiness({ ...green(), boardFound: false, boardSeenAgoMs: 7_400 });
    expect(r.rows[3]).toMatchObject({ ok: false, detail: 'board seen 7s ago' });
    const old = readiness({ ...green(), boardFound: false, boardSeenAgoMs: BOARD_RECENT_MS + 1 });
    expect(old.rows[3].detail).toBe('board not seen');
    const never = readiness({ ...green(), boardFound: false, boardSeenAgoMs: null });
    expect(never.rows[3].detail).toBe('board not seen');
  });

  it('camera detail names the source and its state', () => {
    expect(readiness(green()).rows[1].detail).toBe('cv2 (cv2:0) · connected');
    const lost = readiness(withFaults(new Set(['cameraLost'])));
    expect(lost.rows[1].detail).toBe('cv2 (cv2:0) · LOST');
    const offline = readiness(withFaults(new Set(['cameraOffline'])));
    expect(offline.rows[1].detail).toBe('cv2 (cv2:0) · offline');
  });

  it('camera never found: NOT FOUND with the reason and a plug-in hint', () => {
    const r = readiness({
      ...green(),
      camera: {
        kind: 'cv2',
        name: 'cv2:0',
        connected: false,
        lost: false,
        missing: true,
        reason: 'could not open camera 0 (/dev/video0)',
      },
    });
    expect(r.ready).toBe(false);
    expect(r.rows[1]).toMatchObject({
      ok: false,
      detail: 'cv2 (cv2:0) · NOT FOUND (could not open camera 0 (/dev/video0))',
      hint: CAMERA_MISSING_HINT,
    });
    expect(CAMERA_MISSING_HINT).toMatch(/USB camera.*QAMPOSER_SOURCE/);
  });
});
