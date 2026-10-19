#!/usr/bin/env node
/**
 * Booth QR / UTM generator: one trackable QR code per outreach event.
 *
 *   node scripts/booth-qr.mjs --event <slug> [--target home|golf|runner|/<path>]
 *                             [--lang en|de] [--size a6|a5] [--out dir]
 *
 * Builds `https://entangible.org/<target>?utm_source=booth&utm_medium=qr&utm_campaign=<slug>`
 * (plus `lang=<lang>` when given) and writes, for that URL:
 *   - `<name>.svg`  — the QR code (error correction M, 4-module quiet zone);
 *   - `<name>.html` — a printable A6 (or A5) card: QR, a short call to action,
 *                     the URL in small type.
 * The URL goes to stdout (one line, pipeable); where the files went goes to stderr.
 * Default output dir: `<repo>/out/booth-qr` (git-ignored by the root `out/` rule).
 *
 * Targets use the site's real deep links (src/app/settings.ts `parseUrlOverrides`):
 *   home   → `/`                           (the welcome card)
 *   golf   → `/?mode=golf&input=manual`     (golf built on screen — the welcome
 *                                            card's own golf entry, GOLF_ON_SCREEN)
 *   runner → `/?mode=runner`
 *   /<path> → that path on entangible.org, no query or fragment of its own.
 *
 * The pure helpers are exported for tests/boothQr.test.ts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import QRCode from 'qrcode';

export const SITE = 'https://entangible.org';

/** Named targets → [path, deep-link params]. Only links the site actually parses. */
export const TARGETS = {
  home: ['/', []],
  golf: ['/', [['mode', 'golf'], ['input', 'manual']]],
  runner: ['/', [['mode', 'runner']]],
};

export const LANGS = ['en', 'de'];
export const SIZES = { a6: [105, 148], a5: [148, 210] };

const SLUG_RE = /^[a-z0-9-]{1,40}$/;
/** A custom target: an absolute path of plain segments (no `..`, `//`, query or fragment). */
const PATH_RE = /^\/(?:[A-Za-z0-9._~-]+\/?)*$/;

/** null when `slug` is a valid event slug, else the reason it is not. */
export function slugError(slug) {
  if (typeof slug !== 'string' || slug === '') return 'missing --event <slug>';
  if (slug.length > 40) return `slug is ${slug.length} characters; at most 40`;
  if (!SLUG_RE.test(slug)) return `slug "${slug}" may only contain a-z, 0-9 and "-"`;
  return null;
}

/** null when `target` is a named target or an acceptable path, else the reason. */
export function targetError(target) {
  if (Object.hasOwn(TARGETS, target)) return null;
  if (typeof target !== 'string' || !PATH_RE.test(target) || /(^|\/)\.\.?(\/|$)/.test(target))
    return `target "${target}" is not home|golf|runner or an absolute path like /foo`;
  return null;
}

/** The tracked URL for one event. Throws on an invalid slug, target or lang. */
export function buildBoothUrl({ event, target = 'home', lang } = {}) {
  const err = slugError(event) ?? targetError(target) ??
    (lang !== undefined && !LANGS.includes(lang) ? `lang "${lang}" is not en|de` : null);
  if (err) throw new Error(err);
  const [path, deep] = Object.hasOwn(TARGETS, target) ? TARGETS[target] : [target, []];
  const params = new URLSearchParams(deep);
  params.set('utm_source', 'booth');
  params.set('utm_medium', 'qr');
  params.set('utm_campaign', event);
  if (lang !== undefined) params.set('lang', lang);
  return `${SITE}${path}?${params.toString()}`;
}

/** Base name for the output files: `<slug>[-<target>][-<lang>]`. */
export function outputName({ event, target = 'home', lang }) {
  const t = Object.hasOwn(TARGETS, target)
    ? target === 'home' ? '' : target
    : target.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return [event, t, lang].filter(Boolean).join('-');
}

