/**
 * The Guide's prose, one implementation per language (`./en.tsx`, `./de.tsx`).
 *
 * The Guide is long, linked, formatted prose — paragraphs with bold words,
 * in-copy links to other sections and downloads — so it does not fit the flat
 * string messages in shared/i18n. Each language instead provides the same set
 * of section components behind this interface, and TypeScript makes sure no
 * language misses one. The chrome around them (nav chips, back pill, viewer,
 * aria labels, test-board titles) stays in the messages (`t.guide`).
 *
 * TRANSLATORS: change a section in `en.tsx` first, then mirror it in `de.tsx`.
 */
import type { MouseEvent, ReactNode } from 'react';
import type { GuideSectionId } from '../GuidePage';

/** An in-copy pointer to another guide section: a real link that navigates in place. */
export type SectionLink = (id: GuideSectionId) => {
  href: string;
  onClick: (e: MouseEvent) => void;
};

export interface GuideProseProps {
  /** Spread onto an `<a>` that points at another section. */
  readonly sectionLink: SectionLink;
}

export interface GuideBoothProps extends GuideProseProps {
  /** The on-screen test-board grid (interactive; owned by GuidePage). */
  readonly testBoards: ReactNode;
  /** The Fun-with-Quantum sibling links, already separated (from the manifest). */
  readonly family: ReactNode;
}

/** Every section of the Guide, in one language. */
export interface GuideProse {
  readonly start: (props: GuideProseProps) => ReactNode;
  readonly print: (props: GuideProseProps) => ReactNode;
  readonly play: (props: GuideProseProps) => ReactNode;
  readonly build: (props: GuideProseProps) => ReactNode;
  readonly booth: (props: GuideBoothProps) => ReactNode;
  /** Licence + trademark lines, shown under every section. */
  readonly footer: () => ReactNode;
}
