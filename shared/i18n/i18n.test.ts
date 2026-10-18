/**
 * The UI languages — English (source of truth) and German.
 *
 * TOTALITY over the messages: the two trees are walked in full, so a key added
 * to `en.ts` and forgotten in `de.ts` (or an array that lost an entry, or a
 * message whose arguments changed in one language only) fails here even where
 * TypeScript's structural check is lenient (Record-typed maps). And no German
 * string may be left identical to its English one — a forgotten translation —
 * except a short, explicit allowlist of brand names, gate symbols and words
 * German shares with English.
 *
 * `resolveLang` is the whole "which language does this page open in" decision,
 * so its precedence (URL › stored choice › browser › English) is pinned here.
 */
import { describe, it, expect } from 'vitest';
import { en } from './en';
import { de } from './de';
import { LANGS, MESSAGES, parseLang, resolveLang } from './index';

type Node = unknown;

/** Every leaf of a messages tree: [dotted path, value]. Arrays index like keys. */
function leaves(node: Node, path = ''): Array<[string, Node]> {
  if (typeof node === 'string' || typeof node === 'function') return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (node !== null && typeof node === 'object') {
    return Object.keys(node)
      .sort()
      .flatMap((k) => leaves((node as Record<string, Node>)[k], path ? `${path}.${k}` : k));
  }
  return [[path, node]];
}

/**
 * Leaves of German that may equal English: brands and product names, gate
 * symbols, and words both languages spell the same. Keep it short — each entry
 * is a claim "this is not a forgotten translation".
 */
const SAME_IN_BOTH = new Set<string>([
  // Brand / product names (never translated).
  'app.modeRunner', // Quantum Runner
  'settings.modes.composer', // Composer (the IBM tool's name)
  'settings.modes.quantina',
  'settings.modes.runner',
  // Words German shares with English.
  'kiosk.live', // "live"
  'kiosk.offline', // "offline"
  'histogram.ideal', // "ideal"
  'kiosk.noisyIdeal', // "ideal"
  'runner.level', // "Level"
  'golf.score.eagle', // EAGLE / BIRDIE / PAR — the golf words German uses too
  'golf.score.birdie',
  'golf.score.par',
  'guide.testBoards.04-ghz3.title', // GHZ-3 — a state's name
  'guide.testBoards.05-ghz5.title', // GHZ-5
  // Gate-only / number-only messages (same output for the probe arguments).
  'runner.meters', // "X m"
  'golf.completion.inTime', // " in X"
]);

/** Call a function message with neutral probe arguments (one per parameter). */
function probe(fn: (...args: unknown[]) => unknown): unknown {
  try {
    return fn(...Array.from({ length: fn.length }, () => 'X'));
  } catch {
    return undefined;
  }
}

describe('messages — en and de have the same shape', () => {
  const enLeaves = new Map(leaves(en));
  const deLeaves = new Map(leaves(de));

  it('has exactly the same key tree (incl. array lengths and map keys)', () => {
    expect([...deLeaves.keys()]).toEqual([...enLeaves.keys()]);
  });

  it('gives every leaf the same kind, and every function message the same arity', () => {
    for (const [path, value] of enLeaves) {
      const other = deLeaves.get(path);
      expect(typeof other, path).toBe(typeof value);
      if (typeof value === 'function') {
        expect((other as (...a: unknown[]) => unknown).length, path).toBe(value.length);
      }
    }
  });

  it('has no empty message in either language', () => {
    for (const [lang, tree] of [['en', enLeaves], ['de', deLeaves]] as const) {
      for (const [path, value] of tree) {
        if (typeof value === 'string') expect(value.trim(), `${lang} ${path}`).not.toBe('');
      }
    }
  });

  it('leaves nothing in English by accident (outside the allowlist)', () => {
    const same: string[] = [];
    for (const [path, value] of enLeaves) {
      const other = deLeaves.get(path);
      const a = typeof value === 'function' ? probe(value as never) : value;
      const b = typeof other === 'function' ? probe(other as never) : other;
      if (a !== undefined && a === b && !SAME_IN_BOTH.has(path)) same.push(path);
    }
    expect(same).toEqual([]);
  });

  it('keeps the allowlist honest — every entry still exists and still matches', () => {
    for (const path of SAME_IN_BOTH) {
      expect(enLeaves.has(path), path).toBe(true);
      const a = enLeaves.get(path);
      const b = deLeaves.get(path);
      const pa = typeof a === 'function' ? probe(a as never) : a;
      const pb = typeof b === 'function' ? probe(b as never) : b;
      expect(pb, `${path} is translated now — drop it from the allowlist`).toBe(pa);
    }
  });

  it('lists every language once, each with its messages', () => {
    expect(LANGS).toEqual(['en', 'de']);
    expect(MESSAGES.en).toBe(en);
    expect(MESSAGES.de).toBe(de);
  });
});

describe('resolveLang — which language a page opens in', () => {
  const none = { search: '', stored: null, navigatorLanguages: [] as string[] };

  it('defaults to English (and jsdom/en-US browsers stay English)', () => {
    expect(resolveLang(none)).toBe('en');
    expect(resolveLang({ ...none, navigatorLanguages: ['en-US', 'en'] })).toBe('en');
  });

  it('follows a German browser, any region', () => {
    for (const l of ['de', 'de-DE', 'de-AT', 'de-CH', 'DE-ch']) {
      expect(resolveLang({ ...none, navigatorLanguages: [l, 'en'] }), l).toBe('de');
    }
  });

  it('reads only the FIRST browser preference', () => {
    expect(resolveLang({ ...none, navigatorLanguages: ['fr-FR', 'de-DE'] })).toBe('en');
    expect(resolveLang({ ...none, navigatorLanguages: ['', 'de-AT'] })).toBe('de');
  });

  it('lets a stored choice beat the browser', () => {
    expect(resolveLang({ ...none, stored: 'en', navigatorLanguages: ['de-DE'] })).toBe('en');
    expect(resolveLang({ ...none, stored: 'de', navigatorLanguages: ['en-US'] })).toBe('de');
  });

  it('lets ?lang= beat everything, with or without the leading ?', () => {
    expect(resolveLang({ search: '?lang=de', stored: 'en', navigatorLanguages: ['en-US'] })).toBe(
      'de',
    );
    expect(resolveLang({ search: 'lang=en', stored: 'de', navigatorLanguages: ['de-DE'] })).toBe(
      'en',
    );
    expect(resolveLang({ ...none, search: '?kiosk&lang=de' })).toBe('de');
    expect(resolveLang({ ...none, search: '?lang=DE' })).toBe('de');
  });

  it('ignores junk at every level and falls through to the next', () => {
    expect(resolveLang({ search: '?lang=fr', stored: 'de', navigatorLanguages: [] })).toBe('de');
    expect(resolveLang({ search: '?lang=', stored: 'xx', navigatorLanguages: ['de-CH'] })).toBe(
      'de',
    );
    expect(resolveLang({ search: '?lang=deutsch', stored: '{}', navigatorLanguages: [] })).toBe(
      'en',
    );
    expect(parseLang(undefined)).toBeNull();
    expect(parseLang(' de ')).toBe('de');
    expect(parseLang('english')).toBeNull();
  });
});
