/**
 * Quantum Runner engine golden tests (task #52).
 *
 * The load-bearing claims: gate application matches the shared DISPLAY bit-order
 * convention (so Φ⁺ lands on lanes |00⟩/|11⟩); an obstacle measurement collapses
 * BOTH ways correctly under a seeded RNG; the Bell state is perfectly safe on the
 * anti-correlated pattern; probabilities are always renormalized after collapse;
 * and a seeded playthrough is fully deterministic.
 */
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '@shared/menu/sample';
import type { Complex } from './statevector';
import {
  GATE_BUTTONS,
  DEFAULT_RUNNER_CONFIG,
  applyGate,
  coinScore,
  initRunner,
  initialAmplitudes,
  laneLabels,
  probabilities,
  projectiveMeasure,
  runnerReducer,
  nextPattern,
  poolForLevel,
  LEVEL2_POOL,
  type Level,
  type RunnerEvent,
  type RunnerState,
} from './runner';

/** A constant RNG (for pinning a measurement branch). */
const constRng = (v: number) => () => v;

/** Total probability mass, for the renormalization checks. */
const mass = (amps: readonly Complex[]) =>
  probabilities(amps).reduce((s, p) => s + p, 0);

/** Build the Φ⁺ Bell state at level 2: H0 then CX01. */
function bellAmps(): Complex[] {
  let a = initialAmplitudes(2);
  a = applyGate(a, 2, 'H0');
  a = applyGate(a, 2, 'CX01');
  return a;
}

describe('lanes + labels', () => {
  it('labels follow the DISPLAY convention (leftmost char = q0)', () => {
    expect(laneLabels(1)).toEqual(['|0⟩', '|1⟩']);
    expect(laneLabels(2)).toEqual(['|00⟩', '|01⟩', '|10⟩', '|11⟩']);
  });

  it('offers the fixed button rows per level', () => {
    expect(GATE_BUTTONS[1]).toEqual(['X0', 'H0']);
    expect(GATE_BUTTONS[2]).toEqual(['X0', 'X1', 'H0', 'H1', 'CX01', 'CX10']);
  });
});

describe('gate application', () => {
  it('X0 flips |0⟩ → |1⟩ at level 1', () => {
    const a = applyGate(initialAmplitudes(1), 1, 'X0');
    expect(probabilities(a)).toEqual([0, 1]);
  });

  it('H0 makes an equal superposition at level 1', () => {
    const a = applyGate(initialAmplitudes(1), 1, 'H0');
    const p = probabilities(a);
    expect(p[0]).toBeCloseTo(0.5, 12);
    expect(p[1]).toBeCloseTo(0.5, 12);
  });

  it('H0 then CX01 builds Φ⁺ on lanes |00⟩ and |11⟩ (indices 0 and 3)', () => {
    const p = probabilities(bellAmps());
    expect(p[0]).toBeCloseTo(0.5, 12);
    expect(p[1]).toBeCloseTo(0, 12);
    expect(p[2]).toBeCloseTo(0, 12);
    expect(p[3]).toBeCloseTo(0.5, 12);
  });

  it('a level-1 state ignores level-2 buttons (stays total)', () => {
    const a = applyGate(initialAmplitudes(1), 1, 'X1');
    expect(probabilities(a)).toEqual([1, 0]);
  });
});

describe('coinScore — expected value (unmeasured)', () => {
  it('sums the coin-lane probabilities', () => {
    const a = applyGate(initialAmplitudes(1), 1, 'H0');
    expect(coinScore(a, [0])).toBeCloseTo(0.5, 12);
    expect(coinScore(a, [0, 1])).toBeCloseTo(1, 12);
  });
});

