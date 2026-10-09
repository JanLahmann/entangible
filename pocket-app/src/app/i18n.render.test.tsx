// @vitest-environment jsdom
/**
 * German on the REAL surfaces — smoke tests that the language actually reaches
 * the screen, not just the message files.
 *
 * Each case renders a surface under `LangProvider` in German and checks that a
 * known German line is there AND that the English line it replaces is not (a
 * key the component forgot to read would leak English). Covered: the welcome
 * card, the settings drawer (including switching back to English and the
 * stored choice), golf (scorecard header + the goal line), and the kiosk
 * (golf, composer footer, connect-pending screen).
 *
 * Also pinned: `?lang=` names a language and nothing else — it is NOT a
 * welcome-card bypass, so a `?lang=de` visitor still gets the three paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import type { Circuit } from '@qamposer/react';
import type { StateSnapshot } from '@shared/ws/stateSocket';

// Hold every random-course deal: it never completes, so nothing generates.
vi.mock('@quantum/golfRandom', async (importOriginal) => {
  const real = await importOriginal<typeof import('@quantum/golfRandom')>();
  return { ...real, isCourseReady: () => false, prepareCourse: () => new Promise(() => {}) };
});

// The kiosk's live socket, replaced by a snapshot the case sets.
let snapshot: StateSnapshot;
vi.mock('../kiosk/kioskSocket', () => ({
  useKioskState: () => snapshot,
  getKioskSocket: () => ({ getSnapshot: () => snapshot, send: () => true }),
  kioskStanding: (s: StateSnapshot) => (s.operator === true ? 'operator' : 'viewer'),
}));

import { App } from './App';
import { KioskView } from '../kiosk/KioskView';
import { DEFAULT_SETTINGS, parseUrlOverrides, settingsStore } from './settings';
import { boothLink } from './boothLink';
import { WELCOME_BYPASS_PARAMS, welcomeBypassed, welcomeEligible } from './welcome';
import { LANG_STORAGE_KEY, LangProvider, type Lang } from '@shared/i18n';

vi.setConfig({ testTimeout: 30_000 });

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Open the app the way a visitor's browser would: this URL, empty storage. */
async function openApp(search = '', lang?: Lang) {
  window.history.replaceState(null, '', `/${search}`);
  window.localStorage.clear();
  settingsStore.update({ ...DEFAULT_SETTINGS, ...parseUrlOverrides(search) });
  const utils = render(
    <LangProvider lang={lang}>
      <App />
    </LangProvider>,
  );
  await act(async () => {});
  return utils;
}

function welcomePaths(): string[] {
  const group = document.querySelector('.pk-welcome-paths');
  if (!group) return [];
  return [...group.querySelectorAll('.pk-welcome-path-title')].map((el) => el.textContent ?? '');
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve(null) })));
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
});
afterEach(() => {
  cleanup();
  boothLink.disconnect();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  document.documentElement.lang = '';
});

describe('?lang= is a language, not a destination', () => {
  it('is not a welcome bypass param', () => {
    expect(WELCOME_BYPASS_PARAMS).not.toContain('lang');
    expect(welcomeBypassed('?lang=de')).toBe(false);
    expect(welcomeBypassed('?lang=en')).toBe(false);
    expect(
      welcomeEligible({
        search: '?lang=de',
        status: 'idle',
        connected: false,
        cameraRole: false,
        mode: 'composer',
      }),
    ).toBe(true);
  });

  it('a ?lang=de visitor gets the three-path welcome — in German', async () => {
    await openApp('?lang=de');
    expect(welcomePaths()).toEqual([
      'Kamera aufs Brett richten',
      'Am Bildschirm bauen',
      'Quanten-Golf spielen',
    ]);
    expect(document.documentElement.lang).toBe('de');
    expect(screen.queryByText('Point your camera at the board')).toBeNull();
    expect(screen.getByText(/Neu hier\? Lies die Anleitung/)).toBeTruthy();
  });

  it('defaults to English in tests (jsdom is en-US) — nothing German leaks', async () => {
    await openApp();
    expect(welcomePaths()[0]).toBe('Point your camera at the board');
    expect(document.documentElement.lang).toBe('en');
    expect(screen.queryByText('Kamera aufs Brett richten')).toBeNull();
  });
});

