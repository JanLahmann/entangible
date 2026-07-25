/**
 * Standard Q-sphere — pure geometry + orthographic projection (Qiskit-style).
 *
 * `layout(n)` places the 2^n computational basis states on the unit sphere the
 * way Qiskit's `plot_state_qsphere` does:
 *   - |0…0⟩ at the north pole, |1…1⟩ at the south pole;
 *   - states grouped by Hamming weight `w` onto latitude rings at height
 *     `z = 1 - 2w/n` (north pole `z = +1`, south `z = -1`);
 *   - within each ring, states sorted ascending by binary value and spread
 *     evenly in longitude (`φ_j = 2π·j / count`, first node at `φ = 0`).
 * The pole axis is the model `z` axis (screen-vertical at rest).
 *
 * `viewMatrix(yaw, pitch)` builds a rotatable camera: `yaw` spins the sphere
 * about its pole axis (a globe spin — poles stay put), `pitch` tilts it about
 * the screen-horizontal axis. `project()` applies that matrix and drops to an
 * orthographic screen frame: `screenX = v.x`, `screenY = -v.z` (SVG y-down, so
 * the north pole lands at the top), and `depth = v.y` (camera on +Y; larger
 * depth = nearer the viewer). Depth is what a painter's-algorithm renderer sorts
 * on and dims the far hemisphere by.
 *
 * `basisVisuals()` adds the amplitude-derived visuals per the IBM Quantum
 * Composer "Q-sphere view" convention
 * (https://quantum.cloud.ibm.com/docs/guides/composer): each node's radius is
 * proportional to the measurement PROBABILITY p_k = |amp_k|², and its color is
 * the phase RELATIVE to a reference amplitude (the first populated basis state
 * in index order — the ground state whenever it is populated), φ_k =
 * arg(amp_k) − arg(amp_ref).
 */

export const DEFAULT_QUBITS = 5;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A static basis-state node on the unit sphere (no amplitude info). */
export interface QNode {
  /** Basis index 0..2^n-1. */
  readonly index: number;
  /** Hamming weight (ring). */
  readonly weight: number;
  /** Unit-sphere position (model space; z is the pole axis). */
  readonly pos: Vec3;
}

/** A node projected to the orthographic screen frame. */
export interface Projected {
  readonly index: number;
  readonly weight: number;
  /** Screen x in model units (range roughly [-1, 1]). */
  readonly x: number;
  /** Screen y in model units, y-down (north pole ≈ -1). */
  readonly y: number;
  /** Depth toward the viewer (larger = nearer). */
  readonly depth: number;
}

/** Row-major 3×3 matrix. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

function popcount(n: number): number {
  let c = 0;
  for (let x = n; x !== 0; x >>= 1) c += x & 1;
  return c;
}

/**
 * Static Qiskit-style node layout for `n` qubits (2^n nodes on the unit
 * sphere). Deterministic — no amplitude dependence.
 */
export function layout(n: number): QNode[] {
  const dim = 1 << n;

  // Group basis indices by Hamming weight (ascending index within each ring).
  const rings: number[][] = Array.from({ length: n + 1 }, () => []);
  for (let i = 0; i < dim; i++) rings[popcount(i)].push(i);

  const nodes: QNode[] = [];
  for (let w = 0; w <= n; w++) {
    const ring = rings[w];
    const count = ring.length;
    const z = n === 0 ? 1 : 1 - (2 * w) / n;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    for (let j = 0; j < count; j++) {
      const phi = count === 1 ? 0 : (2 * Math.PI * j) / count;
      nodes.push({
        index: ring[j],
        weight: w,
        pos: { x: r * Math.cos(phi), y: r * Math.sin(phi), z },
      });
    }
  }
  return nodes;
}

/** Radii of the concentric weight rings (unit sphere latitudes, w = 1..n-1). */
export function ringLatitudes(n: number): Array<{ z: number; r: number }> {
  const out: Array<{ z: number; r: number }> = [];
  for (let w = 1; w < n; w++) {
    const z = 1 - (2 * w) / n;
    out.push({ z, r: Math.sqrt(Math.max(0, 1 - z * z)) });
  }
  return out;
}

/**
 * Camera matrix `Rx(pitch) · Rz(yaw)`: yaw spins about the pole axis (z), pitch
 * tilts about the (post-yaw) screen-horizontal axis (x).
 */
