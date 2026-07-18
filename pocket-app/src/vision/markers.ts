/**
 * Marker table — the single source of truth for the Entangible tile scheme,
 * ported verbatim from `qamposer_vision/markers.py`.
 *
 * Maps each ArUco marker ID (DICT_4X4_50) to the gate or board corner it
 * represents. Kept byte-for-byte equivalent to the Python table (checked
 * indirectly by the circuit-builder golden tests): same IDs, same gate types,
 * same rotation angles, same S/T → RZ `emitAs` mappings.
 */

export const ARUCO_DICT_NAME = 'DICT_4X4_50';

/** Board-corner roles in clockwise order starting top-left. */
export const CORNER_ROLES = ['TL', 'TR', 'BR', 'BL'] as const;
export type CornerRole = (typeof CORNER_ROLES)[number];

/** Marker ID → corner role for the four board corners. */
export const CORNER_IDS: Readonly<Record<number, CornerRole>> = {
  0: 'TL',
  1: 'TR',
  2: 'BR',
  3: 'BL',
};

/** Rotation gate families that come in angle variants. */
export const ROTATION_GATES = ['RX', 'RY', 'RZ'] as const;

/** The angle variants (radians) printed for every rotation gate family. */
export const ROTATION_ANGLES = [Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2] as const;

export type SpecKind = 'corner' | 'gate';

export interface GateSpec {
  readonly kind: SpecKind;
  /** GateType string for gates; corner role for corners. */
  readonly gate: string;
  readonly label: string;
  readonly parameter?: number;
  /** Corner role (TL|TR|BR|BL), or CNOT role (control|target), else undefined. */
  readonly role?: string;
  /** For S/T tiles: the `[gateType, parameter]` to emit instead (their RZ eqv). */
  readonly emitAs?: readonly [string, number];
}

function buildMarkerTable(): Map<number, GateSpec> {
  const table = new Map<number, GateSpec>();

  // 0-3: board corners.
  for (const [idStr, role] of Object.entries(CORNER_IDS)) {
    const id = Number(idStr);
    table.set(id, { kind: 'corner', gate: role, label: `Corner ${role}`, role });
  }

  // 10-13: single-qubit Pauli / Hadamard gates.
  const single: Array<[number, string]> = [
    [10, 'H'],
    [11, 'X'],
    [12, 'Y'],
    [13, 'Z'],
  ];
  for (const [id, gate] of single) {
    table.set(id, { kind: 'gate', gate, label: gate });
  }

  // 14/15: CNOT halves.
  table.set(14, { kind: 'gate', gate: 'CNOT', label: 'CNOT control ●', role: 'control' });
  table.set(15, { kind: 'gate', gate: 'CNOT', label: 'CNOT target ⊕', role: 'target' });

  // 20-31: rotation gates × angle variants (4 angles each, contiguous).
  let base = 20;
  for (const family of ROTATION_GATES) {
    ROTATION_ANGLES.forEach((angle, offset) => {
      const id = base + offset;
      table.set(id, {
        kind: 'gate',
        gate: family,
        label: `${family}(${prettyAngle(angle)})`,
        parameter: angle,
      });
    });
    base += ROTATION_ANGLES.length;
  }

  // 40/41: S and T, emitted as their RZ equivalents.
  table.set(40, { kind: 'gate', gate: 'S', label: 'S', emitAs: ['RZ', Math.PI / 2] });
  table.set(41, { kind: 'gate', gate: 'T', label: 'T', emitAs: ['RZ', Math.PI / 4] });

  return table;
}

const PI_FRACTIONS: ReadonlyArray<[number, string]> = [
  [0.25, 'π/4'],
  [0.5, 'π/2'],
  [1.0, 'π'],
  [2.0, '2π'],
  [0.75, '3π/4'],
];

/** Compact π-relative angle label (mirrors markers.pretty_angle). */
export function prettyAngle(theta: number): string {
  if (theta === 0) return '0';
  const sign = theta < 0 ? '-' : '';
  const ratio = Math.abs(theta) / Math.PI;
  for (const [value, text] of PI_FRACTIONS) {
    if (Math.abs(ratio - value) < 1e-9) return `${sign}${text}`;
  }
  return theta.toFixed(4);
}

/** ArUco marker ID → GateSpec. */
export const MARKER_TABLE: ReadonlyMap<number, GateSpec> = buildMarkerTable();
