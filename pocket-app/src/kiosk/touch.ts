/**
 * Kiosk touch-to-inspect enable decision (docs/booth-ux.md, "Variant-A
 * refinements → Touch"). Ported from the former display-app booth surface
 * (Entangible One, phase U3).
 *
 * Touch is OPTIONAL on the kiosk and never edits the circuit (the physical
 * table is the editor). The framework-free copy/decision logic
 * (`gateInspectCopy`, `outcomeInspectCopy`, `formatAngle`, `POPOVER_MS`) lives
 * in `@quantum/inspectCopy` and is re-exported here so kiosk callers
 * (`TouchInspector`) keep importing from `./touch`. Only the kiosk-specific
 * `?touch` / coarse-pointer enable decision stays local (the handheld pocket
 * surface has touch always on).
 */
export {
  POPOVER_MS,
  formatAngle,
  gateInspectCopy,
  outcomeInspectCopy,
} from '@quantum/inspectCopy';

/**
 * Whether touch-to-inspect should be active: explicit `?touch=1` (or `0` to
 * force off) wins; otherwise it follows a coarse pointer (a touchscreen).
 */
export function isTouchEnabled(search: string, coarsePointer: boolean): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get('touch');
  if (raw !== null) {
    return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
  }
  return coarsePointer;
}
