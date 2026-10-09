/**
 * UI language — English (default) and German. No i18n library: the messages
 * are typed objects (`en.ts` is the source of truth, `de.ts` must match its
 * type), and React reads the active one through a context.
 *
 * Which language a page opens in (`resolveLang`, pure):
 *   1. `?lang=de|en` in the URL — so a booth link (`?kiosk&lang=de`) or a
 *      printed QR can name it. It means nothing else: it bypasses no welcome
 *      card and switches no mode.
 *   2. the visitor's own earlier choice (localStorage `entangible.lang`, set by
 *      the drawer's Language control);
 *   3. the browser: the first preferred language starting with `de` (de-DE,
 *      de-AT, de-CH, …) → German;
 *   4. otherwise English.
 *
 * Non-React shared modules (goal line, warnings, hints, celebrations copy) do
 * not read the context: they take the messages object as a parameter — default
 * English — so they stay pure and their tests unchanged.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { en, type Messages } from './en';
import { de } from './de';

export type { Messages } from './en';
export { en } from './en';
export { de } from './de';

export type Lang = 'en' | 'de';

/** Every supported language, in picker order. */
export const LANGS: readonly Lang[] = ['en', 'de'];

/** Each language named in itself — the drawer's pills. Never translated. */
export const LANG_NAMES: Readonly<Record<Lang, string>> = { en: 'English', de: 'Deutsch' };

/** The drawer's control label — bilingual on purpose, so it is findable in both. */
export const LANGUAGE_LABEL = 'Language / Sprache';

/** localStorage key of the visitor's explicit choice. */
export const LANG_STORAGE_KEY = 'entangible.lang';

/** The messages object for a language. */
export const MESSAGES: Readonly<Record<Lang, Messages>> = { en, de };

/** A string as a language, or null if it is not one we speak (case-insensitive). */
export function parseLang(value: string | null | undefined): Lang | null {
  const v = (value ?? '').trim().toLowerCase();
  return v === 'en' || v === 'de' ? v : null;
}

export interface LangInputs {
  /** `window.location.search` (with or without the leading `?`). */
  readonly search: string;
  /** The stored choice (raw localStorage value), or null. */
  readonly stored: string | null;
  /** `navigator.languages` (or `[navigator.language]`). */
  readonly navigatorLanguages: readonly string[];
}

/** The language to open in: URL, then stored choice, then browser, then English. */
export function resolveLang({ search, stored, navigatorLanguages }: LangInputs): Lang {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const fromUrl = parseLang(params.get('lang'));
  if (fromUrl) return fromUrl;
  const fromStore = parseLang(stored);
  if (fromStore) return fromStore;
  const first = navigatorLanguages.find((l) => typeof l === 'string' && l.trim() !== '');
  return first && first.trim().toLowerCase().startsWith('de') ? 'de' : 'en';
}

/** The stored choice, or null — storage can be absent or throw (private mode). */
export function loadStoredLang(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Remember an explicit choice; best-effort. */
export function saveStoredLang(lang: Lang): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* storage unavailable: the choice holds for this page only */
  }
}

/** The language this page opens in, read from the live browser. */
export function initialLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const languages = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : [];
  return resolveLang({
    search: window.location.search,
    stored: loadStoredLang(),
    navigatorLanguages: languages,
  });
}

/**
 * Drop a `?lang=` from the address bar. Called when the visitor picks a
 * language in the drawer: their choice is stored, and a URL still naming the
 * old one would win again on the next reload.
 */
function clearUrlLang(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('lang')) return;
    url.searchParams.delete('lang');
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    /* best-effort */
  }
}

interface LangContextValue {
  readonly lang: Lang;
  readonly t: Messages;
  readonly setLang: (lang: Lang) => void;
}

// Without a provider (unit tests that render a component on its own) the app
// is English and the setter does nothing.
const LangContext = createContext<LangContextValue>({ lang: 'en', t: en, setLang: () => {} });

/**
 * Holds the active language for everything under it, mirrors it onto
 * `<html lang>`, and persists an explicit choice. `lang` fixes the starting
 * language (tests); omitted, it is resolved from the browser (`initialLang`).
 */
export function LangProvider({ lang: initial, children }: { lang?: Lang; children?: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? initialLang());

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    saveStoredLang(next);
    if (typeof window !== 'undefined') clearUrlLang();
    setLangState(next);
  }, []);

  const value = useMemo(() => ({ lang, t: MESSAGES[lang], setLang }), [lang, setLang]);
  return createElement(LangContext.Provider, { value }, children);
}

/** The active messages object. */
export function useT(): Messages {
  return useContext(LangContext).t;
}

/** The active language and its setter. */
export function useLang(): { lang: Lang; setLang: (lang: Lang) => void } {
  const { lang, setLang } = useContext(LangContext);
  return { lang, setLang };
}
