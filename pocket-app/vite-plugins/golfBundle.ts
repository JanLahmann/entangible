/**
 * Build plugins of the golf-only bundle (vite.golf.config.ts,
 * docs/golf-bundle.md). Kept out of the site build entirely.
 *
 *   - `hoverOnlyWhereHover` (PostCSS): every `:hover` rule moves under
 *     `@media (hover: hover)`, so a tap on a phone never leaves a button stuck
 *     in its hover look. Applied to every stylesheet of the bundle.
 *   - `guardLibraryHover` (Vite): @qamposer/react injects its stylesheets at
 *     runtime from template strings (`const css = `…`; document.head…`); the
 *     same rewrite is applied to those strings at build time.
 *   - `golfBundleOutput` (Vite): golf.html is emitted as `index.html` with
 *     classic `<script defer>` / plain `<link>` tags (no `type="module"` /
 *     `crossorigin`), so the page also runs from file:// and from the iOS app's
 *     custom scheme; and emits `LICENSE` (the repo's Apache-2.0) plus
 *     `THIRD_PARTY_NOTICES.txt`, generated from the modules actually bundled.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { preprocessCSS, type CSSOptions, type Plugin, type ResolvedConfig } from 'vite';

/** A PostCSS plugin as Vite's `css.postcss.plugins` takes it (no postcss import). */
type PostcssPlugin = NonNullable<Exclude<NonNullable<CSSOptions['postcss']>, string>['plugins']>[number];

/* ------------------------------------------------------------------ hover */

/** The minimal PostCSS node surface this plugin touches (no postcss import). */
interface CssNode {
  type: string;
  name?: string;
  params?: string;
  selector: string;
  selectors: string[];
  parent?: CssNode;
  clone(overrides: Record<string, unknown>): CssNode;
  after(node: CssNode): void;
  append(node: CssNode): void;
  remove(): void;
}
interface CssRoot {
  walkRules(cb: (rule: CssNode) => void): void;
}
type AtRuleCtor = new (props: { name: string; params: string }) => CssNode;

const HOVER_MEDIA = /\(\s*hover\s*:\s*hover\s*\)/;

function underHoverMedia(node: CssNode): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'atrule' && p.name === 'media' && HOVER_MEDIA.test(p.params ?? '')) return true;
  }
  return false;
}

/** PostCSS plugin: wrap every unguarded `:hover` selector in `@media (hover: hover)`. */
export function hoverOnlyWhereHover(): PostcssPlugin {
  const plugin = {
    postcssPlugin: 'hover-only-where-hover',
    Once(root: CssRoot, { AtRule }: { AtRule: AtRuleCtor }) {
      root.walkRules((rule) => {
        if (!rule.selector.includes(':hover') || underHoverMedia(rule)) return;
        if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name ?? '')) return;
        const hover = rule.selectors.filter((s) => s.includes(':hover'));
        const rest = rule.selectors.filter((s) => !s.includes(':hover'));
        const media = new AtRule({ name: 'media', params: '(hover: hover)' });
        media.append(rule.clone({ selectors: hover }));
        rule.after(media);
        if (rest.length > 0) rule.selectors = rest;
        else rule.remove();
      });
    },
  };
  return plugin as unknown as PostcssPlugin;
}
hoverOnlyWhereHover.postcss = true;

/** Runtime-injected library CSS: `const cssN = `…`;\ndocument.head.appendChild(…)`. */
const INJECTED_CSS = /((?:const|let|var) css\d* = `)([^`]*)(`;\s*document\.head\.appendChild)/g;

export function guardLibraryHover(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'golf:guard-library-hover',
    enforce: 'pre',
    configResolved(resolved) {
      config = resolved;
    },
    async transform(code, id) {
      if (!/[\\/]node_modules[\\/]@qamposer[\\/]react[\\/]dist[\\/].*\.js$/.test(id)) return null;
      const blocks = [...code.matchAll(INJECTED_CSS)];
      if (blocks.length === 0) return null;
      let out = '';
      let at = 0;
      for (const m of blocks) {
        const start = m.index ?? 0;
        // Same PostCSS pipeline as the bundle's own stylesheets (the config's
        // `css.postcss.plugins`, i.e. hoverOnlyWhereHover).
        const css = (await preprocessCSS(m[2], `${id}.injected.css`, config)).code;
        if (css.includes('`') || css.includes('${')) {
          this.error(`rewritten @qamposer/react CSS is not template-literal safe (${id})`);
        }
        out += code.slice(at, start) + m[1] + css + m[3];
        at = start + m[0].length;
      }
      return { code: out + code.slice(at), map: null };
    },
  };
}

/* ------------------------------------------------------- licence notices */

export interface PackageInfo {
  name: string;
  version: string;
  license: string;
  homepage: string;
  licenseFile: string | null;
  licenseText: string;
}

