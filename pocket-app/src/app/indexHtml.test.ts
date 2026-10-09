/**
 * index.html regressions: pinch-zoom stays enabled (accessibility), a shared
 * entangible.org link carries a real preview card, and the page paints a boot
 * splash before any script arrives.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');

function meta(attr: 'name' | 'property', key: string): string | null {
  const m = new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`).exec(html.replace(/\s+/g, ' '));
  return m ? m[1] : null;
}

describe('index.html', () => {
  it('does not block pinch-zoom', () => {
    const viewport = meta('name', 'viewport');
    expect(viewport).toContain('width=device-width');
    expect(viewport).toContain('initial-scale=1');
    expect(viewport).not.toMatch(/maximum-scale|user-scalable/);
  });

  it('has a description and Open Graph / Twitter preview tags', () => {
    expect(meta('name', 'description')).toBeTruthy();
    expect(meta('property', 'og:title')).toBe('Entangible — build quantum circuits with your hands');
    expect(meta('property', 'og:description')).toBeTruthy();
    expect(meta('property', 'og:type')).toBe('website');
    expect(meta('property', 'og:url')).toBe('https://entangible.org/');
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
  });

  it('points og:image at a file that actually ships (public/ → site root)', () => {
    const image = meta('property', 'og:image');
    expect(image).toMatch(/^https:\/\/entangible\.org\//);
    const rel = image!.replace('https://entangible.org/', '');
    expect(existsSync(fileURLToPath(new URL(`../../public/${rel}`, import.meta.url)))).toBe(true);
  });
});

describe('index.html boot splash (no blank first paint)', () => {
  const root = /<div id="root">([\s\S]*?)<\/div>\s*<script/.exec(html)?.[1] ?? '';

  it('puts a static splash inside #root, for React to replace on mount', () => {
    expect(root).toContain('class="boot-splash"');
    expect(root).toContain('role="status"');
    expect(root.replace(/<[^>]+>/g, '')).toContain('Entangible');
    expect(root).toContain('Build quantum circuits with your hands');
  });

  it('styles the splash inline, in the token colours, with no external request', () => {
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    expect(style).toContain('.boot-splash');
    expect(style).toContain('#0f1117'); // --bg (also theme-color)
    expect(style).toContain('#7a5cff'); // --entangle, the "En" of the brand
    expect(style).not.toMatch(/url\(|@import/);
  });
});
