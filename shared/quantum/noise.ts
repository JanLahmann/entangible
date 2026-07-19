/**
 * In-browser noise model — a full density-matrix simulator for the fixed
 * 5-qubit booth circuit (see docs/design.md "In-browser noise model").
 *
 * The state is a 32×32 density matrix ρ (1024 complex numbers ≈ 16 KB) stored
 * in a Float64Array with interleaved real/imag parts: entry (r, c) lives at
 * flat index `2*(r*DIM + c)` (re) and `+1` (im). At ≤5 qubits this "honest"
 * simulation is cheap and deterministic (no sampling jitter), and every channel
 * is an exact Kraus map.
 *
 * Channel schedule per moment (a moment = one circuit column, grouped by the
 * gate `position` exactly as statevector.ts orders them):
 *   (a) for each gate in the moment: apply its unitary (ρ → UρU†), then a
 *       depolarizing channel on its participating qubits (p1 for 1-qubit gates,
 *       p2 for 2-qubit gates);
 *   (b) after the moment's gates: apply amplitude damping (γ1) then pure
 *       dephasing (γφ) to EVERY qubit, including idle ones — a deep circuit
 *       decays even where nothing happens.
 * After all moments, readout confusion is applied classically to the diagonal
 * probability vector (per-qubit symmetric bit-flip).
 *
 * Gate unitaries are imported from statevector.ts (single source — no drift).
 * The `noise: 'off'` path (all params zero) reproduces statevector.ts
 * probabilities exactly (parity test).
 *
 * Dephasing convention: the pure-dephasing channel is ρ → (1−λ)ρ + λ·ZρZ, which
 * scales every off-diagonal by (1−2λ). We parametrize by the per-moment
 * coherence loss γφ (off-diagonals decay by a factor (1−γφ)), so λ = γφ/2. The
 * fixture generator (tools/gen_noise_fixtures.py) uses the SAME convention.
 */
import type { Circuit, Gate } from '@qamposer/react';
import type { Complex } from './statevector';
import { DIM, NUM_QUBITS, gateUnitary } from './statevector';
import presets from './noisePresets.json';

// ---------------------------------------------------------------------------
// Parameters & presets
// ---------------------------------------------------------------------------

/**
 * Noise strengths. Scalar fields are device-wide; the per-qubit fields accept
 * either a scalar (applied to every wire) or a length-`NUM_QUBITS` array
 * (index i → wire i).
 */
export interface NoiseParams {
  /** 1-qubit depolarizing probability (after each 1-qubit gate). */
  readonly p1: number;
  /** 2-qubit depolarizing probability (after each CNOT). */
  readonly p2: number;
  /** Per-moment amplitude-damping γ1 (scalar or per-qubit). */
  readonly gamma1: number | readonly number[];
  /** Per-moment pure-dephasing γφ (scalar or per-qubit). */
  readonly gammaPhi: number | readonly number[];
  /** Symmetric readout flip probability (scalar or per-qubit). */
  readonly readout: number | readonly number[];
}

export type NoisePreset = 'off' | 'today' | 'early';

const OFF: NoiseParams = { p1: 0, p2: 0, gamma1: 0, gammaPhi: 0, readout: 0 };

/** Resolve a named preset to concrete parameters (reads noisePresets.json). */
export function resolvePreset(preset: NoisePreset): NoiseParams {
  if (preset === 'off') return OFF;
  const p = presets[preset];
  return {
    p1: p.p1,
    p2: p.p2,
    gamma1: p.gamma1,
    gammaPhi: p.gammaPhi,
    readout: p.readout,
  };
}

const at = (param: number | readonly number[], q: number): number =>
  typeof param === 'number' ? param : param[q];

// ---------------------------------------------------------------------------
// Complex matrix kernel over the interleaved-Float64 density matrix
// ---------------------------------------------------------------------------

/** A small dense operator on a subset of qubits, in flat re/im form. */
interface Op {
  /** Row-major real parts, length (2^k)². */
  readonly re: Float64Array;
  /** Row-major imag parts, length (2^k)². */
  readonly im: Float64Array;
  /** Dimension 2^k. */
  readonly m: number;
  /** Qubits acted on; qubits[0] is the most-significant local bit. */
  readonly qs: readonly number[];
}

function opFromComplex(mat: readonly Complex[], qs: readonly number[]): Op {
  const m = 1 << qs.length;
  const re = new Float64Array(m * m);
  const im = new Float64Array(m * m);
  for (let i = 0; i < mat.length; i++) {
    re[i] = mat[i].re;
    im[i] = mat[i].im;
  }
  return { re, im, m, qs };
}

