/**
 * Self-check of the app bundles' build-time tooling (golf: docs/golf-bundle.md,
 * runner: docs/runner-bundle.md): the guard's matchers and per-bundle profiles
 * (scripts/check-bundle.mjs) and the licence-notice helpers
 * (vite-plugins/appBundle.ts). Each matcher is shown to catch what it must
 * and to pass what the real bundle legitimately contains — a guard that
 * silently matches nothing is worse than none.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import {
  BUNDLES,
  FORBIDDEN_JS,
  absoluteAssetRefs,
  checkBundle,
  nonRelativeRefs,
  parseArgs,
  unguardedHoverInCss,
  unguardedHoverInJs,
  urlsIn,
} from '../scripts/check-bundle.mjs';
import { packageDirOf, renderNotices } from '../vite-plugins/appBundle';

const URL_ALLOWLIST = BUNDLES.golf.urlAllowlist;
const REPO_LICENSE = resolve(dirname(fileURLToPath(import.meta.url)), '../../LICENSE');

describe('check-bundle matchers', () => {
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

  it('has one distinct, non-empty marker per excluded module, in every bundle', () => {
    for (const [name, profile] of Object.entries(BUNDLES)) {
      const markers = profile.excludedMarkers.map(([, m]) => m);
      expect(new Set(markers).size, name).toBe(markers.length);
      for (const m of markers) expect(m.length, `${name} ${m}`).toBeGreaterThan(3);
    }
  });

  it('keeps each game out of the other bundle', () => {
    const markers = (name: 'golf' | 'runner') => BUNDLES[name].excludedMarkers.map(([, m]) => m);
    // The golf bundle carries no Runner; the runner bundle no golf, no editor library.
    expect(markers('golf')).toContain('pk-runner');
    expect(markers('runner')).not.toContain('pk-runner');
    for (const m of ['pk-golf-goal', 'pk-gatebar', 'circuit-editor', 'qamposer-theme']) {
      expect(markers('runner')).toContain(m);
    }
    // The runner bundle has no editor library, so its notices do not demand it.
    expect(BUNDLES.runner.requiredNotices).not.toContain('@qamposer/react');
    expect(BUNDLES.golf.requiredNotices).toContain('@qamposer/react');
  });

  it('parses --bundle and an optional dist path', () => {
    expect(parseArgs(['--bundle', 'runner'])).toEqual({ bundle: 'runner', dist: null });
    expect(parseArgs(['--bundle=golf', 'out'])).toEqual({ bundle: 'golf', dist: 'out' });
    expect(parseArgs(['dist-x'])).toEqual({ bundle: null, dist: 'dist-x' });
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

describe('checkBundle — a whole (synthetic) runner bundle', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  /** A minimal bundle that satisfies the runner contract; `js` is the app script. */
  function makeDist(js: string): string {
    dir = mkdtempSync(join(tmpdir(), 'runner-bundle-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(
      join(dir, 'index.html'),
      '<!doctype html><link rel="icon" href="data:,"><script defer src="./assets/runner-x.js"></script>' +
        '<link rel="stylesheet" href="./assets/style-x.css">',
    );
    writeFileSync(join(dir, 'assets', 'runner-x.js'), js);
    writeFileSync(join(dir, 'assets', 'style-x.css'), '.pk-runner{}@media (hover: hover){.a:hover{b:c}}');
    writeFileSync(join(dir, 'LICENSE'), readFileSync(REPO_LICENSE, 'utf8'));
    writeFileSync(
      join(dir, 'THIRD_PARTY_NOTICES.txt'),
      BUNDLES.runner.requiredNotices.map((p) => `  - ${p} 1.0.0 — MIT`).join('\n') + '\nSIL OPEN FONT LICENSE',
    );
    return dir;
  }

  it('passes a clean runner bundle', () => {
    const dist = makeDist('var a="pk-runner";var u="https://entangible.org/";');
    expect(checkBundle(dist, REPO_LICENSE, BUNDLES.runner).errors).toEqual([]);
    // The same files fail the golf profile (the Runner is excluded there).
    expect(checkBundle(dist, REPO_LICENSE, BUNDLES.golf).errors.join('\n')).toMatch(/Quantum Runner/);
  });

  it('fails on golf, the editor library, analytics or the network', () => {
    const errors = checkBundle(
      makeDist('a="pk-gatebar";b="circuit-editor";window.umami;fetch("x");c="https://cloud.umami.is/s.js"'),
      REPO_LICENSE,
      BUNDLES.runner,
    ).errors.join('\n');
    expect(errors).toMatch(/golf tap to play/);
    expect(errors).toMatch(/@qamposer\/react editor/);
    expect(errors).toMatch(/forbidden API umami/);
    expect(errors).toMatch(/forbidden API fetch\(/);
    expect(errors).toMatch(/URL not on the allowlist: https:\/\/cloud\.umami\.is/);
  });

  it('reports a missing bundle with its own build command', () => {
    expect(checkBundle(join(tmpdir(), 'no-such-runner-dist'), REPO_LICENSE, BUNDLES.runner).errors[0]).toMatch(
      /npm run build:runner/,
    );
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
