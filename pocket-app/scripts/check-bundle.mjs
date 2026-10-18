#!/usr/bin/env node
/**
 * Guard for the single-game app bundles the Fun with Quantum iOS app embeds
 * offline — Quantum Golf (docs/golf-bundle.md) and Quantum Runner
 * (docs/runner-bundle.md). Run after the matching build:
 *
 *   npm run build:golf   && node scripts/check-bundle.mjs --bundle golf   [dist-golf]
 *   npm run build:runner && node scripts/check-bundle.mjs --bundle runner [dist-runner]
 *
 * Fails (exit 1) when the bundle breaks the contract with the iOS app, which
 * serves the files from a custom URL scheme and blocks every network request:
 *   - index.html must exist and reference only relative URLs (no `/…`, no
 *     scheme), with classic scripts (no `type="module"`, which file:// and
 *     some custom-scheme loaders refuse);
 *   - no absolute `/assets/` URL in any HTML / CSS / JS file;
 *   - JS: no `http(s)://` outside the bundle's allowlist, no `fetch(`,
 *     `new WebSocket`, `getUserMedia`, `serviceWorker`, `umami`, XHR, beacons,
 *     workers; and none of the markers of the modules the bundle must not
 *     contain at all (camera / vision, composer hand-off + QR, Quantina,
 *     kiosk, debug, guide, booth socket, analytics — plus the Runner in the
 *     golf bundle, and golf / the editor library in the runner bundle);
 *   - every `:hover` rule (stylesheets and the editor library's runtime-
 *     injected CSS) sits inside `@media (hover: hover)`;
 *   - LICENSE (identical to the repo's) and THIRD_PARTY_NOTICES.txt (naming
 *     the packages that are certainly bundled) exist.
 * Then prints a size report (raw + gzip per file and in total). Exit 2 on a
 * missing / unknown `--bundle`.
 *
 * The matchers are exported for the self-check in tests/checkBundle.test.ts.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

/** React's error text and XML namespace identifiers — names, not requests. */
const REACT_URLS = [
  // React's production error messages print this as text.
  ['https://reactjs.org/docs/error-decoder.html?invariant=', 'React error text'],
  // XML namespace identifiers (React DOM / SVG).
  ['http://www.w3.org/2000/svg', 'SVG namespace'],
  ['http://www.w3.org/1999/xlink', 'XLink namespace'],
  ['http://www.w3.org/1999/xhtml', 'XHTML namespace'],
  ['http://www.w3.org/1998/Math/MathML', 'MathML namespace'],
  ['http://www.w3.org/XML/1998/namespace', 'XML namespace'],
];

