/**
 * Stylesheet regressions for the pocket layout seams that no DOM test can catch
 * (jsdom does not do layout, and the rules live in a plain .css file). Both
 * assertions come from #92:
 *
 *   1. The sidebar must SCROLL. It is a fixed-height grid track, so `overflow:
 *      hidden` there silently ate everything below the fold — the golf
 *      scorecard's round rows, the stuck/solution UI, the histogram.
 *   2. The golf sphere-forward split must stay scoped to roomy landscape
 *      screens, so the phone stack / tablet portrait / short landscape phone
 *      layouts keep their current geometry.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// Comments stripped: this suite reasons about RULES, and the section headers
// quote the very class names it scans for.
const css = readFileSync(fileURLToPath(new URL('./pocket.css', import.meta.url)), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Body of the first `<selector> { ... }` block, or '' when absent. */
function ruleBody(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

describe('pocket.css sidebar scrolling (#92)', () => {
  it('lets the sidebar scroll vertically instead of clipping', () => {
    const body = ruleBody('.pk-side');
    expect(body).toContain('overflow-y: auto');
    // The regression itself: a blanket `overflow: hidden` would clip again.
    expect(body).not.toMatch(/^\s*overflow:\s*hidden/m);
  });
});

describe('pocket.css golf sphere-forward split (#92)', () => {
  it('rebalances the grid so the state column is the dominant one', () => {
    expect(css).toContain('.pk-main.pk-main--golf-manual {');
    // Both sidebar-side settings are covered.
    expect(css).toContain('.pk-main.pk-main--golf-manual.pk-side-left {');
  });

  it('scopes EVERY golf-manual rule to a media query: roomy landscape (#92) or tap to play’s phone / tablet layouts', () => {
    // Line scan with brace-depth tracking (pocket.css is one declaration per
    // line): each selector line carrying the class must sit inside an @media.
    // #92's sphere-forward split is roomy-landscape only; golf tap to play
    // (TapPlay, docs/pocket.md) adds the phone layouts (library editor hidden,
    // the tap grid is the circuit) and tablet portrait (state panels first).
    let depth = 0;
    let media: string | null = null;
    const queries: string[] = [];
    for (const line of css.split('\n')) {
      if (depth === 0 && line.trimStart().startsWith('@media')) {
        media = line.slice(line.indexOf('@media'), line.lastIndexOf('{')).trim();
      }
      if (line.includes('pk-main--golf-manual')) {
        expect(media, `unscoped golf-manual rule: ${line.trim()}`).not.toBeNull();
        queries.push(media as string);
      }
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (depth === 0) media = null;
    }
    const roomy = (q: string) =>
      /min-width:\s*(9\d\d|1\d{3})px/.test(q) &&
      q.includes('min-height: 500px') &&
      q.includes('orientation: landscape');
    const tapPlay = new Set([
      '@media (max-width: 699px), (max-height: 450px)',
      '@media (max-height: 450px)',
      '@media (orientation: portrait) and (min-width: 700px)',
    ]);
    expect(queries.filter(roomy).length).toBeGreaterThan(0);
    for (const q of queries) expect(roomy(q) || tapPlay.has(q), q).toBe(true);
  });

  it('keeps the editor column above the library 400px min circuit width', () => {
    // minmax(30rem, …) = 480px stage track − 2rem padding ⇒ 448px of editor.
    const golf = css.slice(css.indexOf('.pk-main.pk-main--golf-manual {'));
    expect(golf).toContain('minmax(30rem, 1fr)');
  });
});

describe('pocket.css idle start card is never clipped', () => {
  it('lifts the running stage clip + height cap while idle', () => {
    // `.pk-cam` clips (overflow hidden) and the phone caps it at 22vh; on
    // narrow / portrait screens that cut the start card off below "Read the
    // guide" — taking the "No camera? Build on screen" way in with it.
    const body = ruleBody('.pk-cam.is-idle');
    expect(body).toContain('overflow: visible');
    expect(body).toContain('max-height: none');
  });
});

describe('pocket.css welcome card is phone-width first', () => {
  it('lets every path shrink and wrap instead of widening the card', () => {
    const path = ruleBody('.pk-welcome-path');
    expect(path).toContain('width: 100%');
    expect(path).toContain('min-width: 0');
    expect(path).toContain('box-sizing: border-box');
    expect(path).toContain('overflow-wrap: anywhere');
    // Touch targets stay ≥ 44 px; the primary is the taller, dominant one.
    expect(path).toContain('min-height: 44px');
    expect(ruleBody('.pk-welcome-path--primary')).toContain('min-height: 52px');
  });

  it('puts the two on-screen paths side by side only when they fit', () => {
    // 2 × 8.5rem + the gap fits a 360 px phone's card (16 px gutters); below
    // that the auto-fit grid stacks them rather than overflowing.
    expect(ruleBody('.pk-welcome-alts')).toContain(
      'grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr))',
    );
  });
});

describe('golf goal line: wraps, never truncated', () => {
  // Every rule, at any nesting depth, whose selector names the class.
  function rulesFor(sheet: string, cls: string): string[] {
    const out: string[] = [];
    for (const m of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (m[1].includes(cls)) out.push(m[2]);
    }
    return out;
  }
  const kiosk = readFileSync(
    fileURLToPath(new URL('../kiosk/kiosk.css', import.meta.url)),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');

  it.each([
    ['pocket.css', css, 'pk-golf-goal'],
    ['kiosk.css', kiosk, 'bo-golf-goal'],
  ])('%s: no nowrap, ellipsis, line clamp, clipping or height cap on the line', (_, sheet, cls) => {
    const rules = rulesFor(sheet, cls);
    expect(rules.length).toBeGreaterThan(0);
    for (const body of rules) {
      expect(body).not.toMatch(/white-space:\s*(nowrap|pre)/);
      expect(body).not.toMatch(/text-overflow/);
      expect(body).not.toMatch(/line-clamp/);
      expect(body).not.toMatch(/overflow(-y)?:\s*(hidden|clip)/);
      expect(body).not.toMatch(/(^|[^-])height:|max-height:/);
    }
  });

  it('breaks a long word rather than widening the column', () => {
    const goal = ruleBody('.pk-golf-goal');
    expect(goal).toContain('overflow-wrap: break-word');
    expect(goal).toContain('min-width: 0');
    expect(goal).toContain('max-width: 100%');
  });
});

describe('pocket.css golf sphere on phones: the remaining space, overlays in the corners', () => {
  // The phone block that seats tap to play (several blocks share the query).
  const query = '@media (max-width: 699px), (max-height: 450px) {';
  const phone = css.slice(css.lastIndexOf(query, css.indexOf('.pk-side-hero.has-gatebar .pk-qsphere,')));
  const block = phone.slice(0, phone.indexOf('\n}\n'));
  function phoneRule(selector: string): string {
    const at = block.indexOf(`\n  ${selector} {`);
    if (at < 0) return '';
    const open = block.indexOf('{', at);
    return block.slice(open + 1, block.indexOf('}', open));
  }

  it('the panel fills the screen as a flex column; only the sphere box grows', () => {
    const hero = phoneRule('.pk-side-hero.has-gatebar');
    expect(hero).toContain('display: flex');
    expect(hero).toContain('flex-direction: column');
    expect(hero).toContain('min-height: 100%');
    expect(phoneRule('.pk-side-hero.has-gatebar .pk-well')).toContain('flex: 1 1 auto');
    const evo = phoneRule('.pk-side-hero.has-gatebar .pk-evo');
    expect(evo).toContain('display: flex');
    expect(evo).toContain('min-height: 0');
    // The goal line keeps its natural (wrapped) height; the sphere gives way.
    expect(phoneRule('.pk-side-hero.has-gatebar .pk-golf-goal')).toContain('flex: none');
    const box = phoneRule('.pk-side-hero.has-gatebar .pk-qsphere,\n  .pk-side-hero.has-gatebar .pk-bloch');
    expect(box).toContain('flex: 1 1 0');
    expect(box).toContain('min-height: 84px');
    expect(box).toContain('container-type: size');
    expect(box).toContain('padding: 0');
  });

  it('the sphere is the largest square in its box (Q-sphere and Bloch alike)', () => {
    const svg = phoneRule('.pk-side-hero.has-gatebar .pk-qs-svg,\n  .pk-side-hero.has-gatebar .pk-bl-svg');
    expect(svg).toContain('width: min(100cqw, 100cqh)');
    expect(svg).toContain('max-width: none');
    // The old viewport formula survives only as the no-container-units fallback.
    expect(css).not.toContain('--tap-fixed');
    expect(css).toContain('@supports not (width: 1cqw)');
  });

  it('the scrubber row stays reserved while the scrubber is absent', () => {
    expect(phoneRule('.pk-side-hero.has-gatebar .pk-evo::after')).toContain('height: 2.75rem');
    expect(phoneRule('.pk-side-hero.has-gatebar .pk-evo:has(> .pk-evo-scrubber)::after')).toContain(
      'display: none',
    );
    expect(phoneRule('.pk-side-hero.has-gatebar .pk-evo-scrubber')).toContain('min-height: 2.75rem');
  });

  it('reset (≥ 44 px), phase wheel and view label are overlays in the box corners', () => {
    const reset = phoneRule('.pk-side-hero.has-gatebar .pk-qs-reset');
    expect(reset).toContain('width: 44px');
    expect(reset).toContain('height: 44px');
    expect(reset).toContain('top: 0');
    expect(reset).toContain('right: 0');
    expect(ruleBody('.pk-qs-reset')).toContain('position: absolute');
    const legend = phoneRule('.pk-side-hero.has-gatebar .pk-qs-legend-wrap');
    expect(legend).toContain('right: 0');
    expect(legend).toContain('bottom: 0');
    expect(ruleBody('.pk-qs-legend-wrap')).toContain('position: absolute');
    expect(ruleBody('.pk-qs-legend-wrap')).toContain('pointer-events: none');
    const label = phoneRule('.pk-side-hero.has-gatebar .pk-view-label');
    expect(label).toContain('position: absolute');
    expect(label).toContain('pointer-events: none');
  });

  it('landscape: the well stretches down the sphere column, no fixed vh cap', () => {
    const rule = css.indexOf('\n  .pk-side-hero.has-gatebar > .pk-well {');
    expect(rule).toBeGreaterThan(0);
    const at = css.lastIndexOf('\n@media', rule);
    expect(css.slice(at + 1, css.indexOf('{', at))).toBe('@media (max-height: 450px) ');
    const body = css.slice(at, css.indexOf('\n}\n', at));
    expect(body).toMatch(/\.pk-side-hero\.has-gatebar > \.pk-well \{\s*align-self: stretch;/);
    expect(body).not.toMatch(/\.pk-(qs|bl)-svg/);
  });
});

describe('pocket.css phone topbar never clips the mode pill', () => {
  // The 390 px regression: "QUANTUM RUNNE" cut off under the brand, and the
  // build-on-screen pill drawn as an empty capsule (its label is hidden on
  // phones). Every rule lives in the phone block, indented by two spaces.
  const phone = css.slice(css.indexOf('@media (max-width: 699px), (max-height: 450px) {'));
  function phoneRule(selector: string): string {
    const at = phone.indexOf(`\n  ${selector} {`);
    if (at < 0) return '';
    const open = phone.indexOf('{', at);
    return phone.slice(open + 1, phone.indexOf('}', open));
  }

  it('lets the mode pill wrap to its longest word instead of shrinking past it', () => {
    const pill = phoneRule('.pk-topbar .pk-pill--mode');
    expect(pill).toContain('min-width: min-content');
    expect(pill).toContain('white-space: normal');
    expect(pill).not.toMatch(/min-width:\s*0\b/);
  });

  it('collapses the brand to its glyph while a mode pill is shown', () => {
    expect(phoneRule('.pk-topbar.has-mode .pk-brand-rest')).toContain('display: none');
  });

  it('hides the label-only build-on-screen pill rather than drawing it empty', () => {
    expect(phoneRule('.pk-pill-label')).toContain('display: none');
    expect(phoneRule('.pk-topbar .pk-pill--manual')).toContain('display: none');
  });
});

describe('pocket.css golf holing in on tap to play (#13)', () => {
  const phone = css.slice(css.indexOf('@media (max-width: 699px), (max-height: 450px) {'));
  function phoneRule(selector: string): string {
    const at = phone.indexOf(`\n  ${selector} {`);
    if (at < 0) return '';
    const open = phone.indexOf('{', at);
    return phone.slice(open + 1, phone.indexOf('}', open));
  }

  it('Next hole sits in the flow, in the clubs’ 44 px row — no overlay over the sphere panel', () => {
    const bar = ruleBody('.pk-golf-next--bar');
    expect(bar).toContain('min-height: 44px');
    expect(bar).toContain('width: 100%');
    expect(bar).not.toMatch(/position:\s*(absolute|fixed)/);
    // The #729cb0f overlay is gone from every layout.
    expect(css).not.toMatch(/\.pk-golf-next--sphere\s*\{[^}]*position:\s*absolute/);
    expect(css).not.toMatch(/has-gatebar \.pk-golf-next--sphere/);
    // Landscape phone: it takes the clubs' grid area.
    expect(css).toMatch(/\.pk-side-hero\.has-gatebar \.pk-golf-next--bar \{\s*grid-area: clubs;/);
  });

  it('keeps the scrubber row reserved, with 44 px step buttons', () => {
    expect(ruleBody('.pk-side-hero.has-gatebar .pk-evo')).toContain(
      'grid-template-rows: repeat(4, auto) minmax(2.75rem, auto)',
    );
    const nav = css.slice(css.indexOf('\n.pk-side-hero.has-gatebar .pk-evo-nav,'));
    const body = nav.slice(nav.indexOf('{') + 1, nav.indexOf('}'));
    expect(body).toContain('width: 44px');
    expect(body).toContain('height: 44px');
  });

  it('the scrubber row fits a landscape sphere column: fixed ellipsized label, wrapping dots', () => {
    const label = ruleBody('.pk-side-hero.has-gatebar .pk-evo-label');
    expect(label).toContain('text-overflow: ellipsis');
    expect(label).toContain('min-width: 0');
    expect(ruleBody('.pk-side-hero.has-gatebar .pk-evo-dots')).toContain('flex-wrap: wrap');
  });

  it('the score stacks into the button row up to 439 px (German at 390 px)', () => {
    const at = css.indexOf('@media (max-width: 439px) {');
    expect(at).toBeGreaterThan(0);
    expect(css.slice(at, css.indexOf('}', at))).toContain('.pk-gatebar-score');
  });

  it('marks the replay’s grid column', () => {
    expect(ruleBody('.pk-tapgrid-cell.is-step')).toMatch(/box-shadow|background/);
  });

  it('the banner never runs off the screen: wraps within the viewport everywhere', () => {
    const banner = ruleBody('.pk-banner');
    expect(banner).toContain('width: max-content');
    expect(banner).toContain('max-width: calc(100vw - 2rem)');
    expect(banner).toContain('box-sizing: border-box');
    expect(banner).toContain('overflow-wrap: anywhere');
    expect(banner).not.toContain('white-space: nowrap');
  });

  it('on phones the anchored banner stays inside the sphere panel, sized by its width', () => {
    const anchored = phoneRule('.pk-banner--anchored');
    expect(anchored).toContain('left: var(--banner-x)');
    expect(anchored).toContain('top: var(--banner-y)');
    expect(anchored).toContain('max-width: var(--banner-w)');
    expect(anchored).toMatch(/font-size: clamp\([^;]*var\(--banner-w\)[^;]*\)/);
    // Only the phone layouts anchor: large screens keep the centred banner.
    expect(css.slice(0, css.indexOf('@media (max-width: 699px), (max-height: 450px) {'))).not.toContain(
      '.pk-banner--anchored',
    );
  });
});
