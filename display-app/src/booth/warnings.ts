/**
 * Map circuit-builder warning codes to gentle, booth-friendly wording.
 *
 * The server may add new codes over time (protocol is additive); unknown codes
 * fall back to the server-provided `message` verbatim.
 */
import type { DetectionWarning } from '../ws/messages';

function columnPhrase(warning: DetectionWarning): string {
  return typeof warning.col === 'number' ? ` in column ${warning.col + 1}` : '';
}

export function friendlyWarning(warning: DetectionWarning): string {
  switch (warning.code) {
    case 'lone_control':
      return `A ● control tile is missing its ⊕ partner${columnPhrase(warning)}.`;
    case 'lone_target':
      return `A ⊕ target tile is missing its ● partner${columnPhrase(warning)}.`;
    case 'cell_conflict':
      return `Two tiles are competing for the same cell${columnPhrase(warning)} — nudge one aside.`;
    default:
      // Unknown/new code: trust the server's own human-readable message.
      return warning.message || `Check the board${columnPhrase(warning)}.`;
  }
}
