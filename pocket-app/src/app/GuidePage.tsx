/**
 * Guide & about — the page that makes the public pocket app a self-contained
 * ambassador for Entangible (docs/pocket.md). Reachable at `#guide` before the
 * camera even starts; rendered as an overlay over the still-mounted app so an
 * active camera stream is never torn down (see App.tsx / hashNav.ts).
 *
 * SECTIONS (#82). The guide used to be one long scroll; it is now five topics
 * behind a pinned chip nav, one visible at a time:
 *
 *   start · what it is, how to use it, run it for real
 *   print · the paper kit + the 3D-printed tiles
 *   play  · golf, Quantina, Quantum Runner
 *   build · build on screen (manual input + tap-to-place)
 *   booth · on-screen test boards, the booth installation, the family
 *
 * Each is deep-linkable as `#guide/<id>`; a bare `#guide` — what every link in
 * the app uses — opens the first one, and an unknown slug falls back there too,
 * so no existing entry point can break. Switching sections REPLACES the hash
 * rather than pushing it: the URL stays shareable, but Back still leaves the
 * Guide instead of walking backwards through the chips.
 *
 * LANGUAGE: the prose lives in `./guide/` — one file per language behind one
 * typed interface (`GuideProse`) — and this page picks the active one. The
 * chrome (chips, back pill, viewer, test-board titles) reads `t.guide`.
 *
 * Styling is pk-token, dark, restrained; the copy voice is plain and warm.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { goBack, guideSectionHash, parseGuideSection, type NavWindow } from './hashNav';
import { TEST_BOARDS } from './testBoards';
import { reduceViewer, CLOSED, type ViewerAction } from './viewer';
import fwqFamily from '../data/fwq-family.json';
import { eventName } from './analytics';
import { useLang, useT, type Lang } from '@shared/i18n';
import type { GuideProse, SectionLink } from './guide/types';
import { guideEn } from './guide/en';
import { guideDe } from './guide/de';

/** The Guide's prose per language. */
const PROSE: Readonly<Record<Lang, GuideProse>> = { en: guideEn, de: guideDe };

/**
 * Fun-with-Quantum sibling projects, from the family manifest (family.json in
 * JanLahmann/Fun-with-Quantum). The vendored copy in src/data/fwq-family.json is refreshed by an
 * automated PR whenever the roster changes — do not edit it by hand. Members hidden from footers
 * (`footer: false`) and Entangible itself are left out; the family home comes via FAMILY_URL.
 */
const FAMILY = (fwqFamily.members as { id: string; name: string; url: string; short?: string; footer: boolean }[])
  .filter((m) => m.footer && m.id !== 'entangible' && m.id !== fwqFamily.brand.id);

/** Umami v2 name for a family-link click (`Entangible: family footer click`, label from the manifest). */
const FAMILY_FOOTER_EVENT = eventName('family footer click');

/**
 * The guide's sections, in nav order. `nav` is the chip label (kept short — the
 * row must fit a phone without becoming a scroll of its own); `title` names the
 * panel for screen readers. These are the English labels; the page shows the
 * active language's (`t.guide.sections`).
 */
export const GUIDE_SECTIONS = [
  { id: 'start', nav: 'Start here', title: 'Start here' },
  { id: 'print', nav: 'Print the kit', title: 'Print the kit' },
  { id: 'play', nav: 'Play', title: 'Play' },
  { id: 'build', nav: 'Build on screen', title: 'Build on screen' },
  { id: 'booth', nav: 'Booth & project', title: 'Booth and project' },
] as const;

export type GuideSectionId = (typeof GUIDE_SECTIONS)[number]['id'];

/** Where a visitor lands with no section named — and the fallback for a bad one. */
export const DEFAULT_GUIDE_SECTION: GuideSectionId = 'start';

/**
 * The section a location hash selects. A bare `#guide`, an unknown slug and a
 * malformed sub-path all land on the first section: a deep link that has gone
 * stale should open the guide, never break it.
 */
export function sectionFromHash(hash: string | null | undefined): GuideSectionId {
  const slug = parseGuideSection(hash);
  const known = GUIDE_SECTIONS.find((s) => s.id === slug);
  return known ? known.id : DEFAULT_GUIDE_SECTION;
}

/**
 * The visible section, kept in sync with the URL both ways.
 *
 * Selecting a chip REPLACES the hash instead of assigning it: assigning would
 * push a history entry per chip, and the back pill (`goBack`) would then walk
 * back through the sections instead of returning to the app. A real navigation
 * — an external deep link, or the browser's own back/forward across one — still
 * arrives through `hashchange`.
 */