/** Global bitmask of a local index l spread onto qubits qs (qs[0] = MSB). */
function spreadBits(l: number, qs: readonly number[]): number {
  let s = 0;
  const k = qs.length;
  for (let j = 0; j < k; j++) if ((l >> (k - 1 - j)) & 1) s |= 1 << qs[j];
  return s;
}

/**
 * Apply operator (op ⊗ I) to ρ along one axis, in place.
 *   axis 'row': ρ ← M·ρ  (M mixes the participating bits of the ROW index)
 *   axis 'col': ρ ← ρ·M  (M mixes the participating bits of the COLUMN index)
 * `conjM` conjugates the matrix element-wise (used to realize ρ·M†: the entry
 * of M† contracted against column b to produce column a is conj(M[a,b])).
 */
function applyAlong(rho: Float64Array, op: Op, axis: 'row' | 'col', conjM: boolean): void {
  const { re, im, m, qs } = op;
  let occupied = 0;
  for (const q of qs) occupied |= 1 << q;
  const spread = new Array<number>(m);
  for (let l = 0; l < m; l++) spread[l] = spreadBits(l, qs);
  const vre = new Float64Array(m);
  const vim = new Float64Array(m);
  const wre = new Float64Array(m);
  const wim = new Float64Array(m);
  for (let other = 0; other < DIM; other++) {
    for (let rest = 0; rest < DIM; rest++) {
      if (rest & occupied) continue;
      // gather the m participating amplitudes of this line
      for (let l = 0; l < m; l++) {
        const g = rest | spread[l];
        const flat = axis === 'row' ? 2 * (g * DIM + other) : 2 * (other * DIM + g);
        vre[l] = rho[flat];
        vim[l] = rho[flat + 1];
      }
      // w = M·v, or (conjM) w[a] = Σ_b conj(M[a,b])·v[b] to realize ρ·M†.
      for (let a = 0; a < m; a++) {
        let sre = 0;
        let sim = 0;
        for (let b = 0; b < m; b++) {
          const idx = a * m + b;
          const mr = re[idx];
          const mi = conjM ? -im[idx] : im[idx];
          sre += mr * vre[b] - mi * vim[b];
          sim += mr * vim[b] + mi * vre[b];
        }
        wre[a] = sre;
        wim[a] = sim;
      }
      // scatter back
      for (let l = 0; l < m; l++) {
        const g = rest | spread[l];
        const flat = axis === 'row' ? 2 * (g * DIM + other) : 2 * (other * DIM + g);
        rho[flat] = wre[l];
        rho[flat + 1] = wim[l];
      }
    }
  }
}

/** ρ ← K ρ K† for a single operator (in place). */
function conjugate(rho: Float64Array, op: Op): void {
  applyAlong(rho, op, 'row', false); // ρ ← Kρ
  applyAlong(rho, op, 'col', true); //  ρ ← (Kρ)K†
}