describe('the settings drawer in German', () => {
  it('shows the German drawer, staff group included, and switches back to English', async () => {
    await openApp('', 'de');
    fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }));
    const labels = () =>
      [...document.querySelectorAll('.pk-drawer .pk-label')].map((el) => el.textContent);
    expect(labels()).toEqual(
      expect.arrayContaining(['Language / Sprache', 'Modus', 'Eingabe', 'Rauschen', 'Energie']),
    );
    expect(labels()).not.toContain('Mode');
    expect(screen.getByRole('switch', { name: 'Stromsparmodus' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Low-power mode' })).toBeNull();

    // The staff group is translated too.
    fireEvent.click(screen.getByRole('button', { name: /Standteam & Erweitert/ }));
    expect(labels()).toEqual(expect.arrayContaining(['Brett', 'Seitenleiste', 'Stand']));
    expect(screen.getByRole('switch', { name: 'Debug-Ansicht' })).toBeTruthy();

    // The Language pills: Deutsch is on; English switches, persists, and
    // re-words the drawer in place.
    expect(screen.getByRole('button', { name: 'Deutsch' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(labels()).toContain('Mode');
    expect(screen.getByRole('switch', { name: 'Low-power mode' })).toBeTruthy();
  });

  it('a stored choice opens the next page in that language', async () => {
    window.localStorage.setItem(LANG_STORAGE_KEY, 'de');
    window.history.replaceState(null, '', '/');
    settingsStore.update({ ...DEFAULT_SETTINGS });
    render(
      <LangProvider>
        <App />
      </LangProvider>,
    );
    await act(async () => {});
    expect(welcomePaths()[1]).toBe('Am Bildschirm bauen');
  });
});

describe('golf in German', () => {
  it('words the scorecard and the goal line in German', async () => {
    await openApp('?mode=golf&input=manual', 'de');
    expect(screen.getByText(/Scorekarte · Leicht · Loch 1\/18/)).toBeTruthy();
    const goal = document.querySelector('.pk-golf-goal');
    expect(goal?.textContent).toBe('Ziel: eine faire 50/50-Münze.');
    expect(screen.getByText(/E1 — Überlagerung/)).toBeTruthy();
    expect(screen.getAllByText('Quanten-Golf').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Scorecard ·/)).toBeNull();
    expect(screen.queryByText('Goal: a fair 50/50 coin.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Klassische 18' })).toBeTruthy();
  });
});

// ------------------------------------------------------------------- kiosk

const bell: Circuit = {
  qubits: 5,
  gates: [
    { id: 'H-0', type: 'H', position: 0, qubit: 0 },
    { id: 'CX-1', type: 'CNOT', position: 1, control: 0, target: 1 },
  ],
} as Circuit;

function kioskSnapshot(mode: string, circuit: Circuit): StateSnapshot {
  return {
    connectionState: 'open',
    lastSeq: 1,
    circuit: { type: 'circuit', seq: 1, circuit, qasm: 'OPENQASM 2.0;', source: 'replay' },
    detection: {
      type: 'detection',
      fps: 30,
      board: { found: true, corners: 4, reprojectionErrorMm: 1 },
      markers: [],
      warnings: [],
    },
    status: {
      type: 'status',
      camera: { kind: 'replay', connected: true },
      backend: { enabled: false, healthy: false },
      clients: 1,
    },
    layout: { type: 'layout', mode, sidebar: 'right', panels: ['results', 'state'], wires: 'compact' },
  } as unknown as StateSnapshot;
}

function renderKiosk() {
  return render(
    <LangProvider lang="de">
      <KioskView />
    </LangProvider>,
  );
}

describe('the kiosk in German (?kiosk&lang=de)', () => {
  it('golf: German scorecard, goal line and mode pill', () => {
    snapshot = kioskSnapshot('golf', bell);
    const { container } = renderKiosk();
    expect(screen.getByText(/Scorekarte · Leicht · Loch 1\/18/)).toBeTruthy();
    expect(container.querySelector('.bo-golf-goal')?.textContent).toBe(
      'Ziel: eine faire 50/50-Münze.',
    );
    expect(screen.getByText('Golf')).toBeTruthy();
    expect(screen.queryByText('golf')).toBeNull();
    expect(screen.queryByText(/Goal:/)).toBeNull();
  });

  it('composer: German panels and footer hint, no English leaking', () => {
    snapshot = kioskSnapshot('composer', bell);
    const { container } = renderKiosk();
    const labels = [...container.querySelectorAll('.bo-label')].map((el) => el.textContent);
    expect(labels).toContain('Zustand');
    expect(labels).not.toContain('State');
    expect(container.querySelector('.bo-footer')?.textContent).toMatch(/Plättchen|Qubit|CNOT/);
    expect(container.querySelector('.bo-footer')?.textContent).not.toMatch(/\btiles?\b/);
    expect(screen.getByText('live')).toBeTruthy();
  });

  it('connect-pending screen', () => {
    snapshot = { connectionState: 'connecting', lastSeq: null } as StateSnapshot;
    renderKiosk();
    expect(screen.getByText('Verbinde mit dem Stand…')).toBeTruthy();
    expect(screen.queryByText(/Connecting to the booth/)).toBeNull();
  });
});
