import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildCircuit, type TilePlacement } from '../src/vision/circuitBuilder';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(here, '../../tests/fixtures/circuits');

// The exact placements behind each golden fixture (from tests/utils/render_board.py
// SCENARIOS). Each `(markerId, row, col)`.
const SCENARIOS: Record<string, Array<[number, number, number]>> = {
  empty: [],
  single_h: [[10, 0, 0]],
  bell: [
    [10, 0, 0],
    [14, 0, 1],
    [15, 1, 1],
  ],
  ghz3: [
    [10, 0, 0],
    [14, 0, 1],
    [15, 1, 1],
    [14, 0, 2],
    [15, 2, 2],
  ],
  all_families: [
    [10, 0, 0],
    [11, 1, 0],
    [12, 2, 0],
    [13, 3, 0],
    [21, 0, 1],
    [24, 1, 1],
    [30, 2, 1],
    [14, 0, 2],
    [15, 1, 2],
    [31, 3, 3],
  ],
  warn_lone_control: [
    [10, 0, 0],
    [14, 1, 1],
  ],
  s_and_t: [
    [10, 0, 0],
    [40, 0, 1],
    [41, 0, 2],
  ],
  swap: [
    [10, 0, 0],
    [45, 0, 1],
    [45, 1, 1],
  ],
  // Controlled gates via the ● modifier (task #51).
  cx_plain: [
    [14, 0, 0],
    [11, 1, 0],
  ],
  ch: [
    [14, 0, 0],
    [10, 1, 0],
  ],
  ccx: [
    [14, 0, 0],
    [14, 1, 0],
    [11, 2, 0],
  ],
  controlled_family: [
    [14, 0, 0],
    [12, 1, 0],
    [14, 0, 1],
    [13, 1, 1],
    [14, 0, 2],
    [40, 1, 2],
    [14, 0, 3],
    [41, 1, 3],
  ],
};

// The `dials` fixture: dial tiles at mixed rotations (markerId, row, col,
// rotation) — RX-dial r=1 → RX(π/2), RY-dial r=3 → RY(−π/2), RZ-dial r=2 → RZ(π).
// Mirrors tests/utils/render_board.py's `dials` scenario; the golden is shared
// with the Python builder so the circuits are byte-identical.
const DIAL_PLACEMENTS: Array<[number, number, number, number]> = [
  [42, 0, 0, 1],
  [43, 1, 1, 3],
  [44, 2, 2, 2],
];

const QUBITS = 5;

function placements(name: string): TilePlacement[] {
  return SCENARIOS[name].map(([markerId, row, col]) => ({ markerId, row, col }));
}

function golden(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, `${name}.json`), 'utf-8'));
}

describe('buildCircuit golden fixtures (byte-identical to the Python builder)', () => {
  for (const name of Object.keys(SCENARIOS)) {
    it(`matches golden circuit: ${name}`, () => {
      const result = buildCircuit(placements(name), QUBITS);
      expect(result.circuit).toEqual(golden(name));
    });
  }

  it('emits the lone_control warning for warn_lone_control', () => {
    const result = buildCircuit(placements('warn_lone_control'), QUBITS);
    const expected = JSON.parse(
      readFileSync(resolve(FIXTURES, 'warn_lone_control.warnings.json'), 'utf-8'),
    );
    const got = result.warnings.map((w) => ({
      kind: w.kind,
      message: w.message,
      row: w.row,
      col: w.col,
      marker_ids: w.marker_ids,
    }));
    expect(got).toEqual(expected.warnings);
  });

  it('S and T tiles emit RZ equivalents with no native S/T type', () => {
    const result = buildCircuit(placements('s_and_t'), QUBITS);
    const types = result.circuit.gates.map((g) => g.type);
    expect(types).toEqual(['H', 'RZ', 'RZ']);
    expect(result.warnings).toEqual([]);
  });

  it('dial tiles at mixed rotations match the shared golden circuit', () => {
    const dialPlacements: TilePlacement[] = DIAL_PLACEMENTS.map(
      ([markerId, row, col, rotation]) => ({ markerId, row, col, rotation }),
    );
    const result = buildCircuit(dialPlacements, QUBITS);
    expect(result.circuit).toEqual(golden('dials'));
    expect(result.warnings).toEqual([]);
  });

  it('a dial is byte-identical to the classic rotation tile of the same angle', () => {
    // RX-dial at rotation 1 (→ RX(π/2)) must equal the fixed RX(π/2) tile (id 21).
    const dial = buildCircuit([{ markerId: 42, row: 0, col: 0, rotation: 1 }], QUBITS);
    const classic = buildCircuit([{ markerId: 21, row: 0, col: 0 }], QUBITS);
    expect(dial.circuit).toEqual(classic.circuit);
  });

  it('two × tiles in a column emit a 3-CNOT SWAP in order (matches the golden)', () => {
    const swap: TilePlacement[] = SCENARIOS.swap.map(([markerId, row, col]) => ({
      markerId,
      row,
      col,
    }));
    const result = buildCircuit(swap, QUBITS);
    expect(result.circuit).toEqual(golden('swap'));
    expect(result.warnings).toEqual([]);
    // Order is fixed regardless of tile input order.
    const reversed = buildCircuit([...swap].reverse(), QUBITS);
    expect(reversed.circuit).toEqual(result.circuit);
    const ids = result.circuit.gates.filter((g) => g.id.startsWith('swap-')).map((g) => g.id);
    expect(ids).toEqual(['swap-0-1-1', 'swap-0-1-2', 'swap-0-1-3']);
    const ctrls = result.circuit.gates.filter((g) => g.id.startsWith('swap-')).map((g) => g.control);
    expect(ctrls).toEqual([0, 1, 0]); // cx(a,b), cx(b,a), cx(a,b)
  });

  it('a single × tile warns lone_swap and emits nothing', () => {
    const result = buildCircuit([{ markerId: 45, row: 2, col: 1 }], QUBITS);
    expect(result.circuit.gates).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].kind).toBe('lone_swap');
    expect(result.warnings[0].marker_ids).toEqual([45]);
  });
});

