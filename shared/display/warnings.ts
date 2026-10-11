/**
 * Map circuit-builder / detection warning codes to gentle, booth-friendly
 * wording — shared by the kiosk booth skin and the pocket surfaces — and decide
 * which of them a VISITOR should ever see.
 *
 * The two apps carry warnings in slightly different envelopes:
 *   - the booth's `DetectionWarning` (from the WS protocol) keys off `code`;
 *   - Pocket's `BuildWarning` keys off `kind` and adds an `off_grid` code.
 * Both are accepted structurally via {@link WarningInput}; each app passes its
 * own warning shape through a one-line adapter that maps its discriminant onto
 * `code`. The set of handled codes is the SUPERSET of both apps.
 *
 * Every code either vision pipeline can emit has a case here and an entry in
 * {@link WARNING_AUDIENCE}; `pocket-app/tests/warningKinds.test.ts` (and its
 * Python twin) grep both pipelines so a new kind fails until it is classified.
 * Unknown codes (a newer host) still fall back to the caller's `message`
 * verbatim, or a generic prompt when none is present.
 */
import { en, type Messages } from '@shared/i18n/en';

/** Minimal structural shape both apps' warnings satisfy after adaptation. */
export interface WarningInput {
  code: string;
  col?: number | null;
  message?: string;
}

/**
 * Who a warning is for. `visitor`: something the person at the table did and
 * can fix (a tile between wires, a CNOT half missing) — shown on the kiosk and
 * pocket visitor surfaces. `staff`: booth set-up and inventory — shown only on
 * the staff/debug surfaces. The kit lying beside the board is the normal state
 * of a booth table, so `stray_*` is deliberately SILENT for visitors.
 */
export type WarningAudience = 'visitor' | 'staff';

/** The explicit visibility decision for every warning code either pipeline emits. */
export const WARNING_AUDIENCE = {
  cell_conflict: 'visitor',
  lone_control: 'visitor',
  lone_target: 'visitor',
  lone_swap: 'visitor',
  control_ambiguous: 'visitor',
  off_grid: 'visitor',
  unpaired_measure: 'visitor',
  // The corner blocks and the wire/measurement blocks disagree about the
  // board's width — a set-up problem for staff, and the corners win anyway.
  measure_span_mismatch: 'staff',
  // Spare kit beside the board: inventory, not a mistake (#94/#95 strays).
  stray_furniture: 'staff',
  stray_tiles: 'staff',
} as const satisfies Record<string, WarningAudience>;

/** Every warning code the shared display layer knows. */
export type WarningCode = keyof typeof WARNING_AUDIENCE;

/**
 * Should a visitor surface (the kiosk, the pocket footer/toast) show this
 * warning? Only codes classified `visitor`; staff codes and unknown codes from
 * a newer host stay off the visitor screens (they remain on `/debug`).
 */
export function kioskVisible(w: Pick<WarningInput, 'code'>): boolean {
  return (WARNING_AUDIENCE as Record<string, WarningAudience | undefined>)[w.code] === 'visitor';
}

/**
 * The warning in the visitor's words. `t` picks the language (default
 * English); the STAFF-audience codes stay English — they only ever reach the
 * staff /debug view, which is not translated.
 */
export function friendlyWarning(w: WarningInput, t: Messages = en): string {
  const m = t.warnings;
  const at = typeof w.col === 'number' ? m.inColumn(w.col + 1) : '';
  switch (w.code) {
    case 'lone_control':
      return m.loneControl(at);
    case 'lone_target':
      return m.loneTarget(at);
    case 'cell_conflict':
      return m.cellConflict(at);
    case 'off_grid':
      return m.offGrid;
    case 'lone_swap':
      return m.loneSwap(at);
    case 'control_ambiguous':
      return m.controlAmbiguous(at);
    case 'unpaired_measure':
      return m.unpairedMeasure;
    case 'measure_span_mismatch':
      return "The wire and measurement blocks don't match the corner blocks — check they sit on the board's edges.";
    case 'stray_furniture':
      return 'Spare wire or measurement blocks beside the board are ignored.';
    case 'stray_tiles':
      return 'Tiles beside the board are ignored — only tiles between the corner blocks count.';
    default:
      // Unknown/new code: trust the caller's own human-readable message.
      return w.message || m.checkBoard(at);
  }
}

/** Status-pill line when the booth camera stopped delivering frames (English). */
export const CAMERA_LOST_LABEL = en.warnings.cameraLost;

/** Status-pill line when the booth has no working camera at all (English). */
export const CAMERA_MISSING_LABEL = en.warnings.cameraMissing;

/**
 * What is wrong with the booth camera, from `status.camera`: `lost` — it
 * delivered frames and then stopped (a cable came loose); `missing` — it never
 * delivered a frame (nothing attached, wrong `QAMPOSER_SOURCE`). `null` while
 * fine, still starting, or on older hosts without these fields.
 */
export type CameraProblem = 'lost' | 'missing';

export function cameraProblem(
  camera: { lost?: boolean; missing?: boolean } | undefined | null,
): CameraProblem | null {
  if (camera?.lost === true) return 'lost';
  if (camera?.missing === true) return 'missing';
  return null;
}

/** The visitor-screen line for a camera problem, in `t`'s language. */
export function cameraProblemLabel(problem: CameraProblem, t: Messages = en): string {
  return problem === 'lost' ? t.warnings.cameraLost : t.warnings.cameraMissing;
}
