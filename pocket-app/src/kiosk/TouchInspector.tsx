/**
 * TouchInspector — kiosk binding of the shared TouchInspector (SC2). Ported from
 * the former display-app booth surface (Entangible One, phase U3).
 *
 * The delegated-click engine lives in `@shared/display/TouchInspector`; this
 * binds the kiosk's `bo-` classes and its geometry (drop-below cutoff 140, clamp
 * 220 / 12) and the `enabled` gate (`?touch=1` or a coarse pointer — see
 * `./touch`). The kiosk has no dismiss-guard: an empty-space tap always closes
 * an open popover.
 */
import type { Circuit } from '@qamposer/react';
import { TouchInspector as SharedTouchInspector } from '@shared/display/TouchInspector';

export function TouchInspector({
  circuit,
  enabled,
}: {
  circuit: Circuit;
  enabled: boolean;
}) {
  return (
    <SharedTouchInspector
      circuit={circuit}
      enabled={enabled}
      classPrefix="bo"
      aboveThreshold={140}
      halfMaxCap={220}
      edgeOffset={12}
    />
  );
}

export default TouchInspector;