export function viewMatrix(yaw: number, pitch: number): Mat3 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Rz(yaw):        Rx(pitch) · Rz(yaw):
  //  [ cy -sy 0 ]    row0 = [ cy, -sy, 0 ]
  //  [ sy  cy 0 ]    row1 = [ cp*sy, cp*cy, -sp ]
  //  [ 0   0  1 ]    row2 = [ sp*sy, sp*cy,  cp ]
  return [cy, -sy, 0, cp * sy, cp * cy, -sp, sp * sy, sp * cy, cp];
}

/** Apply a row-major Mat3 to a vector. */
export function applyMatrix(m: Mat3, p: Vec3): Vec3 {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2] * p.z,
    y: m[3] * p.x + m[4] * p.y + m[5] * p.z,
    z: m[6] * p.x + m[7] * p.y + m[8] * p.z,
  };
}

/** Project a single model point to the orthographic screen frame. */
export function projectPoint(p: Vec3, yaw: number, pitch: number): { x: number; y: number; depth: number } {
  const v = applyMatrix(viewMatrix(yaw, pitch), p);
  return { x: v.x, y: -v.z, depth: v.y };
}

/**
 * Project static nodes through the camera. Returned in the same order; callers
 * depth-sort (painter's algorithm) for rendering.
 */
export function project(nodes: readonly QNode[], yaw: number, pitch: number): Projected[] {
  const m = viewMatrix(yaw, pitch);
  return nodes.map((n) => {
    const v = applyMatrix(m, n.pos);
    return { index: n.index, weight: n.weight, x: v.x, y: -v.z, depth: v.y };
  });
}

/**
 * Inverse of `project`'s convention: the camera angles that turn a model
 * direction `d` toward the viewer. `projectPoint(d, ...faceOrientation(d))`
 * lands at screen (0, 0) with maximal depth.
 *
 * Solving `Rx(pitch)·Rz(yaw)·d = (0, 1, 0)` (the +y camera axis):
 *   screenX = 0  ⇒  cos(yaw + atan2(d.y, d.x)) = 0  ⇒  yaw = π/2 − atan2(d.y, d.x)
 *   screenY = 0  ⇒  pitch = atan2(−d.z, hypot(d.x, d.y))
 * The pitch is clamped to the interactive range, so a pole direction is
 * approached (±80°) rather than reached — matching what a drag can do.
 */
export function faceOrientation(d: Vec3): { yaw: number; pitch: number } {
  return {
    yaw: Math.PI / 2 - Math.atan2(d.y, d.x),
    pitch: clampPitch(Math.atan2(-d.z, Math.hypot(d.x, d.y))),
  };
}

/** Clamp a pitch angle to the interactive range (±80°, per the golf spec). */
export const MAX_PITCH = (80 * Math.PI) / 180;
export function clampPitch(pitch: number): number {
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
}

// ---------------------------------------------------------------------------
// Amplitude-derived visuals (probability radius + reference-relative phase)
// ---------------------------------------------------------------------------

/** Below this probability a node is treated as unpopulated (faint dot). */
export const PROB_EPS = 1e-3;

export interface BasisVisual {
  readonly index: number;
  /** Measurement probability p_k = |amp_k|². */
  readonly prob: number;
  /** Phase relative to the reference amplitude, in degrees [0, 360). */
  readonly phaseDeg: number;
  /** True when p_k < PROB_EPS (rendered as a tiny faint point). */
  readonly faint: boolean;
}

type Amp = { readonly re: number; readonly im: number };

/**
 * Per-basis-state visuals for the first `count` amplitudes (default: all).
 * Probability = |amp|²; phase = arg(amp) − arg(amp_ref) where `ref` is the first
 * amplitude with p ≥ PROB_EPS in index order (Composer convention). When no
 * amplitude is populated every phase is 0.
 */
export function basisVisuals(amps: ReadonlyArray<Amp>, count = amps.length): BasisVisual[] {
  // Reference phase: the first populated basis state in index order.
  let refPhase = 0;
  for (let i = 0; i < count; i++) {
    const a = amps[i];
    if (a && a.re * a.re + a.im * a.im >= PROB_EPS) {
      refPhase = Math.atan2(a.im, a.re);
      break;
    }
  }
  const out: BasisVisual[] = [];
  for (let i = 0; i < count; i++) {
    const a = amps[i] ?? { re: 0, im: 0 };
    const prob = a.re * a.re + a.im * a.im;
    let phaseDeg = ((Math.atan2(a.im, a.re) - refPhase) * 180) / Math.PI;
    phaseDeg = ((phaseDeg % 360) + 360) % 360;
    out.push({ index: i, prob, phaseDeg, faint: prob < PROB_EPS });
  }
  return out;
}
