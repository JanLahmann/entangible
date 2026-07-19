import { describe, it, expect, beforeEach } from 'vitest';
import {
  StateSocket,
  baseBackoff,
  jitteredBackoff,
  defaultStateUrl,
  type StateSnapshot,
} from './stateSocket';
import type {
  CircuitMessage,
  DetectionMessage,
  StatusMessage,
} from './messages';

// --- Mock WebSocket ---------------------------------------------------------

class MockWebSocket {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;

  static instances: MockWebSocket[] = [];

  readyState: number = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  // test helpers
  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  emit(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  emitRaw(data: unknown) {
    this.onmessage?.({ data });
  }
  serverClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}

// Manual timer queue so we can inspect scheduled backoff delays.
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
    /** Run the most recently scheduled callback (the pending reconnect). */
    flushLast() {
      const job = scheduled.pop();
      job?.fn();
    },
  };
}

function makeSocket(random: () => number, clock: ReturnType<typeof makeClock>) {
  return new StateSocket({
    url: 'ws://test/ws/state',
    role: 'display',
    WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    setTimeoutImpl: clock.setTimeoutImpl.bind(clock),
    clearTimeoutImpl: clock.clearTimeoutImpl.bind(clock),
    random,
  });
}

const circuitMsg = (seq: number): CircuitMessage => ({
  type: 'circuit',
  seq,
  circuit: { qubits: 5, gates: [] },
  qasm: 'OPENQASM 2.0;\n',
  source: 'camera',
});

const detectionMsg: DetectionMessage = {
  type: 'detection',
  fps: 12.4,
  board: { found: true, corners: 4, reprojectionErrorMm: 0.05 },
  markers: [{ id: 10, row: 0, col: 0 }],
  warnings: [],
};

const statusMsg: StatusMessage = {
  type: 'status',
  camera: { kind: 'replay', name: 'fixtures/bell', connected: true },
  backend: { enabled: false, healthy: false },
  clients: 2,
};

beforeEach(() => {
  MockWebSocket.instances = [];
});

describe('backoff math', () => {
  it('doubles 500 → 8000 and caps', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(baseBackoff)).toEqual([
      500, 1000, 2000, 4000, 8000, 8000, 8000,
    ]);
  });

  it('max-jitter (random=1) yields exactly the 0.5s→8s cap sequence', () => {
    const seq = [0, 1, 2, 3, 4, 5].map((a) => jitteredBackoff(a, () => 1));
    expect(seq).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });

  it('min-jitter (random=0) halves the base', () => {
    expect(jitteredBackoff(0, () => 0)).toBe(250);
    expect(jitteredBackoff(4, () => 0)).toBe(4000);
  });
});

describe('defaultStateUrl', () => {
  it('infers ws/wss from the page protocol', () => {
    expect(
      defaultStateUrl({ protocol: 'http:', host: 'pi.local:8443' } as Location),
    ).toBe('ws://pi.local:8443/ws/state');
    expect(
      defaultStateUrl({ protocol: 'https:', host: 'pi.local:8443' } as Location),
    ).toBe('wss://pi.local:8443/ws/state');
  });
});

describe('StateSocket connect + hello', () => {
  it('sends a display hello on open and goes to open state', () => {
    const clock = makeClock();
    const sock = makeSocket(() => 1, clock);
    const snaps: StateSnapshot[] = [];
    sock.subscribe((s) => snaps.push(s));
    sock.start();

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe('ws://test/ws/state');
    expect(sock.getSnapshot().connectionState).toBe('connecting');

    ws.open();
    expect(sock.getSnapshot().connectionState).toBe('open');
    expect(JSON.parse(ws.sent[0])).toEqual({ type: 'hello', role: 'display' });
  });

  it('notifies listeners on every state/message change', () => {
    const clock = makeClock();
    const sock = makeSocket(() => 1, clock);
    let notifications = 0;
    sock.subscribe(() => (notifications += 1));
    sock.start();
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.emit(circuitMsg(1));
    ws.emit(detectionMsg);
    ws.emit(statusMsg);
    expect(notifications).toBeGreaterThanOrEqual(4);
    expect(sock.getSnapshot().detection?.fps).toBe(12.4);
    expect(sock.getSnapshot().status?.clients).toBe(2);
  });
});

