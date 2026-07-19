import { describe, it, expect } from 'vitest';
import {
  BoothSocketSource,
  snapshotToUpdate,
  connectionPhase,
  detectionWarningToInput,
} from '../../src/sources/BoothSocketSource';
import type { StateSnapshot } from '@shared/ws/stateSocket';
import type { StateUpdate } from '../../src/sources/StateSource';

// --- Mock WebSocket (mirrors the shared stateSocket test) -------------------

class MockWebSocket {
  static OPEN = 1 as const;
  static CLOSED = 3 as const;
  static instances: MockWebSocket[] = [];

  readyState = 0;
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
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
  emit(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

function makeSource() {
  MockWebSocket.instances = [];
  const source = new BoothSocketSource({
    url: 'wss://booth.local:8443/ws/state',
    WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    setTimeoutImpl: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeoutImpl: () => {},
    random: () => 1,
  });
  return source;
}

describe('snapshotToUpdate (pure mapping)', () => {
  const fallback = { qubits: 5, gates: [] } as StateUpdate['circuit'];

  it('maps circuit + qasm + detection warnings + layout + connection', () => {
    const circuitObj = { qubits: 5, gates: [{ id: 'h-0-0' }] } as StateUpdate['circuit'];
    const snap = {
      connectionState: 'open',
      lastSeq: 5,
      circuit: { type: 'circuit', seq: 5, circuit: circuitObj, qasm: 'OPENQASM 2.0;\n', source: 'camera' },
      detection: {
        type: 'detection',
        fps: 10,
        board: { found: true, corners: 4, reprojectionErrorMm: 0 },
        markers: [],
        warnings: [{ code: 'lone_control', message: 'lonely', col: 2 }],
      },
      layout: {
        type: 'layout',
        mode: 'golf',
        sidebar: 'right',
        panels: ['results'],
        wires: 'all',
        noise: 'heron',
      },
    } as unknown as StateSnapshot;

    const update = snapshotToUpdate(snap, fallback);
    expect(update.source).toBe('booth');
    expect(update.circuit).toBe(circuitObj);
    expect(update.qasm).toBe('OPENQASM 2.0;\n');
    expect(update.warnings).toEqual([{ code: 'lone_control', col: 2, message: 'lonely' }]);
    expect(update.boothMode).toBe('golf');
    expect(update.boothWires).toBe('all');
    expect(update.boothNoise).toBe('heron');
    expect(update.connection).toBe('open');
  });

  it('falls back to the provided circuit before the first circuit message', () => {
    const snap = { connectionState: 'connecting', lastSeq: null } as StateSnapshot;
    const update = snapshotToUpdate(snap, fallback);
    expect(update.circuit).toBe(fallback);
    expect(update.qasm).toBeUndefined();
    expect(update.warnings).toEqual([]);
    expect(update.boothMode).toBeUndefined();
    expect(update.boothNoise).toBeUndefined();
    expect(update.connection).toBe('connecting');
  });

  it('collapses booth mode "attract" to composer (pocket has no attract)', () => {
    const snap = {
      connectionState: 'open',
      lastSeq: null,
      layout: { type: 'layout', mode: 'attract', sidebar: 'right', panels: [], wires: 'compact' },
    } as unknown as StateSnapshot;
    expect(snapshotToUpdate(snap, fallback).boothMode).toBe('composer');
  });
});

describe('connectionPhase', () => {
  it('collapses reconnecting into connecting', () => {
    expect(connectionPhase('open')).toBe('open');
    expect(connectionPhase('connecting')).toBe('connecting');
    expect(connectionPhase('reconnecting')).toBe('connecting');
    expect(connectionPhase('closed')).toBe('closed');
  });
});

describe('detectionWarningToInput', () => {
  it('preserves code/col/message', () => {
    expect(detectionWarningToInput({ code: 'cell_conflict', message: 'x', col: 3 })).toEqual({
      code: 'cell_conflict',
      col: 3,
      message: 'x',
    });
    // Missing col becomes undefined (not null) for the shared envelope.
    expect(detectionWarningToInput({ code: 'off_grid', message: 'y' }).col).toBeUndefined();
  });
});

describe('BoothSocketSource — viewer policy (read-only)', () => {
  it('sends only a keyless display hello and NEVER any select_* control', () => {
    const source = makeSource();
    const updates: StateUpdate[] = [];
    source.subscribe((u) => updates.push(u));
    source.start();

    const ws = MockWebSocket.instances[0];
    ws.open();

    // Drive a full booth conversation at the source.
    ws.emit({ type: 'hello_ack', role: 'viewer' });
    ws.emit({ type: 'status', camera: { kind: 'replay', connected: true }, backend: { enabled: false, healthy: false }, clients: 3 });
    ws.emit({ type: 'layout', mode: 'golf', sidebar: 'right', panels: ['results'], wires: 'all' });
    ws.emit({ type: 'circuit', seq: 1, circuit: { qubits: 5, gates: [] }, qasm: '', source: 'camera' });
    ws.emit({ type: 'detection', fps: 9, board: { found: true, corners: 4, reprojectionErrorMm: 0 }, markers: [], warnings: [] });

    // The ONLY frame ever sent is the hello — a plain viewer, no key.
    expect(ws.sent).toHaveLength(1);
    const hello = JSON.parse(ws.sent[0]);
    // A plain viewer hello: display role, courtesy client label, NO key.
    expect(hello).toEqual({ type: 'hello', role: 'display', client: 'pocket-viewer' });
    expect(hello.key).toBeUndefined();
    expect(hello.role).not.toBe('operator');

    // Absolutely no control message leaked (grep the raw wire).
    for (const frame of ws.sent) {
      expect(frame).not.toContain('select_');
      expect(frame).not.toContain('operator');
    }

    // And it still mapped booth state into neutral updates.
    const last = updates.at(-1)!;
    expect(last.source).toBe('booth');
    expect(last.boothMode).toBe('golf');
    expect(last.connection).toBe('open');

    source.stop();
  });

  it('emits an initial connecting update on start (for the status pill)', () => {
    const source = makeSource();
    const updates: StateUpdate[] = [];
    source.subscribe((u) => updates.push(u));
    source.start();
    expect(updates[0]?.connection).toBe('connecting');
    source.stop();
  });
});
