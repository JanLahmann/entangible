// @vitest-environment jsdom
/**
 * Smoke render of the golf-only bundle's shell: it mounts with the on-screen
 * editor, the sphere and the full scorecard, has no site chrome, and its two
 * sheets (course, rules) open, validate and close. Plus the bundle's own
 * course store (key, URL overrides, sanitising).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import { LangProvider } from '@shared/i18n';
import { GolfApp } from './GolfApp';
import { GOLF_COURSE_KEY, loadCourse, saveCourse } from './courseStore';

vi.setConfig({ testTimeout: 30_000 });

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function mount() {
  const utils = render(
    <LangProvider lang="en">
      <GolfApp />
    </LangProvider>,
  );
  await act(async () => {});
  return utils;
}

describe('GolfApp — the golf-only shell', () => {
  it('renders the game: palette, editor, sphere, course picker and the 18-hole card', async () => {
    const { container } = await mount();
    expect(container.querySelector('.pk.pk--golf')).not.toBeNull();
    expect(container.querySelector('.pk-manual-palette')).not.toBeNull();
    expect(container.querySelector('.pk-stage-editor')).not.toBeNull();
    expect(container.querySelector('.pk-side-hero .pk-well')).not.toBeNull();
    expect(container.querySelectorAll('.pk-golf-chip')).toHaveLength(18);
    expect(screen.getByText('E1 — Superposition')).toBeTruthy();
    expect(container.querySelector('.pk-golf-goal')?.textContent).toBeTruthy();
  });

  it('plays a hole by taps: the gate bar under the sphere holes E1 with H on q0', async () => {
    const { container } = await mount();
    const bar = container.querySelector('.pk-side-hero > .pk-well + .pk-gatebar');
    expect(bar, 'gate bar directly under the sphere well').not.toBeNull();
    const editorGates = () => container.querySelectorAll('.pk-stage-editor .circuit-editor__gate').length;
    expect(editorGates()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add H to qubit 0' }));
    // The editor draws the tapped gate (same circuit, same path as a drag) …
    expect(editorGates()).toBe(1);
    // … and the engine scored it: one stroke, ball in, Next hole offered.
    expect(bar!.querySelector('.pk-gatebar-score')!.textContent).toMatch(/strokes\s*1/);
    expect(screen.getAllByRole('button', { name: /Next hole/ }).length).toBeGreaterThan(0);
  });

  it('carries none of the site chrome: no header, footer, camera, settings or guide', async () => {
    const { container } = await mount();
    for (const sel of ['.pk-topbar', '.pk-footer', '.pk-cam', '.pk-gear', '.pk-help', '.pk-transfer-btn']) {
      expect(container.querySelector(sel), sel).toBeNull();
    }
    expect(screen.queryByText('Use camera')).toBeNull();
  });

  it('opens the rules and closes them again', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'How to play' }));
    const dialog = screen.getByRole('dialog', { name: 'How to play' });
    expect(dialog.querySelectorAll('.pk-golfsheet-p').length).toBeGreaterThan(2);
    const link = dialog.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('https://entangible.org/');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('course sheet: rejects a malformed code, accepts a real one and stores it', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /^Course/ }));
    expect(screen.getByRole('dialog', { name: 'Choose a course' })).toBeTruthy();
    const input = screen.getByLabelText('Course code');
    fireEvent.change(input, { target: { value: 'not a code!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.getByRole('alert').textContent).toMatch(/not a course code/);
    fireEvent.change(input, { target: { value: '#ABC12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(GOLF_COURSE_KEY)!)).toEqual({
      courseCode: 'abc12',
      courseScope: null,
    });
  });

  it('switches to German from the toolbar', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Auf Deutsch umschalten' }));
    expect(screen.getByRole('button', { name: 'So geht’s' })).toBeTruthy();
  });
});

describe('golf bundle course store', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('round-trips a choice under its own key', () => {
    const s = mem();
    saveCourse(s, { courseCode: 'abc12', courseScope: 'E' });
    expect(loadCourse(s, '')).toEqual({ courseCode: 'abc12', courseScope: 'E' });
  });

  it('lets a ?course= link override the stored course (scope from the link only)', () => {
    const s = mem();
    saveCourse(s, { courseCode: 'zz', courseScope: 'D' });
    expect(loadCourse(s, '?course=ABC12')).toEqual({ courseCode: 'abc12', courseScope: null });
    expect(loadCourse(s, '?course=abc12&scope=m')).toEqual({ courseCode: 'abc12', courseScope: 'M' });
  });

  it('falls back to classic on junk', () => {
    const s = mem();
    s.setItem(GOLF_COURSE_KEY, '{"courseCode":"00x","courseScope":"Q"}');
    expect(loadCourse(s, '')).toEqual({ courseCode: null, courseScope: null });
    s.setItem(GOLF_COURSE_KEY, 'not json');
    expect(loadCourse(s, '?course=%%%')).toEqual({ courseCode: null, courseScope: null });
    expect(loadCourse(null, '')).toEqual({ courseCode: null, courseScope: null });
  });
});
