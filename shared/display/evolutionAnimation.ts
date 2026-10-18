/**
 * Pure interpolation helpers for the golf state-evolution animation (task #53).
 *
 * The evolution engine (`@quantum/evolution`) gives a sequence of statevector
 * snapshots — one per circuit column. These helpers interpolate BETWEEN two
 * consecutive snapshots so the shared views can animate the transition without
 * being edited: both `EvolvingState` skins feed the interpolated result into the
 * existing `QSphereView` / `BlochView` via their `statevector` prop.
 *
 *   - Q-sphere: interpolate each basis amplitude by PROBABILITY (radius) and
 *     PHASE (hue) independently — `interpolateStatevector`. Probability lerps
 *     (nodes appearing from zero grow in); phase follows the shorter arc. At
 *     t = 0 / t = 1 the reconstruction is exact, so the resting state stays
 *     convention-correct (radius = probability, phase vs the reference).
 *   - Bloch: slerp the reduced Bloch VECTOR along the shorter arc + lerp its
 *     length (`slerpBloch`), then realise that vector as a statevector via a
 *     one-ancilla purification (`blochToStatevector`) so `BlochView` shows it
 *     exactly (forced onto the chosen qubit).
 *
 * All functions are pure; the rAF driver lives in the component.
 */
import { NUM_QUBITS, DIM, type Complex, type StateVector } from '@quantum/statevector';
import type { BlochVector } from '@quantum/bloch';

/** Below this a probability / vector length is treated as zero. */
const EPS = 1e-9;

/** Cubic ease-in-out — a gentle accelerate/decelerate for each step segment. */
export function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/** Interpolate an angle (radians) along the SHORTER arc. */
export function lerpAngleShort(a: number, b: number, t: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

const mag = (c: Complex): number => Math.hypot(c.re, c.im);

/**
 * Interpolate two statevectors amplitude-by-amplitude for the Q-sphere. Radius
 * (probability p = |amp|²) lerps; phase follows the shorter arc. A node with
 * ~zero magnitude at one end borrows the other end's phase so it grows in at its
 * final hue rather than sweeping colour. Exact at t = 0 (→ a) and t = 1 (→ b).
 */
export function interpolateStatevector(a: StateVector, b: StateVector, t: number): StateVector {
  const out: StateVector = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const ma = mag(a[i]);
    const mb = mag(b[i]);
    const pa = ma * ma;
    const pb = mb * mb;
    const p = pa + (pb - pa) * t;
    const r = p <= 0 ? 0 : Math.sqrt(p);
    const pha = Math.atan2(a[i].im, a[i].re);
    const phb = Math.atan2(b[i].im, b[i].re);
    let phase: number;
    if (ma < EPS && mb < EPS) phase = 0;
    else if (ma < EPS) phase = phb;
    else if (mb < EPS) phase = pha;
    else phase = lerpAngleShort(pha, phb, t);
    out[i] = { re: r * Math.cos(phase), im: r * Math.sin(phase) };
  }
  return out;
}

const vlen = (v: BlochVector): number => Math.hypot(v.x, v.y, v.z);

/**
 * Slerp two Bloch vectors: the DIRECTION rotates along the shorter great-circle
 * arc while the LENGTH lerps (entangled states have length < 1). Degenerate ends
 * (length ~0, direction undefined) borrow the other end's direction and simply
 * grow the length. Exact at t = 0 (→ a) and t = 1 (→ b).
 */
