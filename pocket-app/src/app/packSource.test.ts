// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { fetchHostPack, useResolvedPack, _clearPackCache } from './packSource';

/** A minimal client-valid custom pack (id `bistro`, 2 items / 1 qubit). */
const bistroWire = {
  id: 'bistro',
  title: 'Le Bistro',
  tagline: 'Quantum plates',
  serve: { mode: 'single' },
  items: [
    { code: '0', name: 'Soup', emoji: '🍲' },
    { code: '1', name: 'Salad', emoji: '🥗' },
  ],
};

function okResponse(json: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
}
function status(code: number) {
  return Promise.resolve({ ok: false, status: code, json: () => Promise.resolve(null) });
}

beforeEach(() => {
  _clearPackCache();
  vi.restoreAllMocks();
});
afterEach(cleanup);

describe('fetchHostPack', () => {
  it('fetches + validates a host pack and normalizes it', async () => {
    const fetchMock = vi.fn(() => okResponse(bistroWire));
    vi.stubGlobal('fetch', fetchMock);
    const pack = await fetchHostPack('', 'bistro');
    expect(pack?.id).toBe('bistro');
    // validatePack normalizes: 1-qubit pack, both codes filled → no padding.
    expect(pack?.qubits).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/menu/pack/bistro');
  });

  it('caches by id — a second call does not re-fetch', async () => {
    const fetchMock = vi.fn(() => okResponse(bistroWire));
    vi.stubGlobal('fetch', fetchMock);
    await fetchHostPack('', 'bistro');
    await fetchHostPack('', 'bistro');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null (cached) on a 404, without a second fetch', async () => {
    const fetchMock = vi.fn(() => status(404));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchHostPack('', 'ghost')).toBeNull();
    expect(await fetchHostPack('', 'ghost')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null on an invalid pack schema', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okResponse({ id: 'bad', title: 'Bad' /* no items */ })));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await fetchHostPack('', 'bad')).toBeNull();
  });
});

describe('useResolvedPack', () => {
  it('resolves a built-in id synchronously (no fetch, not loading)', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useResolvedPack('cocktails'));
    expect(result.current.pack.id).toBe('cocktails');
    expect(result.current.loading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to coffee, then upgrades when the host fetch lands', async () => {
    vi.stubGlobal('fetch', vi.fn(() => okResponse(bistroWire)));
    const { result } = renderHook(() => useResolvedPack('bistro'));
    // Immediately: coffee fallback while the fetch is in flight.
    expect(result.current.pack.id).toBe('coffee');
    expect(result.current.loading).toBe(true);
    // After the fetch resolves: the custom pack, no longer loading.
    await waitFor(() => expect(result.current.pack.id).toBe('bistro'));
    expect(result.current.loading).toBe(false);
  });

  it('keeps coffee when the host fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => status(404)));
    const { result } = renderHook(() => useResolvedPack('ghost'));
    expect(result.current.pack.id).toBe('coffee');
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pack.id).toBe('coffee');
  });

  it('resolves a null id to coffee without fetching', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useResolvedPack(null));
    expect(result.current.pack.id).toBe('coffee');
    expect(result.current.loading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
