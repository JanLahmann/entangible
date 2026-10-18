// Types for booth-qr.mjs (imported by tests/boothQr.test.ts).
export interface BoothQrArgs {
  event?: string;
  target?: string;
  lang?: string;
  size?: string;
  out?: string;
  help?: boolean;
}
export const SITE: string;
export const TARGETS: Record<'home' | 'golf' | 'runner', [string, Array<[string, string]>]>;
export const LANGS: string[];
export const SIZES: Record<'a6' | 'a5', [number, number]>;
export function slugError(slug: unknown): string | null;
export function targetError(target: unknown): string | null;
export function buildBoothUrl(args?: BoothQrArgs): string;
export function outputName(args: BoothQrArgs): string;
export function cardHtml(args: { url: string; svg: string; target?: string; lang?: string; size?: string }): string;
export function parseArgs(argv: string[]): BoothQrArgs & { target: string; size: string };
export function main(argv?: string[]): Promise<void>;
