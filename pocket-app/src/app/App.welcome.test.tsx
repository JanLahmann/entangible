// @vitest-environment jsdom
/**
 * The welcome card's three paths, and the golf goal line, on the REAL app shell.
 *
 * Each case opens the app the way a visitor's first page load would: the URL
 * set, storage empty, and the settings store holding exactly what it computes
 * on a fresh load (defaults + that URL's overrides, via the store's own
 * `parseUrlOverrides`). The shell is imported ONCE — re-importing it per case
 * is seconds of module evaluation each — and the random-course dealer is held
 * (a shared `?course=` link would otherwise deal a whole course in the
 * background of the test run).
 *
 * Covered:
 *   - the idle composer landing shows three paths, camera first and primary;
 *   - "Play Quantum Golf" switches the mode (through the same settings write
 *     as the drawer) and builds on screen; "Build on screen" goes manual;
 *   - every purposeful arrival keeps today's card: `?course=`, `?scope=`,
 *     `?menu=`, `?role=camera`, `?connect=1`, and the `?kiosk` surface;
 *   - the golf goal line renders under the target in every mode × setting
 *     combination the sidebar has (camera / on-screen input × compact / all
 *     wires), and is absent outside golf.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';

// Hold every random-course deal: it never completes, so nothing generates.
vi.mock('@quantum/golfRandom', async (importOriginal) => {
  const real = await importOriginal<typeof import('@quantum/golfRandom')>();
  return { ...real, isCourseReady: () => false, prepareCourse: () => new Promise(() => {}) };
});

import { App } from './App';
import { DEFAULT_SETTINGS, parseUrlOverrides, settingsStore } from './settings';
import { boothLink } from './boothLink';
import { detectSurface } from './surface';
import { welcomeBypassed, welcomeEligible } from './welcome';
import { LangProvider } from '@shared/i18n';

// The first render pays for the editor/sphere/vision module graph.
vi.setConfig({ testTimeout: 30_000 });

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Open the app the way a visitor's browser would: this URL, empty storage. */
async function openApp(search = '') {
  window.history.replaceState(null, '', `/${search}`);
  window.localStorage.clear();
  settingsStore.update({ ...DEFAULT_SETTINGS, ...parseUrlOverrides(search) });
  const utils = render(<App />);
  // Let the mount effects (served-by-host probe, course code, URL triggers) settle.
  await act(async () => {});
  return { ...utils, settingsStore };
}

const PATHS = ['Point your camera at the board', 'Build on screen', 'Play Quantum Golf'];

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
});

describe('welcome card — three paths on the idle landing', () => {
  it('offers the camera (primary, first), build on screen and Quantum Golf', async () => {
    await openApp();
    expect(welcomePaths()).toEqual(PATHS);
    const primary = document.querySelector('.pk-welcome-path--primary');
    expect(primary?.textContent).toContain('Point your camera at the board');
    // The two-sentence explainer stays.
    expect(screen.getByText(/build a quantum circuit with your hands/)).toBeTruthy();
    // The plain card's camera instructions are what the paths replace.
    expect(screen.queryByText('Point your iPad at the board')).toBeNull();
  });

  it('"Play Quantum Golf" enters golf, built on screen', async () => {
    const { settingsStore } = await openApp();
    fireEvent.click(screen.getByRole('button', { name: /Play Quantum Golf/ }));
    await act(async () => {});
    expect(settingsStore.get().mode).toBe('golf');
    expect(settingsStore.get().input).toBe('manual');
    // The golf surface is up: mode pill, the hole's scorecard, no welcome.
    expect(screen.getAllByText('Quantum Golf').length).toBeGreaterThan(0);
    expect(screen.getByText(/Scorecard · Easy · hole 1\/18/)).toBeTruthy();
    expect(welcomePaths()).toEqual([]);
  });

  it('"Build on screen" switches to the on-screen editor', async () => {
    const { settingsStore } = await openApp();
    fireEvent.click(screen.getByRole('button', { name: /^Build on screen/ }));
    await act(async () => {});
    expect(settingsStore.get().input).toBe('manual');
    expect(settingsStore.get().mode).toBe('composer');
    expect(welcomePaths()).toEqual([]);
  });
});

