import { describe, it, expect } from 'vitest';
import {
  normalizeBoothUrl,
  connectRequested,
  connectionPill,
  cameraSwitchAction,
} from '../../src/sources/boothUrl';
import { de } from '@shared/i18n/de';

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

  it('turns red with the camera-lost line while the booth camera is lost', () => {
    expect(connectionPill('open', true)).toEqual({
      label: 'Camera lost — check the cable',
      cls: 'is-off',
    });
    expect(connectionPill('open', false).cls).toBe('is-live');
    // Not connected: the connection phase is the more urgent news.
    expect(connectionPill('closed', true).label).toMatch(/disconnect/i);
  });

  it('says "No camera found" when the booth never had a camera', () => {
    expect(connectionPill('open', 'missing')).toEqual({
      label: 'No camera found — plug in a USB camera, or set QAMPOSER_SOURCE',
      cls: 'is-off',
    });
    expect(connectionPill('open', 'lost').label).toBe('Camera lost — check the cable');
    expect(connectionPill('open', null).cls).toBe('is-live');
    expect(connectionPill('open', 'missing', de).label).toMatch(/^Keine Kamera gefunden/);
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
