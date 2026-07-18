import { describe, it, expect } from 'vitest';
import {
  StreamController,
  framesSocketUrl,
  canCapture,
  DEFAULT_MAX_BUFFERED_BYTES,
} from './streamController';

/** A fake monotonic clock in ms, advanced manually by the test. */
function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
    set(ms: number) {
      t = ms;
    },
  };
}

describe('StreamController pacing', () => {
  it('sends at most once per frame interval (10 fps → every 100 ms)', () => {
    const clock = makeClock();
    const c = new StreamController({ targetFps: 10, now: clock.now });
    const input = { bufferedAmount: 0, hidden: false };

    // First call at t=0 is due (lastCaptureAt = -inf).
    expect(c.decide(input).send).toBe(true);
    c.markSent();

    // Immediately after: paced, not sent.
    const paced = c.decide(input);
    expect(paced.send).toBe(false);
    expect(paced.reason).toBe('paced');

    // 99 ms later: still paced.
    clock.advance(99);
    expect(c.decide(input).reason).toBe('paced');

    // 100 ms total: due again.
    clock.advance(1);
    const due = c.decide(input);
    expect(due.send).toBe(true);
    c.markSent();

    expect(c.sentCount).toBe(2);
    // Pacing skips are never counted as drops.
    expect(c.droppedCount).toBe(0);
  });
});

describe('StreamController backpressure', () => {
  it('skips (and counts a drop) when bufferedAmount exceeds the cap', () => {
    const clock = makeClock();
    const c = new StreamController({ targetFps: 10, now: clock.now });

    // Due, but the socket buffer is over the cap → backpressure skip.
    const over = c.decide({ bufferedAmount: DEFAULT_MAX_BUFFERED_BYTES + 1, hidden: false });
    expect(over.send).toBe(false);
    expect(over.reason).toBe('backpressure');
    expect(c.droppedCount).toBe(1);
    expect(c.sentCount).toBe(0);

    // Buffer drains; still same instant, still due (no capture happened yet).
    const ok = c.decide({ bufferedAmount: 0, hidden: false });
    expect(ok.send).toBe(true);
  });

  it('exactly at the cap is allowed (strictly-greater skip)', () => {
    const clock = makeClock();
    const c = new StreamController({ targetFps: 10, now: clock.now });
    const atCap = c.decide({ bufferedAmount: DEFAULT_MAX_BUFFERED_BYTES, hidden: false });
    expect(atCap.send).toBe(true);
  });
});

describe('StreamController in-flight adaptivity', () => {
  it('skips while a previous capture is still in flight and counts the drop', () => {
    const clock = makeClock();
    const c = new StreamController({ targetFps: 10, now: clock.now });

    // Capture 1 starts (in flight, not yet marked sent).
    expect(c.decide({ bufferedAmount: 0, hidden: false }).send).toBe(true);

    // Next interval arrives but the blob/send hasn't resolved → in-flight skip.
    clock.advance(100);
    const blocked = c.decide({ bufferedAmount: 0, hidden: false });
    expect(blocked.send).toBe(false);
    expect(blocked.reason).toBe('in-flight');
    expect(c.droppedCount).toBe(1);

    // Send resolves; now a capture is allowed again.
    c.markSent();
    clock.advance(100);
    expect(c.decide({ bufferedAmount: 0, hidden: false }).send).toBe(true);
  });

  it('markSendFailed clears in-flight without counting a sent frame', () => {
    const clock = makeClock();
    const c = new StreamController({ targetFps: 10, now: clock.now });
    expect(c.decide({ bufferedAmount: 0, hidden: false }).send).toBe(true);
    c.markSendFailed();
    expect(c.sentCount).toBe(0);
    clock.advance(100);
    // Not in flight anymore → next due frame sends.
    expect(c.decide({ bufferedAmount: 0, hidden: false }).send).toBe(true);
  });
});

describe('StreamController hidden-tab pause', () => {
  it('never sends while hidden and does not count hidden skips as drops', () => {
    const clock = makeClock();
    const c = new StreamController({ targetFps: 10, now: clock.now });

    for (let i = 0; i < 5; i += 1) {
      const d = c.decide({ bufferedAmount: 0, hidden: true });
      expect(d.send).toBe(false);
      expect(d.reason).toBe('hidden');
      clock.advance(200);
    }
    expect(c.droppedCount).toBe(0);
    expect(c.sentCount).toBe(0);

    // Becomes visible → resumes immediately.
    expect(c.decide({ bufferedAmount: 0, hidden: false }).send).toBe(true);
  });
});

describe('StreamController fps estimate', () => {
  it('reports the sent rate over the rolling window with a fake clock', () => {
    const clock = makeClock();
    const c = new StreamController({ targetFps: 10, fpsWindowMs: 1000, now: clock.now });

    // Send 10 frames spaced 100 ms apart → a full second of history.
    for (let i = 0; i < 10; i += 1) {
      const d = c.decide({ bufferedAmount: 0, hidden: false });
      expect(d.send).toBe(true);
      c.markSent();
      clock.advance(100);
    }
    // At t=1000 the window holds timestamps 0..900 (cutoff = 0, kept) → 10 fps.
    expect(c.fps()).toBeCloseTo(10, 5);

    // Idle for 2 s → window empties → 0 fps.
    clock.advance(2000);
    expect(c.fps()).toBe(0);
  });
});

describe('framesSocketUrl', () => {
  it('uses wss for https origins and ws otherwise', () => {
    expect(framesSocketUrl({ protocol: 'https:', host: 'lan:8443' } as Location)).toBe(
      'wss://lan:8443/ws/frames',
    );
    expect(framesSocketUrl({ protocol: 'http:', host: 'localhost:8443' } as Location)).toBe(
      'ws://localhost:8443/ws/frames',
    );
  });

  it('derives from the ambient location when none is passed', () => {
    // jsdom provides window.location (http://localhost) → ws:// + /ws/frames.
    const url = framesSocketUrl();
    expect(url).toMatch(/^wss?:\/\/.+\/ws\/frames$/);
    expect(url.startsWith('ws://')).toBe(true);
  });
});

describe('canCapture', () => {
  it('requires a secure context and getUserMedia', () => {
    const gum = { getUserMedia: () => Promise.resolve({} as MediaStream) } as unknown as MediaDevices;
    expect(canCapture({ isSecureContext: true }, { mediaDevices: gum } as Navigator)).toBe(true);
    expect(canCapture({ isSecureContext: false }, { mediaDevices: gum } as Navigator)).toBe(false);
    expect(canCapture({ isSecureContext: true }, {} as Navigator)).toBe(false);
  });
});
