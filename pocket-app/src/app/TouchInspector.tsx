/**
 * TouchInspector — pocket binding of the shared TouchInspector (SC2).
 *
 * The delegated-click engine lives in `@shared/display/TouchInspector`; this
 * binds pocket's `pk-` classes and its geometry (drop-below cutoff 120, clamp
 * 180 / 10). Touch is ALWAYS on (a hand-held phone is a touch device). The
 * dismiss-guard protects the camera preview (`.pk-cam`) and sphere views
 * (`.pk-qsphere` / `.pk-bloch`) so pinch-zoom / drag-to-rotate never closes an
 * open popover. The pure copy helpers are re-exported for the unit test.
 */
import type { Circuit } from '@qamposer/react';
import { TouchInspector as SharedTouchInspector } from '@shared/display/TouchInspector';

export { gateInspectAt, outcomeInspectFromAttrs } from '@shared/display/TouchInspector';

export function TouchInspector({
  circuit,
  inspectGates,
}: {
  circuit: Circuit;
  /** Off in manual mode: gate taps belong to the live editor's own toolbar. */
  inspectGates?: boolean;
}) {
  return (
    <SharedTouchInspector
      circuit={circuit}
      classPrefix="pk"
      inspectGates={inspectGates}
      aboveThreshold={120}
      halfMaxCap={180}
      edgeOffset={10}
      dismissGuard=".pk-cam, .pk-qsphere, .pk-bloch"
    />
  );
}

export default TouchInspector;
