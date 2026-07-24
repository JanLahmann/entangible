/**
 * Quantum Runner — pure game + measurement logic for the Entangible pocket
 * "Quantum Runner" mode (task #52).
 *
 * Based on Quantum Runner by the QAMPoser project (the co-developer's Flappy-style
 * lane game): the runner lives in EVERY basis-state lane at once as ghosts whose
 * opacity is the lane probability, and gate buttons reshape that live state in
 * real time. This module is the Entangible re-imagining of the idea, with two
 * twists over the upstream toy:
 *
 *   1. Coins score the EXPECTED value (sum of coin-lane probabilities) — the
 *      state is deliberately NOT measured, so a clean superposition banks
 *      fractional coins.
 *   2. Obstacles ARE the measurement mechanic (the heart of the game): when an
 *      obstacle column reaches the runner it triggers a projective measurement of
 *      the projector onto the obstacle lanes. HIT → lose a life, state collapses
 *      INTO the obstacle lanes; SURVIVE → state collapses AWAY (onto the
 *      complement). Either way the ghosts snap and renormalize.
 *
 * The quantum math reuses the booth engine's single source of gate definitions:
 * `singleQubitUnitary` from `./statevector` supplies the H/X 2×2 matrices (no
 * re-derivation of gate math here), and the lane index follows the shared
 * DISPLAY bit-order convention (`@shared/display/outcomes`): the lane index's
 * MOST-significant bit is q0 (the top wire), so with 2 qubits the lanes are
 * |00⟩ |01⟩ |10⟩ |11⟩ ↔ indices 0..3 and the Φ⁺ Bell state (H0 then CX01) lands
 * on lanes |00⟩ and |11⟩ — perfectly safe against an obstacle on the
 * anti-correlated pair |01⟩/|10⟩.
 *
 * Everything here is a pure reducer `(state, event, rng) → state`; the UI owns
 * timing (rAF) and rendering. The RNG is injectable (`mulberry32` for seeded
 * tests, `cryptoRng` for live play) — both re-used from `@shared/menu/sample`.
 */
import type { Complex, Matrix2 } from './statevector';
import { singleQubitUnitary } from './statevector';
import type { Gate } from '@qamposer/react';
import type { Rng } from '@shared/menu/sample';

export type { Rng };

// ---------------------------------------------------------------------------
// Complex arithmetic (inline — statevector.ts keeps its helpers private, and
// this module only needs a handful for the tiny 2/4-amplitude states)
// ---------------------------------------------------------------------------

const ZERO: Complex = { re: 0, im: 0 };
const cadd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
const cmul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
const abs2 = (a: Complex): number => a.re * a.re + a.im * a.im;

// H/X pulled from the engine's single source of gate matrices (do NOT restate
// the math here). `singleQubitUnitary` only reads `type` (and `parameter` for
// rotations), so a bare `{ type }` is a valid probe.
const H2 = singleQubitUnitary({ type: 'H' } as Gate) as Matrix2;
const X2 = singleQubitUnitary({ type: 'X' } as Gate) as Matrix2;

// ---------------------------------------------------------------------------
// Lanes, levels, gate buttons
// ---------------------------------------------------------------------------

/** Playable levels: 1 qubit (2 lanes) or 2 qubits (4 lanes). */
export type Level = 1 | 2;

/** The gate buttons the player taps. Level 1 exposes X0/H0; level 2 adds the
 * second qubit's X1/H1 and both CX directions. */
export type GateButton = 'X0' | 'H0' | 'X1' | 'H1' | 'CX01' | 'CX10';

/** Which buttons a level offers, in the fixed thumb-row order. */
export const GATE_BUTTONS: Record<Level, readonly GateButton[]> = {
  1: ['X0', 'H0'],
  2: ['X0', 'X1', 'H0', 'H1', 'CX01', 'CX10'],
};

/** Qubit count for a level. */
export function qubitsForLevel(level: Level): number {
  return level;
}

/** Lane count for a level (2^qubits). */
export function laneCount(level: Level): number {
  return 1 << level;
}

/**
 * Lane labels in the shared DISPLAY bit-order convention (leftmost char = q0):
 * level 1 → |0⟩ |1⟩; level 2 → |00⟩ |01⟩ |10⟩ |11⟩.
 */
export function laneLabels(level: Level): string[] {
  const n = laneCount(level);
  const q = qubitsForLevel(level);
  return Array.from({ length: n }, (_, i) => `|${i.toString(2).padStart(q, '0')}⟩`);
}

/** Bit position of qubit `q` within a `k`-qubit lane index (q0 = MSB). */
function qubitBit(q: number, k: number): number {
  return 1 << (k - 1 - q);
}

// ---------------------------------------------------------------------------
// State-vector operations on the tiny (2 or 4 amplitude) lane state
// ---------------------------------------------------------------------------