/** The package directory a module id lives in (innermost node_modules). */
export function packageDirOf(id: string): string | null {
  const clean = id.replace(/^\0/, '').split('?')[0];
  const marker = `${sep}node_modules${sep}`;
  const at = clean.lastIndexOf(marker);
  if (at < 0) return null;
  const rest = clean.slice(at + marker.length).split(sep);
  const depth = rest[0].startsWith('@') ? 2 : 1;
  if (rest.length <= depth) return null;
  return clean.slice(0, at + marker.length) + rest.slice(0, depth).join(sep);
}

const LICENSE_FILE = /^(licen[cs]e|copying|ofl)(\.(md|txt))?$/i;

function readPackage(dir: string): PackageInfo {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
  const license =
    typeof pkg.license === 'string'
      ? pkg.license
      : typeof (pkg.license as { type?: string } | undefined)?.type === 'string'
        ? (pkg.license as { type: string }).type
        : 'UNKNOWN';
  const repo = pkg.repository as string | { url?: string } | undefined;
  const homepage =
    (typeof pkg.homepage === 'string' && pkg.homepage) ||
    (typeof repo === 'string' ? repo : (repo?.url ?? '')) ||
    '';
  const file = readdirSync(dir).find((f) => LICENSE_FILE.test(f)) ?? null;
  return {
    name: String(pkg.name),
    version: String(pkg.version),
    license,
    homepage,
    licenseFile: file,
    licenseText: file ? readFileSync(join(dir, file), 'utf8').trim() : '',
  };
}

/** `THIRD_PARTY_NOTICES.txt` for these packages (sorted, deduplicated). */
export function renderNotices(packages: readonly PackageInfo[], product: string): string {
  const rule = '='.repeat(78);
  const head = [
    `${product} — third-party notices`,
    '',
    'This bundle includes the following third-party packages. The list is',
    'generated at build time from the modules actually bundled (JavaScript and',
    'CSS, including the bundled font files of the @fontsource packages).',
    '',
    ...packages.map((p) => `  - ${p.name} ${p.version} — ${p.license}`),
    '',
  ];
  const bodies = packages.map((p) =>
    [
      rule,
      `${p.name} ${p.version}`,
      `License: ${p.license}`,
      ...(p.homepage ? [`Source: ${p.homepage}`] : []),
      rule,
      '',
      p.licenseText || `(no license file shipped in the package; license field: ${p.license})`,
      '',
    ].join('\n'),
  );
  return `${head.join('\n')}\n${bodies.join('\n')}`;
}

export function golfBundleOutput(options: {
  /** Entry html file name as Rollup emits it (golf.html). */
  readonly entryHtml: string;
  /** The repo LICENSE to copy verbatim into the bundle. */
  readonly licensePath: string;
  readonly product: string;
}): Plugin {
  return {
    name: 'golf:bundle-output',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Classic scripts: an IIFE bundle needs no module loader, and
        // file:// / custom-scheme pages then load without CORS.
        return html
          .replace(/<script type="module" crossorigin src=/g, '<script defer src=')
          .replace(/<script type="module" src=/g, '<script defer src=')
          .replace(/ crossorigin(?=[\s>])/g, '');
      },
    },
    generateBundle(_out, bundle) {
      // golf.html → index.html (same directory level, so relative URLs hold).
      const html = bundle[options.entryHtml];
      if (!html) this.error(`missing ${options.entryHtml} in the bundle`);
      delete bundle[options.entryHtml];
      html.fileName = 'index.html';
      bundle['index.html'] = html;

      // Every package with code or CSS in the output.
      const dirs = new Set<string>();
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue;
        for (const [id, mod] of Object.entries(file.modules)) {
          const isCss = /\.css(\?|$)/.test(id);
          if (mod.renderedLength === 0 && !isCss) continue;
          const dir = packageDirOf(id);
          if (dir) dirs.add(dir);
        }
      }
      // CSS-only modules (fonts) are extracted before chunks render; take them
      // from the module graph as well.
      for (const id of this.getModuleIds()) {
        if (!/\.css(\?|$)/.test(id)) continue;
        const dir = packageDirOf(id);
        if (dir && this.getModuleInfo(id)?.importers.length) dirs.add(dir);
      }
      const packages = [...dirs]
        .filter((d) => existsSync(join(d, 'package.json')))
        .map(readPackage)
        .filter((p, i, all) => all.findIndex((q) => q.name === p.name && q.version === p.version) === i)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (packages.length === 0) this.error('no third-party packages found — notices would be empty');
      const missing = packages.filter((p) => !p.licenseText).map((p) => p.name);
      if (missing.length > 0) this.warn(`no license file in: ${missing.join(', ')}`);

      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_NOTICES.txt',
        source: renderNotices(packages, options.product),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'LICENSE',
        source: readFileSync(options.licensePath, 'utf8'),
      });
    },
  };
}
