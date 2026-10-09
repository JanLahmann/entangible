// @vitest-environment jsdom
/**
 * /debug READY traffic light: the banner + four-row checklist rendered from the
 * live debug-socket snapshot — READY only when every row is green, a fix hint
 * on every red row, and the clock-driven rows (stale frames, "board seen Xs
 * ago") advancing without new messages.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, act } from '@testing-library/react';
import { READINESS_HINTS } from './readiness';

let dbgSnap: Record<string, unknown>;
vi.mock('./debugSocket', () => ({
  useDebugState: () => dbgSnap,
  getDebugSocket: () => ({ sendMessage: vi.fn(() => true) }),
}));
vi.mock('@shared/ws/operatorKey', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, getOperatorKey: () => 'test-key', withKey: (u: string) => u };
});

import { DebugView } from './DebugView';

interface Faults {
  cameraLost?: boolean;
  cameraOffline?: boolean;
  fps0?: boolean;
  boardMissing?: boolean;
  disconnected?: boolean;
}

function snapshot(f: Faults = {}): Record<string, unknown> {
  return {
    connectionState: f.disconnected ? 'reconnecting' : 'open',
    operator: true,
    detection: {
      type: 'detection',
      fps: f.fps0 ? 0 : 12,
      board: { found: !f.boardMissing, corners: f.boardMissing ? 0 : 4, reprojectionErrorMm: 0.1 },
      markers: [],
      warnings: [],
    },
    status: {
      type: 'status',
      camera: { kind: 'cv2', name: 'cv2:0', connected: !f.cameraOffline, lost: !!f.cameraLost },
      backend: { enabled: false, healthy: false },
      clients: 1,
    },
    layout: { type: 'layout', mode: 'composer', sidebar: 'right', panels: [], wires: 'compact', noise: 'off', menu: null },
  };
}

const banner = () => screen.getByRole('status');
const row = (key: string) => document.querySelector(`[data-check="${key}"]`) as HTMLElement;

beforeEach(() => {
  dbgSnap = snapshot();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) })));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('/debug READY banner', () => {
  it('is READY with every row green and no hints', () => {
    render(<DebugView />);
    expect(banner().textContent).toBe('READY');
    expect(banner().className).toContain('debug__ready-banner--ok');
    for (const key of ['link', 'camera', 'frames', 'board']) {
      expect(row(key).dataset.ok).toBe('true');
      expect(row(key).textContent).toContain('✓');
    }
    for (const hint of Object.values(READINESS_HINTS)) expect(screen.queryByText(hint)).toBeNull();
  });

  it('is NOT READY when the camera is lost, with the camera fix hint', () => {
    dbgSnap = snapshot({ cameraLost: true });
    render(<DebugView />);
    expect(banner().textContent).toBe('NOT READY');
    expect(banner().className).toContain('debug__ready-banner--no');
    expect(row('camera').dataset.ok).toBe('false');
    expect(row('camera').textContent).toContain('✗');
    expect(row('camera').textContent).toContain(READINESS_HINTS.camera);
  });

  it('renders every row hint when everything is red', () => {
    dbgSnap = snapshot({ disconnected: true, cameraOffline: true, fps0: true, boardMissing: true });
    render(<DebugView />);
    expect(banner().textContent).toBe('NOT READY');
    expect(row('link').textContent).toContain(READINESS_HINTS.link);
    expect(row('camera').textContent).toContain(READINESS_HINTS.camera);
    expect(row('frames').textContent).toContain(READINESS_HINTS.frames);
    expect(row('board').textContent).toContain(READINESS_HINTS.board);
  });

  // The mandated sweep, end to end through the component.
  const FAULT_KEYS = ['cameraLost', 'cameraOffline', 'fps0', 'boardMissing'] as const;
  const combos = Array.from({ length: 16 }, (_, mask) =>
    Object.fromEntries(FAULT_KEYS.map((k, i) => [k, !!(mask & (1 << i))])) as Faults,
  );
  it.each(combos.map((c) => [FAULT_KEYS.filter((k) => c[k]).join('+') || 'none', c] as const))(
    'sweep faults: %s',
    (_name, faults) => {
      dbgSnap = snapshot(faults);
      render(<DebugView />);
      const anyFault = FAULT_KEYS.some((k) => faults[k]);
      expect(banner().textContent).toBe(anyFault ? 'NOT READY' : 'READY');
      expect(row('camera').dataset.ok).toBe(String(!faults.cameraLost && !faults.cameraOffline));
      expect(row('frames').dataset.ok).toBe(String(!faults.fps0));
      expect(row('board').dataset.ok).toBe(String(!faults.boardMissing));
    },
  );

  it('turns NOT READY when detections stop arriving for > 3 s', () => {
    vi.useFakeTimers();
    render(<DebugView />);
    expect(banner().textContent).toBe('READY');
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(banner().textContent).toBe('NOT READY');
    expect(row('frames').textContent).toContain('last detection 4s ago');
    expect(row('frames').textContent).toContain(READINESS_HINTS.frames);
  });

  it('says how long ago the board was last seen', () => {
    vi.useFakeTimers();
    const { rerender } = render(<DebugView />);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    dbgSnap = snapshot({ boardMissing: true });
    rerender(<DebugView />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(row('board').dataset.ok).toBe('false');
    expect(row('board').textContent).toContain('board seen 3s ago');
  });
});
