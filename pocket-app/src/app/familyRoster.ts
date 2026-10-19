/**
 * The Fun with Quantum siblings Entangible links to, from the family manifest
 * (src/data/fwq-family.json, refreshed by an automated PR and by the CI
 * `prebuild` fetch — never edited by hand). One filter for both renderings of
 * the family links: the Guide's family section (GuidePage.tsx) and the static,
 * crawlable block in index.html (vite-plugins/staticContent.ts). Members hidden
 * from footers (`footer: false`) and Entangible itself are left out; the family
 * home is linked separately (FAMILY_URL).
 */
import fwqFamily from '../data/fwq-family.json';
import { eventName } from './analytics';

export interface FamilyMember {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly short?: string;
  readonly footer: boolean;
}

export const FAMILY: readonly FamilyMember[] = (fwqFamily.members as FamilyMember[]).filter(
  (m) => m.footer && m.id !== 'entangible' && m.id !== fwqFamily.brand.id,
);

/** Umami v2 name for a family-link click (`Entangible: family footer click`, label from the manifest). */
export const FAMILY_FOOTER_EVENT = eventName('family footer click');
