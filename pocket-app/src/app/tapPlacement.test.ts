// @vitest-environment jsdom
/**
 * Tap-to-play's circuit edits (tapPlacement.ts): the clubs it offers, placing
 * in an empty cell, inserting a column mid-circuit, controlled-gate placement,
 * delete, replace — each pinned against the library's own compaction (its
 * QASM round trip compacts with the original `compactGates`) — the engine's
 * stroke for each (add 1, delete 1, replace 2), and the grid model.
 */
import { describe, it, expect } from 'vitest';
import { circuitToQasm, qasmToCircuit, type Circuit, type Gate, type GateType } from '@qamposer/react';
import { HOLES, strokeDelta } from '@quantum/golf';
import {
  barClubs,
  canReplace,
  clubLabel,
  compactGates,
  gridModel,
  placeAt,
  removeGate,
  replaceGate,
  sameBoard,
  type Wires,
} from './tapPlacement';

const EMPTY: Circuit = { qubits: 5, gates: [] } as Circuit;
let nextId = 0;
const id = () => `t${nextId++}`;

/** Type, wiring and column of every gate, in a canonical order. */
const shape = (c: Circuit) =>
  [...c.gates]
    .map((g) => [g.type, g.qubit ?? null, g.control ?? null, g.target ?? null, g.position] as const)
    .sort((a, b) => a[4] - b[4] || String(a).localeCompare(String(b)));

/** What the library makes of a board: QASM out, QASM in (compacted). */
const libraryView = (c: Circuit) => shape(qasmToCircuit(circuitToQasm(c)).circuit!);

/** Place each gate at the end column (the grid's free column). */
function build(steps: [GateType, Wires][]): Circuit {
  return steps.reduce((c, [type, w]) => {
    const end = c.gates.reduce((m, g) => Math.max(m, g.position + 1), 0);
    return placeAt(c, type, w, end, id());
  }, EMPTY);
}

const gate = (c: Circuit, type: string): Gate => c.gates.find((g) => g.type === type)!;

describe('barClubs — exactly the hole palette', () => {
  it('offers each round’s clubs, CX in golf’s spelling', () => {
    expect(barClubs(HOLES[0]).map((c) => c.label)).toEqual(['X', 'H', 'CX']);
    expect(barClubs(HOLES[0]).map((c) => c.type)).toEqual(['X', 'H', 'CNOT']);
    const extra = barClubs(HOLES[HOLES.length - 1]);
    expect(extra.map((c) => c.label)).toEqual(['X', 'H', 'CX', 'Y', 'Z', 'S', 'T', 'CH']);
    expect(extra.filter((c) => c.twoQubit).map((c) => c.label)).toEqual(['CX', 'CH']);
    for (const hole of HOLES) expect(barClubs(hole)).toHaveLength(hole.clubs.length);
    expect(clubLabel('CNOT')).toBe('CX');
  });
});

describe('placeAt — an empty cell', () => {
  it('lands in the cell (or as far left as the wire allows, like the editor)', () => {
    let c = placeAt(EMPTY, 'H', { qubit: 0 }, 0, 'a');
    c = placeAt(c, 'X', { qubit: 1 }, 2, 'b'); // empty wire: compacts to column 0
    expect(shape(c)).toEqual([
      ['H', 0, null, null, 0],
      ['X', 1, null, null, 0],
    ]);
    expect(shape(c)).toEqual(libraryView(c));
  });

  it('builds a GHZ chain control, target, control, target …', () => {
    const c = build([
      ['H', { qubit: 0 }],
      ['CNOT', { control: 0, target: 1 }],
      ['CNOT', { control: 1, target: 2 }],
    ]);
    expect(shape(c)).toEqual([
      ['H', 0, null, null, 0],
      ['CNOT', null, 0, 1, 1],
      ['CNOT', null, 1, 2, 2],
    ]);
    expect(shape(c)).toEqual(libraryView(c));
  });

  it('a long-range CX blocks the wires between (the library’s span rule)', () => {
    const c = build([
      ['H', { qubit: 1 }],
      ['CNOT', { control: 0, target: 2 }],
      ['X', { qubit: 1 }],
    ]);
    expect(gate(c, 'CNOT').position).toBe(1);
    expect(gate(c, 'X').position).toBe(2);
    expect(shape(c)).toEqual(libraryView(c));
  });

  it('a CX whose target cell is taken pushes that gate right (any other qubit is valid)', () => {
    const c0 = build([
      ['H', { qubit: 0 }],
      ['X', { qubit: 1 }],
      ['X', { qubit: 1 }],
    ]);
    const c = placeAt(c0, 'CNOT', { control: 0, target: 1 }, 1, 'cx');
    expect(shape(c)).toEqual([
      ['H', 0, null, null, 0],
      ['X', 1, null, null, 0],
      ['CNOT', null, 0, 1, 1],
      ['X', 1, null, null, 2],
    ]);
    expect(shape(c)).toEqual(libraryView(c));
  });
});