const COPY = {
  en: {
    home: ['Scan to explore', 'Build quantum circuits on your phone.'],
    golf: ['Scan to play Quantum Golf', '18 holes of quantum circuits, on your phone.'],
    runner: ['Scan to play Quantum Runner', 'A quantum circuit game on your phone.'],
    path: ['Scan to explore', 'Entangible on your phone.'],
  },
  de: {
    home: ['Scannen und loslegen', 'Quantenschaltungen auf dem Handy bauen.'],
    golf: ['Scannen und Quantum Golf spielen', '18 Löcher Quantenschaltungen, auf dem Handy.'],
    runner: ['Scannen und Quantum Runner spielen', 'Ein Quantenschaltungs-Spiel auf dem Handy.'],
    path: ['Scannen und loslegen', 'Entangible auf dem Handy.'],
  },
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The printable card: page size `size` (a6|a5), QR SVG inlined. */
export function cardHtml({ url, svg, target = 'home', lang, size = 'a6' }) {
  const [w, h] = SIZES[size];
  const l = lang ?? 'en';
  const key = Object.hasOwn(TARGETS, target) ? target : 'path';
  const [headline, sub] = COPY[l][key];
  const qrMm = Math.round(w * 0.62);
  return `<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entangible booth card</title>
<style>
  @page { size: ${w}mm ${h}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #161616; }
  body { font-family: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif; }
  .card { width: ${w}mm; height: ${h}mm; padding: ${Math.round(w * 0.08)}mm;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; gap: ${Math.round(h * 0.03)}mm; }
  .brand { font-size: ${size === 'a5' ? 22 : 16}pt; font-weight: 600; letter-spacing: 0.02em; }
  h1 { margin: 0; font-size: ${size === 'a5' ? 20 : 14}pt; font-weight: 600; }
  p { margin: 0; font-size: ${size === 'a5' ? 12 : 9}pt; }
  .qr { width: ${qrMm}mm; height: ${qrMm}mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .url { font-family: "IBM Plex Mono", Menlo, monospace; font-size: ${size === 'a5' ? 7 : 5.5}pt;
    color: #525252; word-break: break-all; }
  @media screen { body { background: #e0e0e0; padding: 16px; } .card { background: #fff; margin: 0 auto; } }
</style>
</head>
<body>
<div class="card">
  <div class="brand">Entangible</div>
  <h1>${esc(headline)}</h1>
  <div class="qr">${svg}</div>
  <p>${esc(sub)}</p>
  <div class="url">${esc(url)}</div>
</div>
</body>
</html>
`;
}

/** Parse argv (without node + script). Throws on unknown flags or missing values. */
export function parseArgs(argv) {
  const out = { target: 'home', size: 'a6' };
  const flags = { '--event': 'event', '--target': 'target', '--lang': 'lang', '--out': 'out', '--size': 'size' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { out.help = true; continue; }
    const key = flags[a];
    if (!key) throw new Error(`unknown argument "${a}"`);
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
    out[key] = v;
  }
  if (!Object.hasOwn(SIZES, out.size)) throw new Error(`size "${out.size}" is not a6|a5`);
  return out;
}

const USAGE =
  'usage: node scripts/booth-qr.mjs --event <slug> [--target home|golf|runner|/<path>] ' +
  '[--lang en|de] [--size a6|a5] [--out dir]';

export async function main(argv = process.argv.slice(2)) {
  let args;
  let url;
  try {
    args = parseArgs(argv);
    if (args.help) { console.log(USAGE); return; }
    url = buildBoothUrl(args);
  } catch (e) {
    console.error(`booth-qr: ${e.message}\n${USAGE}`);
    process.exit(2);
  }
  const here = fileURLToPath(new URL('.', import.meta.url));
  const dir = resolve(args.out ?? join(here, '..', '..', 'out', 'booth-qr'));
  const name = outputName(args);
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 4 });
  mkdirSync(dir, { recursive: true });
  const svgPath = join(dir, `${name}.svg`);
  const htmlPath = join(dir, `${name}.html`);
  writeFileSync(svgPath, svg);
  writeFileSync(htmlPath, cardHtml({ url, svg, target: args.target, lang: args.lang, size: args.size }));
  console.log(url);
  console.error(`wrote ${svgPath}\nwrote ${htmlPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
