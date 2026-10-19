/**
 * Booth QR / UTM generator (scripts/booth-qr.mjs, docs/printing.md "Booth QR
 * codes per event"): URL building, slug + target validation, and — for every
 * target × language the script can emit — that the app's own URL readers land
 * where the target says and are not disturbed by the utm_* params.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LANGS,
  TARGETS,
  buildBoothUrl,
  cardHtml,
  main,
  outputName,
  parseArgs,
  slugError,
  targetError,
} from '../scripts/booth-qr.mjs';
import { detectSurface } from '../src/app/surface';
import { welcomeBypassed } from '../src/app/welcome';
import { parseUrlOverrides } from '../src/app/settings';
import { loadCourse } from '../src/golf/courseStore';
import { resolveLang } from '../../shared/i18n/index';

const UTM = 'utm_source=booth&utm_medium=qr&utm_campaign=';

describe('buildBoothUrl', () => {
  it('builds the exact URL for each named target', () => {
    expect(buildBoothUrl({ event: 'qce-2026' })).toBe(`https://entangible.org/?${UTM}qce-2026`);
    expect(buildBoothUrl({ event: 'qce-2026', target: 'golf' })).toBe(
      `https://entangible.org/?mode=golf&input=manual&${UTM}qce-2026`,
    );
    expect(buildBoothUrl({ event: 'qce-2026', target: 'runner' })).toBe(
      `https://entangible.org/?mode=runner&${UTM}qce-2026`,
    );
  });

  it('appends lang only when given', () => {
    expect(buildBoothUrl({ event: 'x', target: 'golf', lang: 'de' })).toBe(
      `https://entangible.org/?mode=golf&input=manual&${UTM}x&lang=de`,
    );
    expect(buildBoothUrl({ event: 'x' })).not.toContain('lang=');
    expect(() => buildBoothUrl({ event: 'x', lang: 'fr' })).toThrow(/lang/);
  });

  it('accepts a plain absolute path as target', () => {
    expect(buildBoothUrl({ event: 'x', target: '/guide/' })).toBe(`https://entangible.org/guide/?${UTM}x`);
  });

  it('rejects an invalid slug or target', () => {
    expect(() => buildBoothUrl({ event: 'Bad Slug' })).toThrow(/a-z/);
    expect(() => buildBoothUrl({ event: 'x', target: 'kiosk' })).toThrow(/target/);
  });
});

describe('slugError', () => {
  it.each(['a', 'qce-2026', 'ieee-quantum-week', '0', 'a'.repeat(40)])('accepts %s', (s) => {
    expect(slugError(s)).toBeNull();
  });
  it.each([
    ['', /missing/],
    [undefined, /missing/],
    ['a'.repeat(41), /41 characters/],
    ['QCE', /a-z/],
    ['qce_2026', /a-z/],
    ['qce 2026', /a-z/],
    ['qcé', /a-z/],
    ['a/b', /a-z/],
  ])('rejects %j', (s, why) => {
    expect(slugError(s)).toMatch(why);
  });
});

describe('targetError', () => {
  it.each(['home', 'golf', 'runner', '/', '/guide', '/guide/', '/a/b-c.html'])('accepts %s', (t) => {
    expect(targetError(t)).toBeNull();
  });
  it.each(['kiosk', 'guide', '//evil.example', '/../x', '/a/./b', '/?mode=golf', '/#guide', 'https://x.y/'])(
    'rejects %s',
    (t) => {
      expect(targetError(t)).not.toBeNull();
    },
  );
});

describe('parseArgs', () => {
  it('reads every flag and defaults target/size', () => {
    expect(parseArgs(['--event', 'e'])).toEqual({ event: 'e', target: 'home', size: 'a6' });
    expect(parseArgs(['--event', 'e', '--target', 'runner', '--lang', 'de', '--size', 'a5', '--out', 'd'])).toEqual({
      event: 'e',
      target: 'runner',
      lang: 'de',
      size: 'a5',
      out: 'd',
    });
  });
  it('rejects unknown flags, missing values and bad sizes', () => {
    expect(() => parseArgs(['--evnt', 'e'])).toThrow(/unknown/);
    expect(() => parseArgs(['--event'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--event', '--lang', 'de'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--event', 'e', '--size', 'a4'])).toThrow(/size/);
  });
});

describe('outputName', () => {
  it('is slug, then non-home target, then lang', () => {
    expect(outputName({ event: 'e' })).toBe('e');
    expect(outputName({ event: 'e', target: 'golf', lang: 'de' })).toBe('e-golf-de');
    expect(outputName({ event: 'e', target: '/guide/' })).toBe('e-guide');
  });
});

// Every target × language the script emits, read back through the app's own URL
// readers: the deep link lands as the target says and utm_* changes nothing.
describe('the site tolerates every generated URL', () => {
  const targets = Object.keys(TARGETS);
  const langs = [undefined, ...LANGS];
  const cases = targets.flatMap((target) => langs.map((lang) => ({ target, lang })));

  it('covers 3 targets × 3 language settings', () => {
    expect(cases).toHaveLength(9);
  });

  it.each(cases)('$target / lang=$lang', ({ target, lang }) => {
    const url = new URL(buildBoothUrl({ event: 'qce-2026', target, lang }));
    const search = url.search;
    const bare = new URLSearchParams(search);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) bare.delete(k);
    const bareSearch = `?${bare.toString()}`;

    expect(url.pathname).toBe('/');
    expect(url.hash).toBe('');
    // Surface: the visitor app, never kiosk/debug.
    expect(detectSurface(url.pathname, search)).toBe('app');
    // Settings: exactly the overrides of the same URL without utm_*.
    expect(parseUrlOverrides(search)).toEqual(parseUrlOverrides(bareSearch));
    expect(parseUrlOverrides(search).mode).toBe(
      target === 'golf' ? 'golf' : target === 'runner' ? 'runner' : undefined,
    );
    // Welcome card: home shows it; golf/runner bypass it via their own ?mode=.
    expect(welcomeBypassed(search)).toBe(target !== 'home');
    expect(welcomeBypassed(search)).toBe(welcomeBypassed(bareSearch));
    // Golf course: utm_campaign is not mistaken for a course or scope.
    expect(loadCourse(null, search)).toEqual({ courseCode: null, courseScope: null });
    // Language: the URL's lang wins when given; otherwise the browser decides.
    expect(resolveLang({ search, stored: null, navigatorLanguages: ['en-US'] })).toBe(lang ?? 'en');
  });
});

describe('QR + card', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('the longest URL still makes a small QR at error correction M', () => {
    const url = buildBoothUrl({ event: 'a'.repeat(40), target: 'golf', lang: 'de' });
    // Version 8 = 49 modules: at 65 mm on A6 that is ~1.3 mm per module.
    expect(QRCode.create(url, { errorCorrectionLevel: 'M' }).version).toBeLessThanOrEqual(8);
  });

  it('the card carries the QR, a call to action and the escaped URL', () => {
    const url = buildBoothUrl({ event: 'e', target: 'golf' });
    const html = cardHtml({ url, svg: '<svg id="q"></svg>', target: 'golf', size: 'a5' });
    expect(html).toContain('<svg id="q"></svg>');
    expect(html).toContain('Scan to play Quantum Golf');
    expect(html).toContain(url.replace(/&/g, '&amp;'));
    expect(html).toContain('size: 148mm 210mm');
    expect(cardHtml({ url, svg: '', target: 'runner', lang: 'de' })).toContain('lang="de"');
  });

  it('main writes the SVG + card and prints the URL', async () => {
    const out = mkdtempSync(join(tmpdir(), 'booth-qr-'));
    dirs.push(out);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await main(['--event', 'qce-2026', '--target', 'runner', '--lang', 'en', '--out', out]);
    const url = buildBoothUrl({ event: 'qce-2026', target: 'runner', lang: 'en' });
    expect(log).toHaveBeenCalledWith(url);
    const svg = readFileSync(join(out, 'qce-2026-runner-en.svg'), 'utf8');
    expect(svg).toMatch(/^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    // The SVG is the level-M symbol plus a 4-module quiet zone on each side.
    const side = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)?.[1]);
    expect(side).toBe(QRCode.create(url, { errorCorrectionLevel: 'M' }).modules.size + 8);
    expect(side).not.toBe(QRCode.create(url, { errorCorrectionLevel: 'L' }).modules.size + 8);
    const html = readFileSync(join(out, 'qce-2026-runner-en.html'), 'utf8');
    expect(html).toContain(svg);
    expect(html).toContain('size: 105mm 148mm');
  });
});
