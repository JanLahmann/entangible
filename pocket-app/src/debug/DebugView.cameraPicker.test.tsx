// @vitest-environment jsdom
/**
 * /debug Camera card: scanning is on demand only (it opens real devices on the
 * host), each found source gets a select pill that sends `select_camera`, the
 * live `status.camera` marks the active one, and replays are labelled as the
 * recorded demo loop.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

let dbgSnap: Record<string, unknown>;
const sendMessage = vi.fn((_msg?: unknown) => true);
vi.mock('./debugSocket', () => ({
  useDebugState: () => dbgSnap,
  getDebugSocket: () => ({ sendMessage }),
}));
vi.mock('@shared/ws/operatorKey', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, getOperatorKey: () => 'test-key', withKey: (u: string) => `${u}?key=test-key` };
});

import { DebugView } from './DebugView';

const SCAN = {
  active: 'cv2:0',
  cameras: [
    { spec: 'cv2:0', kind: 'cv2', index: 0, ok: true, width: null, height: null, active: true },
    { spec: 'cv2:2', kind: 'cv2', index: 2, ok: true, width: 1280, height: 720, active: false },
    { spec: 'cv2:3', kind: 'cv2', index: 3, ok: false, width: null, height: null, active: false },
  ],
  picamera2: true,
  replays: ['bell-sequence'],
  push: true,
};

function snapshot(camera: Record<string, unknown>) {
  return {
    connectionState: 'open',
    operator: true,
    detection: { type: 'detection', fps: 12, board: { found: true, corners: 4, reprojectionErrorMm: 0.1 }, markers: [], warnings: [] },
    status: { type: 'status', camera, backend: { enabled: false, healthy: false }, clients: 1 },
    layout: { type: 'layout', mode: 'composer', sidebar: 'right', panels: [], wires: 'compact', noise: 'off', menu: null },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sendMessage.mockClear();
  dbgSnap = snapshot({ kind: 'cv2', name: 'cv2:0', connected: true, lost: false });
  fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      url.startsWith('/api/cameras')
        ? { ok: true, json: () => Promise.resolve(SCAN) }
        : { ok: false, json: () => Promise.resolve(null) },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cameraCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/cameras'));
const source = (key: string) => document.querySelector(`[data-source="${key}"]`) as HTMLElement;

async function scan() {
  fireEvent.click(screen.getByRole('button', { name: 'Scan cameras' }));
  await waitFor(() => expect(source('cv2:2')).not.toBeNull());
}

describe('/debug Camera card', () => {
  it('shows the live camera line and never scans until asked', () => {
    render(<DebugView />);
    expect(screen.getAllByText('cv2 (cv2:0) · connected').length).toBeGreaterThan(0);
    expect(cameraCalls()).toHaveLength(0);
  });

  it('scans with the operator key and lists every source', async () => {
    render(<DebugView />);
    await scan();
    expect(cameraCalls()).toEqual([['/api/cameras?key=test-key']]);
    for (const key of ['cv2:0', 'cv2:2', 'cv2:3', 'picamera2', 'push', 'replay:bell-sequence']) {
      expect(source(key)).not.toBeNull();
    }
    expect(source('cv2:2').textContent).toContain('1280×720');
    expect(source('cv2:0').textContent).toContain('in use by the pipeline');
    expect(source('cv2:3').textContent).toContain('opens but no frame');
  });

  it('labels replays as the recorded demo loop', async () => {
    render(<DebugView />);
    await scan();
    expect(source('replay:bell-sequence').textContent).toContain('recorded demo loop');
  });

  it('marks the live source active', async () => {
    render(<DebugView />);
    await scan();
    const pressed = (key: string) => source(key).querySelector('button')!.getAttribute('aria-pressed');
    expect(pressed('cv2:0')).toBe('true');
    expect(source('cv2:0').textContent).toContain('active');
    expect(pressed('cv2:2')).toBe('false');
    expect(pressed('replay:bell-sequence')).toBe('false');
  });

  it('marks a replay active by its recording name', async () => {
    dbgSnap = snapshot({ kind: 'replay', name: 'bell-sequence', connected: true });
    render(<DebugView />);
    await scan();
    expect(source('replay:bell-sequence').querySelector('button')!.getAttribute('aria-pressed')).toBe('true');
    expect(source('cv2:0').querySelector('button')!.getAttribute('aria-pressed')).toBe('false');
  });

  it.each([
    ['cv2:2', { type: 'select_camera', kind: 'cv2', index: 2 }],
    ['picamera2', { type: 'select_camera', kind: 'picamera2' }],
    ['push', { type: 'select_camera', kind: 'push' }],
    ['replay:bell-sequence', { type: 'select_camera', kind: 'replay', name: 'bell-sequence' }],
  ])('selecting %s sends select_camera', async (key, expected) => {
    render(<DebugView />);
    await scan();
    fireEvent.click(source(key).querySelector('button')!);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expected);
  });

  it('reports a failed scan', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }));
    render(<DebugView />);
    fireEvent.click(screen.getByRole('button', { name: 'Scan cameras' }));
    await waitFor(() => expect(screen.getByText(/scan failed/)).not.toBeNull());
  });
});
