/**
 * Layout class seams of the pocket shell — shared by the site (`App`) and the
 * golf-only bundle (`GolfApp`), which lays its stage and sidebar out with the
 * same pocket.css rules. Pure and exported so they are unit-testable without a
 * DOM (stageClass.test.ts, via App's re-export).
 */

/**
 * Stage variant class. In manual "build on screen" mode the stage also holds the
 * on-screen gate palette above the editor; `pk-stage--manual` scopes the phone
 * CSS that floors the editor's height so the palette can't collapse it (see
 * pocket.css). Camera/booth stages get the plain `.pk-stage` sizing. Pure and
 * exported so the seam is unit-testable without a DOM.
 */
export function stageClassName(manual: boolean): string {
  return manual ? 'pk-stage pk-stage--manual' : 'pk-stage';
}

/**
 * Main-grid variant classes (#92). Two independent knobs:
 *   - `pk-side-left`        — the sidebar-side setting (unchanged behaviour).
 *   - `pk-main--golf-manual` — Quantum Golf played WITH the on-screen editor.
 *     A hole is a 1–3 wire circuit, so the editor does not need the wide 2/3
 *     column while the Bloch/Q-sphere — the actual game — is squeezed into the
 *     narrow one. The class flips the landscape split so the state column is
 *     dominant (pocket.css scopes it to roomy landscape screens; the phone
 *     stack, tablet portrait and short landscape phones are untouched).
 * Golf-in-camera-mode keeps the classic split: there the physical board is the
 * "editor" and the stage is the recognised-circuit read-out.
 * Pure and exported so the seam is unit-testable without a DOM.
 */
export function mainClassName(sideLeft: boolean, golfManual: boolean): string {
  return ['pk-main', sideLeft ? 'pk-side-left' : '', golfManual ? 'pk-main--golf-manual' : '']
    .filter(Boolean)
    .join(' ');
}
