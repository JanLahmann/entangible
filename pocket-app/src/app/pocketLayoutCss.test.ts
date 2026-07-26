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

  it('scopes EVERY golf-manual rule to a roomy landscape media query', () => {
    // Line scan with brace-depth tracking (pocket.css is one declaration per
    // line): each selector line carrying the class must sit inside an @media.
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
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q).toMatch(/min-width:\s*(9\d\d|1\d{3})px/);
      expect(q).toContain('min-height: 500px');
      expect(q).toContain('orientation: landscape');
    }
  });

  it('keeps the editor column above the library 400px min circuit width', () => {
    // minmax(30rem, …) = 480px stage track − 2rem padding ⇒ 448px of editor.
    const golf = css.slice(css.indexOf('.pk-main.pk-main--golf-manual {'));
    expect(golf).toContain('minmax(30rem, 1fr)');
  });
});
