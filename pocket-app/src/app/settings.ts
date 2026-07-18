/**
 * Pocket settings — typed, localStorage-persisted, URL-overridable.
 *
 * Serverless equivalent of the booth's /debug controls (docs/pocket.md,
 * "Settings, debug, golf"). Everything lives in `localStorage`
 * (`entangible.pocket.settings`); URL params override the stored value for the
 * session (`?mode=golf&debug=1&panels=camera,results&side=left&lowpower=1`) but
 * never touch storage until the user changes a field through the drawer — at
 * which point that field is persisted and its URL override is dropped.
 *
 * The store is a tiny factory (injectable `storage` + `search` for tests) plus
 * a `window`-backed singleton and a `useSettings` hook via useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react';

export type Mode = 'composer' | 'golf';
export type Side = 'left' | 'right';
export type PanelId = 'camera' | 'results' | 'state' | 'qasm';

export const PANEL_IDS: readonly PanelId[] = ['camera', 'results', 'state', 'qasm'];

export interface Settings {
  readonly mode: Mode;
  readonly panels: readonly PanelId[];
  readonly side: Side;
  readonly lowpower: boolean;
  readonly debug: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'composer',
  panels: ['camera', 'results', 'state'],
  side: 'right',
  lowpower: false,
  debug: false,
};

export const STORAGE_KEY = 'entangible.pocket.settings';

// --- pure helpers -----------------------------------------------------------

function parseBool(v: string | null): boolean | undefined {
  if (v === null) return undefined;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return undefined;
}

function parsePanels(v: string | null): PanelId[] | undefined {
  if (v === null) return undefined;
  const parts = v
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is PanelId => (PANEL_IDS as readonly string[]).includes(s));
  // De-dupe while preserving order.
  const seen = new Set<PanelId>();
  const out: PanelId[] = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/** A mutable settings patch (Settings fields are readonly). */
type MutableSettings = { -readonly [K in keyof Settings]?: Settings[K] };

/** Parse the recognized subset of URL query params into a settings patch. */
export function parseUrlOverrides(search: string): Partial<Settings> {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const out: MutableSettings = {};

  const mode = params.get('mode');
  if (mode === 'composer' || mode === 'golf') out.mode = mode;

  const side = params.get('side');
  if (side === 'left' || side === 'right') out.side = side;

  const debug = parseBool(params.get('debug'));
  if (debug !== undefined) out.debug = debug;

  const lowpower = parseBool(params.get('lowpower'));
  if (lowpower !== undefined) out.lowpower = lowpower;

  const panels = parsePanels(params.get('panels'));
  if (panels !== undefined) out.panels = panels;

  return out;
}

/** Coerce arbitrary parsed JSON into a valid Settings, filling from defaults. */
export function sanitize(raw: unknown): Settings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const mode: Mode = r.mode === 'golf' ? 'golf' : 'composer';
  const side: Side = r.side === 'left' ? 'left' : 'right';
  const panels = Array.isArray(r.panels)
    ? (r.panels.filter((p): p is PanelId => (PANEL_IDS as readonly string[]).includes(p as string)) as PanelId[])
    : [...DEFAULT_SETTINGS.panels];
  return {
    mode,
    panels,
    side,
    lowpower: r.lowpower === true,
    debug: r.debug === true,
  };
}

// --- store factory ----------------------------------------------------------

export interface SettingsStore {
  get(): Settings;
  /** Apply a UI change: takes effect, persists, and clears any URL override for the touched keys. */
  update(patch: Partial<Settings>): void;
  togglePanel(panel: PanelId): void;
  subscribe(listener: () => void): () => void;
}

interface StoreDeps {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  search?: string;
}

export function createSettingsStore({ storage, search = '' }: StoreDeps = {}): SettingsStore {
  let persisted: Settings = DEFAULT_SETTINGS;
  if (storage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) persisted = sanitize(JSON.parse(raw));
    } catch {
      /* corrupt storage → defaults */
    }
  }

  let overrides = parseUrlOverrides(search);
  let effective: Settings = { ...persisted, ...overrides };

  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };

  const recompute = () => {
    effective = { ...persisted, ...overrides };
  };

  return {
    get: () => effective,
    update(patch) {
      persisted = { ...persisted, ...patch };
      // The user has spoken: their explicit choice wins over the URL override.
      const next = { ...overrides };
      for (const key of Object.keys(patch)) delete (next as Record<string, unknown>)[key];
      overrides = next;
      recompute();
      if (storage) {
        try {
          storage.setItem(STORAGE_KEY, JSON.stringify(persisted));
        } catch {
          /* best-effort persistence */
        }
      }
      emit();
    },
    togglePanel(panel) {
      const has = effective.panels.includes(panel);
      const panels = has
        ? effective.panels.filter((p) => p !== panel)
        : [...effective.panels, panel];
      this.update({ panels });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// --- singleton + hook -------------------------------------------------------

function browserStore(): SettingsStore {
  if (typeof window === 'undefined') return createSettingsStore();
  return createSettingsStore({
    storage: window.localStorage,
    search: window.location.search,
  });
}

export const settingsStore: SettingsStore = browserStore();

export function useSettings(): Settings {
  return useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.get,
    settingsStore.get,
  );
}
