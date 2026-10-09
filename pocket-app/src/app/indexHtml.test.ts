/**
 * index.html head regressions: pinch-zoom stays enabled (accessibility), and a
 * shared entangible.org link carries a real preview card.
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