describe('placeAt — inserting a column mid-circuit', () => {
  it('opens a column before step 2 on that wire; what follows moves right', () => {
    const c0 = build([
      ['H', { qubit: 0 }],
      ['CNOT', { control: 0, target: 1 }],
      ['X', { qubit: 0 }],
    ]);
    const c = placeAt(c0, 'Z', { qubit: 0 }, 1, 'z'); // gap before step 2
    expect(shape(c)).toEqual([
      ['H', 0, null, null, 0],
      ['Z', 0, null, null, 1],
      ['CNOT', null, 0, 1, 2],
      ['X', 0, null, null, 3],
    ]);
    expect(shape(c)).toEqual(libraryView(c));
    expect(strokeDelta(c0, c)).toBe(1);
  });

  it('inserts a CX before step 1 (gap at the left edge)', () => {
    const c0 = build([
      ['X', { qubit: 1 }],
      ['H', { qubit: 1 }],
    ]);
    const c = placeAt(c0, 'CNOT', { control: 0, target: 1 }, 0, 'cx');
    expect(shape(c)).toEqual([
      ['CNOT', null, 0, 1, 0],
      ['X', 1, null, null, 1],
      ['H', 1, null, null, 2],
    ]);
    expect(shape(c)).toEqual(libraryView(c));
  });

  it('leaves wires the new gate does not touch where they are', () => {
    const c0 = build([
      ['H', { qubit: 0 }],
      ['H', { qubit: 2 }],
      ['X', { qubit: 2 }],
    ]);
    const c = placeAt(c0, 'X', { qubit: 0 }, 0, 'x');
    expect(gate(c, 'H') && c.gates.filter((g) => g.qubit === 2).map((g) => g.position)).toEqual([0, 1]);
    expect(shape(c)).toEqual(libraryView(c));
  });
});

describe('delete, replace — and what the engine charges', () => {
  const base = () =>
    build([
      ['H', { qubit: 0 }],
      ['CNOT', { control: 0, target: 1 }],
      ['X', { qubit: 1 }],
    ]);

  it('an add costs 1', () => {
    const c0 = base();
    expect(strokeDelta(c0, placeAt(c0, 'H', { qubit: 2 }, 0, 'n'))).toBe(1);
  });

  it('a delete costs 1 and re-compacts', () => {
    const c0 = base();
    const c = removeGate(c0, gate(c0, 'CNOT').id);
    expect(strokeDelta(c0, c)).toBe(1);
    expect(shape(c)).toEqual([
      ['H', 0, null, null, 0],
      ['X', 1, null, null, 0],
    ]);
    expect(compactGates(c.gates)).toEqual(c.gates);
  });

  it('a replace costs 2 (one tile off, one on) and keeps the cell', () => {
    const c0 = base();
    const h = gate(c0, 'H');
    const c = replaceGate(c0, h.id, 'X', 'r');
    expect(strokeDelta(c0, c)).toBe(2);
    expect(c.gates.find((g) => g.id === 'r')).toMatchObject({ type: 'X', qubit: 0, position: 0 });
    const cx = gate(c0, 'CNOT');
    const ch = replaceGate(c0, cx.id, 'CH', 'ch');
    expect(strokeDelta(c0, ch)).toBe(2);
    expect(ch.gates.find((g) => g.id === 'ch')).toMatchObject({ type: 'CH', control: 0, target: 1 });
  });

  it('replace stays within an arity', () => {
    const c0 = base();
    expect(canReplace(gate(c0, 'H'), 'CNOT')).toBe(false);
    expect(canReplace(gate(c0, 'H'), 'H')).toBe(false);
    expect(canReplace(gate(c0, 'CNOT'), 'CH')).toBe(true);
    expect(replaceGate(c0, gate(c0, 'H').id, 'CNOT')).toBe(c0);
  });

  it('undo = back to the board before: a placed gate’s undo costs 1, a replace’s 2', () => {
    const c0 = base();
    const added = placeAt(c0, 'Y', { qubit: 2 }, 0, 'y');
    expect(strokeDelta(added, c0)).toBe(1);
    const swapped = replaceGate(c0, gate(c0, 'X').id, 'Z', 'z');
    expect(strokeDelta(swapped, c0)).toBe(2);
    expect(sameBoard(c0, { ...c0 })).toBe(true);
    expect(sameBoard(c0, added)).toBe(false);
  });
});

describe('gridModel', () => {
  it('rows = the hole’s qubits, one free column at the end, CX cells and the crossed wire', () => {
    const c = build([
      ['H', { qubit: 0 }],
      ['CNOT', { control: 0, target: 2 }],
    ]);
    const g = gridModel(c, 3);
    expect(g.rows).toBe(3);
    expect(g.columns).toBe(3); // 2 used + 1 free (and the minimum of 3)
    expect(g.cells[0][0].kind).toBe('single');
    expect(g.cells[0][1].kind).toBe('control');
    expect(g.cells[1][1].kind).toBe('crossed');
    expect(g.cells[2][1].kind).toBe('target');
    expect(g.cells[1][0].kind).toBe('empty');
    const long = build(Array.from({ length: 6 }, () => ['X', { qubit: 0 }] as [GateType, Wires]));
    expect(gridModel(long, 1).columns).toBe(7);
  });

  it('grows past the hole when a gate already sits higher (dragged in the editor)', () => {
    const c = build([['X', { qubit: 3 }]]);
    expect(gridModel(c, 1).rows).toBe(4);
  });
});
