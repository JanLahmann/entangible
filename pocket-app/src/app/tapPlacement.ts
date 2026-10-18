/**
 * Tap-to-play circuit edits for golf (`TapPlay.tsx`, `TapCircuit.tsx`) —
 * pure, no React, no DOM.
 *
 * The tap grid is a second view of the SAME circuit the on-screen editor
 * shows. It never scores anything: each action here returns the next
 * `Circuit`, and the shell hands it to `ManualEditSource.setFromEditor` — the
 * path the editor's `onCircuitChange` feeds — so `useGolfGame.step` charges it
 * exactly like a drag: +1 per gate added, +1 per gate removed, a retype 2
 * (`strokeDelta`: a gate's key is its type and wiring, never its column).
 *
 * Placement mirrors the editor's drop (`commitPlacement` in @qamposer/react):
 * every gate whose wire span overlaps the new gate's span and that sits at or
 * right of the drop column moves one column right, the new gate takes the
 * column, then `compactGates` packs the whole board left. Tapping an empty
 * cell and tapping the gap before a column are both that one operation at
 * that column — on an empty cell nothing on the span is in the way, at a gap
 * the gates there shift right (a new column, mid-circuit included).
 * `compactGates` and the span rule (`getGateQubits`: a controlled gate blocks
 * every wire from its lowest to its highest qubit) are not exported by the
 * library, so they are mirrored here; `tapPlacement.test.ts` pins them against
 * the library's QASM round trip, which compacts with the original.
 *
 * Controlled gates: the editor accepts any target wire other than the control
 * (it shifts whatever is in the way), so every other qubit of the hole is a
 * valid target.
 */
import { generateGateId, type Circuit, type Gate, type GateType } from '@qamposer/react';
import { clubGateTypes, type Hole } from '@quantum/golf';

/** Two-wire controlled gates the grid can place (control + target). */
const TWO_QUBIT: ReadonlySet<GateType> = new Set<GateType>(['CNOT', 'CY', 'CZ', 'CH', 'CS', 'CT']);
/** Single-wire gates the grid can place (no rotation dials: no club uses one). */
const ONE_QUBIT: ReadonlySet<GateType> = new Set<GateType>(['H', 'X', 'Y', 'Z', 'S', 'T']);

/** One club on the bar. */
export interface BarClub {
  readonly type: GateType;
  /** What the golfer calls it (the library's CNOT is golf's CX). */
  readonly label: string;
  readonly twoQubit: boolean;
}

/** Where a gate sits. */
export type Wires = { readonly qubit: number } | { readonly control: number; readonly target: number };

/** Golf's name for a gate type ('CNOT' → 'CX', every other club as is). */
export function clubLabel(type: GateType): string {
  return type === 'CNOT' ? 'CX' : type;
}

export function isTwoQubitClub(type: GateType): boolean {
  return TWO_QUBIT.has(type);
}

/** The hole's clubs as bar buttons — exactly the palette's set (#55). */
export function barClubs(hole: Hole): BarClub[] {
  return clubGateTypes(hole)
    .filter((type) => ONE_QUBIT.has(type) || TWO_QUBIT.has(type))
    .map((type) => ({ type, label: clubLabel(type), twoQubit: TWO_QUBIT.has(type) }));
}

/** Every wire a gate blocks (mirror of the library's `getGateQubits`). */
export function gateSpan(gate: Pick<Gate, 'type' | 'qubit' | 'control' | 'control2' | 'target'>): number[] {
  if (gate.control !== undefined && gate.target !== undefined) {
    const involved = [gate.control, gate.target];
    if (gate.type === 'CCX' && gate.control2 !== undefined) involved.push(gate.control2);
    const lo = Math.min(...involved);
    const hi = Math.max(...involved);
    const out: number[] = [];
    for (let q = lo; q <= hi; q++) out.push(q);
    return out;
  }
  return gate.qubit !== undefined ? [gate.qubit] : [];
}

/**
 * Push every gate as far left as its wires allow, keeping the column order
 * (mirror of the library's `compactGates`).
 */
export function compactGates(gates: readonly Gate[]): Gate[] {
  const next = new Map<number, number>();
  return [...gates]
    .sort((a, b) => a.position - b.position)
    .map((gate) => {
      const span = gateSpan(gate);
      let position = 0;
      for (const q of span) position = Math.max(position, next.get(q) ?? 0);
      for (const q of span) next.set(q, position + 1);
      return { ...gate, position };
    });
}

