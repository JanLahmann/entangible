// @vitest-environment jsdom
/**
 * Guide sections (#82) — the guide is five topics behind a chip nav, one shown
 * at a time, each deep-linkable as `#guide/<id>`.
 *
 * What these guard is the thing a restructure most easily breaks: every entry
 * point into the guide. `#guide` is what the topbar, the settings drawer and the
 * start card all link to, and it must keep opening the guide on its first
 * section; a stale or malformed deep link must degrade to the same place rather
 * than render an empty page; and switching sections must not push history, or
 * the back pill would walk backwards through the chips instead of leaving.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { parseRoute, parseGuideSection, guideSectionHash } from './hashNav';
import { GuidePage, GUIDE_SECTIONS, sectionFromHash, DEFAULT_GUIDE_SECTION } from './GuidePage';

afterEach(cleanup);

describe('guide section routing (#82)', () => {
  it('keeps every `#guide` link on the guide route, sub-path or not', () => {
    expect(parseRoute('#guide')).toBe('guide');
    expect(parseRoute('#guide/print')).toBe('guide');
    expect(parseRoute('#guide/play')).toBe('guide');
    // Trailing slash and casing are how people retype a link from a photo.
    expect(parseRoute('#GUIDE/Play')).toBe('guide');
  });

  it('does not mistake a neighbouring hash for the guide', () => {
    expect(parseRoute('#guides')).toBe('main');
    expect(parseRoute('#guidebook/print')).toBe('main');
    expect(parseRoute('')).toBe('main');
    expect(parseRoute(undefined)).toBe('main');
  });

  it('reads the sub-path, and only a plain slug', () => {
    expect(parseGuideSection('#guide/print')).toBe('print');
    expect(parseGuideSection('#guide/print/')).toBe('print');
    expect(parseGuideSection('#guide')).toBeNull();
    expect(parseGuideSection('#guide/a/b')).toBeNull();
    expect(parseGuideSection('#guide/what is this')).toBeNull();
    expect(parseGuideSection('#main')).toBeNull();
  });

  it('round-trips every section through its deep link', () => {
    for (const s of GUIDE_SECTIONS) {
      expect(sectionFromHash(guideSectionHash(s.id))).toBe(s.id);
    }
  });

  it('lands a bare, unknown or malformed hash on the first section', () => {
    // `#guide` is what every link inside the app uses — it must never be a dead end.
    expect(sectionFromHash('#guide')).toBe(DEFAULT_GUIDE_SECTION);
    expect(sectionFromHash('#guide/no-such-section')).toBe(DEFAULT_GUIDE_SECTION);
    expect(sectionFromHash('#guide/a/b')).toBe(DEFAULT_GUIDE_SECTION);
    expect(sectionFromHash('')).toBe(DEFAULT_GUIDE_SECTION);
    expect(DEFAULT_GUIDE_SECTION).toBe(GUIDE_SECTIONS[0].id);
  });
});

describe('guide section nav (#82)', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('opens the first section for a bare #guide and shows only that content', () => {
    window.location.hash = '#guide';
    render(<GuidePage />);

    expect(screen.getByText(/What is this/)).toBeTruthy();
    // Another section's copy must not be in the document at all — the point of
    // the split is that the guide is no longer one long scroll.
    expect(screen.queryByText(/3D-print the tiles/)).toBeNull();
    expect(screen.queryByText(/Quantum Golf/)).toBeNull();
  });

  it('opens the section a deep link names', () => {
    window.location.hash = guideSectionHash('play');
    render(<GuidePage />);

    expect(screen.getByText(/Quantum Golf/)).toBeTruthy();
    expect(screen.queryByText(/What is this/)).toBeNull();
  });

  it('marks the selected chip for assistive tech, and only that one', () => {
    window.location.hash = guideSectionHash('print');
    render(<GuidePage />);

    const nav = screen.getByRole('navigation', { name: /guide sections/i });
    const links = nav.querySelectorAll('a');
    expect(links.length).toBe(GUIDE_SECTIONS.length);

    const current = [...links].filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.length).toBe(1);
    expect(current[0].textContent).toBe('Print the kit');
    // Every chip stays a real link, so it can be copied or opened in a new tab.
    expect([...links].map((a) => a.getAttribute('href'))).toEqual(
      GUIDE_SECTIONS.map((s) => guideSectionHash(s.id)),
    );
  });

  it('switches section on a click and REPLACES the hash (back still leaves)', () => {
    window.location.hash = '#guide';
    render(<GuidePage />);
    const before = window.history.length;

    fireEvent.click(screen.getByRole('link', { name: 'Play' }));

    expect(screen.getByText(/Quantum Golf/)).toBeTruthy();
    expect(window.location.hash).toBe(guideSectionHash('play'));
    // Replaced, not pushed: the back pill must return to the app, not to the
    // previous chip.
    expect(window.history.length).toBe(before);
  });

  it('follows an external hash change (browser back/forward across a deep link)', () => {
    window.location.hash = '#guide';
    render(<GuidePage />);
    expect(screen.getByText(/What is this/)).toBeTruthy();

    window.location.hash = guideSectionHash('booth');
    fireEvent(window, new HashChangeEvent('hashchange'));

    expect(screen.getByText(/The full project/)).toBeTruthy();
    expect(screen.queryByText(/What is this/)).toBeNull();
  });

  it('keeps the licence/trademark footer on every section', () => {
    for (const s of GUIDE_SECTIONS) {
      window.location.hash = guideSectionHash(s.id);
      const { unmount } = render(<GuidePage />);
      expect(screen.getByText(/Apache-2.0 licensed/)).toBeTruthy();
      expect(screen.getByText(/trademarks of International Business Machines/)).toBeTruthy();
      unmount();
    }
  });
});
