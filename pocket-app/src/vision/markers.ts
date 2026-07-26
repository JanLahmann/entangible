/**
 * Marker table — the single source of truth for the Entangible tile scheme,
 * ported verbatim from `qamposer_vision/markers.py`.
 *
 * Maps each ArUco marker ID (DICT_4X4_50) to the gate or board corner it
 * represents. Kept byte-for-byte equivalent to the Python table (checked
 * indirectly by the circuit-builder golden tests): same IDs, same gate types,
 * same rotation angles, same S/T → RZ `emitAs` mappings.
 *
 * The ID assignment is EXPLICIT per ID, not a contiguous range: task #96
 * re-homed H → 30, X → 35 and the CNOT control ● → 17 onto IDs whose printed
 * bit pattern resembles the glyph, which pushed RZ(π) onto the freed 10. IDs 11
 * and 14 are now free (unassigned, not reserved); 48–49 stay reserved.
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
  /**
   * For a dial tile (IDs 42/43/44), the rotation-gate axis (RX/RY/RZ) it
   * parameterises. The angle is not fixed on the spec; it is chosen from the
   * tile's board-frame rotation r as `ROTATION_ANGLES[r]` and emitted like a
   * classic rotation tile. Undefined for every non-dial tile.
   */
  readonly dialAxis?: string;
}

/** Dial-tile marker ID → the rotation-gate axis it parameterises. */
export const DIAL_IDS: Readonly<Record<number, string>> = { 42: 'RX', 43: 'RY', 44: 'RZ' };

/**
 * The qubit-wire block (#95) — board furniture, not a gate. Up to five
 * IDENTICAL blocks (all this one ID; the instance count is the signal) sit
 * along the left edge between UL and LL; each declares one wire at its
 * vertical position, sorted top→bottom. None present = the classic 5 wires.
 */
export const QUBIT_WIRE_ID = 46;

/**
 * The measurement block (#97) — the RIGHT-edge counterpart of `QUBIT_WIRE_ID`,
 * and board furniture just the same. Up to five IDENTICAL blocks sit along the
 * right edge between UR and LR, so the table reads like a circuit diagram:
 * state prep on the left, measurement on the right. Measurement blocks are a
 * pure REFINEMENT — a wire exists iff its LEFT block exists, and a right block
 * only says where that wire ends, so a paired wire runs as the tilted segment
 * through both block centres instead of a horizontal line. An unpaired right
 * block is ignored (warned as `unpaired_measure`); the wire count is NEVER
 * derived from the right side. Mirrors `markers.MEASURE_BLOCK_ID`.
 */
export const MEASURE_BLOCK_ID = 47;

/**
 * Single-qubit Pauli / Hadamard tiles, `[markerId, gate]`. Hand-picked IDs, not
 * sequential: H on 30 and X on 35 read as their glyphs in print (#96).
 */
const SINGLE_QUBIT_IDS: ReadonlyArray<readonly [number, string]> = [
  [30, 'H'],
  [35, 'X'],
  [12, 'Y'],
  [13, 'Z'],
];

/** CNOT halves, `[markerId, role, glyph]`. The control ● moved 14 → 17 (#96). */
const CNOT_IDS: ReadonlyArray<readonly [number, string, string]> = [
  [17, 'control', '●'],
  [15, 'target', '⊕'],
];

/**
 * Fixed-angle rotation tiles, `[markerId, family, angle]` — written out one ID
 * at a time on purpose. RZ(π) lives on 10 (the ID freed when H moved to 30), so
 * the old "base 20 + index into ROTATION_ANGLES" arithmetic no longer holds and
 * must not come back. Array order is the canonical print order.
 */
