// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { FrameStreamer } from './frameStreamer';

// --- Mock binary WebSocket --------------------------------------------------

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
  serverClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  /** Binary sends (skip the JSON hello string). */
  get binarySends(): unknown[] {
    return this.sent.filter((d) => typeof d !== 'string');
  }
}

function makeClock() {
  const scheduled: { fn: () => void; ms: number; id: number }[] = [];
  let nextId = 1;
  return {
    delays: [] as number[],
    setTimeoutImpl(fn: () => void, ms: number) {
      const id = nextId++;
      scheduled.push({ fn, ms, id });
      this.delays.push(ms);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutImpl(id: ReturnType<typeof setTimeout>) {
      const idx = scheduled.findIndex((s) => s.id === (id as unknown as number));
      if (idx >= 0) scheduled.splice(idx, 1);
    },
    flushLast() {
      const job = scheduled.pop();
      job?.fn();
    },
  };
}

/** A monotonic fake clock in ms for the pacing controller. */
function fakeNow() {
  const state = { t: 0 };
  return { now: () => state.t, advance: (ms: number) => (state.t += ms), state };
}

const buf = () => new ArrayBuffer(8);
const encodeOk = () => Promise.resolve<ArrayBuffer | null>(buf());

beforeEach(() => {
  MockWebSocket.instances = [];
});

describe('FrameStreamer', () => {
  it('sets binaryType and reports connecting → open', () => {
    const clock = makeClock();
    const s = new FrameStreamer({
      url: 'wss://host/ws/frames?key=abc',
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      setTimeoutImpl: clock.setTimeoutImpl.bind(clock),
      clearTimeoutImpl: clock.clearTimeoutImpl.bind(clock),
    });
    s.start();
    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe('wss://host/ws/frames?key=abc');
    expect(ws.binaryType).toBe('arraybuffer');
    expect(s.getStatus().connection).toBe('connecting');
    ws.open();
    expect(s.getStatus().connection).toBe('open');
  });

  it('does not encode/send before the socket is open', async () => {
    const s = new FrameStreamer({
      url: 'wss://host/ws/frames',
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });
    s.start();
    let encoded = 0;
    s.offerFrame(false, () => {
      encoded += 1;
      return encodeOk();
    });
    await Promise.resolve();
    expect(encoded).toBe(0);
  });

  it('encodes + sends a due frame and counts it', async () => {
    const clk = fakeNow();
    const s = new FrameStreamer({
      url: 'wss://host/ws/frames',
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      controller: { targetFps: 10, now: clk.now },
    });
    s.start();
    MockWebSocket.instances[0].open();
    s.offerFrame(false, encodeOk);
    await Promise.resolve();
    await Promise.resolve();
    expect(MockWebSocket.instances[0].binarySends.length).toBe(1);
    expect(s.getStatus().sent).toBe(1);
  });

  it('paces to the target fps (a second immediate offer is skipped)', async () => {
    const clk = fakeNow();
    const s = new FrameStreamer({
      url: 'wss://host/ws/frames',
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      controller: { targetFps: 10, now: clk.now },
    });
    s.start();
    const ws = MockWebSocket.instances[0];
    ws.open();
    s.offerFrame(false, encodeOk); // due
    await Promise.resolve();
    await Promise.resolve();
    s.offerFrame(false, encodeOk); // <100ms later → paced, skipped
    await Promise.resolve();
    expect(ws.binarySends.length).toBe(1);
    clk.advance(100);
    s.offerFrame(false, encodeOk); // now due again
    await Promise.resolve();
    await Promise.resolve();
    expect(ws.binarySends.length).toBe(2);
  });

  it('drops frames under backpressure (bufferedAmount over the cap)', async () => {
    const clk = fakeNow();
    const s = new FrameStreamer({
      url: 'wss://host/ws/frames',
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      controller: { targetFps: 1000, now: clk.now, maxBufferedBytes: 1000 },
    });
    s.start();
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.bufferedAmount = 5000; // over cap
    s.offerFrame(false, encodeOk);
    await Promise.resolve();
    expect(ws.binarySends.length).toBe(0);
    expect(s.getStatus().dropped).toBe(1);
  });

  it('reconnects with backoff after an unexpected close', () => {
    const clock = makeClock();
    const s = new FrameStreamer({
      url: 'wss://host/ws/frames',
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      setTimeoutImpl: clock.setTimeoutImpl.bind(clock),
      clearTimeoutImpl: clock.clearTimeoutImpl.bind(clock),
      random: () => 1, // max jitter → exact 500ms first delay
    });
    s.start();
    MockWebSocket.instances[0].open();
    MockWebSocket.instances[0].serverClose();
    expect(s.getStatus().connection).toBe('reconnecting');
    expect(clock.delays).toEqual([500]);
    clock.flushLast();
    expect(MockWebSocket.instances.length).toBe(2);
  });

  it('stop() closes and does not reconnect', () => {
    const clock = makeClock();
    const s = new FrameStreamer({
      url: 'wss://host/ws/frames',
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      setTimeoutImpl: clock.setTimeoutImpl.bind(clock),
      clearTimeoutImpl: clock.clearTimeoutImpl.bind(clock),
    });
    s.start();
    MockWebSocket.instances[0].open();
    s.stop();
    expect(s.getStatus().connection).toBe('closed');
    MockWebSocket.instances[0].serverClose();
    expect(clock.delays).toEqual([]); // no reconnect scheduled
  });
});
