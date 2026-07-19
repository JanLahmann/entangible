// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { CameraRoleSource } from './CameraRoleSource';

// --- Mock WebSocket (carries both the binary frames + JSON state sockets) ----

class MockWebSocket {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;

  static instances: MockWebSocket[] = [];

  readyState: number = MockWebSocket.CONNECTING;
  binaryType = '';
  bufferedAmount = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  static byPath(fragment: string): MockWebSocket {
    const ws = MockWebSocket.instances.find((w) => w.url.includes(fragment));
    if (!ws) throw new Error(`no socket for ${fragment}`);
    return ws;
  }
  get jsonSent(): any[] {
    return this.sent.filter((d) => typeof d === 'string').map((d) => JSON.parse(d as string));
  }
  get binarySends(): unknown[] {
    return this.sent.filter((d) => typeof d !== 'string');
  }
}

/** A canvas stub whose toBlob resolves to a tiny buffer. */
function fakeCanvas(): HTMLCanvasElement {
  return {
    toBlob: (cb: (blob: unknown) => void) =>
      cb({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) }),
  } as unknown as HTMLCanvasElement;
}

function makeSource() {
  return new CameraRoleSource({
    framesUrl: 'wss://host/ws/frames?key=tok',
    stateUrl: 'wss://host/ws/state',
    operatorKey: () => 'tok',
    WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
  });
}

beforeEach(() => {
  MockWebSocket.instances = [];
});

describe('CameraRoleSource', () => {
  it('opens the keyed frames socket and the /ws/state socket on start', () => {
    const src = makeSource();
    src.start();
    const frames = MockWebSocket.byPath('/ws/frames');
    const state = MockWebSocket.byPath('/ws/state');
    expect(frames.url).toBe('wss://host/ws/frames?key=tok');
    expect(frames.binaryType).toBe('arraybuffer');
    expect(state.url).toBe('wss://host/ws/state');
  });

  it('announces as an operator camera and requests the push source on state open', () => {
    const src = makeSource();
    src.start();
    const state = MockWebSocket.byPath('/ws/state');
    state.open();
    const msgs = state.jsonSent;
    // hello carries role 'camera' + the operator key (host grants operator).
    expect(msgs[0]).toMatchObject({ type: 'hello', role: 'camera', key: 'tok' });
    // …then select_camera {kind:'push'} swaps the host onto the push source.
    expect(msgs).toContainEqual({ type: 'select_camera', kind: 'push' });
  });

  it('streams the canvas over the frames socket when it is open', async () => {
    const src = makeSource();
    src.start();
    const frames = MockWebSocket.byPath('/ws/frames');
    frames.open();
    src.offerFrame(fakeCanvas());
    // toBlob → arrayBuffer → send are microtasks; let them drain.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(frames.binarySends.length).toBe(1);
  });

  it('does not stream before the frames socket is open', async () => {
    const src = makeSource();
    src.start();
    src.offerFrame(fakeCanvas());
    await Promise.resolve();
    await Promise.resolve();
    expect(MockWebSocket.byPath('/ws/frames').binarySends.length).toBe(0);
  });

  it('stop() closes both sockets', () => {
    const src = makeSource();
    src.start();
    const frames = MockWebSocket.byPath('/ws/frames');
    const state = MockWebSocket.byPath('/ws/state');
    frames.open();
    state.open();
    src.stop();
    expect(frames.readyState).toBe(MockWebSocket.CLOSED);
    expect(state.readyState).toBe(MockWebSocket.CLOSED);
  });
});
