/**
 * Friendly, booth-consistent wording for circuit-builder / pipeline warnings.
 * Mirrors display-app/src/booth/warnings.ts, extended with the `off_grid` code
 * the pocket pipeline can emit.
 */
import type { BuildWarning } from '../vision/circuitBuilder';

function columnPhrase(w: BuildWarning): string {
  return typeof w.col === 'number' && w.col !== null ? ` in column ${w.col + 1}` : '';
}

export function friendlyWarning(w: BuildWarning): string {
  switch (w.kind) {
    case 'lone_control':
      return `A ● control tile is missing its ⊕ partner${columnPhrase(w)}.`;
    case 'lone_target':
      return `A ⊕ target tile is missing its ● partner${columnPhrase(w)}.`;
    case 'cell_conflict':
      return `Two tiles are competing for the same cell${columnPhrase(w)} — nudge one aside.`;
    case 'off_grid':
      return 'A tile is off the grid — slide it onto a cell.';
    default:
      return w.message || 'Check the board.';
  }
}