const ROTATION_IDS: ReadonlyArray<readonly [number, string, number]> = [
  [20, 'RX', Math.PI / 4],
  [21, 'RX', Math.PI / 2],
  [22, 'RX', Math.PI],
  [23, 'RX', -Math.PI / 2],
  [24, 'RY', Math.PI / 4],
  [25, 'RY', Math.PI / 2],
  [26, 'RY', Math.PI],
  [27, 'RY', -Math.PI / 2],
  [28, 'RZ', Math.PI / 4],
  [29, 'RZ', Math.PI / 2],
  [10, 'RZ', Math.PI],
  [31, 'RZ', -Math.PI / 2],
];

function buildMarkerTable(): Map<number, GateSpec> {
  const table = new Map<number, GateSpec>();

  // 0-3: board corners.
  for (const [idStr, role] of Object.entries(CORNER_IDS)) {
    const id = Number(idStr);
    table.set(id, { kind: 'corner', gate: role, label: `Corner ${role}`, role });
  }

  // 30/35/12/13: single-qubit Pauli / Hadamard gates.
  for (const [id, gate] of SINGLE_QUBIT_IDS) {
    table.set(id, { kind: 'gate', gate, label: gate });
  }

  // 17/15: CNOT halves.
  for (const [id, role, glyph] of CNOT_IDS) {
    table.set(id, { kind: 'gate', gate: 'CNOT', label: `CNOT ${role} ${glyph}`, role });
  }

  // 20-29/10/31: rotation gates × angle variants, one explicit ID each.
  for (const [id, family, angle] of ROTATION_IDS) {
    table.set(id, {
      kind: 'gate',
      gate: family,
      label: `${family}(${prettyAngle(angle)})`,
      parameter: angle,
    });
  }

  // 40/41: S and T, emitted as their RZ equivalents.
  table.set(40, { kind: 'gate', gate: 'S', label: 'S', emitAs: ['RZ', Math.PI / 2] });
  table.set(41, { kind: 'gate', gate: 'T', label: 'T', emitAs: ['RZ', Math.PI / 4] });

  // 42/43/44: RX/RY/RZ dial tiles. The angle comes from the tile's board-frame
  // rotation (ROTATION_ANGLES[r]); `parameter` stays unset, `dialAxis` names it.
  for (const [idStr, axis] of Object.entries(DIAL_IDS)) {
    table.set(Number(idStr), { kind: 'gate', gate: axis, label: `${axis} dial`, dialAxis: axis });
  }

  // 45: SWAP tile (×). No native @qamposer/react SWAP type, so two × tiles in
  // one column are emitted by the circuit builder as a 3-CNOT SWAP between their
  // rows (see circuitBuilder.emitSwap). 46/47 are furniture (wire / measurement
  // blocks, no GateSpec); IDs 48-49 remain reserved and 11/14 are free (#96).
  table.set(45, { kind: 'gate', gate: 'SWAP', label: 'SWAP ×' });

  return table;
}

/**
 * Clockwise 90° step index (0-3) of a marker's printed top-left corner offset
 * `(dx, dy)` (dx right, dy down) from the marker centre — TL=0, TR=1, BR=2,
 * BL=3. Byte-for-byte identical to `markers.quadrant_rotation` in Python, so a
 * tile's rotation resolves to the same index in both detectors.
 */
export function quadrantRotation(dx: number, dy: number): number {
  const angle = Math.atan2(dy, dx);
  return ((Math.round((angle + (3 * Math.PI) / 4) / (Math.PI / 2)) % 4) + 4) % 4;
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

/**
 * Every ID a detector must be able to DECODE: the gate/corner table plus the
 * two board-furniture blocks. IDs 46/47 carry no `GateSpec` — they are
 * furniture, deliberately absent from `MARKER_TABLE` so they can never be
 * mapped to a cell as a gate — but the board still has to recognise them, so
 * `dictionary.json` carries them and the browser decodes exactly the same IDs
 * `cv2.aruco` does. Mirrors `markers.DETECTABLE_IDS`.
 */
export const DETECTABLE_IDS: ReadonlySet<number> = new Set([
  ...MARKER_TABLE.keys(),
  QUBIT_WIRE_ID,
  MEASURE_BLOCK_ID,
]);