/**
 * axe `aria-prohibited-attr`: aria-label / aria-labelledby are prohibited on
 * elements whose role is generic (div, span, …) or text-level. The camera
 * status pill was a bare `<span aria-label>` (the entangible.org scan). This
 * walks the rendered shell — EN and DE, the welcome card up — and requires
 * every naming attribute to sit on an element that may carry one.
 */
const NAMEABLE_TAGS = new Set([
  'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'NAV', 'MAIN', 'ASIDE', 'SECTION',
  'FORM', 'DIALOG', 'IMG', 'SVG', 'IFRAME', 'VIDEO', 'CANVAS', 'TABLE', 'METER',
  'PROGRESS', 'OUTPUT', 'DETAILS', 'FIELDSET', 'UL', 'OL', 'LI', 'HEADER', 'FOOTER',
]);
const NAME_PROHIBITED_ROLES = new Set([
  'generic', 'presentation', 'none', 'caption', 'code', 'deletion', 'emphasis',
  'insertion', 'paragraph', 'strong', 'subscript', 'superscript', 'term', 'time',
]);

function prohibitedNamings(root: ParentNode): string[] {
  return [...root.querySelectorAll('[aria-label], [aria-labelledby]')]
    .filter((el) => {
      const role = el.getAttribute('role');
      if (role) return NAME_PROHIBITED_ROLES.has(role.trim().split(/\s+/)[0]);
      return !NAMEABLE_TAGS.has(el.tagName.toUpperCase());
    })
    .map((el) => el.outerHTML.slice(0, 120));
}

describe('home page — no aria-prohibited-attr (EN + DE)', () => {
  it.each(['en', 'de'] as const)('%s: every aria-label sits on a nameable role', async (lang) => {
    window.history.replaceState(null, '', '/');
    window.localStorage.clear();
    settingsStore.update({ ...DEFAULT_SETTINGS });
    render(
      <LangProvider lang={lang}>
        <App />
      </LangProvider>,
    );
    await act(async () => {});
    // The welcome card is up, so the scan covers it too.
    expect(document.querySelector('.pk-welcome-paths')).not.toBeNull();
    expect(prohibitedNamings(document.body)).toEqual([]);
    // The camera status pill keeps its accessible name, now on an image role.
    const pill = document.querySelector('.pk-topbar .pk-pill:not(.pk-pill--mode)');
    expect(pill?.getAttribute('role')).toBe('img');
    expect(pill?.getAttribute('aria-label')).toBeTruthy();
  });

  it('the on-screen build pill names itself by its visible text', async () => {
    window.history.replaceState(null, '', '/');
    window.localStorage.clear();
    settingsStore.update({ ...DEFAULT_SETTINGS, input: 'manual' });
    render(<App />);
    await act(async () => {});
    expect(document.querySelector('.pk-pill--manual')).not.toBeNull();
    expect(prohibitedNamings(document.body)).toEqual([]);
  });

  it('the check itself flags a bare span or div with aria-label', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<span aria-label="camera off">x</span><div aria-label="y"></div>' +
      '<span role="img" aria-label="ok"></span><div role="group" aria-label="ok"></div>' +
      '<p role="paragraph" aria-label="no"></p>';
    expect(prohibitedNamings(host)).toHaveLength(3);
  });
});

