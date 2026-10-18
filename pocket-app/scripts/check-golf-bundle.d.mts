// Types for check-golf-bundle.mjs (imported by src/golf/checkGolfBundle.test.ts).
export const URL_ALLOWLIST: Map<string, string>;
export const FORBIDDEN_JS: Array<[string, RegExp]>;
export const EXCLUDED_MARKERS: Array<[string, string]>;
export const REQUIRED_NOTICES: string[];
export function urlsIn(text: string): string[];
export function absoluteAssetRefs(text: string): string[];
export function nonRelativeRefs(html: string): string[];
export function unguardedHoverInCss(css: string): string[];
export function unguardedHoverInJs(js: string): string[];
export function checkBundle(
  dist: string,
  repoLicense?: string,
): { errors: string[]; files: string[] };
