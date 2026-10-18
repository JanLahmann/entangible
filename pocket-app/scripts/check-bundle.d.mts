// Types for check-bundle.mjs (imported by tests/checkBundle.test.ts).
export interface BundleProfile {
  title: string;
  dist: string;
  build: string;
  urlAllowlist: Map<string, string>;
  excludedMarkers: Array<[string, string]>;
  requiredNotices: string[];
}
export const BUNDLES: Record<'golf' | 'runner', BundleProfile>;
export const FORBIDDEN_JS: Array<[string, RegExp]>;
export const HOST_BRIDGE: RegExp;
export function withoutHostBridge(js: string): string;
export function urlsIn(text: string): string[];
export function absoluteAssetRefs(text: string): string[];
export function nonRelativeRefs(html: string): string[];
export function unguardedHoverInCss(css: string): string[];
export function unguardedHoverInJs(js: string): string[];
export function checkBundle(
  dist: string,
  repoLicense?: string,
  profile?: BundleProfile,
): { errors: string[]; files: string[] };
export function parseArgs(argv: string[]): { bundle: string | null; dist: string | null };
export function main(argv?: string[]): void;
