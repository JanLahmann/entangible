import { describe, it, expect } from 'vitest';
import {
  parseUrlOverrides,
  sanitize,
  createSettingsStore,
  initialDefaults,
  DEFAULT_SETTINGS,
  PHONE_DEFAULT_PANELS,
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

  it('accepts a ?booth= host override (trimmed) and ignores an empty one', () => {
    expect(parseUrlOverrides('?booth=wss://booth.local:8443').boothUrl).toBe(
      'wss://booth.local:8443',
    );
    expect(parseUrlOverrides('?booth=%20%20')).toEqual({}); // whitespace-only → no override
    expect(parseUrlOverrides('?mode=golf')).not.toHaveProperty('boothUrl');
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
      wires: 'compact',
      cameraId: null,
      boothUrl: null,
    });
  });

  it('defaults wires to compact and only accepts "all" to override it', () => {
    expect(sanitize({}).wires).toBe('compact');
    expect(sanitize({ wires: 'bogus' }).wires).toBe('compact');
    expect(sanitize({ wires: 'all' }).wires).toBe('all');
  });

  it('defaults cameraId to null and accepts a non-empty string id', () => {
    expect(sanitize({}).cameraId).toBeNull();
    expect(sanitize({ cameraId: null }).cameraId).toBeNull();
    expect(sanitize({ cameraId: '' }).cameraId).toBeNull(); // empty → automatic
    expect(sanitize({ cameraId: 42 }).cameraId).toBeNull(); // wrong type → automatic
    expect(sanitize({ cameraId: 'cam-b' }).cameraId).toBe('cam-b');
  });

  it('defaults boothUrl to null and keeps a non-empty string (trimmed)', () => {
    expect(sanitize({}).boothUrl).toBeNull();
    expect(sanitize({ boothUrl: '' }).boothUrl).toBeNull();
    expect(sanitize({ boothUrl: '   ' }).boothUrl).toBeNull();
    expect(sanitize({ boothUrl: 42 }).boothUrl).toBeNull(); // wrong type
    expect(sanitize({ boothUrl: '  wss://booth.local:8443 ' }).boothUrl).toBe(
      'wss://booth.local:8443',
    );
  });

  it('persists a booth URL through the store round-trip', () => {
    const storage = fakeStorage();
    const store = createSettingsStore({ storage });
    store.update({ boothUrl: 'wss://booth.local:8443' });
    expect(store.get().boothUrl).toBe('wss://booth.local:8443');
    // A fresh store over the same storage reads it back.
    const reloaded = createSettingsStore({ storage });
    expect(reloaded.get().boothUrl).toBe('wss://booth.local:8443');
    expect(JSON.parse(storage._map.get(STORAGE_KEY)!).boothUrl).toBe('wss://booth.local:8443');
  });
});

describe('cameraId setting', () => {
  it('is null by default with no storage and no url', () => {
    expect(createSettingsStore().get().cameraId).toBeNull();
  });

  it('has no URL override — ?cameraId is ignored', () => {
    const store = createSettingsStore({ search: '?cameraId=cam-b' });
    expect(store.get().cameraId).toBeNull();
  });

  it('persists a chosen camera and reloads it', () => {
    const storage = fakeStorage();
    const store = createSettingsStore({ storage });
    store.update({ cameraId: 'cam-b' });
    expect(store.get().cameraId).toBe('cam-b');
    expect(JSON.parse(storage._map.get(STORAGE_KEY)!).cameraId).toBe('cam-b');
    // A fresh store reading the same storage keeps the persisted choice.
    expect(createSettingsStore({ storage }).get().cameraId).toBe('cam-b');
  });

  it('resets back to automatic (null) on update', () => {
    const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify({ cameraId: 'cam-b' }) });
    const store = createSettingsStore({ storage });
    expect(store.get().cameraId).toBe('cam-b');
    store.update({ cameraId: null });
    expect(store.get().cameraId).toBeNull();
    expect(JSON.parse(storage._map.get(STORAGE_KEY)!).cameraId).toBeNull();
  });
});

describe('wires setting', () => {
  it('parses ?wires=all / ?wires=compact and ignores junk', () => {
    expect(parseUrlOverrides('?wires=all')).toEqual({ wires: 'all' });
    expect(parseUrlOverrides('?wires=compact')).toEqual({ wires: 'compact' });
    expect(parseUrlOverrides('?wires=seven')).toEqual({});
  });

  it('defaults to compact with no storage and no url', () => {
    expect(createSettingsStore().get().wires).toBe('compact');
  });

  it('URL ?wires=all overrides stored compact for the session', () => {
    const storage = fakeStorage({ [STORAGE_KEY]: JSON.stringify({ wires: 'compact' }) });
    const store = createSettingsStore({ storage, search: '?wires=all' });
    expect(store.get().wires).toBe('all');
  });

  it('persists a UI change and a persisted choice wins on reload', () => {
    const storage = fakeStorage();
    const store = createSettingsStore({ storage });
    store.update({ wires: 'all' });
    expect(store.get().wires).toBe('all');
    expect(JSON.parse(storage._map.get(STORAGE_KEY)!).wires).toBe('all');
    // A fresh store reading the same storage keeps the persisted choice.
    expect(createSettingsStore({ storage }).get().wires).toBe('all');
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

describe('initialDefaults (phone-aware panel default)', () => {
  it('returns the desktop defaults when not a phone', () => {
    expect(initialDefaults(false)).toEqual(DEFAULT_SETTINGS);
  });

  it('drops state/qasm to camera+results on a phone', () => {
    expect(initialDefaults(true).panels).toEqual([...PHONE_DEFAULT_PANELS]);
    expect(PHONE_DEFAULT_PANELS).toEqual(['camera', 'results']);
    // Only the panels field differs from the desktop default.
    expect(initialDefaults(true)).toEqual({ ...DEFAULT_SETTINGS, panels: [...PHONE_DEFAULT_PANELS] });
  });
});

describe('phone-default panels vs persistence', () => {
  it('seeds camera+results for a pristine phone (no storage value yet)', () => {
    const storage = fakeStorage();
    const store = createSettingsStore({ storage, isPhone: true });
    expect(store.get().panels).toEqual(['camera', 'results']);
  });

  it('keeps the full desktop default for a pristine non-phone', () => {
    const store = createSettingsStore({ storage: fakeStorage(), isPhone: false });
    expect(store.get().panels).toEqual([...DEFAULT_SETTINGS.panels]);
  });

  it('a persisted choice always wins over the phone default', () => {
    const storage = fakeStorage({
      [STORAGE_KEY]: JSON.stringify({ panels: ['camera', 'results', 'state', 'qasm'] }),
    });
    const store = createSettingsStore({ storage, isPhone: true });
    expect(store.get().panels).toEqual(['camera', 'results', 'state', 'qasm']);
  });

  it('a URL override still wins over the phone default', () => {
    const store = createSettingsStore({
      storage: fakeStorage(),
      isPhone: true,
      search: '?panels=qasm',
    });
    expect(store.get().panels).toEqual(['qasm']);
  });
});
