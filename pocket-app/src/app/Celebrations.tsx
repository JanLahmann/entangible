/**
 * Celebrations — pocket binding of the shared Celebrations overlay (SC2).
 *
 * The canvas/banner engine lives in `@shared/display/Celebrations`; this binds
 * pocket's `pk-` class scheme and its confetti policy: a fixed cap (100, or the
 * low-power 60 the parent passes), kind-independent, used as both the per-burst
 * budget and the ceiling (docs/pocket.md).
 */

/** The golf sphere panel — where a hole-in banner sits on a phone (#13). */
export const golfBannerAnchor = (): Element | null =>
  typeof document === 'undefined' ? null : document.querySelector('.pk-side-hero .pk-well');
import { Celebrations as SharedCelebrations } from '@shared/display/Celebrations';
import type { CelebrationRequest } from '@shared/display/Celebrations';

export type { CelebrationRequest };

const MAX_PARTICLES = 100; // tablet budget (both Bell and GHZ)
export const LOW_POWER_PARTICLES = 60; // docs/pocket.md low-power confetti cap

export function Celebrations({
  celebration,
  maxParticles = MAX_PARTICLES,
  anchor,
}: {
  celebration: CelebrationRequest | null;
  maxParticles?: number;
  /** Golf: the sphere panel, so a phone keeps the banner inside it (#13). */
  anchor?: () => Element | null;
}) {
  return (
    <SharedCelebrations
      celebration={celebration}
      classPrefix="pk"
      particleBudget={() => maxParticles}
      maxParticles={maxParticles}
      anchor={anchor}
    />
  );
}

export default Celebrations;
