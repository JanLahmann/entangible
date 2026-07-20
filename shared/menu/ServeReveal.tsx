/**
 * ServeReveal — a brief reveal-animation wrapper for a just-served order
 * (classPrefix-shared, style-free).
 *
 * Keyed on `seq`: every serve bumps the counter, which remounts the wrapper so
 * the CSS entrance animation on `<prefix>-reveal` replays even when the same
 * item comes out twice. `data-seq` exposes the current sequence for tests. The
 * animation itself — and its `prefers-reduced-motion` suppression — lives
 * entirely in each app's CSS; this component only owns the retrigger.
 */
import type { ReactNode } from 'react';

export function ServeReveal({
  seq,
  children,
  classPrefix,
}: {
  /** Serve counter — a change remounts the wrapper so the animation replays. */
  seq: number;
  children: ReactNode;
  classPrefix: string;
}) {
  return (
    <div key={seq} className={`${classPrefix}-reveal`} data-seq={seq}>
      {children}
    </div>
  );
}

export default ServeReveal;
