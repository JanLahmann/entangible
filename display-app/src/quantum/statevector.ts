/**
 * Tiny 5-qubit statevector simulator for the booth "moment engine".
 *
 * The physical board is fixed at five qubits, so the state space is a flat
 * array of 32 complex amplitudes. This is deliberately dependency-free (a few
 * lines of inline complex arithmetic) — it runs on every stable circuit change
 * purely to classify the state (superposition / Bell / GHZ …), never to drive
 * the on-screen histogram (that stays the composer's `localAdapter`).
 *
 * Convention: little-endian, matching Qiskit — basis index `i` has qubit `q`
 * set when `(i >> q) & 1`. All canonical builders and fidelity comparisons use
 * this same convention, so cross-comparisons are self-consistent.
 */
import type { Circuit, Gate } from '@qamposer/react';

// ---------------------------------------------------------------------------
// Complex arithmetic (inline, no deps)
// ---------------------------------------------------------------------------

export interface Complex {
  readonly re: number;
  readonly im: number;
}

const cx = (re: number, im = 0): Complex => ({ re, im });
const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
const mul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
const conj = (a: Complex): Complex => ({ re: a.re, im: -a.im });
const abs2 = (a: Complex): number => a.re * a.re + a.im * a.im;

// ---------------------------------------------------------------------------
// State space
// ---------------------------------------------------------------------------

export const NUM_QUBITS = 5;
/** Dimension of the state space (2^5 = 32). */
export const DIM = 1 << NUM_QUBITS;

/** A pure state: 32 complex amplitudes. */
export type StateVector = Complex[];

/** The all-zero computational basis state |00000⟩. */
export function zeroState(): StateVector {
  const s: StateVector = new Array(DIM);
  for (let i = 0; i < DIM; i++) s[i] = cx(0);
  s[0] = cx(1);
  return s;
}

// ---------------------------------------------------------------------------
// Gate matrices (2×2, applied in-place) + CNOT
// ---------------------------------------------------------------------------

/** Row-major 2×2 matrix: [m00, m01, m10, m11]. */
type Matrix2 = readonly [Complex, Complex, Complex, Complex];

const R = Math.SQRT1_2;

function gateMatrix(g: Gate): Matrix2 | null {
  switch (g.type) {
    case 'H':
      return [cx(R), cx(R), cx(R), cx(-R)];
    case 'X':
      return [cx(0), cx(1), cx(1), cx(0)];
    case 'Y':
      return [cx(0), cx(0, -1), cx(0, 1), cx(0)];
    case 'Z':
      return [cx(1), cx(0), cx(0), cx(-1)];
    case 'RX': {
      const t = (g.parameter ?? 0) / 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      return [cx(c), cx(0, -s), cx(0, -s), cx(c)];
    }
    case 'RY': {
      const t = (g.parameter ?? 0) / 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      return [cx(c), cx(-s), cx(s), cx(c)];
    }
    case 'RZ': {
      const t = (g.parameter ?? 0) / 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      return [cx(c, -s), cx(0), cx(0), cx(c, s)];
    }
    default:
      // CNOT is handled separately.
      return null;
  }
}

/** Apply a single-qubit 2×2 matrix to qubit `q`, in place. */
function applySingle(state: StateVector, q: number, m: Matrix2): void {
  const bit = 1 << q;
  for (let i = 0; i < DIM; i++) {
    if ((i & bit) === 0) {
      const j = i | bit;
      const a = state[i];
      const b = state[j];
      state[i] = add(mul(m[0], a), mul(m[1], b));
      state[j] = add(mul(m[2], a), mul(m[3], b));
    }
  }
}

/** Apply CNOT(control, target): flip `target` where `control` is set. */
function applyCnot(state: StateVector, control: number, target: number): void {
  const cbit = 1 << control;
  const tbit = 1 << target;
  for (let i = 0; i < DIM; i++) {
    if ((i & cbit) !== 0 && (i & tbit) === 0) {
      const j = i | tbit;
      const tmp = state[i];
      state[i] = state[j];
      state[j] = tmp;
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Compute the 32-amplitude statevector for a (≤5-qubit) circuit. */
export function statevector(circuit: Circuit): StateVector {
  const state = zeroState();
  // Apply gates in circuit (column) order; ties broken stably.
  const gates = [...circuit.gates].sort((a, b) => a.position - b.position);
  for (const g of gates) {
    if (g.type === 'CNOT') {
      if (g.control == null || g.target == null) continue;
      if (g.control >= NUM_QUBITS || g.target >= NUM_QUBITS) continue;
      applyCnot(state, g.control, g.target);
    } else {
      const q = g.qubit;
      if (q == null || q >= NUM_QUBITS) continue;
      const m = gateMatrix(g);
      if (m) applySingle(state, q, m);
    }
  }
  return state;
}

/** Qubits touched by any gate, ascending. */
export function activeQubits(circuit: Circuit): number[] {
  const s = new Set<number>();
  for (const g of circuit.gates) {
    if (g.type === 'CNOT') {
      if (g.control != null) s.add(g.control);
      if (g.target != null) s.add(g.target);
    } else if (g.qubit != null) {
      s.add(g.qubit);
    }
  }
  return [...s].sort((a, b) => a - b);
}

/**
 * State fidelity |⟨reference|state⟩|², invariant to global phase. Both inputs
 * are assumed normalized (they always are here — unitary evolution of |0…0⟩).
 */
export function fidelity(state: StateVector, reference: StateVector): number {
  let re = 0;
  let im = 0;
  for (let i = 0; i < DIM; i++) {
    const p = mul(conj(reference[i]), state[i]);
    re += p.re;
    im += p.im;
  }
  return re * re + im * im;
}

/** Probability that qubit `q` is measured as 1. */
export function probOne(state: StateVector, q: number): number {
  const bit = 1 << q;
  let p = 0;
  for (let i = 0; i < DIM; i++) if ((i & bit) !== 0) p += abs2(state[i]);
  return p;
}

/**
 * Canonical maximally-entangled state (|0…0⟩ + |1…1⟩)/√2 over the given
 * qubits, embedded in the 5-qubit space (all other qubits |0⟩). With two
 * qubits this is a Bell pair; with k ≥ 3 it is GHZ-k.
 */
export function ghzState(qubits: readonly number[]): StateVector {
  const s: StateVector = new Array(DIM);
  for (let i = 0; i < DIM; i++) s[i] = cx(0);
  let ones = 0;
  for (const q of qubits) ones |= 1 << q;
  s[0] = cx(R);
  s[ones] = cx(R);
  return s;
}

/** Canonical Bell pair (|00⟩ + |11⟩)/√2 on `qubits` (embedded in 5 qubits). */
export function bellState(qubits: readonly number[]): StateVector {
  return ghzState(qubits);
}