export function slerpBloch(a: BlochVector, b: BlochVector, t: number): BlochVector {
  const la = vlen(a);
  const lb = vlen(b);
  const len = la + (lb - la) * t;
  if (len < EPS) return { x: 0, y: 0, z: 0 };

  // Unit directions (fall back to the populated end when one is degenerate).
  const na = la < EPS ? null : { x: a.x / la, y: a.y / la, z: a.z / la };
  const nb = lb < EPS ? null : { x: b.x / lb, y: b.y / lb, z: b.z / lb };
  let dir: BlochVector;
  if (na && nb) {
    const dot = Math.max(-1, Math.min(1, na.x * nb.x + na.y * nb.y + na.z * nb.z));
    const omega = Math.acos(dot);
    if (omega < 1e-6) {
      dir = na; // parallel — no rotation needed
    } else {
      const s = Math.sin(omega);
      const wa = Math.sin((1 - t) * omega) / s;
      const wb = Math.sin(t * omega) / s;
      const x = wa * na.x + wb * nb.x;
      const y = wa * na.y + wb * nb.y;
      const z = wa * na.z + wb * nb.z;
      const n = Math.hypot(x, y, z) || 1;
      dir = { x: x / n, y: y / n, z: z / n };
    }
  } else {
    dir = (na ?? nb) as BlochVector;
  }
  return { x: dir.x * len, y: dir.y * len, z: dir.z * len };
}

/**
 * Realise a reduced single-qubit Bloch vector `v` (any length ≤ 1) on qubit `q`
 * as a full 5-qubit statevector, so `BlochView` (fed this + `qubit={q}`) shows it
 * exactly. Length-1 vectors are a pure single-qubit state; shorter (entangled /
 * mixed) vectors are purified with ONE ancilla qubit so `blochVector(sv, q)`
 * returns `v` unchanged. All other qubits stay |0⟩.
 */
export function blochToStatevector(v: BlochVector, q: number): StateVector {
  const s: StateVector = new Array(DIM);
  for (let i = 0; i < DIM; i++) s[i] = { re: 0, im: 0 };

  const L = Math.min(1, vlen(v));
  const lambdaPlus = (1 + L) / 2;
  const lambdaMinus = (1 - L) / 2;
  const rootPlus = Math.sqrt(Math.max(0, lambdaPlus));
  const rootMinus = Math.sqrt(Math.max(0, lambdaMinus));

  // Spherical angles of the vector's direction (default +z when degenerate).
  const theta = L < EPS ? 0 : Math.acos(Math.max(-1, Math.min(1, v.z / L)));
  const phi = Math.atan2(v.y, v.x);
  const ch = Math.cos(theta / 2);
  const sh = Math.sin(theta / 2);
  // Eigenvector |u+⟩ (spin-up along the direction) and |u−⟩ (orthogonal).
  const uPlus: [Complex, Complex] = [
    { re: ch, im: 0 },
    { re: sh * Math.cos(phi), im: sh * Math.sin(phi) },
  ];
  const uMinus: [Complex, Complex] = [
    { re: -sh * Math.cos(phi), im: sh * Math.sin(phi) },
    { re: ch, im: 0 },
  ];

  const ancilla = (q + 1) % NUM_QUBITS; // always ≠ q (NUM_QUBITS ≥ 2)
  const qbit = 1 << q;
  const abit = 1 << ancilla;
  const otherMask = (DIM - 1) & ~qbit & ~abit;
  for (let i = 0; i < DIM; i++) {
    if ((i & otherMask) !== 0) continue; // all non-(q,ancilla) qubits must be |0⟩
    const qv = (i & qbit) !== 0 ? 1 : 0;
    const av = (i & abit) !== 0 ? 1 : 0;
    // |ψ⟩ = √λ₊ |u₊⟩⊗|0⟩_a + √λ₋ |u₋⟩⊗|1⟩_a
    if (av === 0) {
      const u = uPlus[qv];
      s[i] = { re: rootPlus * u.re, im: rootPlus * u.im };
    } else {
      const u = uMinus[qv];
      s[i] = { re: rootMinus * u.re, im: rootMinus * u.im };
    }
  }
  return s;
}

// ---- step timing ---------------------------------------------------------

/**
 * How fast the evolution moves from one step to the next: `travelMs` is the
 * tween of one segment (the mass rolling on the sphere, the ket line morphing),
 * `dwellMs` the pause on each step reached on the way, so its state line can
 * be read. No dwell on the goal step — the view simply rests there.
 */
