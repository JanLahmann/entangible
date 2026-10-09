/** Small building blocks the Guide's prose files share, so every language looks alike. */
import type { ReactNode } from 'react';

/** A section heading inside the Guide. */
export function Label({ children }: { children: ReactNode }) {
  return <div className="pk-label pk-guide-label">{children}</div>;
}

/** An external link that opens in a new tab. */
export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
