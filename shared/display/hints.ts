/**
 * Rotating footer "hint ticker" copy, shared by the kiosk booth skin and the
 * pocket surfaces. Both footers cycle the same four teaching lines on the same
 * interval when no warning is showing; SC1 gives them one home so the copy
 * can't drift. The rotation state/effect stays in each surface's component.
 *
 * (App-specific hints — e.g. Pocket's iOS "Add to Home Screen" install hint —
 * are NOT here; they are not duplicated across the two apps.)
 */
export const HINTS = [
  '● and ⊕ in the same column make a CNOT — entanglement in one move.',
  'An H tile puts a qubit into superposition — 0 and 1 at once.',
  'Place tiles left-to-right; each column is one step in time.',
  'Two entangled qubits always agree — measure one, know the other.',
];

/** Milliseconds between hint rotations. */
export const HINT_ROTATE_MS = 7000;
