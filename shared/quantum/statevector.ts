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
export type Matrix2 = readonly [Complex, Complex, Complex, Complex];

const R = Math.SQRT1_2;

/**
 * The 2×2 unitary of a single-qubit gate (row-major), or `null` for CNOT
 * (handled separately). Exported as the single source of gate definitions so
 * the density-matrix noise simulator cannot drift from this one.
 */
export function singleQubitUnitary(g: Gate): Matrix2 | null {
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
// Generic controlled-U (control ID 14 as a generic modifier — see task #51 /
// docs/marker-ids.md). A column with one single-qubit gate + one ● is its
// controlled version (X→CX, Y→CY, Z→CZ, H→CH, S→CS, T→CT); two ● + X is CCX.
// One code path applies any controlled gate: a control MASK on the basis
// indices gates the target's 2×2 unitary. CX stays on the dedicated `applyCnot`
// (a pure swap) so the legacy Bell/GHZ path is byte-for-byte unchanged.
// ---------------------------------------------------------------------------

/**
 * The 2×2 target unitary of a controlled gate `type` (the U that acts on the
 * target when every control is |1⟩), or `null` if `type` is not a controlled
 * gate. CS/CT are the true controlled-PHASE gates diag(1,i)/diag(1,e^{iπ/4})
 * (matching the QASM cu1(π/2)/cu1(π/4) emission) — NOT controlled-RZ, whose
 * control-conditional global phase would differ.
 */
export function controlledTargetOp(type: string): Matrix2 | null {
  switch (type) {
    case 'CNOT':
    case 'CX':
    case 'CCX':
      return [cx(0), cx(1), cx(1), cx(0)]; // X
    case 'CY':
      return [cx(0), cx(0, -1), cx(0, 1), cx(0)]; // Y
    case 'CZ':
      return [cx(1), cx(0), cx(0), cx(-1)]; // Z
    case 'CH':
      return [cx(R), cx(R), cx(R), cx(-R)]; // H
    case 'CS':
      return [cx(1), cx(0), cx(0), cx(0, 1)]; // S = diag(1, i)
    case 'CT':
      return [cx(1), cx(0), cx(0), cx(R, R)]; // T = diag(1, e^{iπ/4})
    default:
      return null;
  }
}

/** The control rows of a (possibly multi-control) gate, or `null` if malformed. */
function controlsOf(g: Gate): number[] | null {
  const t = g.type as string;
  if (t === 'CCX') {
    const c2 = (g as { control2?: number }).control2;
    if (g.control == null || c2 == null) return null;
    return [g.control, c2];
  }
  if (g.control == null) return null;
  return [g.control];
}

/**
 * Apply a controlled 2×2 unitary `m` to `target` gated on all `controls` being
 * |1⟩, in place. Generic over any number of controls (CX/…/CT: one; CCX: two).
 */
function applyControlled(
  state: StateVector,
  controls: readonly number[],
  target: number,
  m: Matrix2,
): void {
  const tbit = 1 << target;
  let cmask = 0;
  for (const c of controls) cmask |= 1 << c;
  for (let i = 0; i < DIM; i++) {
    if ((i & tbit) === 0 && (i & cmask) === cmask) {
      const j = i | tbit;
      const a = state[i];
      const b = state[j];
      state[i] = add(mul(m[0], a), mul(m[1], b));
      state[j] = add(mul(m[2], a), mul(m[3], b));
    }
  }
}

// ---------------------------------------------------------------------------
// Exported gate unitaries (single source for both simulators)
// ---------------------------------------------------------------------------

/**
 * A gate as a dense unitary plus the qubits it acts on. `matrix` is row-major
 * over the local 2^k-dimensional subspace, whose basis index orders the given
 * `qubits` most-significant-first: for CNOT `qubits = [control, target]` and
 * local index `(controlBit << 1) | targetBit`.
 *
 * This is the ONE place gate matrices are defined; the noise simulator consumes
 * it so the two engines can never disagree (guarded by the parity test).
 */
export interface GateUnitary {
  readonly matrix: readonly Complex[];
  readonly qubits: readonly number[];
}

const CNOT_MATRIX: readonly Complex[] = [
  cx(1), cx(0), cx(0), cx(0),
  cx(0), cx(1), cx(0), cx(0),
  cx(0), cx(0), cx(0), cx(1),
  cx(0), cx(0), cx(1), cx(0),
];

/**
 * The dense 2^k×2^k unitary of a controlled gate: identity everywhere except
 * the target's 2×2 unitary `u` applied on the single block where all
 * `numControls` controls are |1⟩. The `qubits` order (controls first, then
 * target) puts the controls as the most-significant local bits — so this block
 * is the last two local indices — matching `gateUnitary`'s qubit ordering and
 * the density simulator's most-significant-first convention. For CX this
 * reproduces `CNOT_MATRIX` exactly (verified by the parity test).
 */
function controlledDense(numControls: number, u: Matrix2): Complex[] {
  const dim = 1 << (numControls + 1);
  const mat: Complex[] = new Array(dim * dim);
  for (let i = 0; i < dim * dim; i++) mat[i] = cx(0);
  const base = ((1 << numControls) - 1) << 1; // all controls set, target = 0
  for (let i = 0; i < dim; i++) {
    if (i !== base && i !== base + 1) mat[i * dim + i] = cx(1);
  }
  mat[base * dim + base] = u[0];
  mat[base * dim + base + 1] = u[1];
  mat[(base + 1) * dim + base] = u[2];
  mat[(base + 1) * dim + base + 1] = u[3];
  return mat;
}

/** Dense unitary of a gate, or `null` if it is malformed / out of range. */
export function gateUnitary(g: Gate): GateUnitary | null {
  const t = g.type as string;
  if (t === 'CNOT' || t === 'CX') {
    if (g.control == null || g.target == null) return null;
    if (g.control >= NUM_QUBITS || g.target >= NUM_QUBITS) return null;
    return { matrix: CNOT_MATRIX, qubits: [g.control, g.target] };
  }
  if (t === 'CCX') {
    const controls = controlsOf(g);
    if (controls == null || g.target == null) return null;
    if (controls.some((c) => c >= NUM_QUBITS) || g.target >= NUM_QUBITS) return null;
    const u = controlledTargetOp(t);
    if (!u) return null;
    return { matrix: controlledDense(2, u), qubits: [...controls, g.target] };
  }
  const cu = controlledTargetOp(t);
  if (cu) {
    if (g.control == null || g.target == null) return null;
    if (g.control >= NUM_QUBITS || g.target >= NUM_QUBITS) return null;
    return { matrix: controlledDense(1, cu), qubits: [g.control, g.target] };
  }
  const q = g.qubit;
  if (q == null || q >= NUM_QUBITS) return null;
  const m = singleQubitUnitary(g);
  if (!m) return null;
  return { matrix: m, qubits: [q] };
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
    const t = g.type as string;
    if (t === 'CNOT' || t === 'CX') {
      if (g.control == null || g.target == null) continue;
      if (g.control >= NUM_QUBITS || g.target >= NUM_QUBITS) continue;
      applyCnot(state, g.control, g.target);
    } else {
      const cu = controlledTargetOp(t);
      if (cu) {
        const controls = controlsOf(g);
        if (controls == null || g.target == null) continue;
        if (controls.some((c) => c >= NUM_QUBITS) || g.target >= NUM_QUBITS) continue;
        applyControlled(state, controls, g.target, cu);
        continue;
      }
      const q = g.qubit;
      if (q == null || q >= NUM_QUBITS) continue;
      const m = singleQubitUnitary(g);
      if (m) applySingle(state, q, m);
    }
  }
  return state;
}

/** Qubits touched by any gate, ascending. */
export function activeQubits(circuit: Circuit): number[] {
  const s = new Set<number>();
  for (const g of circuit.gates) {
    // Controlled gates (CNOT/CX/CY/CZ/CH/CS/CT/CCX) carry control(+control2)+target;
    // single-qubit gates carry qubit. Add whichever wires the gate touches.
    if (g.control != null || g.target != null) {
      if (g.control != null) s.add(g.control);
      const c2 = (g as { control2?: number }).control2;
      if (c2 != null) s.add(c2);
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