export interface EvolutionPace {
  readonly travelMs: number;
  readonly dwellMs: number;
}

/**
 * The evolution's whole timing, per surface:
 *   - `replay`: the explicit replays — holing in (`replayKey`, #13) and ↻.
 *   - `live`: the animation on every circuit change while building.
 *   - `liveFrom`: where that live animation starts — `'start'` replays the whole
 *     circuit from the start state; `'change'` starts at the step just before
 *     the first step the change altered, so appending a gate animates only the
 *     new step (no full replay after every tap).
 *   - `stepMs`: travel per step for the manual ‹ › / dot stepping (no dwell).
 */
export interface EvolutionTiming {
  readonly replay: EvolutionPace;
  readonly live: EvolutionPace;
  readonly liveFrom: 'start' | 'change';
  readonly stepMs: number;
}

/**
 * Booth kiosk (big screen) — the original #53 timing, unchanged: 500 ms per
 * step, no dwell, every change replays the whole circuit, stepping 500 ms.
 */
export const BOOTH_EVOLUTION_TIMING: EvolutionTiming = {
  replay: { travelMs: 500, dwellMs: 0 },
  live: { travelMs: 500, dwellMs: 0 },
  liveFrom: 'start',
  stepMs: 500,
};

/**
 * Pocket app + golf bundle (phones). Jan: the replay was too fast to follow on
 * a phone. The replay travels 2× slower (1 s per step) and pauses 1 s on each
 * step so the bra-ket line can be read. While building, a tap animates only
 * the step(s) it changed — brisker (0.8 s, 0.3 s dwell) but still slower per
 * step than before; ‹ › stepping is a short 0.3 s glide.
 */
export const POCKET_EVOLUTION_TIMING: EvolutionTiming = {
  replay: { travelMs: 1000, dwellMs: 1000 },
  live: { travelMs: 800, dwellMs: 300 },
  liveFrom: 'change',
  stepMs: 300,
};

/** Total time (ms) to cover `segments` steps at `pace`: travel each, dwell between. */
export function paceDuration(segments: number, pace: EvolutionPace): number {
  if (segments <= 0) return 0;
  return segments * pace.travelMs + (segments - 1) * pace.dwellMs;
}

/**
 * Progress (in steps, 0…`segments`) after `elapsed` ms at `pace`: travel the
 * first segment, dwell on the step reached, travel the next, … Linear within a
 * travel (the per-segment easing is applied by the renderer); integral while
 * dwelling; clamped to `segments` at the end.
 */
export function paceProgress(elapsed: number, segments: number, pace: EvolutionPace): number {
  if (segments <= 0) return 0;
  if (elapsed >= paceDuration(segments, pace)) return segments;
  if (elapsed <= 0) return 0;
  const travel = Math.max(0, pace.travelMs);
  const period = travel + Math.max(0, pace.dwellMs);
  if (period <= 0) return segments;
  const k = Math.floor(elapsed / period);
  const inPeriod = elapsed - k * period;
  const frac = travel <= 0 ? 1 : Math.min(1, inPeriod / travel);
  return Math.min(segments, k + frac);
}

/**
 * The first step index (≥ 1) whose state differs between two evolutions, or
 * null when `next` is just a prefix of `prev` (a column removed at the end — or
 * no change). Used by `liveFrom: 'change'`.
 */
export function firstChangedStep(
  prev: ReadonlyArray<StateVector>,
  next: ReadonlyArray<StateVector>,
): number | null {
  for (let i = 1; i < next.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (!a || a.length !== b.length) return i;
    for (let j = 0; j < b.length; j++) {
      if (Math.abs(a[j].re - b[j].re) > EPS || Math.abs(a[j].im - b[j].im) > EPS) return i;
    }
  }
  return null;
}
