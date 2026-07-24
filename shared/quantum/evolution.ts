/**
 * Per-column state EVOLUTION — the snapshots that drive the golf animation
 * (task #53). A circuit's gates are laid out in COLUMNS (the composer's
 * `position`); this exposes the statevector after each occupied column so the
 * golf Q-sphere / Bloch views can step the state through the circuit instead of
 * only showing the final state.
 *
 * It reimplements NO gate math: each snapshot is `statevector()` of a prefix
 * circuit (all gates in columns up to and including that one). `statevector`
 * already sorts by `position` and applies in column order, so a by-position
 * prefix is exactly the cumulative state after that column — one source of
 * truth for the simulation. The snapshots are the same convention (little-endian
 * 32-amplitude StateVector) as everything else in the engine.
 */
import type { Circuit } from '@qamposer/react';
import { statevector, zeroState, type StateVector } from './statevector';

/** Distinct gate columns (positions) that actually carry a gate, ascending. */
export function occupiedColumns(circuit: Circuit): number[] {
  const cols = new Set<number>();
  for (const g of circuit.gates) cols.add(g.position);
  return [...cols].sort((a, b) => a - b);
}

/**
 * Statevector snapshots stepping through the circuit column by column:
 *   step 0 = the initial |0…0⟩,
 *   step i = the cumulative state after the i-th occupied column.
 * The final entry always equals `statevector(circuit)` (the live golf state), so
 * an animation that lands on the last step lands exactly on the current state.
 * Length is `occupiedColumns(circuit).length + 1` (≥ 1: an empty board yields
 * just the initial state).
 */
export function evolutionSteps(circuit: Circuit): StateVector[] {
  const cols = occupiedColumns(circuit);
  const steps: StateVector[] = [zeroState()];
  for (const col of cols) {
    const prefix: Circuit = {
      ...circuit,
      gates: circuit.gates.filter((g) => g.position <= col),
    };
    steps.push(statevector(prefix));
  }
  return steps;
}
