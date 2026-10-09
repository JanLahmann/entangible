/**
 * Kiosk zoom guard. Pinch-zoom is enabled app-wide (index.html — an
 * accessibility must for the visitor's phone), but a booth screen or tablet
 * must not be left magnified by one visitor's pinch for the next. The guard is
 * one `touch-action` on the kiosk ROOT (`.bo`) — and nowhere on the visitor
 * phone app's root (`.pk`), which keeps full pinch-zoom.
 *
 * jsdom does no layout and ignores `touch-action`, so this pins the stylesheet
 * rules themselves (read as UTF-8, comments stripped — the comments quote the
 * very declarations scanned for).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

function stylesheet(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
}

/** Body of the first top-level `<selector> {` block, or '' when absent. */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  if (at < 0) return '';
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

const kiosk = stylesheet('./kiosk.css');
const pocket = stylesheet('../app/pocket.css');

describe('kiosk surface: no accidental zoom', () => {
  it('the kiosk root allows pans only (no pinch / double-tap zoom)', () => {
    expect(ruleBody(kiosk, '.bo')).toMatch(/^\s*touch-action:\s*pan-x pan-y;/m);
  });

  it('the visitor phone root keeps pinch-zoom (no touch-action on .pk)', () => {
    const body = ruleBody(pocket, '.pk');
    expect(body).not.toBe('');
    expect(body).not.toMatch(/touch-action/);
    // …and no pocket rule restricts pans/zoom wholesale either.
    expect(pocket).not.toMatch(/touch-action:\s*pan-x pan-y/);
  });
});
