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
  GATE_COLUMNS,
  DEFAULT_RUNNER_CONFIG,
  LEVEL2_RUNNER_CONFIG,
  LEVEL_RUNNER_CONFIG,
  resetAmplitudes,
  secondsToMaxSpeed,
  secondsToMinSpawn,
  speedAt,
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
    // Two rows of three, one per qubit: X₀ H₀ CX 0→1 / X₁ H₁ CX 1→0.
    expect(GATE_BUTTONS[2]).toEqual(['X0', 'H0', 'CX01', 'X1', 'H1', 'CX10']);
    expect(GATE_COLUMNS).toEqual({ 1: 2, 2: 3 });
    // Totality: every level's buttons fill whole rows.
    for (const lv of [1, 2] as Level[]) expect(GATE_BUTTONS[lv].length % GATE_COLUMNS[lv]).toBe(0);
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

describe('reset — every qubit back to |0⟩ (non-unitary, free)', () => {
  const rng = () => mulberry32(3);

  it('resets a level-1 superposition to |0⟩, renormalised', () => {
    const a = resetAmplitudes(applyGate(initialAmplitudes(1), 1, 'H0'));
    expect(probabilities(a)).toEqual([1, 0]);
    expect(mass(a)).toBeCloseTo(1, 12);
    expect(resetAmplitudes(applyGate(initialAmplitudes(1), 1, 'X0'))).toEqual(initialAmplitudes(1));
  });

  it('resets a level-2 Bell state and a uniform superposition to |00⟩', () => {
    expect(probabilities(resetAmplitudes(bellAmps()))).toEqual([1, 0, 0, 0]);
    let u = applyGate(initialAmplitudes(2), 2, 'H0');
    u = applyGate(u, 2, 'H1');
    u = applyGate(u, 2, 'X1');
    expect(probabilities(resetAmplitudes(u))).toEqual([1, 0, 0, 0]);
  });

  it('is not a gate: two different states reset to the same one (it forgets)', () => {
    const one = applyGate(initialAmplitudes(1), 1, 'X0');
    const plus = applyGate(initialAmplitudes(1), 1, 'H0');
    expect(resetAmplitudes(one)).toEqual(resetAmplitudes(plus));
  });

  it('renormalises an unnormalised input and keeps lane 0 real-positive', () => {
    const a = resetAmplitudes([{ re: 0, im: 0.3 }, { re: -0.4, im: 0 }, { re: 0, im: 0 }, { re: 0.1, im: 0.1 }]);
    expect(a[0]).toEqual({ re: 1, im: 0 });
    expect(mass(a)).toBeCloseTo(1, 12);
  });

  it('the reducer resets only the state: score, lives, columns and timing untouched', () => {
    let s = initRunner(2);
    s = runnerReducer(s, { type: 'gate', gate: 'H0' }, rng());
    s = runnerReducer(s, { type: 'gate', gate: 'CX01' }, rng());
    s = {
      ...s,
      score: 2.5,
      lives: 2,
      elapsed: 12,
      spawnCooldown: 0.4,
      columns: [{ id: 0, kind: 'obstacle', lanes: [0], x: 0.3, resolved: false }],
      nextColumnId: 1,
    };
    const r = runnerReducer(s, { type: 'reset' }, rng());
    expect(probabilities(r.amps)).toEqual([1, 0, 0, 0]);
    expect({ ...r, amps: s.amps }).toEqual(s);
  });

  it('does not skip or soften the next obstacle: reset into |0…0⟩ then an obstacle on lane 0 is a certain hit', () => {
    for (const level of [1, 2] as Level[]) {
      let s = initRunner(level);
      s = runnerReducer(s, { type: 'gate', gate: 'H0' }, rng());
      s = { ...s, spawnCooldown: 1000, columns: [{ id: 0, kind: 'obstacle', lanes: [0], x: 0.001, resolved: false }] };
      s = runnerReducer(s, { type: 'reset' }, rng());
      s = runnerReducer(s, { type: 'tick', dt: 0.05 }, constRng(0.999999));
      expect(s.lives).toBe(2);
      expect(s.flash).toMatchObject({ kind: 'measure', hit: true, p: 1 });
    }
  });

  it('is a no-op once the run is over', () => {
    const over = { ...initRunner(1), status: 'over' as const, amps: applyGate(initialAmplitudes(1), 1, 'X0') };
    expect(runnerReducer(over, { type: 'reset' }, rng())).toBe(over);
  });
});

