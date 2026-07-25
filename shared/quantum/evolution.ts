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
 *
 * It also derives the "roll-the-ball" TRANSPORT MAP (task #57): per segment,
 * which basis node's mass moves to which other node, how much of it, and what
 * colour it departs/arrives with — plus the surface geometry a ball follows.
 * Same principle: no per-gate-type math, everything comes from applying the
 * column's gates through the shared engine path.
 */
import type { Circuit } from '@qamposer/react';
import {
  applyGatesTo,
  statevector,
  zeroState,
  DIM,
  type Complex,
  type StateVector,
} from './statevector';
import { PROB_EPS, type Vec3 } from './qsphere';

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

// ---------------------------------------------------------------------------
// Roll-the-ball transport map (#57)
// ---------------------------------------------------------------------------

/**
 * Probability below which a source basis state / a transition amplitude is
 * treated as absent. Looser than the display's `PROB_EPS` on purpose: a ball
 * carrying 0.5 % of the mass is still worth watching travel.
 */
export const TRANSPORT_EPS = 1e-4;

/**
 * One movement of probability mass across the sphere during a single animation
 * segment (column k → k+1).
 */
export interface TransportEdge {
  /** Source basis index (populated at step k). */
  readonly from: number;
  /** Destination basis index (`from === to` ⇒ mass that stays put). */
  readonly to: number;
  /** Mass carried: `prob_from(k) · |U_to,from|²`. */
  readonly weight: number;
  /** Departure hue: the source node's phase at step k, degrees [0, 360). */
  readonly fromHue: number;
  /** Arrival hue: the phase of the CONTRIBUTION `amp_from(k) · U_to,from`,
   *  measured against the step-k+1 reference, degrees [0, 360). */
  readonly toHue: number;
}

/**
 * The reference phase of `basisVisuals` (qsphere.ts): the argument of the first
 * amplitude with p ≥ PROB_EPS in index order, or 0 when nothing is populated.
 * Re-derived here (three lines, no gate math) so a traveler's ARRIVAL hue can be
 * measured in the destination step's frame without exposing the reference from
 * the display layer.
 */
function referencePhase(amps: ReadonlyArray<Complex>): number {
  for (const a of amps) {
    if (a.re * a.re + a.im * a.im >= PROB_EPS) return Math.atan2(a.im, a.re);
  }
  return 0;
}

/** Degrees, wrapped into [0, 360). */
function wrapDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** The basis vector |i⟩ in the 32-amplitude space. */
function basisVector(i: number): StateVector {
  const s = zeroState();
  s[0] = { re: 0, im: 0 };
  s[i] = { re: 1, im: 0 };
  return s;
}

/**
 * Where mass travels in each animation segment — one edge list per segment
 * (length = number of occupied columns = `evolutionSteps(circuit).length - 1`).
 *
 * Derived from the engine, not from per-gate-type knowledge: for every source
 * basis state `i` populated at step k, the column's gates are applied to |i⟩ via
 * `applyGatesTo` (the SAME code path and ordering `statevector` uses, so the
 * result is consistent with the step snapshots), and every destination `j` with
 * a non-negligible |U_ji|² becomes an edge weighted `prob_i(k) · |U_ji|²`.
 *
 * Self-edges (`from === to`) ARE included — the weights leaving a source sum to
 * `prob_i(k)`, which makes the map testable as a probability transport — but the
 * renderer draws no traveler for them: mass that stays put is already covered by
 * the base node animation.
 *
 * Interference is deliberately visible: `weight` is the CONTRIBUTION size, so
 * when two contributions cancel, two balls arrive at a node that nonetheless
 * shrinks. That IS destructive interference; do not "fix" it by normalising to
 * the destination probability.
 */
export function transportEdges(
  circuit: Circuit,
  steps: readonly StateVector[] = evolutionSteps(circuit),
): TransportEdge[][] {
  const cols = occupiedColumns(circuit);
  return cols.map((col, k) => {
    const from = steps[k];
    const to = steps[k + 1];
    if (!from || !to) return [];
    // Same filter+order as the prefix circuits in `evolutionSteps`.
    const gates = circuit.gates.filter((g) => g.position === col);
    const refFrom = referencePhase(from);
    const refTo = referencePhase(to);
    const edges: TransportEdge[] = [];
    for (let i = 0; i < DIM; i++) {
      const a = from[i];
      const probFrom = a.re * a.re + a.im * a.im;
      if (probFrom <= TRANSPORT_EPS) continue;
      const column = applyGatesTo(basisVector(i), gates); // U|i⟩
      const fromHue = wrapDeg(((Math.atan2(a.im, a.re) - refFrom) * 180) / Math.PI);
      for (let j = 0; j < DIM; j++) {
        const u = column[j]; // U_ji
        const transfer = u.re * u.re + u.im * u.im;
        if (transfer <= TRANSPORT_EPS) continue;
        // amp_i(k) · U_ji — the contribution this ball delivers to node j.
        const contrib = { re: a.re * u.re - a.im * u.im, im: a.re * u.im + a.im * u.re };
        edges.push({
          from: i,
          to: j,
          weight: probFrom * transfer,
          fromHue,
          toHue: wrapDeg(((Math.atan2(contrib.im, contrib.re) - refTo) * 180) / Math.PI),
        });
      }
    }
    return edges;
  });
}

// ---------------------------------------------------------------------------
// Surface transport geometry (great-circle paths between lattice nodes)
// ---------------------------------------------------------------------------

/** Below this |dot + 1| two unit vectors count as antipodal (slerp degenerates). */
const ANTIPODAL_EPS = 1e-6;
/** Below this a coordinate counts as zero (pole / equator detection). */
const AXIS_EPS = 1e-9;

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** Great-circle interpolation between two NON-antipodal unit vectors. */
function slerpUnit(a: Vec3, b: Vec3, t: number): Vec3 {
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  const omega = Math.acos(d);
  const sin = Math.sin(omega);
  // Coincident (or numerically so): nothing to rotate.
  if (sin < 1e-8) return normalize({ x: a.x, y: a.y, z: a.z });
  const wa = Math.sin((1 - t) * omega) / sin;
  const wb = Math.sin(t * omega) / sin;
  return normalize({
    x: wa * a.x + wb * b.x,
    y: wa * a.y + wb * b.y,
    z: wa * a.z + wb * b.z,
  });
}

/**
 * The deterministic half-way point for an ANTIPODAL hop (|0⟩→|1⟩ is exactly
 * pole-to-pole, where slerp has no defined plane): the equator point at the
 * SOURCE's longitude — longitude 0 when the source sits on a pole.
 *
 * One extra case the lattice can produce (even qubit counts have an equator
 * ring, e.g. n = 2's |01⟩ and |10⟩): a source already ON the equator is its own
 * "equator point at its longitude". Those hops route over the north pole
 * instead — equally deterministic, and still a great circle.
 */
export function antipodalWaypoint(a: Vec3): Vec3 {
  const r = Math.hypot(a.x, a.y);
  if (r < AXIS_EPS) return { x: 1, y: 0, z: 0 }; // source on a pole → longitude 0
  if (Math.abs(a.z) < AXIS_EPS) return { x: 0, y: 0, z: 1 }; // source on the equator
  return { x: a.x / r, y: a.y / r, z: 0 };
}

/**
 * Where a traveler is at fraction `t` of its hop from unit vector `a` to unit
 * vector `b`: the great-circle (slerp) path, or — for an antipodal pair, where
 * slerp is degenerate — two great-circle arcs through `antipodalWaypoint(a)`.
 * The result is always a unit vector, so travelers roll ON the sphere surface.
 */
export function surfacePath(a: Vec3, b: Vec3, t: number): Vec3 {
  const clamped = Math.max(0, Math.min(1, t));
  if (dot(a, b) < -1 + ANTIPODAL_EPS) {
    const w = antipodalWaypoint(a);
    return clamped < 0.5
      ? slerpUnit(a, w, clamped * 2)
      : slerpUnit(w, b, clamped * 2 - 1);
  }
  return slerpUnit(a, b, clamped);
}

/**
 * Interpolate a hue (degrees) along the SHORTEST angular path — a ball crossing
 * 350° → 10° passes through 0°, not backwards through the whole wheel. An exact
 * half-turn (a Z gate's 180°, the common case) has no shorter side: it resolves
 * deterministically to the increasing direction.
 */
export function lerpHue(from: number, to: number, t: number): number {
  let delta = wrapDeg(to - from);
  if (delta > 180) delta -= 360;
  return wrapDeg(from + delta * t);
}
