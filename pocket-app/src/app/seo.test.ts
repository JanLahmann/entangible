// @vitest-environment jsdom
/**
 * Search-engine surface of index.html + public/sitemap.xml: the crawlable
 * static block (h1, copy, deep links, the family links — all of them, from the
 * manifest), title/og:title/twitter:title agreeing, the per-language canonical,
 * hreflang alternates that match the sitemap, and JSON-LD that parses.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { FAMILY, FAMILY_FOOTER_EVENT } from './familyRoster';
import { FAMILY_MARKER, injectStaticContent } from '../../vite-plugins/staticContent';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const raw = read('../../index.html');
const html = injectStaticContent(raw);
const doc = new DOMParser().parseFromString(html, 'text/html');
const block = doc.querySelector('#root > .boot-seo')!;
const text = (block?.textContent ?? '').replace(/\s+/g, ' ').trim();

const SITE = 'https://entangible.org/';
const DE = 'https://entangible.org/?lang=de';

describe('crawlable static block (#root > .boot-seo)', () => {
  it('sits in #root after the splash, so React replaces both on mount', () => {
    const root = doc.getElementById('root')!;
    expect(block).toBeTruthy();
    expect([...root.children].map((c) => c.className)).toEqual(['boot-splash', 'boot-seo']);
  });

  it('has the page’s only h1 and real prose', () => {
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect(block.querySelector('h1')?.textContent).toBe('Entangible — build quantum circuits with your hands');
    expect([...block.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'How to play',
      'Quantum Golf',
      'Quantum Runner',
    ]);
    expect(text.split(' ').length).toBeGreaterThan(200);
  });

  it('makes no claims the app does not make (copy comes from the Guide)', () => {
    expect(text).not.toMatch(/\bfree\b|nothing leaves|requires?\b/i);
  });

  it('links the app’s real deep links', () => {
    const hrefs = [...block.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    for (const h of ['/', '/?lang=de', '/#guide', '/?mode=golf&input=manual', '/?mode=runner']) {
      expect(hrefs).toContain(h);
    }
  });

  it('carries every family member the Guide shows, in manifest order, with the Guide’s attributes', () => {
    expect(raw).toContain(FAMILY_MARKER);
    expect(html).not.toContain(FAMILY_MARKER);
    const links = [...block.querySelectorAll('a[data-umami-event]')];
    expect(FAMILY.length).toBeGreaterThan(0);
    expect(links.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('data-umami-event-to')])).toEqual(
      FAMILY.map((m) => [m.name, m.url, m.id]),
    );
    for (const a of links) {
      expect(a.getAttribute('data-umami-event')).toBe(FAMILY_FOOTER_EVENT);
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('is visually hidden while JS runs and shown instead of the splash without JS', () => {
    const style = doc.querySelector('head > style')!.textContent!;
    expect(style).toMatch(/\.boot-seo\s*\{[^}]*position:\s*absolute[^}]*clip-path:\s*inset\(50%\)/);
    const noscript = doc.querySelector('head > noscript')!.innerHTML;
    expect(noscript).toMatch(/\.boot-splash\s*\{\s*display:\s*none/);
    expect(noscript).toMatch(/\.boot-seo\s*\{[^}]*position:\s*static/);
  });
});

describe('title and preview titles', () => {
  it('is descriptive, at most 60 characters, and the same everywhere', () => {
    const title = doc.title;
    expect(title).toBe('Entangible — build quantum circuits with your hands');
    expect(title.length).toBeLessThanOrEqual(60);
    expect(doc.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(title);
    expect(doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content')).toBe(title);
  });
});

describe('canonical and hreflang', () => {
  it('lists en, de and x-default alternates', () => {
    const alt = [...doc.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => [
      l.getAttribute('hreflang'),
      l.getAttribute('href'),
    ]);
    expect(alt).toEqual([
      ['en', SITE],
      ['de', DE],
      ['x-default', SITE],
    ]);
  });

  it('ships no static canonical (it would point /?lang=de at the English page)', () => {
    expect(doc.querySelector('link[rel="canonical"]')).toBeNull();
  });

  const script = [...doc.querySelectorAll('head > script:not([src]):not([type])')]
    .map((s) => s.textContent ?? '')
    .find((s) => s.includes("'canonical'"))!;

  function canonicalFor(search: string): string[] {
    const added: { rel: string; href: string }[] = [];
    const document = {
      createElement: () => ({ rel: '', href: '' }),
      head: { appendChild: (l: { rel: string; href: string }) => void added.push(l) },
    };
    vm.runInNewContext(script, { document, location: { search }, URLSearchParams });
    return added.filter((l) => l.rel === 'canonical').map((l) => l.href);
  }

  it('sets the canonical per language, in <head>, every other parameter collapsing to /', () => {
    expect(script).toBeTruthy();
    expect(canonicalFor('')).toEqual([SITE]);
    expect(canonicalFor('?lang=de')).toEqual([DE]);
    expect(canonicalFor('?mode=golf&lang=DE')).toEqual([DE]);
    expect(canonicalFor('?lang=en')).toEqual([SITE]);
    expect(canonicalFor('?mode=runner')).toEqual([SITE]);
    expect(canonicalFor('?kiosk&connect=1')).toEqual([SITE]);
    expect(canonicalFor('?lang=fr')).toEqual([SITE]);
  });
});

describe('JSON-LD', () => {
  const blocks = [...doc.querySelectorAll('script[type="application/ld+json"]')];
  const data = JSON.parse(blocks[0]?.textContent ?? 'null');
  const byType = (t: string) => data['@graph'].find((n: { '@type': string }) => n['@type'] === t);

  it('parses, once, as a WebSite + WebApplication graph', () => {
    expect(blocks).toHaveLength(1);
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@graph'].map((n: { '@type': string }) => n['@type'])).toEqual(['WebSite', 'WebApplication']);
  });

  it('states only verifiable fields', () => {
    const site = byType('WebSite');
    expect(site).toMatchObject({ name: 'Entangible', url: SITE, inLanguage: ['en', 'de'] });
    const app = byType('WebApplication');
    expect(app).toMatchObject({
      name: 'Entangible',
      url: SITE,
      applicationCategory: 'EducationalApplication',
      operatingSystem: 'Web browser',
      inLanguage: ['en', 'de'],
      license: 'https://www.apache.org/licenses/LICENSE-2.0',
      image: doc.querySelector('meta[property="og:image"]')?.getAttribute('content'),
    });
    expect(read('../../../LICENSE')).toMatch(/Apache License\s+Version 2\.0/);
    expect(app).not.toHaveProperty('isAccessibleForFree');
    expect(app).not.toHaveProperty('offers');
  });
});

describe('public/sitemap.xml', () => {
  const xml = new DOMParser().parseFromString(read('../../public/sitemap.xml'), 'application/xml');
  const urls = [...xml.getElementsByTagNameNS('http://www.sitemaps.org/schemas/sitemap/0.9', 'url')];
  const child = (u: Element, name: string) =>
    u.getElementsByTagNameNS('http://www.sitemaps.org/schemas/sitemap/0.9', name)[0]?.textContent;

  it('is well-formed XML with the English and German pages', () => {
    expect(xml.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(urls.map((u) => child(u, 'loc'))).toEqual([SITE, DE]);
  });

  it('gives each URL a real, non-future lastmod', () => {
    for (const u of urls) {
      const lastmod = child(u, 'lastmod')!;
      expect(lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(lastmod))).toBe(false);
      expect(Date.parse(lastmod)).toBeLessThanOrEqual(Date.now());
    }
  });

  it('lists every alternate on every URL (itself included), matching index.html', () => {
    for (const u of urls) {
      const alt = [...u.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'link')].map((l) => [
        l.getAttribute('hreflang'),
        l.getAttribute('href'),
      ]);
      expect(alt).toEqual([
        ['en', SITE],
        ['de', DE],
        ['x-default', SITE],
      ]);
    }
  });
});
