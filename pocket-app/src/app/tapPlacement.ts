/**
 * Tap-to-place circuit edits for golf's gate bar (`GateBar.tsx`) — pure, no
 * React, no DOM.
 *
 * The gate bar is a second way to build a golf hole on screen: tap a club and
 * it lands at the END of the chosen wire(s). It does not touch the engine; it
 * produces the next `Circuit` and hands it to the same `ManualEditSource`
 * (`setFromEditor`) the on-screen editor's `onCircuitChange` feeds, so
 * `useGolfGame.step` scores it exactly like a drag: one stroke per added gate,
 * one per removed gate (`strokeDelta`), the wipe its flat one.
 *
 * "Identical to a drag at the end": the editor's drop (`commitPlacement` in
 * @qamposer/react) shifts nothing when the drop column is past every gate, adds
 * the new gate there and runs `compactGates` over the whole board. `appendGate`
 * does the same with a column after the last one. `compactGates` and the
 * wire-span rule (`getGateQubits`: a controlled gate occupies every wire from
 * its lowest to its highest qubit) are not exported by the library, so they are
 * mirrored here; `tapPlacement.test.ts` pins the mirror against the library's own
 * QASM round trip (which compacts with the original).
 */
import { generateGateId, type Circuit, type Gate, type GateType } from '@qamposer/react';
import { clubGateTypes, type Hole } from '@quantum/golf';

/** Two-wire controlled gates the bar can place (control + target). */
const TWO_QUBIT: ReadonlySet<GateType> = new Set<GateType>(['CNOT', 'CY', 'CZ', 'CH', 'CS', 'CT']);
/** Single-wire gates the bar can place (no rotation dials: no club uses one). */
const ONE_QUBIT: ReadonlySet<GateType> = new Set<GateType>(['H', 'X', 'Y', 'Z', 'S', 'T']);

/** One club on the bar. */
export interface BarClub {
  readonly type: GateType;
  /** What the golfer calls it (the library's CNOT is golf's CX). */
  readonly label: string;
  readonly twoQubit: boolean;
}

/** Where a tap puts a gate. */
export type Wires = { readonly qubit: number } | { readonly control: number; readonly target: number };

/** Golf's name for a gate type ('CNOT' → 'CX', every other club as is). */
export function clubLabel(type: GateType): string {
  return type === 'CNOT' ? 'CX' : type;
}

export function isTwoQubitClub(type: GateType): boolean {
  return TWO_QUBIT.has(type);
}

/**
 * The hole's clubs as bar buttons — exactly the palette's set
 * (`clubGateTypes`, #55), in the round's order. A club the bar cannot place
 * (none today) is left out rather than shown dead.
 */
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
 * (mirror of the library's `compactGates`: stable sort by position, then each
 * gate takes the first column after everything already on its span).
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

/** The board with `type` appended at the end of `wires` (see the module doc). */
export function appendGate(
  circuit: Circuit,
  type: GateType,
  wires: Wires,
  id: string = generateGateId(),
): Circuit {
  const end = circuit.gates.reduce((m, g) => Math.max(m, g.position + 1), 0);
  const gate: Gate =
    'qubit' in wires
      ? { id, type, qubit: wires.qubit, position: end }
      : { id, type, control: wires.control, target: wires.target, position: end };
  return { ...circuit, gates: compactGates([...circuit.gates, gate]) };
}

/** The board without gate `id` (re-compacted, like the editor's own delete). */
export function removeGate(circuit: Circuit, id: string): Circuit {
  return { ...circuit, gates: compactGates(circuit.gates.filter((g) => g.id !== id)) };
}

/**
 * The gate Undo takes back: the most recent one the bar placed that is still
 * on the board (`placed` is the bar's history, oldest first); with none of
 * those left (the board was built by dragging, or the bar's gates were deleted
 * in the editor), the board's last gate — the right-most column, and of a
 * column the one listed last. Null for an empty board.
 */
export function undoTarget(circuit: Circuit, placed: readonly string[]): Gate | null {
  for (let i = placed.length - 1; i >= 0; i--) {
    const hit = circuit.gates.find((g) => g.id === placed[i]);
    if (hit) return hit;
  }
  let last: Gate | null = null;
  for (const g of circuit.gates) if (last === null || g.position >= last.position) last = g;
  return last;
}

/** The wires a gate sits on, as the bar describes them. */
export function gateWires(gate: Gate): Wires {
  return gate.control !== undefined && gate.target !== undefined
    ? { control: gate.control, target: gate.target }
    : { qubit: gate.qubit ?? 0 };
}