function useGuideSection(): [GuideSectionId, (id: GuideSectionId) => void] {
  const [section, setSection] = useState<GuideSectionId>(() =>
    sectionFromHash(typeof window === 'undefined' ? '' : window.location.hash),
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onHash = () => setSection(sectionFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const select = useCallback((id: GuideSectionId) => {
    setSection(id);
    if (typeof window === 'undefined') return;
    try {
      window.history.replaceState(null, '', guideSectionHash(id));
    } catch {
      /* best-effort: the section is already showing, only the URL lags */
    }
  }, []);

  return [section, select];
}

export function GuidePage() {
  const t = useT().guide;
  const { lang } = useLang();
  const prose = PROSE[lang];

  const onBack = useCallback(() => {
    if (typeof window !== 'undefined') goBack(window as unknown as NavWindow);
  }, []);

  const [section, selectSection] = useGuideSection();
  const bodyRef = useRef<HTMLDivElement>(null);

  // A new section starts at its top — landing halfway down a topic you just
  // chose reads as a broken page.
  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0 });
  }, [section]);

  /** A chip, and any in-copy pointer from one section to another. */
  const goToSection = useCallback(
    (id: GuideSectionId) => (e: React.MouseEvent) => {
      // Leave the real link alone for modified clicks — a deep link is a link,
      // and "open in new tab" must still work.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      selectSection(id);
    },
    [selectSection],
  );

  /** Props for an in-copy `<a>` to another section (spread by the prose). */
  const sectionLink: SectionLink = useCallback(
    (id: GuideSectionId) => ({ href: guideSectionHash(id), onClick: goToSection(id) }),
    [goToSection],
  );

  // Fullscreen test-board viewer state machine (pure reducer + count).
  const [viewer, dispatch] = useReducer(
    (s: typeof CLOSED, a: ViewerAction) => reduceViewer(s, a, TEST_BOARDS.length),
    CLOSED,
  );
  const stageRef = useRef<HTMLDivElement>(null);

  // Enter/leave true fullscreen where available (else the fixed overlay alone
  // covers the screen). Keep viewer state in sync if the user exits native
  // fullscreen with the browser's own ESC.
  useEffect(() => {
    const el = stageRef.current;
    if (viewer.open) {
      if (el && el.requestFullscreen && !document.fullscreenElement) {
        el.requestFullscreen().catch(() => {});
      }
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }, [viewer.open]);

  useEffect(() => {
    if (!viewer.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') dispatch({ type: 'next' });
      else if (e.key === 'ArrowLeft') dispatch({ type: 'prev' });
      else if (e.key === 'Escape') dispatch({ type: 'close' });
    };
    const onFsChange = () => {
      if (!document.fullscreenElement) dispatch({ type: 'close' });
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [viewer.open]);

  /** A test board's title + blurb in the active language (as authored if missing). */
  const boardCopy = (b: (typeof TEST_BOARDS)[number]) => t.testBoards[b.id] ?? b;

  const board = TEST_BOARDS[viewer.index];
  const boardTitle = board ? boardCopy(board).title : '';
  const active = t.sections[section];

  const testBoards = (
    <div className="pk-guide-grid">
      {TEST_BOARDS.map((b, i) => {
        const copy = boardCopy(b);
        return (
          <button
            key={b.id}
            type="button"
            className="pk-guide-card"
            onClick={() => dispatch({ type: 'open', index: i })}
          >
            <img src={b.src} alt={copy.title} loading="lazy" />
            <span className="pk-guide-card-title">{copy.title}</span>
            <span className="pk-guide-card-blurb">{copy.blurb}</span>
          </button>
        );
      })}
    </div>
  );

  const family = FAMILY.map((f, i) => (
    <span key={f.name}>
      {i > 0 && ' · '}
      <a
        href={f.url}
        target="_blank"
        rel="noopener noreferrer"
        title={f.short}
        data-umami-event={FAMILY_FOOTER_EVENT}
        data-umami-event-to={f.id}
      >
        {f.name}
      </a>
    </span>
  ));

  return (
    <div className="pk-guide" role="region" aria-label={t.aria}>
      <header className="pk-guide-top">
        <button type="button" className="pk-pill pk-guide-back" onClick={onBack}>
          <span aria-hidden="true">←</span> {t.back}
        </button>
        <div className="pk-brand">
          <span className="en">En</span>tangible<small>guide</small>
        </div>
      </header>

      {/* Section nav: real links (so a chip can be copied, opened in a tab and
          deep-linked) that navigate in place on a plain click. */}
      <nav className="pk-guide-nav" aria-label={t.navAria}>
        {GUIDE_SECTIONS.map((s) => (
          <a
            key={s.id}
            className={`pk-guide-tab${s.id === section ? ' is-active' : ''}`}
            href={guideSectionHash(s.id)}
            aria-current={s.id === section ? 'page' : undefined}
            onClick={goToSection(s.id)}
          >
            {t.sections[s.id].nav}
          </a>
        ))}
      </nav>

      <div
        className="pk-guide-body"
        ref={bodyRef}
        role="region"
        aria-label={t.sectionAria(active.title)}
      >
        {section === 'start' && prose.start({ sectionLink })}
        {section === 'print' && prose.print({ sectionLink })}
        {section === 'play' && prose.play({ sectionLink })}
        {section === 'build' && prose.build({ sectionLink })}
        {section === 'booth' && prose.booth({ sectionLink, testBoards, family })}

        {/* The footer is not a topic — licence and trademarks belong on every
            section, so it sits outside the switch. */}
        <footer className="pk-guide-foot">{prose.footer()}</footer>
      </div>

      {viewer.open && board && (
        <div
          ref={stageRef}
          className="pk-viewer"
          role="dialog"
          aria-label={t.testBoardAria(boardTitle)}
        >
          <img className="pk-viewer-img" src={board.src} alt={boardTitle} />
          {/* Tap zones: left = prev, right = next, center = close. */}
          <button
            type="button"
            className="pk-viewer-zone pk-viewer-prev"
            aria-label={t.prevBoard}
            onClick={() => dispatch({ type: 'prev' })}
          />
          <button
            type="button"
            className="pk-viewer-zone pk-viewer-close"
            aria-label={t.close}
            onClick={() => dispatch({ type: 'close' })}
          />
          <button
            type="button"
            className="pk-viewer-zone pk-viewer-next"
            aria-label={t.nextBoard}
            onClick={() => dispatch({ type: 'next' })}
          />
          <div className="pk-viewer-index" aria-live="polite">
            {viewer.index + 1} / {TEST_BOARDS.length} · {boardTitle}
          </div>
        </div>
      )}
    </div>
  );
}

export default GuidePage;
