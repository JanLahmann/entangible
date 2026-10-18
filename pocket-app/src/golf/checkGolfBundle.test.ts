/**
 * Self-check of the golf bundle's build-time tooling: the guard's matchers
 * (scripts/check-golf-bundle.mjs) and the licence-notice helpers
 * (vite-plugins/golfBundle.ts). Each matcher is shown to catch what it must
 * and to pass what the real bundle legitimately contains — a guard that
 * silently matches nothing is worse than none.
 */
import { join, sep } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  EXCLUDED_MARKERS,
  FORBIDDEN_JS,
  URL_ALLOWLIST,
  absoluteAssetRefs,
  nonRelativeRefs,
  unguardedHoverInCss,
  unguardedHoverInJs,
  urlsIn,
} from '../../scripts/check-golf-bundle.mjs';
import { packageDirOf, renderNotices } from '../../vite-plugins/golfBundle';

describe('check-golf-bundle matchers', () => {
  it('flags root-absolute asset URLs, not relative ones', () => {
    expect(absoluteAssetRefs('<script src="/assets/a.js">')).toHaveLength(1);
    expect(absoluteAssetRefs('url(/assets/f.woff2)')).toHaveLength(1);
    expect(absoluteAssetRefs('"./assets/a.js" url(./f.woff2)')).toEqual([]);
  });

  it('accepts only relative src/href in index.html', () => {
    const html =
      '<script defer src="./assets/a.js"></script><link href="./assets/s.css"><link rel="icon" href="data:,">' +
      '<script src="/x.js"></script><link href="https://cdn.example/x.css">';
    expect(nonRelativeRefs(html)).toEqual(['/x.js', 'https://cdn.example/x.css']);
  });

  it('finds URLs and allows exactly the listed ones', () => {
    const js = 'a="https://entangible.org/";b="http://www.w3.org/2000/svg";c="https://cloud.umami.is/script.js"';
    const bad = urlsIn(js).filter((u: string) => !URL_ALLOWLIST.has(u));
    expect(bad).toEqual(['https://cloud.umami.is/script.js']);
  });

  it('catches every forbidden API', () => {
    const samples: Record<string, string> = {
      'fetch(': 'await fetch ("/api/info")',
      'new WebSocket': 'new WebSocket(u)',
      getUserMedia: 'navigator.mediaDevices.getUserMedia({})',
      serviceWorker: 'navigator.serviceWorker.register("sw.js")',
      umami: 'window.Umami.track()',
      XMLHttpRequest: 'new XMLHttpRequest',
      sendBeacon: 'navigator.sendBeacon(u)',
      EventSource: 'new EventSource(u)',
      'new Worker': 'new Worker(u)',
    };
    for (const [label, re] of FORBIDDEN_JS) {
      expect(re.test(samples[label]), label).toBe(true);
    }
    // …and leaves look-alikes alone.
    expect(FORBIDDEN_JS.some(([, re]: [string, RegExp]) => re.test('prefetch=1;refetchX'))).toBe(false);
  });

  it('has one distinct, non-empty marker per excluded module', () => {
    const markers = EXCLUDED_MARKERS.map(([, m]: [string, string]) => m);
    expect(new Set(markers).size).toBe(markers.length);
    for (const m of markers) expect(m.length).toBeGreaterThan(3);
  });

  it('finds :hover outside @media (hover: hover) in CSS, and only there', () => {
    const css =
      '.a:hover{color:red}@media (hover:hover){.b:hover{color:red}}' +
      '@media (max-width:699px){.c:hover{x:y}@media (hover: hover){.d:hover{x:y}}}' +
      '/* .e:hover{} */.f:focus{x:y}';
    expect(unguardedHoverInCss(css)).toEqual(['.a:hover', '.c:hover']);
  });

  it('finds injected :hover rules that are not wrapped (JS strings)', () => {
    const ok = 'const css=`.x{a:b}\n@media (hover: hover) {\n.x:hover {\n  a: c;\n}\n}`';
    const bad = 'const css=`.x{a:b}\n.x:hover {\n  a: c;\n}`';
    expect(unguardedHoverInJs(ok)).toEqual([]);
    expect(unguardedHoverInJs(bad)).toHaveLength(1);
    // A guard block that already closed does not cover a later rule.
    expect(unguardedHoverInJs(`${ok}\n.y:hover{a:b}`)).toHaveLength(1);
  });
});

describe('third-party notice helpers', () => {
  const nm = (...parts: string[]) => join(sep, 'repo', 'node_modules', ...parts);

  it('maps a module id to its (innermost) package directory', () => {
    expect(packageDirOf(nm('react', 'cjs', 'react.production.min.js'))).toBe(nm('react'));
    expect(packageDirOf(nm('@fontsource', 'ibm-plex-sans', 'latin-400.css'))).toBe(
      nm('@fontsource', 'ibm-plex-sans'),
    );
    expect(packageDirOf(`\0${nm('scheduler', 'index.js')}?commonjs-exports`)).toBe(nm('scheduler'));
    expect(packageDirOf(nm('a', 'node_modules', 'b', 'x.js'))).toBe(nm('a', 'node_modules', 'b'));
    expect(packageDirOf(join(sep, 'repo', 'src', 'app.ts'))).toBeNull();
  });

  it('lists every package with its licence text', () => {
    const text = renderNotices(
      [
        { name: 'react', version: '18.3.1', license: 'MIT', homepage: '', licenseFile: 'LICENSE', licenseText: 'MIT License …' },
        { name: 'x', version: '1.0.0', license: 'ISC', homepage: 'https://x', licenseFile: null, licenseText: '' },
      ],
      'Test',
    );
    expect(text).toMatch(/^ {2}- react 18\.3\.1 — MIT$/m);
    expect(text).toContain('MIT License …');
    expect(text).toContain('(no license file shipped in the package; license field: ISC)');
  });
});
