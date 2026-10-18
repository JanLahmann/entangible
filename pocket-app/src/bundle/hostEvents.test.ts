// @vitest-environment jsdom
/**
 * The bundles' host bridge (src/bundle/hostEvents.ts): a no-op without
 * `window.umami`, the site's exact names and data with it (also when the host
 * injects late), never a throw — and its hard-coded label is the site's.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { HOST_SITE_LABEL, hostTrack } from './hostEvents';
import { SITE_LABEL, eventName, trackGame } from '../app/analytics';

type Win = { umami?: unknown };
const win = window as unknown as Win;

afterEach(() => {
  delete win.umami;
});

describe('hostTrack — the host bridge', () => {
  it('uses the label the site derives from the family manifest', () => {
    expect(HOST_SITE_LABEL).toBe(SITE_LABEL);
  });

  it('does nothing (and does not throw) without a bridge', () => {
    expect(() => hostTrack('runner start', { level: 1 })).not.toThrow();
    win.umami = {};
    expect(() => hostTrack('runner start', { level: 1 })).not.toThrow();
    win.umami = { track: 'not a function' };
    expect(() => hostTrack('runner start', { level: 1 })).not.toThrow();
  });

  it('sends the exact names and cleaned data the site sends', () => {
    const track = vi.fn();
    win.umami = { track };
    const cases: [Parameters<typeof hostTrack>[0], Record<string, string | number | undefined>][] = [
      ['golf hole finished', { qubits: 2, score: 'birdie', course: 'classic' }],
      ['golf round finished', { course: 'random', scope: 'E' }],
      ['runner start', { level: 1 }],
      ['runner finish', { level: 2, score: 17, extra: undefined }],
    ];
    for (const [what, data] of cases) {
      track.mockClear();
      hostTrack(what, data);
      const ours = track.mock.calls[0];
      track.mockClear();
      trackGame(what, data);
      expect(ours, what).toEqual(track.mock.calls[0]);
      expect(ours[0]).toBe(eventName(what));
    }
    hostTrack('runner finish', { level: 2, score: 17, extra: undefined });
    expect(track).toHaveBeenLastCalledWith('Entangible: runner finish', { level: '2', score: '17' });
    // Called as a method of the bridge (a native bridge may rely on `this`).
    expect(track.mock.contexts.at(-1)).toBe(win.umami);
  });

  it('finds a bridge injected after load', () => {
    hostTrack('runner start', { level: 1 });
    const track = vi.fn();
    win.umami = { track };
    hostTrack('golf hole finished', { qubits: 1, score: 'par', course: 'classic' });
    expect(track).toHaveBeenCalledWith('Entangible: golf hole finished', {
      qubits: '1',
      score: 'par',
      course: 'classic',
    });
  });

  it('swallows a throwing bridge', () => {
    win.umami = {
      track: () => {
        throw new Error('bridge down');
      },
    };
    expect(() => hostTrack('runner start', { level: 1 })).not.toThrow();
  });
});
