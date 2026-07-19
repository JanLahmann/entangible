// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { cameraRoleOffered, framesUrlFromStateUrl, roleRequested } from './cameraRole';

describe('roleRequested', () => {
  it('detects the staff-QR camera trigger', () => {
    expect(roleRequested('?connect=1&role=camera&key=tok')).toBe('camera');
    expect(roleRequested('role=camera')).toBe('camera');
  });
  it('is null without role=camera', () => {
    expect(roleRequested('?connect=1')).toBeNull();
    expect(roleRequested('')).toBeNull();
    expect(roleRequested('?role=viewer')).toBeNull();
  });
});

describe('cameraRoleOffered', () => {
  it('requires BOTH a known host and an operator key', () => {
    expect(cameraRoleOffered({ hostKnown: true, hasKey: true })).toBe(true);
    expect(cameraRoleOffered({ hostKnown: true, hasKey: false })).toBe(false);
    expect(cameraRoleOffered({ hostKnown: false, hasKey: true })).toBe(false);
    expect(cameraRoleOffered({ hostKnown: false, hasKey: false })).toBe(false);
  });
});

describe('framesUrlFromStateUrl', () => {
  it('swaps the /ws/state suffix for /ws/frames on the same host', () => {
    expect(framesUrlFromStateUrl('wss://booth.local:8443/ws/state')).toBe(
      'wss://booth.local:8443/ws/frames',
    );
    expect(framesUrlFromStateUrl('ws://10.0.0.5:8080/ws/state')).toBe(
      'ws://10.0.0.5:8080/ws/frames',
    );
  });
});
