import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import { statevector } from './statevector';
import {
  HOLES,
  HOLE_IN_THRESHOLD,
  COURSE_PAR,
  ROUND_CLUBS,
  bestFidelity,
  evaluate,
  scoreName,
  golfStep,
  initialGolfState,
  holeHighlight,
  courseTotals,
  formatVsPar,
  loadBest,
  saveBest,
  GOLF_STORAGE_KEY,
  GOLF_HOLES_KEY,
} from './golf';

// The test board can emit gate types beyond the qamposer union (CH/S/T tiles).
const g = (type: string, position: number, extra: Partial<Gate> = {}): Gate => ({
  id: `${type}-${position}-${extra.qubit ?? extra.control ?? 0}`,
  type: type as Gate['type'],
  position,
  ...extra,
});

const circuit = (gates: Gate[]): Circuit => ({ qubits: 5, gates });
const empty = circuit([]);
const hole = (n: number) => HOLES[n - 1];

/** GHZ-k on q0..q(k-1): H q0 then a fan of CNOTs from q0. */
function ghz(k: number, base = 0): Gate[] {
  const gates: Gate[] = [g('H', base, { qubit: 0 })];
  for (let t = 1; t < k; t++) gates.push(g('CNOT', base + t, { control: 0, target: t }));
  return gates;
}

/** A circuit that follows each hole's reference path from the course spec. */
function refCircuit(n: number): Circuit {
  switch (n) {
    // EASY — GHZ family.
    case 1:
      return circuit([g('H', 0, { qubit: 0 })]);
    case 2:
      return circuit(ghz(2));
    case 3:
      return circuit(ghz(3));
    case 4:
      return circuit(ghz(4));
    case 5:
      return circuit(ghz(5));
    // MEDIUM — bit-flip variants.
    case 6: // M1 |1⟩
      return circuit([g('X', 0, { qubit: 0 })]);
    case 7: // M2 Ψ-plus = Bell + X
      return circuit([...ghz(2), g('X', 2, { qubit: 0 })]);
    case 8: // M3 flipped GHZ-3 = GHZ-3 + X
      return circuit([...ghz(3), g('X', 3, { qubit: 2 })]);
    case 9: // M4 flipped GHZ-4 = GHZ-4 + X
      return circuit([...ghz(4), g('X', 4, { qubit: 3 })]);
    case 10: // M5 flipped GHZ-5 = GHZ-5 + X
      return circuit([...ghz(5), g('X', 5, { qubit: 4 })]);
    // DIFFICULT — relative-phase.
    case 11: // D1 minus = H·Z
      return circuit([g('H', 0, { qubit: 0 }), g('Z', 1, { qubit: 0 })]);
    case 12: // D2 Φ-minus = Bell + Z
      return circuit([...ghz(2), g('Z', 2, { qubit: 0 })]);
    case 13: // D3 i-GHZ-3 = GHZ-3 + S (S tile)
      return circuit([...ghz(3), g('S', 3, { qubit: 0 })]);
    case 14: // D4 minus GHZ-4 = GHZ-4 + Z
      return circuit([...ghz(4), g('Z', 4, { qubit: 0 })]);
    case 15: // D5 i-GHZ-5 = GHZ-5 + S
      return circuit([...ghz(5), g('S', 5, { qubit: 0 })]);
    // EXTRA-HARD.
    case 16: // X1 magic-T = H·T (T tile)
      return circuit([g('H', 0, { qubit: 0 }), g('T', 1, { qubit: 0 })]);
    case 17: // X3 Cascade = H q0; CH q0→q1; CX q1→q2
      return circuit([
        g('H', 0, { qubit: 0 }),
        g('CH', 1, { control: 0, target: 1 }),
        g('CNOT', 2, { control: 1, target: 2 }),
      ]);
    case 18: // X5 golden GHZ = GHZ-5 + T
      return circuit([...ghz(5), g('T', 5, { qubit: 0 })]);
    default:
      throw new Error(`no reference for hole ${n}`);
  }
}

