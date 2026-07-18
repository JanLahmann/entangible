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
};

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
});
