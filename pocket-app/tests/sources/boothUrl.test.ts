import { describe, it, expect } from 'vitest';
import {
  normalizeBoothUrl,
  connectRequested,
  connectionPill,
  cameraSwitchAction,
} from '../../src/sources/boothUrl';

describe('normalizeBoothUrl', () => {
  it('maps http(s) → ws(s) and pins the /ws/state path', () => {
    expect(normalizeBoothUrl('https://booth.local:8443')).toBe('wss://booth.local:8443/ws/state');
    expect(normalizeBoothUrl('http://booth.local:8443')).toBe('ws://booth.local:8443/ws/state');
  });

  it('accepts ws(s) URLs as-is (path replaced with /ws/state)', () => {
    expect(normalizeBoothUrl('wss://booth.local:8443')).toBe('wss://booth.local:8443/ws/state');
    expect(normalizeBoothUrl('ws://pi.local')).toBe('ws://pi.local/ws/state');
    // Any user-typed path/query is dropped in favor of /ws/state.
    expect(normalizeBoothUrl('wss://booth.local:8443/pocket?connect=1')).toBe(
      'wss://booth.local:8443/ws/state',
    );
  });

  it('assumes a secure wss for a bare host and trims whitespace', () => {
    expect(normalizeBoothUrl('booth.local:8443')).toBe('wss://booth.local:8443/ws/state');
    expect(normalizeBoothUrl('  booth.local:8443  ')).toBe('wss://booth.local:8443/ws/state');
  });

  it('returns null for empty / host-less input', () => {
    expect(normalizeBoothUrl(null)).toBeNull();
    expect(normalizeBoothUrl('')).toBeNull();
    expect(normalizeBoothUrl('   ')).toBeNull();
    expect(normalizeBoothUrl('http://')).toBeNull(); // maps to ws:// with no host
    expect(normalizeBoothUrl('wss://')).toBeNull(); // no host
  });
});

describe('connectRequested', () => {
  it('is true only for a truthy ?connect', () => {
    expect(connectRequested('?connect=1')).toBe(true);
    expect(connectRequested('connect=true')).toBe(true);
    expect(connectRequested('?connect=0')).toBe(false);
    expect(connectRequested('?foo=1')).toBe(false);
    expect(connectRequested('')).toBe(false);
  });
});

describe('connectionPill', () => {
  it('labels each phase', () => {
    expect(connectionPill('open').label).toMatch(/viewing/i);
    expect(connectionPill('connecting').label).toMatch(/connecting/i);
    expect(connectionPill('closed').label).toMatch(/disconnect/i);
  });
});

describe('cameraSwitchAction (source switch local ⇄ booth restores camera)', () => {
  it('stops and remembers a running camera when connecting', () => {
    expect(cameraSwitchAction(true, true, false)).toEqual({
      stop: true,
      start: false,
      remember: true,
    });
  });

  it('stops but does not remember an idle camera when connecting', () => {
    expect(cameraSwitchAction(true, false, false)).toEqual({
      stop: true,
      start: false,
      remember: false,
    });
  });

  it('resumes the camera on disconnect only when it was running before', () => {
    expect(cameraSwitchAction(false, false, true)).toEqual({
      stop: false,
      start: true,
      remember: false,
    });
    expect(cameraSwitchAction(false, false, false)).toEqual({
      stop: false,
      start: false,
      remember: false,
    });
  });

  it('round-trips: connect while running → disconnect resumes', () => {
    const onConnect = cameraSwitchAction(true, true, false);
    expect(onConnect.stop).toBe(true);
    // App stores `remember` and passes it back as `wasRunning` on disconnect.
    const onDisconnect = cameraSwitchAction(false, false, onConnect.remember);
    expect(onDisconnect.start).toBe(true);
  });
});
