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
/**
 * Wire-count DISPLAY mode (docs/pocket.md, "Qubit count"). Purely cosmetic — the
 * physical table and the recognized circuit are ALWAYS five qubits; this only
 * decides how many wires the editor draws. 'compact' shows the used rows
 * (minimum 3, auto-grows to 4/5 as tiles land on q3/q4), 'all' always shows 5.
 */
export type Wires = 'compact' | 'all';

export const PANEL_IDS: readonly PanelId[] = ['camera', 'results', 'state', 'qasm'];

export interface Settings {
  readonly mode: Mode;
  readonly panels: readonly PanelId[];
  readonly side: Side;
  readonly lowpower: boolean;
  readonly debug: boolean;
  readonly wires: Wires;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'composer',
  // Per Jan (2026-07-18): camera + results only, on every device — the calm
  // first impression. State/QASM stay one toggle away in the drawer.
  panels: ['camera', 'results'],
  side: 'right',
  lowpower: false,
  debug: false,
  wires: 'compact',
};

/**
 * Panels a brand-new *phone* visitor sees before touching settings: camera +
 * results only (state / qasm off — no room on a handset). Applied ONLY as the
 * initial default when nothing is persisted yet (design: phone-first). A stored
 * preference — or a URL override — always wins over this.
 */
export const PHONE_DEFAULT_PANELS: readonly PanelId[] = ['camera', 'results'];

/**
 * matchMedia query that means "phone": a narrow (<700px) viewport *or* a short
 * landscape phone (a landscape handset is wider than 700px but under 450px
 * tall). Kept in sync with the phone CSS breakpoints in pocket.css.
 */
export const PHONE_MEDIA_QUERY = '(max-width: 699px), (max-height: 450px)';

/** Initial, never-yet-persisted settings — phone-aware panel default. */
export function initialDefaults(isPhone: boolean): Settings {
  return isPhone ? { ...DEFAULT_SETTINGS, panels: [...PHONE_DEFAULT_PANELS] } : DEFAULT_SETTINGS;
}

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

  const wires = params.get('wires');
  if (wires === 'compact' || wires === 'all') out.wires = wires;

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
  const wires: Wires = r.wires === 'all' ? 'all' : 'compact';
  return {
    mode,
    panels,
    side,
    lowpower: r.lowpower === true,
    debug: r.debug === true,
    wires,
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
  /** When true and nothing is persisted yet, seed the phone panel default. */
  isPhone?: boolean;
}

export function createSettingsStore({ storage, search = '', isPhone = false }: StoreDeps = {}): SettingsStore {
  let persisted: Settings = initialDefaults(isPhone);
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
  const isPhone =
    typeof window.matchMedia === 'function' && window.matchMedia(PHONE_MEDIA_QUERY).matches;
  return createSettingsStore({
    storage: window.localStorage,
    search: window.location.search,
    isPhone,
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
