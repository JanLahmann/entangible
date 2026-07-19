/**
 * Map circuit-builder / detection warning codes to gentle, booth-friendly
 * wording — shared by the kiosk booth skin and the pocket surfaces.
 *
 * The two apps carry warnings in slightly different envelopes:
 *   - the booth's `DetectionWarning` (from the WS protocol) keys off `code`;
 *   - Pocket's `BuildWarning` keys off `kind` and adds an `off_grid` code.
 * Both are accepted structurally via {@link WarningInput}; each app passes its
 * own warning shape through a one-line adapter that maps its discriminant onto
 * `code`. The set of handled codes is the SUPERSET of both apps.
 *
 * Unknown/new codes fall back to the caller-provided `message` verbatim (the
 * protocol is additive), or a generic prompt when none is present.
 */

/** Minimal structural shape both apps' warnings satisfy after adaptation. */
export interface WarningInput {
  code: string;
  col?: number | null;
  message?: string;
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
    default:
      // Unknown/new code: trust the caller's own human-readable message.
      return w.message || `Check the board${columnPhrase(w)}.`;
  }
}