describe('projectiveMeasure — the obstacle mechanic', () => {
  it('H then obstacle on |1⟩ collapses INTO |1⟩ when rng < p (hit)', () => {
    const a = applyGate(initialAmplitudes(1), 1, 'H0'); // p(|1⟩) = 0.5
    const res = projectiveMeasure(a, [1], constRng(0.2)); // 0.2 < 0.5 → hit
    expect(res.hit).toBe(true);
    expect(res.p).toBeCloseTo(0.5, 12);
    expect(probabilities(res.newState)).toEqual([0, 1]);
    expect(mass(res.newState)).toBeCloseTo(1, 12);
  });

  it('H then obstacle on |1⟩ collapses AWAY to |0⟩ when rng ≥ p (survive)', () => {
    const a = applyGate(initialAmplitudes(1), 1, 'H0');
    const res = projectiveMeasure(a, [1], constRng(0.8)); // 0.8 ≥ 0.5 → survive
    expect(res.hit).toBe(false);
    expect(probabilities(res.newState)).toEqual([1, 0]);
    expect(mass(res.newState)).toBeCloseTo(1, 12);
  });

  it('Bell Φ⁺ is perfectly safe on the anti-correlated |01⟩/|10⟩ obstacle (p=0)', () => {
    const bell = bellAmps();
    // Even the most hostile rng (0) cannot hit: p = 0 ⇒ rng() < 0 is false.
    const res = projectiveMeasure(bell, [1, 2], constRng(0));
    expect(res.p).toBeCloseTo(0, 12);
    expect(res.hit).toBe(false);
    // Clean pass — the state is unchanged (up to renormalization) and still Bell.
    expect(probabilities(res.newState)).toEqual(probabilities(bell));
    expect(mass(res.newState)).toBeCloseTo(1, 12);
  });

  it('a certain hit (p=1) leaves the state intact and normalized', () => {
    const a = initialAmplitudes(1); // |0⟩, p(|0⟩) = 1
    const res = projectiveMeasure(a, [0], constRng(0.999999));
    expect(res.hit).toBe(true);
    expect(res.p).toBeCloseTo(1, 12);
    expect(mass(res.newState)).toBeCloseTo(1, 12);
  });

  it('always renormalizes across a randomized sweep of states + obstacles', () => {
    const rng = mulberry32(99);
    for (let t = 0; t < 200; t++) {
      let a = initialAmplitudes(2);
      const buttons = GATE_BUTTONS[2];
      for (let g = 0; g < 4; g++) {
        a = applyGate(a, 2, buttons[Math.floor(rng() * buttons.length)]);
      }
      const pat = LEVEL2_POOL[Math.floor(rng() * LEVEL2_POOL.length)];
      const res = projectiveMeasure(a, pat.lanes, rng);
      // Either a genuine collapse (mass 1) or a p=0 clean pass (mass 1 too).
      expect(mass(res.newState)).toBeCloseTo(1, 10);
    }
  });
});

describe('pattern pool', () => {
  it('level 2 includes the anti-correlated obstacle |01⟩/|10⟩', () => {
    const has = poolForLevel(2).some(
      (p) => p.kind === 'obstacle' && p.lanes.length === 2 && p.lanes.includes(1) && p.lanes.includes(2),
    );
    expect(has).toBe(true);
  });

  it('nextPattern is seed-deterministic and always in the pool', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 20; i++) {
      const pa = nextPattern(2, a);
      const pb = nextPattern(2, b);
      expect(pa).toEqual(pb);
      expect(poolForLevel(2)).toContain(pa);
    }
  });
});

describe('reducer + seeded playthrough determinism', () => {
  const script: RunnerEvent[] = [];
  // A fixed 60 s script: a tick every 1/30 s with periodic gate taps.
  for (let i = 0; i < 1800; i++) {
    script.push({ type: 'tick', dt: 1 / 30 });
    if (i % 90 === 20) script.push({ type: 'gate', gate: 'H0' });
    if (i % 90 === 40) script.push({ type: 'gate', gate: 'CX01' });
  }

  function play(level: Level, seed: number): RunnerState {
    let state = initRunner(level, DEFAULT_RUNNER_CONFIG);
    const rng = mulberry32(seed);
    for (const ev of script) state = runnerReducer(state, ev, rng);
    return state;
  }

  it('two runs with the same seed are byte-for-byte identical', () => {
    expect(play(2, 12345)).toEqual(play(2, 12345));
  });

  it('accumulates fractional score and eventually ends the run', () => {
    const end = play(2, 12345);
    expect(end.score).toBeGreaterThan(0);
    // The ramping speed + obstacles exhaust 3 lives within the scripted minute.
    expect(end.status).toBe('over');
    expect(end.lives).toBe(0);
    expect(end.distance).toBeGreaterThan(0);
  });

  it('a gate event is a no-op once the run is over', () => {
    const over = play(2, 12345);
    const after = runnerReducer(over, { type: 'gate', gate: 'X0' }, mulberry32(1));
    expect(after.amps).toEqual(over.amps);
    expect(after.status).toBe('over');
  });

  it('restart returns a fresh full-lives run at the same level', () => {
    const over = play(2, 12345);
    const fresh = runnerReducer(over, { type: 'restart' }, mulberry32(1));
    expect(fresh.status).toBe('playing');
    expect(fresh.lives).toBe(DEFAULT_RUNNER_CONFIG.startLives);
    expect(fresh.score).toBe(0);
    expect(fresh.level).toBe(2);
    expect(fresh.columns).toEqual([]);
  });

  it('setLevel starts a fresh run with the new lane count', () => {
    const s = initRunner(1);
    const next = runnerReducer(s, { type: 'setLevel', level: 2 }, mulberry32(1));
    expect(next.level).toBe(2);
    expect(next.amps).toHaveLength(4);
  });
});
