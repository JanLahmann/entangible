/**
 * The game share pages (public/golf/, public/runner/ → entangible.org/golf/,
 * /runner/): static entries whose only jobs are a game-specific link preview
 * and an immediate hand-off to the app's existing deep link. Crawlers run no
 * JS, so these tags are all a shared game link can show.
 *
 * The source pages are checked always; the built copies in dist/ whenever a
 * build is present (the deploy workflow runs vitest right after `npm run
 * build`, so what ships is checked there).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const appDir = fileURLToPath(new URL('../../', import.meta.url));
const SITE = 'https://entangible.org/';

const PAGES = [
  {
    path: 'golf',
    image: 'og-golf.png',
    deepLink: '?mode=golf&input=manual',
    title: 'Quantum Golf',
  },
  {
    path: 'runner',
    image: 'og-runner.png',
    deepLink: '?mode=runner',
    title: 'Quantum Runner',
  },
] as const;

function meta(html: string, attr: 'name' | 'property', key: string): string | null {
  const m = new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`).exec(html.replace(/\s+/g, ' '));
  return m ? m[1] : null;
}

/** PNG width × height from the IHDR chunk. */
function pngSize(file: string): [number, number] {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function checkPage(html: string, p: (typeof PAGES)[number], root: string) {
  const url = `${SITE}${p.path}/`;
  const image = `${SITE}${p.image}`;

  // The card: absolute URLs only (crawlers resolve nothing), the game's image.
  expect(meta(html, 'property', 'og:url')).toBe(url);
  expect(meta(html, 'property', 'og:image')).toBe(image);
  expect(meta(html, 'name', 'twitter:image')).toBe(image);
  expect(meta(html, 'name', 'twitter:card')).toBe('summary_large_image');
  expect(meta(html, 'property', 'og:image:width')).toBe('1200');
  expect(meta(html, 'property', 'og:image:height')).toBe('630');
  expect(meta(html, 'property', 'og:title')).toContain(p.title);
  expect(meta(html, 'name', 'twitter:title')).toBe(meta(html, 'property', 'og:title'));
  expect(meta(html, 'name', 'twitter:description')).toBe(meta(html, 'property', 'og:description'));
  expect(meta(html, 'property', 'og:description')!.length).toBeGreaterThan(60);
  expect(meta(html, 'property', 'og:image:alt')!.length).toBeGreaterThan(40);
  expect(meta(html, 'name', 'twitter:image:alt')).toBe(meta(html, 'property', 'og:image:alt'));
  for (const [, v] of html.matchAll(/<meta\s+(?:property|name)="(?:og|twitter):(?:url|image)"\s+content="([^"]*)"/g)) {
    expect(v.startsWith(SITE)).toBe(true);
  }

  // The image ships next to the page, at the card size and light enough.
  const img = `${root}/${p.image}`;
  expect(existsSync(img)).toBe(true);
  expect(pngSize(img)).toEqual([1200, 630]);
  expect(statSync(img).size).toBeLessThan(300_000);

  // Not content of its own: noindex. Canonical names this page (as og:url
  // does), so a crawler that follows it never lands on the generic site card.
  expect(meta(html, 'name', 'robots')).toBe('noindex, follow');
  expect(html).toContain(`<link rel="canonical" href="${SITE}${p.path}/" />`);

  // Immediate hand-off into the existing deep link, keeping ?lang= / utm_*
  // (the whole query) and the hash. No meta refresh: crawlers follow it to
  // the generic card; no-JS visitors get the page's link instead.
  expect(html).toContain(
    `location.replace('../${p.deepLink}' + location.search.replace(/^\\?/, '&') + location.hash);`,
  );
  expect(html).not.toContain('http-equiv="refresh"');
  expect(html).toContain(`<a href="../${p.deepLink.replace(/&/g, '&amp;')}">`);
}

/** Run the page's redirect script against a given location; return the target. */
function redirectTarget(html: string, search: string, hash = ''): string {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
  let target = '';
  const location = { search, hash, replace: (u: string) => (target = u) };
  new Function('location', script)(location);
  return target;
}

describe.each(PAGES)('share page /$path/', (p) => {
  const src = readFileSync(`${appDir}public/${p.path}/index.html`, 'utf8');

  it('carries the game card and redirects into the deep link (source)', () => {
    checkPage(src, p, `${appDir}public`);
  });

  it('keeps lang, utm_* and the hash through the redirect', () => {
    expect(redirectTarget(src, '')).toBe(`../${p.deepLink}`);
    expect(redirectTarget(src, '?lang=de&utm_source=x&utm_campaign=y', '#a')).toBe(
      `../${p.deepLink}&lang=de&utm_source=x&utm_campaign=y#a`,
    );
  });

  it('is not in the sitemap (noindex share entry, not content)', () => {
    expect(readFileSync(`${appDir}public/sitemap.xml`, 'utf8')).not.toContain(`/${p.path}/`);
  });

  const built = `${appDir}dist/${p.path}/index.html`;
  it.runIf(existsSync(`${appDir}dist/index.html`))('ships in the build output, unchanged', () => {
    expect(existsSync(built)).toBe(true);
    const html = readFileSync(built, 'utf8');
    expect(html).toBe(src);
    checkPage(html, p, `${appDir}dist`);
  });
});
