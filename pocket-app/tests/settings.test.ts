import { describe, it, expect } from 'vitest';
import {
  parseUrlOverrides,
  sanitize,
  createSettingsStore,
  DEFAULT_SETTINGS,
  STORAGE_KEY,
} from '../src/app/settings';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe('parseUrlOverrides', () => {
  it('parses the full recognized param set', () => {
    const o = parseUrlOverrides('?mode=golf&debug=1&panels=camera,results&side=left&lowpower=1');
    expect(o).toEqual({
      mode: 'golf',
      debug: true,
      panels: ['camera', 'results'],
      side: 'left',
      lowpower: true,
    });
  });

  it('ignores unknown / invalid values', () => {
    expect(parseUrlOverrides('?mode=bogus&side=up&debug=maybe')).toEqual({});
    expect(parseUrlOverrides('')).toEqual({});
  });

  it('accepts a leading-? or bare query string and dedupes panels', () => {
    expect(parseUrlOverrides('panels=state,state,qasm,junk').panels).toEqual(['state', 'qasm']);
  });

  it('parses boolean synonyms', () => {
    expect(parseUrlOverrides('?debug=true&lowpower=0')).toEqual({ debug: true, lowpower: false });
  });
});

describe('sanitize', () => {
  it('fills defaults and coerces bad input', () => {
    expect(sanitize(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitize({ mode: 'golf', panels: ['x', 'qasm'], side: 'left', debug: true })).toEqual({
      mode: 'golf',
      panels: ['qasm'],
      side: 'left',
      lowpower: false,
      debug: true,
    });
  });
});

describe('createSettingsStore', () => {
  it('returns defaults with no storage and no url', () => {
    const store = createSettingsStore();
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
  });

  it('loads persisted settings from storage', () => {
    const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify({ mode: 'golf', side: 'left' }) });
    const store = createSettingsStore({ storage });
    expect(store.get().mode).toBe('golf');
    expect(store.get().side).toBe('left');
  });

  it('URL overrides win over stored settings for the session', () => {
    const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify({ mode: 'composer' }) });
    const store = createSettingsStore({ storage, search: '?mode=golf' });
    expect(store.get().mode).toBe('golf');
  });

  it('does not touch storage until a UI change', () => {
    const storage = fakeStorage();
    createSettingsStore({ storage, search: '?mode=golf&debug=1' });
    expect(storage._map.has(STORAGE_KEY)).toBe(false);
  });

  it('persists on update and clears the URL override for the touched key', () => {
    const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify({ mode: 'composer', side: 'right' }) });
    const store = createSettingsStore({ storage, search: '?mode=golf' });
    expect(store.get().mode).toBe('golf'); // url override active

    store.update({ mode: 'composer' }); // user explicitly picks composer
    expect(store.get().mode).toBe('composer'); // override cleared, choice wins
    expect(JSON.parse(storage._map.get(STORAGE_KEY)!).mode).toBe('composer');
  });

  it('togglePanel adds and removes a panel and notifies subscribers', () => {
    const storage = fakeStorage();
    const store = createSettingsStore({ storage });
    let notified = 0;
    store.subscribe(() => notified++);

    expect(store.get().panels.includes('qasm')).toBe(false);
    store.togglePanel('qasm');
    expect(store.get().panels).toContain('qasm');
    store.togglePanel('camera');
    expect(store.get().panels).not.toContain('camera');
    expect(notified).toBe(2);
    expect(JSON.parse(storage._map.get(STORAGE_KEY)!).panels).toEqual(store.get().panels);
  });

  it('an unchanged key keeps its URL override even after another key is updated', () => {
    const storage = fakeStorage();
    const store = createSettingsStore({ storage, search: '?mode=golf&side=left' });
    store.update({ debug: true });
    expect(store.get().mode).toBe('golf'); // still overridden
    expect(store.get().side).toBe('left');
    expect(store.get().debug).toBe(true);
  });
});