/** ρ ← Σ_m K_m ρ K_m† for a Kraus channel (in place). */
function krausChannel(rho: Float64Array, ops: readonly Op[]): void {
  const snapshot = rho.slice();
  const acc = new Float64Array(rho.length);
  const tmp = new Float64Array(rho.length);
  for (const op of ops) {
    tmp.set(snapshot);
    conjugate(tmp, op);
    for (let i = 0; i < acc.length; i++) acc[i] += tmp[i];
  }
  rho.set(acc);
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

// Single-qubit Pauli operators (flat re/im, 2×2) for the depolarizing sum.
const PAULI: readonly { re: Float64Array; im: Float64Array }[] = [
  { re: Float64Array.from([1, 0, 0, 1]), im: Float64Array.from([0, 0, 0, 0]) }, // I
  { re: Float64Array.from([0, 1, 1, 0]), im: Float64Array.from([0, 0, 0, 0]) }, // X
  { re: Float64Array.from([0, 0, 0, 0]), im: Float64Array.from([0, -1, 1, 0]) }, // Y
  { re: Float64Array.from([1, 0, 0, -1]), im: Float64Array.from([0, 0, 0, 0]) }, // Z
];

const pauliOp = (d: number, q: number): Op => ({
  re: PAULI[d].re,
  im: PAULI[d].im,
  m: 2,
  qs: [q],
});

/**
 * Depolarizing channel on `qs`: ρ → (1−p)ρ + p/(4^k−1)·Σ_{P≠I} PρP†. Built by
 * conjugating with the 4^k−1 non-identity Pauli strings (each a tensor of
 * single-qubit Paulis, applied factor by factor — the factors commute as they
 * act on different qubits).
 */
function depolarizing(rho: Float64Array, p: number, qs: readonly number[]): void {
  if (p === 0) return;
  const k = qs.length;
  const numStrings = 1 << (2 * k); // 4^k
  const wOther = p / (numStrings - 1);
  const snapshot = rho.slice();
  const acc = new Float64Array(rho.length);
  const tmp = new Float64Array(rho.length);
  // identity Pauli string
  for (let i = 0; i < acc.length; i++) acc[i] = (1 - p) * snapshot[i];
  for (let s = 1; s < numStrings; s++) {
    tmp.set(snapshot);
    for (let j = 0; j < k; j++) {
      const d = (s >> (2 * j)) & 3; // 0=I,1=X,2=Y,3=Z on qs[j]
      if (d !== 0) conjugate(tmp, pauliOp(d, qs[j]));
    }
    for (let i = 0; i < acc.length; i++) acc[i] += wOther * tmp[i];
  }
  rho.set(acc);
}

/** Amplitude damping on qubit q: K0=[[1,0],[0,√(1−γ)]], K1=[[0,√γ],[0,0]]. */
function amplitudeDamping(rho: Float64Array, gamma: number, q: number): void {
  if (gamma === 0) return;
  const s = Math.sqrt(1 - gamma);
  const r = Math.sqrt(gamma);
  const k0: Op = { re: Float64Array.from([1, 0, 0, s]), im: new Float64Array(4), m: 2, qs: [q] };
  const k1: Op = { re: Float64Array.from([0, r, 0, 0]), im: new Float64Array(4), m: 2, qs: [q] };
  krausChannel(rho, [k0, k1]);
}

/** Pure dephasing on qubit q: ρ → (1−λ)ρ + λ·ZρZ with λ = γφ/2. */
function dephasing(rho: Float64Array, gammaPhi: number, q: number): void {
  if (gammaPhi === 0) return;
  const lambda = gammaPhi / 2;
  const k0: Op = {
    re: Float64Array.from([Math.sqrt(1 - lambda), 0, 0, Math.sqrt(1 - lambda)]),
    im: new Float64Array(4),
    m: 2,
    qs: [q],
  };
  const sl = Math.sqrt(lambda);
  const k1: Op = { re: Float64Array.from([sl, 0, 0, -sl]), im: new Float64Array(4), m: 2, qs: [q] };
  krausChannel(rho, [k0, k1]);
}

// ---------------------------------------------------------------------------
// Moment grouping & simulation
// ---------------------------------------------------------------------------

/** Gates grouped by column `position`, ascending — the moment schedule. */
function moments(circuit: Circuit): Gate[][] {
  const byPos = new Map<number, Gate[]>();
  for (const g of circuit.gates) {
    const list = byPos.get(g.position);
    if (list) list.push(g);
    else byPos.set(g.position, [g]);
  }
  return [...byPos.keys()].sort((a, b) => a - b).map((pos) => byPos.get(pos)!);
}

/** The |0…0⟩ density matrix. */
function zeroDensity(): Float64Array {
  const rho = new Float64Array(2 * DIM * DIM);
  rho[0] = 1; // ρ[0,0] = 1
  return rho;
}

/**
 * Noisy measurement probabilities for a (≤5-qubit) circuit under `params`. The
 * returned length-32 vector uses the SAME little-endian basis-state ordering as
 * statevector.ts (basis index i has qubit q set when (i >> q) & 1).
 */
export function noisyProbabilities(circuit: Circuit, params: NoiseParams): number[] {
  const rho = zeroDensity();

  for (const moment of moments(circuit)) {
    // (a) unitary + depolarizing per gate
    for (const g of moment) {
      const u = gateUnitary(g);
      if (!u) continue;
      conjugate(rho, opFromComplex(u.matrix, u.qubits));
      depolarizing(rho, u.qubits.length === 1 ? params.p1 : params.p2, u.qubits);
    }
    // (b) amplitude damping then dephasing on every qubit (incl. idle)
    for (let q = 0; q < NUM_QUBITS; q++) {
      amplitudeDamping(rho, at(params.gamma1, q), q);
      dephasing(rho, at(params.gammaPhi, q), q);
    }
  }

  // Diagonal → probability vector.
  const probs = new Array<number>(DIM);
  for (let i = 0; i < DIM; i++) probs[i] = rho[2 * (i * DIM + i)];

  // Readout confusion: per-qubit symmetric flip, applied classically. Composing
  // the independent per-qubit binary-symmetric channels yields the full
  // tensor-product confusion matrix.
  for (let q = 0; q < NUM_QUBITS; q++) {
    const r = at(params.readout, q);
    if (r === 0) continue;
    const bit = 1 << q;
    const src = probs.slice();
    for (let i = 0; i < DIM; i++) probs[i] = (1 - r) * src[i] + r * src[i ^ bit];
  }

  return probs;
}
