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

function columnPhrase(w: WarningInput): string {
  return typeof w.col === 'number' ? ` in column ${w.col + 1}` : '';
}

export function friendlyWarning(w: WarningInput): string {
  switch (w.code) {
    case 'lone_control':
      return `A ● control tile is missing its ⊕ partner${columnPhrase(w)}.`;
    case 'lone_target':
      return `A ⊕ target tile is missing its ● partner${columnPhrase(w)}.`;
    case 'cell_conflict':
      return `Two tiles are competing for the same cell${columnPhrase(w)} — nudge one aside.`;
    case 'off_grid':
      return 'A tile is off the grid — slide it onto a cell.';
    case 'lone_swap':
      return `A SWAP tile is missing its partner${columnPhrase(w)} — SWAPs work in pairs.`;
    case 'control_ambiguous':
      return `A ● control has too many gates to choose from${columnPhrase(w)} — give it just one.`;
    case 'unpaired_measure':
      return 'A measurement block has no wire block across from it — line it up with a wire.';
    case 'measure_span_mismatch':
      return "The wire and measurement blocks don't match the corner blocks — check they sit on the board's edges.";
    case 'stray_furniture':
      return 'Spare wire or measurement blocks beside the board are ignored.';
    case 'stray_tiles':
      return 'Tiles beside the board are ignored — only tiles between the corner blocks count.';
    default:
      // Unknown/new code: trust the caller's own human-readable message.
      return w.message || `Check the board${columnPhrase(w)}.`;
  }
}

/** Status-pill line when the booth camera stopped delivering frames. */
export const CAMERA_LOST_LABEL = 'Camera lost — check the cable';