/** The wires of a gate, as the grid describes them. */
export function gateWires(gate: Gate): Wires {
  return gate.control !== undefined && gate.target !== undefined
    ? { control: gate.control, target: gate.target }
    : { qubit: gate.qubit ?? 0 };
}

function makeGate(type: GateType, wires: Wires, position: number, id: string): Gate {
  return 'qubit' in wires
    ? { id, type, qubit: wires.qubit, position }
    : { id, type, control: wires.control, target: wires.target, position };
}

/**
 * The editor's drop of `type` on `wires` at `column` (see the module doc):
 * shift what overlaps the span at or after the column, add, compact.
 */
export function placeAt(
  circuit: Circuit,
  type: GateType,
  wires: Wires,
  column: number,
  id: string = generateGateId(),
): Circuit {
  const gate = makeGate(type, wires, Math.max(0, column), id);
  const span = gateSpan(gate);
  const shifted = circuit.gates.map((g) =>
    g.position >= gate.position && gateSpan(g).some((q) => span.includes(q))
      ? { ...g, position: g.position + 1 }
      : g,
  );
  return { ...circuit, gates: compactGates([...shifted, gate]) };
}

/** The board without gate `id`, re-compacted (the editor's keyboard delete). */
export function removeGate(circuit: Circuit, id: string): Circuit {
  return { ...circuit, gates: compactGates(circuit.gates.filter((g) => g.id !== id)) };
}

/**
 * Retype gate `id` in place — the physical "swap a tile": the engine reads it
 * as one gate removed and one added (2 strokes). Same wiring, same column; a
 * one-qubit gate only becomes another one-qubit gate, a two-qubit gate keeps
 * its control and target. Returns the circuit unchanged when the swap is not
 * allowed (`canReplace`).
 */
export function replaceGate(
  circuit: Circuit,
  id: string,
  type: GateType,
  newId: string = generateGateId(),
): Circuit {
  const old = circuit.gates.find((g) => g.id === id);
  if (!old || !canReplace(old, type)) return circuit;
  const next = makeGate(type, gateWires(old), old.position, newId);
  return { ...circuit, gates: circuit.gates.map((g) => (g.id === id ? next : g)) };
}

/** May `gate` be retyped to `type` (same arity, different type)? */
export function canReplace(gate: Gate, type: GateType): boolean {
  return gate.type !== type && isTwoQubitClub(gate.type) === isTwoQubitClub(type);
}

// ---------------------------------------------------------------------------
// The grid model
// ---------------------------------------------------------------------------

/** What one cell of the grid shows. */
export type Cell =
  | { readonly kind: 'empty' }
  | { readonly kind: 'single'; readonly gate: Gate }
  | { readonly kind: 'control'; readonly gate: Gate }
  | { readonly kind: 'target'; readonly gate: Gate }
  /** A wire a controlled gate's line crosses (blocked, part of that gate). */
  | { readonly kind: 'crossed'; readonly gate: Gate };

export interface GridModel {
  readonly rows: number;
  /** Columns drawn: the circuit's, plus always one free column at the end. */
  readonly columns: number;
  /** `cells[qubit][column]`. */
  readonly cells: readonly (readonly Cell[])[];
}

/** Fewest columns the grid draws, so an empty hole still reads as a board. */
export const MIN_COLUMNS = 3;

/**
 * Lay a circuit out as a grid of `rows` wires (the hole's qubits; more if a
 * gate already sits higher, e.g. dragged there in the editor).
 */
export function gridModel(circuit: Circuit, minRows: number): GridModel {
  let rows = minRows;
  let used = 0;
  for (const g of circuit.gates) {
    for (const q of gateSpan(g)) rows = Math.max(rows, q + 1);
    used = Math.max(used, g.position + 1);
  }
  const columns = Math.max(MIN_COLUMNS, used + 1);
  const cells: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, (): Cell => ({ kind: 'empty' })),
  );
  for (const gate of circuit.gates) {
    const c = gate.position;
    if (gate.control !== undefined && gate.target !== undefined) {
      for (const q of gateSpan(gate)) cells[q][c] = { kind: 'crossed', gate };
      cells[gate.control][c] = { kind: 'control', gate };
      cells[gate.target][c] = { kind: 'target', gate };
    } else if (gate.qubit !== undefined) {
      cells[gate.qubit][c] = { kind: 'single', gate };
    }
  }
  return { rows, columns, cells };
}

/** The gates' identity, for "is the board still what we left it?" checks. */
export function sameBoard(a: Circuit, b: Circuit): boolean {
  return JSON.stringify(a.gates) === JSON.stringify(b.gates);
}