describe('welcome card — purposeful arrivals keep today’s card', () => {
  it.each([
    ['?course=1z9k4h'],
    ['?scope=E'],
    ['?menu=cocktails'],
    ['?role=camera'],
    ['?connect=1'],
  ])('%s → no three-path card', async (search) => {
    await openApp(search);
    expect(welcomePaths()).toEqual([]);
  });

  it('?course= still lands on golf with the plain camera card', async () => {
    await openApp('?course=1z9k4h');
    expect(welcomePaths()).toEqual([]);
    expect(screen.getByText('Point your iPad at the board')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No camera? Build on screen' })).toBeTruthy();
  });

  it('?kiosk is a different surface altogether — and is a bypass param anyway', () => {
    expect(detectSurface('/', '?kiosk')).toBe('kiosk');
    expect(welcomeBypassed('?kiosk&connect=1')).toBe(true);
  });
});

describe('welcomeEligible', () => {
  const base = {
    search: '',
    status: 'idle' as const,
    connected: false,
    cameraRole: false,
    mode: 'composer' as const,
  };

  it('is the idle (or just-starting) composer landing only', () => {
    expect(welcomeEligible(base)).toBe(true);
    expect(welcomeEligible({ ...base, status: 'starting' })).toBe(true);
    expect(welcomeEligible({ ...base, status: 'running' })).toBe(false);
    expect(welcomeEligible({ ...base, status: 'error' })).toBe(false);
    expect(welcomeEligible({ ...base, connected: true })).toBe(false);
    expect(welcomeEligible({ ...base, cameraRole: true })).toBe(false);
    for (const mode of ['golf', 'quantina', 'runner'] as const) {
      expect(welcomeEligible({ ...base, mode })).toBe(false);
    }
  });

  it('steps aside for every purposeful URL param, with or without a value', () => {
    for (const p of ['kiosk', 'connect=1', 'role=camera', 'course=abc', 'scope=E', 'menu=coffee', 'menupack=x', 'mode=composer']) {
      expect(welcomeEligible({ ...base, search: `?${p}` })).toBe(false);
    }
    // Cosmetic params are not a destination: the welcome stays.
    for (const p of ['wires=all', 'lowpower=1', 'debug=1', 'side=left']) {
      expect(welcomeEligible({ ...base, search: `?${p}` })).toBe(true);
    }
  });
});

describe('golf goal line — mode × setting sweep', () => {
  it.each([
    ['?mode=golf&input=manual&wires=compact'],
    ['?mode=golf&input=manual&wires=all'],
    ['?mode=golf&input=camera&wires=compact'],
    ['?mode=golf&input=camera&wires=all'],
  ])('%s → the hole-1 goal under the target', async (search) => {
    await openApp(search);
    const goal = document.querySelector('.pk-golf-goal');
    expect(goal?.textContent).toBe('Goal: a fair 50/50 coin — H is your first club.');
    // The line wraps instead of being cut off, so there is no tooltip copy
    // of it (VoiceOver would read the sentence twice).
    expect(goal?.hasAttribute('title')).toBe(false);
    // It sits with the target, in the sphere's well.
    expect(goal?.closest('.pk-side-hero')).not.toBeNull();
  });

  it('is a golf-only line', async () => {
    await openApp('?mode=composer&input=manual');
    expect(document.querySelector('.pk-golf-goal')).toBeNull();
  });
});

describe('golf tap-to-play — on-screen golf only', () => {
  it.each([['?mode=golf&input=manual&wires=compact'], ['?mode=golf&input=manual&wires=all']])(
    '%s → clubs + tap grid sit under the sphere',
    async (search) => {
      await openApp(search);
      const bar = document.querySelector('.pk-gatebar');
      expect(bar?.closest('.pk-side-hero')).not.toBeNull();
      expect(screen.getByRole('button', { name: 'H gate' })).toBeTruthy();
      expect(screen.getByRole('group', { name: /^Circuit, 1 qubits/ })).toBeTruthy();
    },
  );

  it.each([['?mode=golf&input=camera'], ['?mode=composer&input=manual']])(
    '%s → no tap-to-play (the board, or no golf)',
    async (search) => {
      await openApp(search);
      expect(document.querySelector('.pk-gatebar')).toBeNull();
    },
  );
});