describe('pacing per level', () => {
  it('level 1 is exactly the historical pacing', () => {
    expect(LEVEL_RUNNER_CONFIG[1]).toBe(DEFAULT_RUNNER_CONFIG);
    expect(DEFAULT_RUNNER_CONFIG).toEqual({
      baseSpeed: 0.2,
      speedRamp: 0.006,
      maxSpeed: 0.62,
      spawnBase: 1.9,
      spawnRamp: 0.013,
      minSpawn: 0.7,
      startLives: 3,
    });
    expect(initRunner(1).config).toBe(DEFAULT_RUNNER_CONFIG);
  });

  it('level 2 starts at 70 % speed and takes about twice as long to reach top speed', () => {
    expect(LEVEL_RUNNER_CONFIG[2]).toBe(LEVEL2_RUNNER_CONFIG);
    expect(initRunner(2).config).toBe(LEVEL2_RUNNER_CONFIG);
    expect(LEVEL2_RUNNER_CONFIG.baseSpeed).toBeCloseTo(0.7 * DEFAULT_RUNNER_CONFIG.baseSpeed, 12);
    expect(LEVEL2_RUNNER_CONFIG.maxSpeed).toBe(DEFAULT_RUNNER_CONFIG.maxSpeed);
    expect(LEVEL2_RUNNER_CONFIG.minSpawn).toBe(DEFAULT_RUNNER_CONFIG.minSpawn);
    expect(LEVEL2_RUNNER_CONFIG.startLives).toBe(DEFAULT_RUNNER_CONFIG.startLives);
    expect(secondsToMaxSpeed(DEFAULT_RUNNER_CONFIG)).toBeCloseTo(70, 6);
    expect(secondsToMaxSpeed(LEVEL2_RUNNER_CONFIG)).toBeCloseTo(141.2, 1);
    expect(secondsToMinSpawn(DEFAULT_RUNNER_CONFIG)).toBeCloseTo(92.3, 1);
    expect(secondsToMinSpawn(LEVEL2_RUNNER_CONFIG)).toBeCloseTo(184.2, 1);
    // Never faster than level 1 at the same moment of the run.
    for (let t = 0; t <= 300; t += 5) {
      expect(speedAt(LEVEL2_RUNNER_CONFIG, t)).toBeLessThanOrEqual(speedAt(DEFAULT_RUNNER_CONFIG, t));
    }
  });

  it('a level switch picks up the new level\'s pacing; a custom config is kept', () => {
    const toTwo = runnerReducer(initRunner(1), { type: 'setLevel', level: 2 }, mulberry32(1));
    expect(toTwo.config).toBe(LEVEL2_RUNNER_CONFIG);
    const back = runnerReducer(toTwo, { type: 'setLevel', level: 1 }, mulberry32(1));
    expect(back.config).toBe(DEFAULT_RUNNER_CONFIG);
    expect(runnerReducer(toTwo, { type: 'restart' }, mulberry32(1)).config).toBe(LEVEL2_RUNNER_CONFIG);
    const custom = { ...DEFAULT_RUNNER_CONFIG, baseSpeed: 0.5 };
    const c2 = runnerReducer(initRunner(1, custom), { type: 'setLevel', level: 2 }, mulberry32(1));
    expect(c2.config).toBe(custom);
  });
});
