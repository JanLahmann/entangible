// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  OPERATOR_KEY_STORAGE,
  clearOperatorKey,
  getOperatorKey,
  storeOperatorKey,
  withKey,
} from './operatorKey';

function setUrl(search: string): void {
  window.history.replaceState({}, '', `/pocket/${search}`);
}

beforeEach(() => {
  window.localStorage.clear();
  setUrl('');
});

describe('operator key — URL ingest + scrub', () => {
  it('reads ?key= from the URL, persists it, and scrubs it from the address bar', () => {
    setUrl('?connect=1&role=camera&key=secret-tok');
    expect(getOperatorKey()).toBe('secret-tok');
    // Persisted for later loads…
    expect(window.localStorage.getItem(OPERATOR_KEY_STORAGE)).toBe('secret-tok');
    // …and the credential no longer lingers in the visible URL.
    expect(window.location.search).not.toContain('key=');
    expect(window.location.search).not.toContain('secret-tok');
    // Other params survive the scrub (the camera-role trigger must still work).
    const params = new URLSearchParams(window.location.search);
    expect(params.get('connect')).toBe('1');
    expect(params.get('role')).toBe('camera');
  });

  it('falls back to the stored key once the URL has been scrubbed', () => {
    setUrl('?key=abc');
    expect(getOperatorKey()).toBe('abc');
    expect(window.location.search).toBe('');
    // A second resolve (URL now clean) returns the stored value.
    expect(getOperatorKey()).toBe('abc');
  });

  it('returns null when no key is present anywhere', () => {
    expect(getOperatorKey()).toBeNull();
  });

  it('withKey appends the key only when one is available', () => {
    expect(withKey('wss://host/ws/frames')).toBe('wss://host/ws/frames');
    storeOperatorKey('tok');
    expect(withKey('wss://host/ws/frames')).toBe('wss://host/ws/frames?key=tok');
    expect(withKey('wss://host/ws/frames?x=1')).toBe('wss://host/ws/frames?x=1&key=tok');
  });

  it('clearOperatorKey forgets the stored token', () => {
    storeOperatorKey('tok');
    expect(getOperatorKey()).toBe('tok');
    clearOperatorKey();
    expect(getOperatorKey()).toBeNull();
  });
});
