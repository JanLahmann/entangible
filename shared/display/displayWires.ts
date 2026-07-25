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
 *   - `minWires` (golf) REPLACES that floor with the hole's own qubit count, so
 *     a 1-qubit hole shows ONE wire — see `displayQubits`.
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
 *
 * `minWires > 0` REPLACES the generic 3-wire floor rather than raising it (#67):
 * golf passes the current hole's qubit count, and the board must then show
 * EXACTLY the hole's wires — a 4-qubit hole shows 4 before any gate lands on q3
 * (the player must see the wires the target needs, not discover them), and a
 * 1-qubit hole shows ONE, not three empty wires two of which are noise. It still
 * grows with actual use (a gate on q2 wins over a 1-qubit hole) and is still
 * capped at the physical `FULL_WIRES`.
 *
 * With the default `minWires = 0` — every non-golf mode — nothing changes: the
 * compact floor of 3 applies as before, and 'all' is always 5.
 */
export function displayQubits(circuit: Circuit, wires: Wires, minWires = 0): number {
  if (wires === 'all') return FULL_WIRES;
  const floor = minWires > 0 ? minWires : MIN_COMPACT_WIRES;
  return Math.min(FULL_WIRES, Math.max(floor, highestUsedRow(circuit) + 1));
}

/**
 * The circuit as SHOWN in the editor: identical gates, display-clamped wire
 * count (`minWires` as in `displayQubits`). Returns the input unchanged when no
 * re-count is needed.
 */
export function displayCircuit(circuit: Circuit, wires: Wires, minWires = 0): Circuit {
  const qubits = displayQubits(circuit, wires, minWires);
  return qubits === circuit.qubits ? circuit : { qubits, gates: circuit.gates };
}
