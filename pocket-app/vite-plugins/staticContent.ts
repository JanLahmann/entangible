/**
 * Site build only (vite.config.ts): fills the family links into the static,
 * crawlable block of index.html (`.boot-seo`, inside #root) at build and dev
 * time, from the same roster the Guide renders (src/app/familyRoster.ts). The
 * manifest can change at build time (the CI `prebuild` fetch), so the links are
 * generated rather than written into index.html, and can never drift from the
 * Guide's. The golf / runner bundles never load this plugin.
 */
import type { Plugin } from 'vite';
import { FAMILY, FAMILY_FOOTER_EVENT, type FamilyMember } from '../src/app/familyRoster';

/** Where index.html wants the family links. */
export const FAMILY_MARKER = '<!--fwq-family-links-->';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The family links as HTML: the Guide's anchors (same attributes), joined by ` · `. */
export function familyLinksHtml(members: readonly FamilyMember[] = FAMILY): string {
  return members
    .map((m) => {
      const title = m.short ? ` title="${esc(m.short)}"` : '';
      return (
        `<a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer"${title}` +
        ` data-umami-event="${esc(FAMILY_FOOTER_EVENT)}" data-umami-event-to="${esc(m.id)}">${esc(m.name)}</a>`
      );
    })
    .join(' · ');
}

/** index.html with the family links in place; throws if the marker went missing. */
export function injectStaticContent(html: string): string {
  if (!html.includes(FAMILY_MARKER)) throw new Error(`index.html lost its ${FAMILY_MARKER} marker`);
  return html.replace(FAMILY_MARKER, familyLinksHtml());
}

export function staticContent(): Plugin {
  return {
    name: 'entangible-static-content',
    transformIndexHtml: { order: 'pre', handler: injectStaticContent },
  };
}