describe('controlled gates via the ● modifier (task #51)', () => {
  const build = (tiles: Array<[number, number, number]>) =>
    buildCircuit(
      tiles.map(([markerId, row, col]) => ({ markerId, row, col })),
      QUBITS,
    );

  it('● + X (no ⊕) is a native CX, control = ●’s row', () => {
    const r = build([
      [14, 0, 0],
      [11, 1, 0],
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.circuit.gates).toEqual([
      { id: 'cnot-0-0', type: 'CNOT', control: 0, target: 1, position: 0 },
    ]);
  });

  it('● + {Y,Z,H,S,T} emit CY/CZ/CH/CS/CT with control+target', () => {
    for (const [marker, ctype] of [
      [12, 'CY'],
      [13, 'CZ'],
      [10, 'CH'],
      [40, 'CS'],
      [41, 'CT'],
    ] as const) {
      const r = build([
        [14, 2, 0],
        [marker, 4, 0],
      ]);
      expect(r.warnings).toEqual([]);
      expect(r.circuit.gates).toEqual([
        { id: `${ctype.toLowerCase()}-2-0`, type: ctype, control: 2, target: 4, position: 0 },
      ]);
    }
  });

  it('two ● + X is CCX with sorted controls', () => {
    const r = build([
      [14, 4, 0],
      [14, 1, 0],
      [11, 2, 0],
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.circuit.gates).toEqual([
      { id: 'ccx-1-4-0', type: 'CCX', control: 1, control2: 4, target: 2, position: 0 },
    ]);
  });

  it('excludes-with-warning: ● + 2 gates, 2 controls + non-X, 3 controls, ●+⊕+gate, ●+rotation', () => {
    const cases: Array<Array<[number, number, number]>> = [
      [
        [14, 0, 0],
        [10, 1, 0],
        [11, 2, 0],
      ], // ● + 2 gate tiles
      [
        [14, 0, 0],
        [14, 1, 0],
        [10, 2, 0],
      ], // 2 controls + non-X (H)
      [
        [14, 0, 0],
        [14, 1, 0],
        [14, 2, 0],
        [11, 3, 0],
      ], // 3 controls
      [
        [14, 0, 0],
        [15, 1, 0],
        [10, 2, 0],
      ], // ● + ⊕ + gate
      [
        [14, 0, 0],
        [21, 1, 0],
      ], // ● + RX(π/2): no controlled rotations in v1
    ];
    for (const tiles of cases) {
      const r = build(tiles);
      expect(r.circuit.gates).toEqual([]);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].kind).toBe('control_ambiguous');
    }
  });

  it('legacy ●● + ⊕ pairing (no gate tile) is unchanged — one CX + one lone control', () => {
    const r = build([
      [14, 0, 0],
      [14, 4, 0],
      [15, 1, 0],
    ]);
    const cnots = r.circuit.gates.filter((g) => g.type === 'CNOT');
    expect(cnots).toEqual([
      { id: 'cnot-0-0', type: 'CNOT', control: 0, target: 1, position: 0 },
    ]);
    const lone = r.warnings.filter((w) => w.kind === 'lone_control');
    expect(lone).toHaveLength(1);
    expect(lone[0].row).toBe(4);
  });
});
