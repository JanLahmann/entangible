/**
 * Celebrations — kiosk binding of the shared Celebrations overlay (SC2). Ported
 * from the former display-app booth surface (Entangible One, phase U3).
 *
 * The canvas/banner engine lives in `@shared/display/Celebrations`; this binds
 * the kiosk's `ent-` class scheme and the booth confetti policy: kind-aware
 * budget (Bell 100 / GHZ 150) with a `?lowpower` cap of 60 for the Pi 4, and a
 * constant 150-particle ceiling on the live array (docs/booth-ux.md).
 */
import { Celebrations as SharedCelebrations } from '@shared/display/Celebrations';
import type { Celebration } from '@quantum/moments';

export type { CelebrationRequest } from '@shared/display/Celebrations';

const BELL_PARTICLES = 100;
const GHZ_PARTICLES = 150;
const LOWPOWER_CAP = 60;

function isLowPower(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('lowpower');
}

/** Per-burst particle budget, respecting the low-power cap. */
function particleBudget(kind: Celebration['kind']): number {
  const base = kind === 'ghz' ? GHZ_PARTICLES : BELL_PARTICLES;
  return isLowPower() ? Math.min(LOWPOWER_CAP, base) : base;
}

export function Celebrations({
  celebration,
}: {
  celebration: import('@shared/display/Celebrations').CelebrationRequest | null;
}) {
  return (
    <SharedCelebrations
      celebration={celebration}
      classPrefix="ent"
      particleBudget={particleBudget}
      maxParticles={GHZ_PARTICLES}
    />
  );
}

export default Celebrations;
