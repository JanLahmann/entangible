/**
 * Display-only wire-count transform shared by the booth and Pocket editors
 * (docs/booth-ux.md "Dynamic layout" → wires; docs/pocket.md "Qubit count").
 *
 * The physical table and the recognized circuit are ALWAYS five qubits — this
 * never touches gate data, detection, the statevector, moments, histogram or
 * QASM (which all keep the 5-qubit truth). It only decides how many wires the
 * controlled `CircuitEditor` draws, and how many rows the booth histogram
 * spans:
 *
 *   - 'all'     → always the full 5 wires.
 *   - 'compact' → the smallest count that still covers every used row, floored
 *                 at 3. Auto-grows to 4/5 the moment a tile lands on q3/q4 and
 *                 contracts again when it is removed; on Pocket the tile
 *                 stabilizer keeps that from flickering.
 *
 * `displayCircuit` returns the SAME object when the wire count already matches,
 * so React memoisation and the editor's identity checks stay stable.
 *
 * SC1: one canonical implementation (was duplicated as a booth-local port and a
 * pocket-local file); both apps import it via the `@shared` alias.
 */
import type { Circuit } from '@qamposer/react';
import type { Wires } from './wires';

/** Fewest wires 'compact' will ever show. */
export const MIN_COMPACT_WIRES = 3;
/** The physical wire count — the ceiling for the display and 'all's fixed value. */
export const FULL_WIRES = 5;

/** Highest qubit row touched by any gate, or -1 for an empty circuit. */
export function highestUsedRow(circuit: Circuit): number {
  let hi = -1;
  for (const g of circuit.gates) {
    if (g.qubit != null && g.qubit > hi) hi = g.qubit;
    if (g.control != null && g.control > hi) hi = g.control;
    if (g.target != null && g.target > hi) hi = g.target;
  }
  return hi;
}

/**
 * Number of wires to DISPLAY for `circuit` under the given `wires` setting.
 * `minWires` raises the compact floor: golf passes the current hole's qubit
 * count so e.g. a 4-qubit hole shows 4 wires BEFORE any gate lands on q3 —
 * the player must see the wires the target needs, not discover them.
 */
export function displayQubits(circuit: Circuit, wires: Wires, minWires = 0): number {
  if (wires === 'all') return FULL_WIRES;
  return Math.min(
    FULL_WIRES,
    Math.max(MIN_COMPACT_WIRES, minWires, highestUsedRow(circuit) + 1),
  );
}

/**
 * The circuit as SHOWN in the editor: identical gates, display-clamped wire
 * count. Returns the input unchanged when no re-count is needed.
 */
export function displayCircuit(circuit: Circuit, wires: Wires, minWires = 0): Circuit {
  const qubits = displayQubits(circuit, wires, minWires);
  return qubits === circuit.qubits ? circuit : { qubits, gates: circuit.gates };
}