describe('reconnect backoff sequence', () => {
  it('schedules 500,1000,2000,4000,8000,8000 across successive drops', () => {
    const clock = makeClock();
    const sock = makeSocket(() => 1, clock); // max jitter → base sequence
    sock.start();

    // Simulate a connection that keeps failing before it ever opens, so the
    // attempt counter grows monotonically (a successful open would reset it).
    for (let i = 0; i < 6; i++) {
      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      ws.serverClose();
      expect(sock.getSnapshot().connectionState).toBe('reconnecting');
      clock.flushLast(); // fire the scheduled reconnect → opens a new socket
    }

    expect(clock.delays).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
    // Each reconnect created a fresh socket.
    expect(MockWebSocket.instances.length).toBe(7);
  });

  it('resets backoff to 500 after a successful reconnect', () => {
    const clock = makeClock();
    const sock = makeSocket(() => 1, clock);
    sock.start();

    let ws = MockWebSocket.instances[0];
    ws.open();
    ws.serverClose();
    expect(clock.delays).toEqual([500]);
    clock.flushLast();

    // New socket connects successfully, then drops again.
    ws = MockWebSocket.instances[1];
    ws.open(); // success resets attempt counter
    ws.serverClose();
    expect(clock.delays).toEqual([500, 500]);
  });
});

describe('replay + seq semantics', () => {
  it('ignores a duplicate seq (verbatim replay on reconnect)', () => {
    const clock = makeClock();
    const sock = makeSocket(() => 1, clock);
    sock.start();
    const ws = MockWebSocket.instances[0];
    ws.open();

    ws.emit(circuitMsg(42));
    expect(sock.getSnapshot().lastSeq).toBe(42);

    let changed = false;
    sock.subscribe(() => (changed = true));
    ws.emit(circuitMsg(42)); // duplicate replay
    expect(changed).toBe(false);
    expect(sock.getSnapshot().lastSeq).toBe(42);
  });

  it('accepts a higher seq as a normal forward update', () => {
    const clock = makeClock();
    const sock = makeSocket(() => 1, clock);
    sock.start();
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.emit(circuitMsg(42));
    ws.emit(circuitMsg(43));
    expect(sock.getSnapshot().lastSeq).toBe(43);
  });

  it('accepts a lower seq as a host restart and resets the counter', () => {
    const clock = makeClock();
    const sock = makeSocket(() => 1, clock);
    sock.start();
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.emit(circuitMsg(42));

    // Host restarts: reconnect and replay a fresh low seq.
    ws.serverClose();
    clock.flushLast();
    const ws2 = MockWebSocket.instances[1];
    ws2.open();
    ws2.emit(circuitMsg(1)); // lower than 42 — must be accepted, not discarded
    expect(sock.getSnapshot().lastSeq).toBe(1);
    expect(sock.getSnapshot().circuit?.seq).toBe(1);
  });

  it('replays circuit + detection + status on connect populate the snapshot', () => {
    const clock = makeClock();
    const sock = makeSocket(() => 1, clock);
    sock.start();
    const ws = MockWebSocket.instances[0];
    ws.open();
    // Server replays latest of each immediately after connect.
    ws.emit(circuitMsg(7));
    ws.emit(detectionMsg);
    ws.emit(statusMsg);
    const snap = sock.getSnapshot();
    expect(snap.circuit?.seq).toBe(7);
    expect(snap.detection?.board.corners).toBe(4);
    expect(snap.status?.camera.kind).toBe('replay');
  });
});

describe('robustness', () => {
  it('ignores malformed / non-string frames without throwing', () => {
    const clock = makeClock();
    const sock = makeSocket(() => 1, clock);
    sock.start();
    const ws = MockWebSocket.instances[0];
    ws.open();
    expect(() => ws.emitRaw('{ not json')).not.toThrow();
    expect(() => ws.emitRaw(new ArrayBuffer(4))).not.toThrow();
    expect(() => ws.emit({ type: 'unknown_future', foo: 1 })).not.toThrow();
    expect(sock.getSnapshot().circuit).toBeUndefined();
  });

  it('stop() cancels pending reconnect and marks closed', () => {
    const clock = makeClock();
    const sock = makeSocket(() => 1, clock);
    sock.start();
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.serverClose();
    expect(sock.getSnapshot().connectionState).toBe('reconnecting');
    sock.stop();
    expect(sock.getSnapshot().connectionState).toBe('closed');
    // No new socket should be created after stop.
    clock.flushLast();
    expect(MockWebSocket.instances.length).toBe(1);
  });
});