describe('course definition', () => {
  it('is 18 holes across four rounds in play order', () => {
    expect(HOLES.length).toBe(18);
    expect(HOLES.map((h) => h.hole)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(HOLES.map((h) => h.round)).toEqual([
      ...Array(5).fill('easy'),
      ...Array(5).fill('medium'),
      ...Array(5).fill('difficult'),
      'extra',
      'extra',
      'extra',
    ]);
    expect(HOLES.map((h) => h.code)).toEqual([
      'E1', 'E2', 'E3', 'E4', 'E5',
      'M1', 'M2', 'M3', 'M4', 'M5',
      'D1', 'D2', 'D3', 'D4', 'D5',
      'X1', 'X3', 'X5',
    ]);
  });

  it('has the spec pars and a course par of 65', () => {
    expect(HOLES.map((h) => h.par)).toEqual([
      1, 2, 3, 4, 5, // easy = 15
      1, 3, 4, 5, 6, // medium = 19
      2, 3, 4, 5, 6, // difficult = 20
      2, 3, 6, // extra = 11
    ]);
    expect(HOLES.reduce((s, h) => s + h.par, 0)).toBe(65);
    expect(COURSE_PAR).toBe(65);
  });

  it('1-qubit holes play Bloch, the rest Q-sphere', () => {
    for (const h of HOLES) expect(h.view).toBe(h.qubits === 1 ? 'bloch' : 'qsphere');
  });

  it('shows the round clubs hint (cumulative gate sets)', () => {
    expect(hole(1).clubs).toEqual(ROUND_CLUBS.easy);
    expect(hole(7).clubs).toEqual(ROUND_CLUBS.medium);
    expect(hole(13).clubs).toEqual(ROUND_CLUBS.difficult);
    expect(hole(17).clubs).toEqual(ROUND_CLUBS.extra);
    expect(ROUND_CLUBS.extra).toContain('CH');
    expect(ROUND_CLUBS.extra).toContain('T');
  });
});

describe('reachability — every reference path holes in', () => {
  it('the spec reference path clears its hole (fidelity ≥ 0.99)', () => {
    for (let n = 1; n <= 18; n++) {
      const h = hole(n);
      const ev = evaluate(refCircuit(n), h);
      expect(ev.fidelity, `hole ${n} (${h.code} ${h.name})`).toBeGreaterThan(0.99);
      expect(ev.holedIn, `hole ${n} (${h.code})`).toBe(true);
    }
  });

  it('reference paths hit their par stroke count', () => {
    for (let n = 1; n <= 18; n++) {
      expect(evaluate(refCircuit(n), hole(n)).strokes).toBe(hole(n).par);
    }
  });

  it('S and T tiles are equivalent to RZ(π/2)/RZ(π/4) (normalized)', () => {
    // D3 with an RZ(π/2) instead of the S tile also holes in.
    const rzHalf = circuit([...ghz(3), g('RZ', 3, { qubit: 0, parameter: Math.PI / 2 })]);
    expect(evaluate(rzHalf, hole(13)).holedIn).toBe(true);
    // X1 with an RZ(π/4) instead of the T tile also holes in.
    const rzQuarter = circuit([g('H', 0, { qubit: 0 }), g('RZ', 1, { qubit: 0, parameter: Math.PI / 4 })]);
    expect(evaluate(rzQuarter, hole(16)).holedIn).toBe(true);
  });

  it('accepts the answer built on any rows (best-over-placements)', () => {
    // Bell on non-canonical qubits.
    const bell = circuit([g('H', 0, { qubit: 2 }), g('CNOT', 1, { control: 2, target: 4 })]);
    expect(bestFidelity(bell, hole(2))).toBeGreaterThan(0.99);
    // Superposition on any single qubit.
    expect(evaluate(circuit([g('H', 0, { qubit: 3 })]), hole(1)).holedIn).toBe(true);
  });
});

describe('phase discrimination — phase-blind circuits cannot hole D/X', () => {
  it('a plain GHZ does not clear the relative-phase holes', () => {
    // D3 i-GHZ-3, D5 i-GHZ-5, D4 minus GHZ-4, X5 golden GHZ-5.
    expect(evaluate(circuit(ghz(3)), hole(13)).holedIn).toBe(false);
    expect(evaluate(circuit(ghz(4)), hole(14)).holedIn).toBe(false);
    expect(evaluate(circuit(ghz(5)), hole(15)).holedIn).toBe(false);
    expect(evaluate(circuit(ghz(5)), hole(18)).holedIn).toBe(false);
    // fidelity(GHZ, i-GHZ) is measurably below threshold (≈ 0.5).
    expect(bestFidelity(circuit(ghz(3)), hole(13))).toBeLessThan(0.99);
    expect(bestFidelity(circuit(ghz(5)), hole(18))).toBeLessThan(0.99);
  });

  it('a plain superposition does not clear the magic-T hole', () => {
    expect(evaluate(circuit([g('H', 0, { qubit: 0 })]), hole(16)).holedIn).toBe(false);
  });

  it('a bare H does not clear the Bell hole', () => {
    const ev = evaluate(circuit([g('H', 0, { qubit: 0 })]), hole(2));
    expect(ev.holedIn).toBe(false);
    expect(ev.fidelity).toBeLessThan(HOLE_IN_THRESHOLD);
  });
});

describe('Cascade (X3) exact amplitudes', () => {
  it('H q0; CH q0→q1; CX q1→q2 ⇒ (√2|000⟩ + |100⟩ + |111⟩)/2', () => {
    const sv = statevector(refCircuit(17));
    const R = Math.SQRT1_2;
    const mag = (i: number) => Math.hypot(sv[i].re, sv[i].im);
    // little-endian: |000⟩ = 0, |100⟩ (q0=1) = 1, |111⟩ = 7.
    expect(mag(0)).toBeCloseTo(R, 6);
    expect(mag(1)).toBeCloseTo(0.5, 6);
    expect(mag(7)).toBeCloseTo(0.5, 6);
    // Everything else is zero.
    let others = 0;
    for (let i = 0; i < sv.length; i++) if (i !== 0 && i !== 1 && i !== 7) others += mag(i);
    expect(others).toBeCloseTo(0, 6);
  });
});

describe('flip families accept any single-qubit flip', () => {
  it('M3 clears with the odd qubit in any position', () => {
    for (const flipped of [0, 1, 2]) {
      const c = circuit([...ghz(3), g('X', 3, { qubit: flipped })]);
      expect(evaluate(c, hole(8)).holedIn, `flip q${flipped}`).toBe(true);
    }
    // But a plain GHZ-3 (no flip) does NOT clear M3.
    expect(evaluate(circuit(ghz(3)), hole(8)).holedIn).toBe(false);
  });
});

describe('holeHighlight', () => {
  it('names the canonical target basis states on the lowest qubits', () => {
    expect(holeHighlight(hole(3))).toEqual(new Set([0, 7])); // GHZ-3: |000⟩,|111⟩
    expect(holeHighlight(hole(6))).toEqual(new Set([1])); // |1⟩ on q0
    expect(holeHighlight(hole(7))).toEqual(new Set([1, 2])); // Ψ-plus |01⟩,|10⟩
    expect(holeHighlight(hole(17))).toEqual(new Set([0, 1, 7])); // Cascade
  });
});

describe('scoreName', () => {
  it('names scores by strokes vs par', () => {
    expect(scoreName(1, 3)).toBe('EAGLE');
    expect(scoreName(2, 3)).toBe('BIRDIE');
    expect(scoreName(3, 3)).toBe('PAR');
    expect(scoreName(5, 3)).toBe('HOLE IN +2');
    expect(scoreName(1, 1)).toBe('PAR');
  });
});

describe('course totals', () => {
  it('sums best vs par across completed holes only', () => {
    // Cleared E1 (par 1) in 1, E3 (par 3) in 2 → 3 strokes, par 4 → −1.
    const t = courseTotals({ 1: 1, 3: 2 });
    expect(t).toEqual({ completed: 2, strokes: 3, par: 4, vsPar: -1 });
  });

  it('formats vs-par golf-style', () => {
    expect(formatVsPar(0)).toBe('E');
    expect(formatVsPar(3)).toBe('+3');
    expect(formatVsPar(-2)).toBe('−2');
  });
});

describe('golfStep state machine', () => {
  it('holes in, latches, records best, and advances on board clear', () => {
    let state = initialGolfState();

    let step = golfStep(state, refCircuit(1));
    expect(step.justHoledIn).toBe(true);
    expect(step.holedIn).toBe(true);
    expect(step.scoreName).toBe('PAR');
    expect(step.state.best[1]).toBe(1);
    state = step.state;

    // Wiggling keeps the latch (no re-fire).
    step = golfStep(state, refCircuit(1));
    expect(step.justHoledIn).toBe(false);
    expect(step.holedIn).toBe(true);
    state = step.state;

    // Board clear advances to hole 2.
    step = golfStep(state, empty);
    expect(step.advanced).toBe(true);
    expect(step.state.levelIndex).toBe(1);
    expect(step.hole.hole).toBe(2);
    state = step.state;

    step = golfStep(state, refCircuit(2));
    expect(step.justHoledIn).toBe(true);
    expect(step.state.best[2]).toBe(2);
  });

  it('board clear without a hole-in does not advance', () => {
    const state = initialGolfState();
    const partial = golfStep(state, circuit([g('Y', 0, { qubit: 0 })]));
    expect(partial.holedIn).toBe(false);
    const cleared = golfStep(partial.state, empty);
    expect(cleared.advanced).toBe(false);
    expect(cleared.state.levelIndex).toBe(0);
  });

  it('does not lower best when re-holing with more strokes', () => {
    const state = initialGolfState({ 1: 1 });
    const twoGate = circuit([g('H', 0, { qubit: 0 }), g('Z', 1, { qubit: 4 })]);
    expect(evaluate(twoGate, hole(1)).holedIn).toBe(true);
    const step = golfStep(state, twoGate);
    expect(step.state.best[1]).toBe(1);
  });

  it('plays the whole course, completes after hole 18, then restarts', () => {
    let state = initialGolfState();
    for (let n = 1; n <= 18; n++) {
      const inStep = golfStep(state, refCircuit(n));
      expect(inStep.holedIn, `hole ${n} hole-in`).toBe(true);
      expect(inStep.state.best[n]).toBe(hole(n).par);
      state = inStep.state;

      const clear = golfStep(state, empty);
      state = clear.state;
      if (n < 18) {
        expect(clear.advanced, `advance after hole ${n}`).toBe(true);
        expect(state.levelIndex).toBe(n);
      } else {
        expect(clear.justCompleted).toBe(true);
        expect(clear.complete).toBe(true);
        expect(state.complete).toBe(true);
      }
    }

    // Final total: every hole cleared at par → even.
    const totals = courseTotals(state.best);
    expect(totals.completed).toBe(18);
    expect(totals.strokes).toBe(COURSE_PAR);
    expect(totals.vsPar).toBe(0);

    // On the complete screen, a board-clear restarts at hole 1 (best kept).
    const restart = golfStep(state, empty);
    expect(restart.restarted).toBe(true);
    expect(restart.state.levelIndex).toBe(0);
    expect(restart.state.complete).toBe(false);
    expect(restart.state.best[18]).toBe(hole(18).par); // best carried over
  });

  it('holds the complete screen while gates sit on the board', () => {
    const state = { levelIndex: 17, holedIn: false, complete: true, best: {} as Record<number, number> };
    const step = golfStep(state, circuit([g('H', 0, { qubit: 0 })]));
    expect(step.complete).toBe(true);
    expect(step.restarted).toBe(false);
    expect(step.state.complete).toBe(true);
  });
});

describe('best persistence + migration', () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      _map: map,
    };
  }

  it('round-trips best scores under the per-hole key', () => {
    const storage = fakeStorage();
    saveBest(storage, { 1: 1, 8: 4 });
    expect(loadBest(storage)).toEqual({ 1: 1, 8: 4 });
    expect(storage._map.has(GOLF_HOLES_KEY)).toBe(true);
  });

  it('migrates the legacy per-level best into E1..E5 and drops the old key', () => {
    const storage = fakeStorage({ [GOLF_STORAGE_KEY]: JSON.stringify({ 1: 1, 3: 3, 5: 5 }) });
    const best = loadBest(storage);
    expect(best).toEqual({ 1: 1, 3: 3, 5: 5 }); // levels 1/3/5 → holes E1/E3/E5
    // Persisted under the new key, old key removed.
    expect(storage._map.has(GOLF_HOLES_KEY)).toBe(true);
    expect(storage._map.has(GOLF_STORAGE_KEY)).toBe(false);
    // A second load reads the migrated key unchanged.
    expect(loadBest(storage)).toEqual({ 1: 1, 3: 3, 5: 5 });
  });

  it('prefers the per-hole key over a stale legacy key', () => {
    const storage = fakeStorage({
      [GOLF_HOLES_KEY]: JSON.stringify({ 12: 3 }),
      [GOLF_STORAGE_KEY]: JSON.stringify({ 1: 1 }),
    });
    expect(loadBest(storage)).toEqual({ 12: 3 });
  });

  it('tolerates missing / corrupt storage', () => {
    expect(loadBest(null)).toEqual({});
    const bad = fakeStorage({ [GOLF_HOLES_KEY]: 'not json' });
    expect(loadBest(bad)).toEqual({});
  });
});
