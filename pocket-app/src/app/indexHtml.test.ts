/**
 * index.html regressions: pinch-zoom stays enabled (accessibility), a shared
 * entangible.org link carries a real preview card, and the page paints a boot
 * splash before any script arrives, and the Umami tag is the family standard
 * (bot filter + ?notrack opt-out) for entangible.org only.
 */
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');

function meta(attr: 'name' | 'property', key: string): string | null {
  const m = new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`).exec(html.replace(/\s+/g, ' '));
  return m ? m[1] : null;
}

describe('index.html', () => {
  it('does not block pinch-zoom', () => {
    const viewport = meta('name', 'viewport');
    expect(viewport).toContain('width=device-width');
    expect(viewport).toContain('initial-scale=1');
    expect(viewport).not.toMatch(/maximum-scale|user-scalable/);
  });

  it('has a description and Open Graph / Twitter preview tags', () => {
    expect(meta('name', 'description')).toBeTruthy();
    expect(meta('property', 'og:title')).toBe('Entangible — build quantum circuits with your hands');
    expect(meta('property', 'og:description')).toBeTruthy();
    expect(meta('property', 'og:type')).toBe('website');
    expect(meta('property', 'og:url')).toBe('https://entangible.org/');
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
  });

  it('points og:image at a file that actually ships (public/ → site root)', () => {
    const image = meta('property', 'og:image');
    expect(image).toMatch(/^https:\/\/entangible\.org\//);
    const rel = image!.replace('https://entangible.org/', '');
    expect(existsSync(fileURLToPath(new URL(`../../public/${rel}`, import.meta.url)))).toBe(true);
  });

  it('keeps the site card generic: the game cards live on the share pages', () => {
    // entangible.org/golf/ and /runner/ carry og-golf.png / og-runner.png
    // (sharePages.test.ts); the app page itself stays the Entangible card.
    expect(meta('property', 'og:image')).toBe('https://entangible.org/og-image.png');
    expect(meta('name', 'twitter:image')).toBe('https://entangible.org/og-image.png');
  });
});

describe('index.html boot splash (no blank first paint)', () => {
  const root = /<div id="root">([\s\S]*?)<\/div>\s*<script/.exec(html)?.[1] ?? '';

  it('puts a static splash inside #root, for React to replace on mount', () => {
    expect(root).toContain('class="boot-splash"');
    expect(root).toContain('role="status"');
    expect(root.replace(/<[^>]+>/g, '')).toContain('Entangible');
    expect(root).toContain('Build quantum circuits with your hands');
  });

  it('styles the splash inline, in the token colours, with no external request', () => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    expect(style).toContain('.boot-splash');
    expect(style).toContain('#0f1117'); // --bg (also theme-color)
    expect(style).toContain('#7a5cff'); // --entangle, the "En" of the brand
    expect(style).not.toMatch(/url\(|@import/);
  });
});

describe('index.html Umami tag (Fun with Quantum family standard)', () => {
  /** The family-standard inline filter, byte for byte. */
  const FAMILY_FILTER =
    "(function(){try{var q=location.search;if(/[?&]notrack\\b/.test(q))localStorage.setItem('umami.disabled','1');if(/[?&]track\\b/.test(q))localStorage.removeItem('umami.disabled')}catch(e){}window.fwqUmamiBeforeSend=function(t,p){var n=navigator;return(n.webdriver||/HeadlessChrome|bot|crawl|spider|Lighthouse|PageSpeed/i.test(n.userAgent))?false:p}})();";

  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  const inlineAt = scripts.findIndex((m) => m[2].includes('fwqUmamiBeforeSend'));
  const trackerAt = scripts.findIndex((m) => m[1].includes('cloud.umami.is/script.js'));

  it('ships the filter verbatim, as a classic inline script BEFORE the tracker', () => {
    expect(inlineAt).toBeGreaterThanOrEqual(0);
    expect(scripts[inlineAt][1].trim()).toBe('');
    expect(scripts[inlineAt][2]).toBe(FAMILY_FILTER);
    expect(trackerAt).toBeGreaterThan(inlineAt);
    expect(scripts.filter((m) => m[1].includes('umami')).length).toBe(1);
  });

  it('loads the tracker deferred, for entangible.org only, through the filter', () => {
    const attrs = scripts[trackerAt][1];
    expect(attrs).toContain(' defer');
    expect(attrs).toContain('data-website-id="97f347ac-e7ba-4be3-b26f-ab4b328bdbf2"');
    expect(attrs).toContain('data-domains="entangible.org"');
    expect(attrs).toContain('data-before-send="fwqUmamiBeforeSend"');
  });

  type BeforeSend = (type: string, payload: unknown) => unknown;
  type Sandbox = Record<string, unknown> & { fwqUmamiBeforeSend?: BeforeSend };

  const DESKTOP =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  const MOBILE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
  const payload = { website: 'x', url: '/' };

  /** Run the inline filter as the page does, in a fresh global (`window` = the global). */
  function runFilter(opts: {
    search?: string;
    ua?: string;
    webdriver?: boolean;
    store?: Map<string, string>;
    storage?: unknown;
  }) {
    const store = opts.store ?? new Map<string, string>();
    const sandbox: Sandbox = {
      location: { search: opts.search ?? '' },
      navigator: { userAgent: opts.ua ?? DESKTOP, webdriver: opts.webdriver ?? false },
      localStorage: opts.storage ?? {
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
    sandbox.window = sandbox;
    vm.runInNewContext(FAMILY_FILTER, sandbox);
    return { beforeSend: sandbox.fwqUmamiBeforeSend!, store };
  }

  it('passes a person on a desktop or a phone through unchanged', () => {
    for (const ua of [DESKTOP, MOBILE]) {
      expect(runFilter({ ua }).beforeSend('event', payload)).toBe(payload);
    }
  });

  it('drops every send from automation: webdriver, headless Chrome, bots, Lighthouse', () => {
    expect(runFilter({ webdriver: true }).beforeSend('event', payload)).toBe(false);
    for (const ua of [
      DESKTOP.replace('Chrome/', 'HeadlessChrome/'),
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 Chrome-Lighthouse',
      'Mozilla/5.0 (compatible; SomeCrawler/1.0; crawl)',
      'Mozilla/5.0 (compatible; Google-PageSpeed)',
    ]) {
      expect(runFilter({ ua }).beforeSend('event', payload), ua).toBe(false);
    }
  });

  it('?notrack opts this browser out (umami.disabled=1); ?track opts it back in', () => {
    const store = new Map<string, string>();
    runFilter({ search: '?notrack', store });
    expect(store.get('umami.disabled')).toBe('1');
    runFilter({ search: '', store });
    expect(store.get('umami.disabled')).toBe('1'); // sticks on later visits
    runFilter({ search: '?x=1&track', store });
    expect(store.has('umami.disabled')).toBe(false);
    runFilter({ search: '?course=abc12&notrack', store });
    expect(store.get('umami.disabled')).toBe('1');
  });

  it('still installs the filter when storage throws (private mode)', () => {
    const storage = {
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(runFilter({ search: '?notrack', storage }).beforeSend('event', payload)).toBe(payload);
  });
});