/** The all-|0…0⟩ starting amplitude vector for a level. */
export function initialAmplitudes(level: Level): Complex[] {
  const amps = new Array<Complex>(laneCount(level)).fill(ZERO);
  amps[0] = { re: 1, im: 0 };
  return amps;
}

/** Lane probabilities |amp|² (length = lane count). */
export function probabilities(amps: readonly Complex[]): number[] {
  return amps.map(abs2);
}

/** Apply a single-qubit 2×2 unitary to qubit `q` (returns a new array). */
function applySingle(amps: readonly Complex[], q: number, k: number, m: Matrix2): Complex[] {
  const bit = qubitBit(q, k);
  const out = amps.slice();
  for (let i = 0; i < amps.length; i++) {
    if ((i & bit) === 0) {
      const j = i | bit;
      const a = amps[i];
      const b = amps[j];
      out[i] = cadd(cmul(m[0], a), cmul(m[1], b));
      out[j] = cadd(cmul(m[2], a), cmul(m[3], b));
    }
  }
  return out;
}

/** Apply CX(control, target) — flip target where control is |1⟩ (new array). */
function applyCx(amps: readonly Complex[], control: number, target: number, k: number): Complex[] {
  const cbit = qubitBit(control, k);
  const tbit = qubitBit(target, k);
  const out = amps.slice();
  for (let i = 0; i < amps.length; i++) {
    if ((i & cbit) !== 0 && (i & tbit) === 0) {
      const j = i | tbit;
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
  }
  return out;
}

/**
 * Apply a gate button to the amplitude vector for a level. A button that
 * references a qubit the level doesn't have (e.g. `X1` at level 1) is a no-op —
 * the UI never offers it, but the reducer stays total.
 */
export function applyGate(amps: readonly Complex[], level: Level, button: GateButton): Complex[] {
  const k = qubitsForLevel(level);
  switch (button) {
    case 'X0':
      return applySingle(amps, 0, k, X2);
    case 'H0':
      return applySingle(amps, 0, k, H2);
    case 'X1':
      return k > 1 ? applySingle(amps, 1, k, X2) : amps.slice();
    case 'H1':
      return k > 1 ? applySingle(amps, 1, k, H2) : amps.slice();
    case 'CX01':
      return k > 1 ? applyCx(amps, 0, 1, k) : amps.slice();
    case 'CX10':
      return k > 1 ? applyCx(amps, 1, 0, k) : amps.slice();
    default:
      return amps.slice();
  }
}

// ---------------------------------------------------------------------------
// Measurement (the obstacle mechanic) + coin scoring
// ---------------------------------------------------------------------------

/** Result of a projective measurement onto a set of obstacle lanes. */
export interface MeasureResult {
  /** True → the runner was found IN the obstacle lanes (a hit). */
  hit: boolean;
  /** The pre-measurement probability of landing in the obstacle lanes. */
  p: number;
  /** The renormalized post-collapse amplitude vector. */
  newState: Complex[];
}

/** Renormalize an amplitude vector to unit norm (no-op if already ~degenerate). */
function renormalize(amps: readonly Complex[]): Complex[] {
  let norm2 = 0;
  for (const a of amps) norm2 += abs2(a);
  if (norm2 <= 1e-12) return amps.slice();
  const inv = 1 / Math.sqrt(norm2);
  return amps.map((a) => ({ re: a.re * inv, im: a.im * inv }));
}

/**
 * Projectively measure the projector onto `lanes`. Draw `r = rng()`; with
 * probability `p = Σ P(lane)` the runner is HIT (state collapses onto `lanes`),
 * otherwise it SURVIVES (state collapses onto the complement). Both branches
 * renormalize. Edge cases fall out for free: `p = 0` → `r < 0` is impossible, so
 * always survive with the state untouched (the "clean pass"); `p = 1` → `r < 1`
 * always holds, so a certain hit that leaves the state intact.
 */
export function projectiveMeasure(
  amps: readonly Complex[],
  lanes: readonly number[],
  rng: Rng,
): MeasureResult {
  const probs = probabilities(amps);
  let p = 0;
  for (const l of lanes) p += probs[l] ?? 0;
  const hit = rng() < p;
  const laneSet = new Set(lanes);
  // Keep the amplitudes on the measured side (obstacle lanes on a hit; the
  // complement on a survive); zero the other side, then renormalize.
  const collapsed = amps.map((a, i) => (laneSet.has(i) === hit ? a : ZERO));
  return { hit, p, newState: renormalize(collapsed) };
}

/** Expected coins banked when a coin column crosses: Σ P(coin lane). */
export function coinScore(amps: readonly Complex[], lanes: readonly number[]): number {
  const probs = probabilities(amps);
  let s = 0;
  for (const l of lanes) s += probs[l] ?? 0;
  return s;
}

// ---------------------------------------------------------------------------
// Pattern pool (hand-designed per level; seeded-RNG generated, like the coin
// patterns in the upstream plan)
// ---------------------------------------------------------------------------

/** A scrolling column: coins bank expected value; obstacles measure. */
export type ColumnKind = 'coin' | 'obstacle';

/** One entry in a level's hand-designed pattern pool. */
export interface Pattern {
  kind: ColumnKind;
  /** Lane indices the column occupies. */
  lanes: readonly number[];
}

/**
 * Level 1 pool — coins on either/both lanes, obstacles on a single lane. H
 * (equal superposition) banks +1.0 across both coin lanes and gives every
 * single-lane obstacle a coin-flip.
 */
export const LEVEL1_POOL: readonly Pattern[] = [
  { kind: 'coin', lanes: [0] },
  { kind: 'coin', lanes: [1] },
  { kind: 'coin', lanes: [0, 1] },
  { kind: 'obstacle', lanes: [0] },
  { kind: 'obstacle', lanes: [1] },
];

/**
 * Level 2 pool. The designed aha-moment: the obstacle on the anti-correlated
 * pair |01⟩/|10⟩ (lanes 1 & 2) has ZERO probability under the Φ⁺ Bell state
 * (H0 then CX01 → |00⟩+|11⟩), so a Bell runner sails through untouched.
 */
export const LEVEL2_POOL: readonly Pattern[] = [
  { kind: 'coin', lanes: [0] },
  { kind: 'coin', lanes: [3] },
  { kind: 'coin', lanes: [0, 3] },
  { kind: 'coin', lanes: [0, 1, 2, 3] },
  { kind: 'obstacle', lanes: [1, 2] }, // anti-correlated — Bell Φ⁺ is safe here
  { kind: 'obstacle', lanes: [0] },
  { kind: 'obstacle', lanes: [3] },
  { kind: 'obstacle', lanes: [1] },
];

/** The pattern pool for a level. */
export function poolForLevel(level: Level): readonly Pattern[] {
  return level === 1 ? LEVEL1_POOL : LEVEL2_POOL;
}

/** Draw the next column pattern from a level's pool (seeded-RNG injectable). */
export function nextPattern(level: Level, rng: Rng): Pattern {
  const pool = poolForLevel(level);
  const idx = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return pool[idx];
}

// ---------------------------------------------------------------------------
// Tick / step model (pure reducer; UI drives timing)
// ---------------------------------------------------------------------------

/** Tunable pacing. Defaults ramp a typical run to ~45–90 s. */
export interface RunnerConfig {
  /** Column speed (field-widths per second) at t=0. */
  baseSpeed: number;
  /** Speed gained per second elapsed. */
  speedRamp: number;
  /** Speed ceiling. */
  maxSpeed: number;
  /** Seconds between spawns at t=0. */
  spawnBase: number;
  /** Spawn interval shrink per second elapsed. */
  spawnRamp: number;
  /** Minimum spawn interval. */
  minSpawn: number;
  /** Lives a run starts with. */
  startLives: number;
}

export const DEFAULT_RUNNER_CONFIG: RunnerConfig = {
  baseSpeed: 0.2,
  speedRamp: 0.006,
  maxSpeed: 0.62,
  spawnBase: 1.9,
  spawnRamp: 0.013,
  minSpawn: 0.7,
  startLives: 3,
};

/** Current column speed at an elapsed time. */
export function speedAt(config: RunnerConfig, elapsed: number): number {
  return Math.min(config.maxSpeed, config.baseSpeed + elapsed * config.speedRamp);
}

/** Current spawn interval at an elapsed time. */
export function spawnIntervalAt(config: RunnerConfig, elapsed: number): number {
  return Math.max(config.minSpawn, config.spawnBase - elapsed * config.spawnRamp);
}

/** A column on the field. `x` runs 1 (right edge, just spawned) → 0 (runner line). */
export interface Column extends Pattern {
  id: number;
  x: number;
  /** True once the column has crossed the runner line and been resolved. */
  resolved: boolean;
}

/**
 * The most recent coin/measure event, for the UI's snap/flash. It carries the
 * `at` (elapsed) timestamp of the event and persists (unchanged) across ticks
 * that resolve nothing new, so the UI fades it out on `elapsed - flash.at`
 * rather than having it vanish on the very next frame.
 */
export type RunnerFlash =
  | { kind: 'coin'; amount: number; lanes: readonly number[]; at: number }
  | { kind: 'measure'; hit: boolean; p: number; lanes: readonly number[]; at: number };

export type RunnerStatus = 'playing' | 'over';

/** The full game state. Serializable + structurally comparable (used by tests). */
export interface RunnerState {
  level: Level;
  amps: Complex[];
  score: number;
  lives: number;
  /** Field-widths travelled (the run's "distance"). */
  distance: number;
  elapsed: number;
  columns: Column[];
  spawnCooldown: number;
  nextColumnId: number;
  status: RunnerStatus;
  /** Last coin/measure event, for the UI snap (null between events). */
  flash: RunnerFlash | null;
  config: RunnerConfig;
}

/** X of the runner line (columns resolve when their x reaches it). */
export const RUNNER_LINE = 0;
/** X a column spawns at (just off the right edge). */
const SPAWN_X = 1;
/** X past which a resolved column is culled. */
const CULL_X = -0.2;
/** Per-tick dt is clamped to keep the physics stable under a stalled rAF. */
const MAX_DT = 0.1;

/** A fresh run for a level. */
export function initRunner(level: Level, config: RunnerConfig = DEFAULT_RUNNER_CONFIG): RunnerState {
  return {
    level,
    amps: initialAmplitudes(level),
    score: 0,
    lives: config.startLives,
    distance: 0,
    elapsed: 0,
    columns: [],
    // A brief grace period before the first column so the player can orient.
    spawnCooldown: Math.min(config.spawnBase, 1.4),
    nextColumnId: 0,
    status: 'playing',
    flash: null,
    config,
  };
}

/** Events the reducer accepts. */
export type RunnerEvent =
  | { type: 'gate'; gate: GateButton }
  | { type: 'tick'; dt: number }
  | { type: 'setLevel'; level: Level }
  | { type: 'restart' };

/**
 * The pure game reducer. `rng` is consumed only by `tick` (spawns + obstacle
 * measurements); `gate`/`restart`/`setLevel` ignore it. Deterministic under a
 * seeded `rng` — the basis of the playthrough golden test.
 */
export function runnerReducer(state: RunnerState, event: RunnerEvent, rng: Rng): RunnerState {
  switch (event.type) {
    case 'restart':
      return initRunner(state.level, state.config);
    case 'setLevel':
      // Changing level is a fresh run (the lane count changes).
      return initRunner(event.level, state.config);
    case 'gate': {
      if (state.status !== 'playing') return state;
      return { ...state, amps: applyGate(state.amps, state.level, event.gate) };
    }
    case 'tick': {
      if (state.status !== 'playing') return state;
      return tick(state, event.dt, rng);
    }
    default:
      return state;
  }
}

/** Advance the world by `dt` seconds. */
function tick(state: RunnerState, rawDt: number, rng: Rng): RunnerState {
  const dt = Math.max(0, Math.min(MAX_DT, rawDt));
  const config = state.config;
  const elapsed = state.elapsed + dt;
  const speed = speedAt(config, state.elapsed);
  const move = speed * dt;

  let amps = state.amps;
  let score = state.score;
  let lives = state.lives;
  let flash: RunnerFlash | null = null;

  // Move columns and collect the ones crossing the runner line this tick.
  const moved = state.columns.map((c) => ({ ...c, x: c.x - move }));
  // Resolve in field order (nearest the line first) for stable determinism.
  const crossing = moved
    .filter((c) => !c.resolved && c.x <= RUNNER_LINE)
    .sort((a, b) => a.x - b.x);

  for (const col of crossing) {
    if (col.kind === 'coin') {
      const amount = coinScore(amps, col.lanes);
      score += amount;
      flash = { kind: 'coin', amount, lanes: col.lanes, at: elapsed };
    } else {
      const res = projectiveMeasure(amps, col.lanes, rng);
      amps = res.newState;
      if (res.hit) lives = Math.max(0, lives - 1);
      flash = { kind: 'measure', hit: res.hit, p: res.p, lanes: col.lanes, at: elapsed };
    }
    col.resolved = true;
  }

  // Cull columns that have scrolled off the left edge.
  let columns = moved.filter((c) => c.x > CULL_X);

  // Spawn on the cooldown. A single tick spawns at most a handful (guards a
  // long stalled dt), each stepped by the current interval.
  let spawnCooldown = state.spawnCooldown - dt;
  let nextColumnId = state.nextColumnId;
  let guard = 0;
  while (spawnCooldown <= 0 && guard < 8) {
    const pattern = nextPattern(state.level, rng);
    columns = [
      ...columns,
      { ...pattern, id: nextColumnId++, x: SPAWN_X, resolved: false },
    ];
    spawnCooldown += spawnIntervalAt(config, elapsed);
    guard++;
  }

  const status: RunnerStatus = lives <= 0 ? 'over' : 'playing';

  return {
    ...state,
    amps,
    score,
    lives,
    distance: state.distance + move,
    elapsed,
    columns,
    spawnCooldown,
    nextColumnId,
    status,
    flash: flash ?? state.flash,
    config,
  };
}
