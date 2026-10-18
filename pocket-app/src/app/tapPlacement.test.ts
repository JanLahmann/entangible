// @vitest-environment jsdom
/**
 * The gate bar's circuit edits (tapPlacement.ts): the clubs it offers, the
 * append-at-the-end rule (pinned against the library's own compaction via
 * its QASM round trip), removal and Undo's choice of gate — and that the
 * engine charges each edit one stroke, like a drag or a delete.
 */
import { describe, it, expect } from 'vitest';
import { circuitToQasm, qasmToCircuit, type Circuit, type GateType } from '@qamposer/react';
import { HOLES, strokeDelta } from '@quantum/golf';
import {
  appendGate,
  barClubs,
  clubLabel,
  compactGates,
  removeGate,
  undoTarget,
  type Wires,
} from './tapPlacement';

const EMPTY: Circuit = { qubits: 5, gates: [] } as Circuit;
let nextId = 0;
const id = () => `t${nextId++}`;

/** Positions + wiring only (ids differ between our gates and parsed ones). */
const shape = (c: Circuit) =>
  [...c.gates]
    .sort((a, b) => a.position - b.position || (a.qubit ?? a.control ?? 0) - (b.qubit ?? b.control ?? 0))
    .map((g) => [g.type, g.qubit, g.control, g.target, g.position]);

function build(steps: [GateType, Wires][]): Circuit {
  return steps.reduce((c, [type, w]) => appendGate(c, type, w, id()), EMPTY);
}

describe('barClubs — exactly the hole palette', () => {
  it('offers each round’s clubs, CX in golf’s spelling', () => {
    const easy = barClubs(HOLES[0]);
    expect(easy.map((c) => c.label)).toEqual(['X', 'H', 'CX']);
    expect(easy.map((c) => c.type)).toEqual(['X', 'H', 'CNOT']);
    expect(easy.find((c) => c.label === 'CX')!.twoQubit).toBe(true);
    const extra = barClubs(HOLES[HOLES.length - 1]);
    expect(extra.map((c) => c.label)).toEqual(['X', 'H', 'CX', 'Y', 'Z', 'S', 'T', 'CH']);
    expect(extra.filter((c) => c.twoQubit).map((c) => c.label)).toEqual(['CX', 'CH']);
  });

  it('covers every club of every hole (nothing dropped)', () => {
    for (const hole of HOLES) expect(barClubs(hole)).toHaveLength(hole.clubs.length);
    expect(clubLabel('CNOT')).toBe('CX');
    expect(clubLabel('CH')).toBe('CH');
  });
});

describe('appendGate — the end of the chosen wires', () => {
  it('puts single gates in the next free column of their wire', () => {
    const c = build([
      ['H', { qubit: 0 }],
      ['H', { qubit: 0 }],
      ['X', { qubit: 1 }],
    ]);
    expect(c.gates.map((g) => [g.type, g.qubit, g.position])).toEqual([
      ['H', 0, 0],
      ['H', 0, 1],
      ['X', 1, 0],
    ]);
    expect(c.qubits).toBe(5);
  });

  it('puts a two-qubit gate after everything on its span (intermediate wires too)', () => {
    const c = build([
      ['H', { qubit: 1 }],
      ['H', { qubit: 1 }],
      ['CNOT', { control: 0, target: 2 }],
      ['X', { qubit: 0 }],
    ]);
    const cx = c.gates.find((g) => g.type === 'CNOT')!;
    expect([cx.control, cx.target, cx.position]).toEqual([0, 2, 2]);
    expect(c.gates.find((g) => g.type === 'X')!.position).toBe(3);
  });

  it('matches the library’s own compaction for every sequence (QASM round trip)', () => {
    const seqs: [GateType, Wires][][] = [
      [['H', { qubit: 0 }], ['CNOT', { control: 0, target: 1 }], ['CNOT', { control: 1, target: 2 }]],
      [['X', { qubit: 2 }], ['CH', { control: 2, target: 0 }], ['Y', { qubit: 1 }], ['T', { qubit: 0 }]],
      [['S', { qubit: 1 }], ['Z', { qubit: 3 }], ['CNOT', { control: 4, target: 0 }], ['H', { qubit: 2 }]],
    ];
    for (const seq of seqs) {
      const ours = build(seq);
      const lib = qasmToCircuit(circuitToQasm(ours)).circuit!;
      expect(shape(lib)).toEqual(shape(ours));
    }
  });

  it('leaves an already compact board’s gates where they are', () => {
    const before = build([['H', { qubit: 0 }], ['X', { qubit: 1 }]]);
    const after = appendGate(before, 'Z', { qubit: 2 }, 'z');
    for (const g of before.gates) {
      expect(after.gates.find((x) => x.id === g.id)!.position).toBe(g.position);
    }
    expect(compactGates(after.gates)).toEqual(after.gates);
  });

  it('costs exactly one stroke per tap', () => {
    let c = EMPTY;
    for (const [type, w] of [
      ['H', { qubit: 0 }],
      ['CNOT', { control: 0, target: 1 }],
      ['X', { qubit: 1 }],
    ] as [GateType, Wires][]) {
      const next = appendGate(c, type, w, id());
      expect(strokeDelta(c, next)).toBe(1);
      c = next;
    }
  });
});

describe('removeGate / undoTarget', () => {
  it('takes back the bar’s most recent gate, not the right-most one', () => {
    const c = build([]);
    const a = appendGate(c, 'H', { qubit: 0 }, 'a');
    const b = appendGate(a, 'H', { qubit: 0 }, 'b');
    const x = appendGate(b, 'X', { qubit: 1 }, 'x'); // column 0, but placed last
    expect(undoTarget(x, ['a', 'b', 'x'])!.id).toBe('x');
    const after = removeGate(x, 'x');
    expect(after.gates.map((g) => g.id).sort()).toEqual(['a', 'b']);
    expect(strokeDelta(x, after)).toBe(1);
  });

  it('skips history the editor already deleted; falls back to the last column', () => {
    const c = appendGate(appendGate(EMPTY, 'H', { qubit: 0 }, 'a'), 'X', { qubit: 0 }, 'b');
    expect(undoTarget(c, ['gone', 'a'])!.id).toBe('a');
    expect(undoTarget(c, ['gone'])!.id).toBe('b'); // right-most
    expect(undoTarget(c, [])!.id).toBe('b');
    expect(undoTarget(EMPTY, ['a'])).toBeNull();
  });

  it('re-compacts after a removal', () => {
    const c = appendGate(appendGate(EMPTY, 'H', { qubit: 0 }, 'a'), 'X', { qubit: 0 }, 'b');
    expect(removeGate(c, 'a').gates).toEqual([{ id: 'b', type: 'X', qubit: 0, position: 0 }]);
  });
});