/** Network / platform APIs a bundle must not use at all. */
export const FORBIDDEN_JS = [
  ['fetch(', /\bfetch\s*\(/],
  ['new WebSocket', /new\s+WebSocket\b/],
  ['getUserMedia', /getUserMedia/],
  ['serviceWorker', /serviceWorker/],
  ['umami', /umami/i],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['sendBeacon', /sendBeacon/],
  ['EventSource', /\bEventSource\b/],
  ['new Worker', /new\s+(Shared)?Worker\b/],
];

/**
 * Distinctive strings of the site-only modules that NO app bundle may contain
 * (absent, not just hidden). Each was checked present in the site build's
 * matching chunk when this list was made — class names and protocol strings,
 * not i18n copy (all messages, Quantina's included, ship in both languages by
 * design).
 */
const SITE_ONLY_MARKERS = [
  ['camera (useCamera / CameraPanel)', 'facingMode'],
  ['camera panel UI', 'pk-cam'],
  ['vision pipeline', 'appearMin cannot exceed'],
  ['vision pipeline warnings', 'stray_furniture'],
  ['booth state socket', '/ws/state'],
  ['camera-role frame socket', '/ws/frames'],
  ['booth host probe', '/api/info'],
  ['composer hand-off (lz-string)', 'compressToEncodedURIComponent'],
  ['composer hand-off UI', 'pk-transfer'],
  ['composer QR', 'pk-qr'],
  ['qrcode library', 'No input text'],
  ['challenge-a-friend QR', 'pk-golf-challenge'],
  ['Quantina', 'pk-quantina'],
  ['Quantina serve reveal', 'ServeReveal'],
  ['kiosk skin', 'bo-connect'],
  ['debug panel', 'dbg-'],
  ['guide', 'pk-guide'],
  ['settings drawer', 'pk-drawer'],
  ['welcome card', 'pk-welcome'],
  ['analytics event names', 'Entangible:'],
  ['fullscreen / wake lock', 'wakeLock'],
];

/**
 * The bundles this guard knows (`--bundle <name>`): where the build puts it,
 * which absolute URLs its JS may contain (each with why it is not a request —
 * anything else fails), which modules must be absent, and which packages its
 * THIRD_PARTY_NOTICES.txt must name (those certainly bundled).
 */
export const BUNDLES = {
  golf: {
    title: 'Quantum Golf',
    dist: 'dist-golf',
    build: 'npm run build:golf',
    urlAllowlist: new Map([
      // A plain <a href> (rules panel) and the base of the copied course link —
      // opened by the host in Safari, never fetched by the page.
      ['https://entangible.org/', 'plain link (rules panel, course share link)'],
      ...REACT_URLS,
    ]),
    excludedMarkers: [...SITE_ONLY_MARKERS, ['Quantum Runner', 'pk-runner']],
    requiredNotices: [
      'react',
      'react-dom',
      'scheduler',
      '@qamposer/react',
      '@fontsource/ibm-plex-sans',
      '@fontsource/ibm-plex-mono',
    ],
  },
  runner: {
    title: 'Quantum Runner',
    dist: 'dist-runner',
    build: 'npm run build:runner',
    urlAllowlist: new Map([
      // A plain <a href> in the rules panel — opened by the host in Safari.
      ['https://entangible.org/', 'plain link (rules panel)'],
      ...REACT_URLS,
    ]),
    excludedMarkers: [
      ...SITE_ONLY_MARKERS,
      // Golf and everything only golf pulls in: the runner needs no editor
      // library, no sphere and no golf engine.
      ['golf board', 'pk-golf-goal'],
      ['golf course picker', 'pk-course-pick'],
      ['golf tap to play', 'pk-gatebar'],
      ['golf engine', 'no solution for hole'],
      ['@qamposer/react editor', 'circuit-editor'],
      ['@qamposer/react theme', 'qamposer-theme'],
    ],
    requiredNotices: [
      'react',
      'react-dom',
      'scheduler',
      '@fontsource/ibm-plex-sans',
      '@fontsource/ibm-plex-mono',
    ],
  },
};

/** Every absolute http(s) URL in `text`. */
export function urlsIn(text) {
  return text.match(/https?:\/\/[^\s"'`)\\<>]*/g) ?? [];
}

/** Root-absolute asset references (`"/assets/…"`, `url(/assets/…)`, …). */
export function absoluteAssetRefs(text) {
  return text.match(/(?:["'(=]\s*)\/assets\//g) ?? [];
}

/** src/href values in an HTML file that are not relative paths. */
export function nonRelativeRefs(html) {
  const bad = [];
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/g)) {
    const v = m[1];
    if (v.startsWith('data:')) continue;
    if (v.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(v)) bad.push(v);
  }
  return bad;
}

const HOVER_MEDIA = /@media[^{]*\(\s*hover\s*:\s*hover\s*\)/;

/**
 * `:hover` selectors in a stylesheet that are NOT inside `@media (hover:
 * hover)`. A brace-depth scan over the (comment-free) CSS: each block's
 * prelude is pushed, so a rule knows every at-rule it sits in.
 */
export function unguardedHoverInCss(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [];
  const bad = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') {
      const prelude = text.slice(start, i).trim();
      if (prelude.includes(':hover') && !prelude.startsWith('@') && !stack.some((p) => HOVER_MEDIA.test(p))) {
        bad.push(prelude);
      }
      stack.push(prelude);
      start = i + 1;
    } else if (c === '}') {
      stack.pop();
      start = i + 1;
    } else if (c === ';' ) {
      start = i + 1;
    }
  }
  return bad;
}

/**
 * `:hover` in JS (the editor library injects its CSS from strings): each one
 * must follow an `@media (hover: hover) {` with no block closed in between —
 * the shape the build's rewrite produces (one rule per guard block).
 */
export function unguardedHoverInJs(js) {
  const bad = [];
  for (const m of js.matchAll(/:hover/g)) {
    const i = m.index;
    const before = js.slice(Math.max(0, i - 2000), i);
    const at = Math.max(before.lastIndexOf('(hover: hover)'), before.lastIndexOf('(hover:hover)'));
    const between = at < 0 ? null : before.slice(at);
    if (between === null || between.includes('}')) bad.push(js.slice(Math.max(0, i - 60), i + 20));
  }
  return bad;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function kb(n) {
  return `${(n / 1024).toFixed(1)} kB`;
}

export function checkBundle(dist, repoLicense, profile = BUNDLES.golf) {
  const errors = [];
  const fail = (msg) => errors.push(msg);
  if (!existsSync(dist)) return { errors: [`${dist} does not exist — run ${profile.build}`], files: [] };
  const files = walk(dist).sort();
  const rel = (p) => relative(dist, p);
  const read = (p) => readFileSync(p, 'utf8');

  // index.html at the top level, relative references only, classic scripts.
  const indexPath = join(dist, 'index.html');
  if (!existsSync(indexPath)) fail('index.html missing at the top level');
  else {
    const html = read(indexPath);
    for (const v of nonRelativeRefs(html)) fail(`index.html: non-relative reference ${v}`);
    if (/type\s*=\s*["']module["']/.test(html)) fail('index.html: module script (must be classic)');
    if (!/<script[^>]+src=["']\.\/assets\/[^"']+\.js["']/.test(html)) fail('index.html: no ./assets/*.js script');
    if (!/<link[^>]+href=["']\.\/assets\/[^"']+\.css["']/.test(html)) fail('index.html: no ./assets/*.css stylesheet');
  }

  for (const p of files) {
    const name = rel(p);
    if (/\.(html|css|js)$/.test(name)) {
      const text = read(p);
      for (const ref of absoluteAssetRefs(text)) fail(`${name}: absolute asset URL (${ref.trim()}…)`);
    }
    if (name.endsWith('.css')) {
      for (const sel of unguardedHoverInCss(read(p))) fail(`${name}: :hover outside @media (hover: hover): ${sel}`);
    }
    if (name.endsWith('.js')) {
      const js = read(p);
      for (const u of new Set(urlsIn(js))) {
        if (!profile.urlAllowlist.has(u)) fail(`${name}: URL not on the allowlist: ${u}`);
      }
      for (const [label, re] of FORBIDDEN_JS) if (re.test(js)) fail(`${name}: forbidden API ${label}`);
      for (const [what, marker] of profile.excludedMarkers) {
        if (js.includes(marker)) fail(`${name}: excluded module present — ${what} ("${marker}")`);
      }
      for (const snip of unguardedHoverInJs(js)) fail(`${name}: injected :hover outside @media (hover: hover): …${snip}…`);
    }
  }
  if (!files.some((p) => p.endsWith('.js'))) fail('no JavaScript in the bundle');

  // Licences.
  const license = join(dist, 'LICENSE');
  if (!existsSync(license)) fail('LICENSE missing');
  else if (repoLicense && read(license) !== readFileSync(repoLicense, 'utf8')) fail('LICENSE differs from the repo LICENSE');
  const notices = join(dist, 'THIRD_PARTY_NOTICES.txt');
  if (!existsSync(notices)) fail('THIRD_PARTY_NOTICES.txt missing');
  else {
    const text = read(notices);
    for (const pkg of profile.requiredNotices) {
      if (!new RegExp(`^  - ${pkg.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')} \\d`, 'm').test(text)) {
        fail(`THIRD_PARTY_NOTICES.txt does not list ${pkg}`);
      }
    }
    if (!text.includes('SIL OPEN FONT LICENSE')) fail('THIRD_PARTY_NOTICES.txt lacks the OFL text');
  }
  return { errors, files };
}

/** `--bundle <name>` (or `--bundle=<name>`) and an optional dist path. */
export function parseArgs(argv) {
  let bundle = null;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--bundle') bundle = argv[++i] ?? null;
    else if (a.startsWith('--bundle=')) bundle = a.slice('--bundle='.length);
    else rest.push(a);
  }
  return { bundle, dist: rest[0] ?? null };
}

export function main(argv = process.argv.slice(2)) {
  const { bundle, dist: distArg } = parseArgs(argv);
  const profile = bundle && Object.hasOwn(BUNDLES, bundle) ? BUNDLES[bundle] : undefined;
  if (!profile) {
    console.error(`usage: node scripts/check-bundle.mjs --bundle ${Object.keys(BUNDLES).join('|')} [dist]`);
    process.exit(2);
  }
  const here = fileURLToPath(new URL('.', import.meta.url));
  const dist = resolve(distArg ?? join(here, '..', profile.dist));
  const repoLicense = resolve(here, '..', '..', 'LICENSE');
  const { errors, files } = checkBundle(dist, repoLicense, profile);

  // Size report.
  let raw = 0;
  let gz = 0;
  console.log(`${bundle} bundle (${profile.title}): ${dist}`);
  for (const p of files) {
    const buf = readFileSync(p);
    const z = gzipSync(buf, { level: 9 }).length;
    raw += buf.length;
    gz += z;
    console.log(`  ${relative(dist, p).padEnd(56)} ${kb(buf.length).padStart(10)}  gz ${kb(z).padStart(9)}`);
  }
  console.log(`  ${'total'.padEnd(56)} ${kb(raw).padStart(10)}  gz ${kb(gz).padStart(9)}`);

  if (errors.length > 0) {
    console.error(`\ncheck-bundle (${bundle}): ${errors.length} problem(s):`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log(`\ncheck-bundle (${bundle}): OK`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
