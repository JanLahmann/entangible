import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import { statevector } from './statevector';
import {
  HOLES,
  HOLE_IN_THRESHOLD,
  COURSE_PAR,
  ROUND_CLUBS,
  clubGateTypes,
  bestFidelity,
  evaluate,
  holeSolution,
  strokeDelta,
  scoreName,
  scoreKind,
  completionCelebration,
  formatDuration,
  LEGENDARY_VS_PAR,
  ROUND_CODE,
  golfStep,
  initialGolfState,
  holeHighlight,
  courseTotals,
  formatVsPar,
  loadBest,
  saveBest,
  GOLF_LEGACY_KEYS,
  GOLF_COURSE_VERSION,
  GOLF_HOLES_KEY,
  GOLF_REVEALED_KEY,
  holeScore,
  golfReveal,
  golfWipe,
  golfJumpTo,
  GOLF_SCOPES,
  scopeLabel,
  scopeHoles,
  scopeCode,
  parseScope,
  coursePar,
  loadRevealed,
  saveRevealed,
  type Hole,
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

/**
 * Each hole's reference path — the PROD solution the card reveals after a
 * hole-in (#71). Deliberately not a second copy: these circuits used to live
 * here, and the assertions below (holes in, costs par − 2) are exactly what
 * makes them trustworthy to show a player, so they must run against the data
 * the player actually sees.
 */
function refCircuit(n: number): Circuit {
  const solution = hole(n).solution;
  if (!solution) throw new Error(`no solution for hole ${n}`);
  return solution;
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

  it('has the spec pars (minimum + 2) and a course par of 108', () => {
    expect(HOLES.map((h) => h.par)).toEqual([
      3, 4, 5, 7, 7, // easy = 26
      4, 5, 6, 8, 8, // medium = 31
      4, 5, 7, 8, 9, // difficult = 33
      6, 5, 7, // extra = 18
    ]);
    expect(HOLES.reduce((s, h) => s + h.par, 0)).toBe(108);
    expect(COURSE_PAR).toBe(108);
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

  it('maps the clubs to library gate types for the on-screen palette (#55)', () => {
    // Only CX is respelled; the order of the clubs hint is preserved.
    expect(clubGateTypes(hole(1))).toEqual(['X', 'H', 'CNOT']);
    expect(clubGateTypes(hole(7))).toEqual(['X', 'H', 'CNOT', 'Y']);
    expect(clubGateTypes(hole(13))).toEqual(['X', 'H', 'CNOT', 'Y', 'Z', 'S']);
    expect(clubGateTypes(hole(17))).toEqual(['X', 'H', 'CNOT', 'Y', 'Z', 'S', 'T', 'CH']);
  });

  it('offers a club for every hole, and never a gate the library cannot drop', () => {
    // Guards the palette prop: an unknown type would silently vanish from the
    // library's gate list, leaving a round short of a club.
    const LIBRARY_TYPES = new Set([
      'H', 'X', 'Y', 'Z', 'S', 'T', 'RX', 'RY', 'RZ',
      'CNOT', 'CY', 'CZ', 'CH', 'CS', 'CT', 'CCX',
    ]);
    for (const h of HOLES) {
      const types = clubGateTypes(h);
      expect(types.length, `hole ${h.hole} (${h.code})`).toBe(h.clubs.length);
      for (const t of types) expect(LIBRARY_TYPES.has(t), `hole ${h.hole}: ${t}`).toBe(true);
    }
  });
});

describe('reachability — every published solution holes in', () => {
  it('every hole publishes a solution, and it is the one holeSolution names', () => {
    for (let n = 1; n <= 18; n++) {
      expect(hole(n).solution, `hole ${n} (${hole(n).code})`).toBeDefined();
      expect(hole(n).solution).toEqual(holeSolution(n));
    }
    expect(() => holeSolution(19)).toThrow();
  });

  it('the spec reference path clears its hole (fidelity ≥ 0.99)', () => {
    for (let n = 1; n <= 18; n++) {
      const h = hole(n);
      const ev = evaluate(refCircuit(n), h);
      expect(ev.fidelity, `hole ${n} (${h.code} ${h.name})`).toBeGreaterThan(0.99);
      expect(ev.holedIn, `hole ${n} (${h.code})`).toBe(true);
    }
  });

  it('reference paths hit par − 2 (the minimum; par carries a 2-stroke margin)', () => {
    for (let n = 1; n <= 18; n++) {
      expect(evaluate(refCircuit(n), hole(n)).gateCount).toBe(hole(n).par - 2);
      expect(strokeDelta(empty, refCircuit(n))).toBe(hole(n).par - 2);
    }
  });

  it('draws on the hole’s own wires — a solution never reaches past q(k−1)', () => {
    // What `MiniCircuit` is handed: `n = hole.qubits` wires. A solution that
    // touched a higher wire would draw a row the hole does not have.
    for (let n = 1; n <= 18; n++) {
      for (const gate of hole(n).solution!.gates) {
        for (const q of [gate.qubit, gate.control, gate.control2, gate.target]) {
          if (q === undefined) continue;
          expect(q, `hole ${n} (${hole(n).code})`).toBeLessThan(hole(n).qubits);
        }
      }
    }
  });

  it('S and T tiles are equivalent to RZ(π/2)/RZ(π/4) (normalized)', () => {
    // D2 (i-Bell) with an RZ(π/2) instead of the S tile also holes in.
    const rzHalf = circuit([...ghz(2), g('RZ', 2, { qubit: 0, parameter: Math.PI / 2 })]);
    expect(evaluate(rzHalf, hole(12)).holedIn).toBe(true);
    // X1 (lopsided coin) with an RZ(π/4) instead of the T tile also holes in.
    const rzQuarter = circuit([
      g('X', 0, { qubit: 0 }),
      g('H', 1, { qubit: 0 }),
      g('RZ', 2, { qubit: 0, parameter: Math.PI / 4 }),
      g('H', 3, { qubit: 0 }),
    ]);
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

describe('same odds, different state — the colour decides (twin holes)', () => {
  // E1/M1/D1 are all fair coins, E2/D2 and E4/M4 share their histograms: only
  // the phase (the Q-sphere colour) tells them apart, and fidelity must too.
  const twins: [number, number][] = [
    [1, 6], [1, 11], [6, 11], // |+⟩, |−⟩, |i⟩
    [2, 12], // Φ+ vs i-Bell
    [4, 9], // two couples vs minus couples
    [5, 15], // GHZ-5 vs −i GHZ-5
  ];
  it('a twin\'s answer never holes the other twin in', () => {
    for (const [a, b] of twins) {
      expect(evaluate(refCircuit(a), hole(b)).holedIn, `${hole(a).code} on ${hole(b).code}`).toBe(false);
      expect(evaluate(refCircuit(b), hole(a)).holedIn, `${hole(b).code} on ${hole(a).code}`).toBe(false);
      expect(bestFidelity(refCircuit(a), hole(b))).toBeLessThan(0.9);
    }
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

describe('relabelling is free — any wires, any order', () => {
  it('E3 (coin, flip, coin) clears with the sure 1 on any wire', () => {
    for (const one of [0, 1, 2, 3, 4]) {
      const coins = [0, 1, 2, 3, 4].filter((q) => q !== one).slice(0, 2);
      const c = circuit([
        g('X', 0, { qubit: one }),
        g('H', 1, { qubit: coins[0] }),
        g('H', 2, { qubit: coins[1] }),
      ]);
      expect(evaluate(c, hole(3)).holedIn, `the 1 on q${one}`).toBe(true);
    }
    // Three coins (no flip) do NOT clear it.
    const threeCoins = circuit([0, 1, 2].map((q) => g('H', q, { qubit: q })));
    expect(evaluate(threeCoins, hole(3)).holedIn).toBe(false);
  });

  it('M5 (odd one out) clears with any ball as the odd one', () => {
    for (const odd of [0, 1, 2, 3, 4]) {
      const c = circuit([...ghz(5), g('Y', 5, { qubit: odd })]);
      expect(evaluate(c, hole(10)).holedIn, `odd q${odd}`).toBe(true);
    }
    expect(evaluate(circuit(ghz(5)), hole(10)).holedIn).toBe(false);
  });
});

describe('holeHighlight', () => {
  it('names the canonical target basis states on the lowest qubits', () => {
    expect(holeHighlight(hole(2))).toEqual(new Set([0, 3])); // Bell: |00⟩,|11⟩
    expect(holeHighlight(hole(3))).toEqual(new Set([2, 3, 6, 7])); // |+⟩|1⟩|+⟩: q1 = 1
    expect(holeHighlight(hole(7))).toEqual(new Set([1, 2])); // singlet |01⟩,|10⟩
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

  it('classifies the same scores for the chip colours (#74)', () => {
    expect(scoreKind(1, 3)).toBe('eagle');
    expect(scoreKind(2, 3)).toBe('birdie');
    expect(scoreKind(3, 3)).toBe('par');
    expect(scoreKind(5, 3)).toBe('over');
    // The name is written FROM the kind, so a colour can never disagree with
    // the word on the holed-in line.
    for (const par of [3, 5, 8]) {
      for (let s = 1; s <= par + 3; s++) {
        const named = scoreName(s, par);
        const kind = scoreKind(s, par);
        expect(named.startsWith(kind === 'over' ? 'HOLE IN' : kind.toUpperCase())).toBe(true);
      }
    }
  });
});

describe('course timer formatting (#83)', () => {
  it('writes mm:ss, and grows an hours field only when it needs one', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9_000)).toBe('0:09');
    expect(formatDuration(69_000)).toBe('1:09');
    expect(formatDuration(12 * 60_000 + 34_000)).toBe('12:34');
    expect(formatDuration(59 * 60_000 + 59_400)).toBe('59:59');
    expect(formatDuration(3600_000)).toBe('1:00:00');
    expect(formatDuration(3600_000 + 5 * 60_000 + 7_000)).toBe('1:05:07');
    // Never negative, however the clocks disagree.
    expect(formatDuration(-5_000)).toBe('0:00');
  });
});

describe('course-end celebration (#80)', () => {
  it('tiers the round by vs-par, and names the result in the copy', () => {
    // Every hole played at the minimum on the classic course is −36; the
    // legendary line is −18, i.e. "you found the good line most of the way".
    expect(completionCelebration(-36).tier).toBe('legendary');
    expect(completionCelebration(LEGENDARY_VS_PAR).tier).toBe('legendary');
    expect(completionCelebration(LEGENDARY_VS_PAR + 1).tier).toBe('under');
    expect(completionCelebration(-1).tier).toBe('under');
    expect(completionCelebration(0).tier).toBe('even');
    expect(completionCelebration(1).tier).toBe('over');

    expect(completionCelebration(-20).copy).toBe('Legendary round — 20 under par!');
    expect(completionCelebration(-4).copy).toBe('4 under par!');
    expect(completionCelebration(0).copy).toBe('Even par — course complete!');
    expect(completionCelebration(3).copy).toBe('Course complete — +3.');
  });

  it('quotes the round\u2019s time when there is one (#83)', () => {
    const ms = 12 * 60_000 + 34_000;
    expect(completionCelebration(-20, ms).copy).toBe(
      'Legendary round — 20 under par in 12:34!',
    );
    expect(completionCelebration(-4, ms).copy).toBe('4 under par in 12:34!');
    expect(completionCelebration(0, ms).copy).toBe('Even par — course complete in 12:34!');
    expect(completionCelebration(3, ms).copy).toBe('Course complete — +3 in 12:34.');
    // An untimed round (the clock never started) reads exactly as before.
    expect(completionCelebration(-4, null).copy).toBe('4 under par!');
  });

  it('scales the burst with the round, and never inverts the ordering', () => {
    const tiers = [-36, -4, 0, 5].map((v) => completionCelebration(v).intensity);
    expect(tiers).toEqual([...tiers].sort((a, b) => b - a));
    expect(completionCelebration(-36).intensity).toBeGreaterThan(1);
    expect(completionCelebration(9).intensity).toBeLessThan(1);
    // A modest round still gets a burst — finishing 18 holes is finishing.
    for (const v of [-36, -1, 0, 12]) {
      expect(completionCelebration(v).intensity).toBeGreaterThan(0);
      expect(completionCelebration(v).copy.length).toBeGreaterThan(0);
    }
  });
});

describe('round codes (#74)', () => {
  it('gives the extra round its own letter, and matches every hole code', () => {
    expect(ROUND_CODE).toEqual({ easy: 'E', medium: 'M', difficult: 'D', extra: 'X' });
    // The bug this fixes: deriving the letter from ROUND_LABEL printed "Extra"
    // as "E", colliding with "Easy" on the scorecard's fourth row.
    expect(ROUND_CODE.extra).not.toBe(ROUND_CODE.easy);
    for (const h of HOLES) expect(h.code.charAt(0), `hole ${h.hole}`).toBe(ROUND_CODE[h.round]);
  });
});

describe('strokeDelta — the per-change edit distance (#68)', () => {
  it('charges 1 per add and 1 per delete', () => {
    const h = circuit([g('H', 0, { qubit: 0 })]);
    expect(strokeDelta(empty, h)).toBe(1);
    expect(strokeDelta(h, empty)).toBe(1);
    expect(strokeDelta(empty, circuit(ghz(3)))).toBe(3);
    expect(strokeDelta(circuit(ghz(3)), circuit(ghz(2)))).toBe(1);
    expect(strokeDelta(circuit(ghz(2)), circuit(ghz(3)))).toBe(1);
  });

  it('is free to slide a gate along its wire (position is excluded)', () => {
    expect(
      strokeDelta(circuit([g('H', 0, { qubit: 0 })]), circuit([g('H', 4, { qubit: 0 })])),
    ).toBe(0);
    // Auto-compaction after a delete shifts everything left — only the delete counts.
    const before = circuit([
      g('X', 0, { qubit: 0 }),
      g('H', 1, { qubit: 1 }),
      g('Y', 2, { qubit: 2 }),
    ]);
    const after = circuit([g('X', 0, { qubit: 0 }), g('Y', 1, { qubit: 2 })]);
    expect(strokeDelta(before, after)).toBe(1);
  });

  it('charges 2 (remove + add) for rewiring or retyping a gate', () => {
    const h0 = circuit([g('H', 0, { qubit: 0 })]);
    expect(strokeDelta(h0, circuit([g('H', 0, { qubit: 1 })]))).toBe(2); // rewired
    expect(strokeDelta(h0, circuit([g('X', 0, { qubit: 0 })]))).toBe(2); // retyped
    // Swapping a CNOT's control and target is a rewire, not a move.
    expect(
      strokeDelta(
        circuit([g('CNOT', 0, { control: 0, target: 1 })]),
        circuit([g('CNOT', 0, { control: 1, target: 0 })]),
      ),
    ).toBe(2);
  });

  it('treats identical gates as a multiset', () => {
    const one = circuit([g('X', 0, { qubit: 0 })]);
    const two = circuit([g('X', 0, { qubit: 0 }), g('X', 1, { qubit: 0 })]);
    expect(strokeDelta(one, two)).toBe(1);
    expect(strokeDelta(two, one)).toBe(1);
    expect(strokeDelta(two, two)).toBe(0);
  });

  it('tells the rotation tiles apart by angle (RZ(π/2) ≠ RZ(π/4))', () => {
    const s = circuit([g('RZ', 0, { qubit: 0, parameter: Math.PI / 2 })]);
    const t = circuit([g('RZ', 0, { qubit: 0, parameter: Math.PI / 4 })]);
    expect(strokeDelta(s, t)).toBe(2);
    expect(strokeDelta(s, s)).toBe(0);
  });
});

describe('cumulative strokes per hole (#68)', () => {
  const holeState = (n: number) => ({ ...initialGolfState(), levelIndex: n - 1 });

  it('charges the retry: a deleted wrong tile still costs a stroke', () => {
    const rightBell = refCircuit(2); // H q0 ; CNOT q0→q1 (par 2)
    let step = golfStep(holeState(2), circuit([g('H', 0, { qubit: 0 })]));
    expect(step.strokes).toBe(1);

    // A wrong CNOT lands (2), comes off again (3), the right one lands (4).
    step = golfStep(step.state, circuit([g('H', 0, { qubit: 0 }), g('CNOT', 1, { control: 2, target: 3 })]));
    expect(step.strokes).toBe(2);
    expect(step.holedIn).toBe(false);
    step = golfStep(step.state, circuit([g('H', 0, { qubit: 0 })]));
    expect(step.strokes).toBe(3);
    step = golfStep(step.state, rightBell);
    expect(step.strokes).toBe(4);
    expect(step.justHoledIn).toBe(true);
    expect(step.scoreName).toBe('PAR'); // par 4 (min 2 + 2), four strokes
    expect(step.state.best[2]).toBe(4);
  });

  it('charges a fumble that passes through an empty board (#73)', () => {
    // The case the old "any empty board is a fresh tee-off" rule wiped clean:
    // on a ONE-gate hole, a wrong tile has to come off before the right one
    // goes on, so the board is momentarily empty. That is a fumble, and it is
    // now scored as one — three strokes (par), not one (an undeserved eagle).
    let step = golfStep(holeState(1), circuit([g('X', 0, { qubit: 0 })])); // wrong club
    expect(step.strokes).toBe(1);
    expect(step.holedIn).toBe(false);
    step = golfStep(step.state, empty); // off it comes …
    expect(step.strokes).toBe(2);
    expect(step.advanced).toBe(false);
    step = golfStep(step.state, circuit([g('H', 0, { qubit: 0 })])); // … the right one on
    expect(step.strokes).toBe(3);
    expect(step.justHoledIn).toBe(true);
    expect(step.scoreName).toBe('PAR'); // par 3 (min 1 + 2)
    expect(step.state.best[1]).toBe(3);
  });

  it('stops counting once the ball is in, and tees the next hole off at zero', () => {
    // Hole in E2 at par, then lift the tiles one at a time (the camera path).
    let step = golfStep(holeState(2), refCircuit(2));
    expect(step.strokes).toBe(2);
    expect(step.justHoledIn).toBe(true);

    step = golfStep(step.state, circuit([g('H', 0, { qubit: 0 })]));
    expect(step.strokes).toBe(2); // teardown is not a stroke
    expect(step.state.best[2]).toBe(2);

    step = golfStep(step.state, empty); // last tile off → advance
    expect(step.advanced).toBe(true);
    expect(step.hole.hole).toBe(3);
    expect(step.strokes).toBe(0);
    expect(step.state.strokes).toBe(0);
    expect(step.state.gateKeys).toEqual({}); // tee-off baseline is EMPTY …

    // … so a stale tile the camera still sees on the new hole can only ever be
    // charged as an add, never as a leftover removal from the hole before.
    step = golfStep(step.state, circuit([g('H', 0, { qubit: 0 })]));
    expect(step.strokes).toBe(1);
    // Lifting it again is a stroke like any other: hole 3 is not holed in, so
    // the count carries on (#73) instead of teeing off afresh.
    step = golfStep(step.state, empty);
    expect(step.state.strokes).toBe(2);
    expect(step.state.gateKeys).toEqual({});
  });

  it('charges 2 for an occlusion-style remove + re-add of the same gate', () => {
    // Deliberate: the tile stabiliser upstream already hysteresis-filters, so a
    // gate that disappears and comes back is a REAL table event, worth a delete
    // plus an add. No extra debouncing lives in the engine.
    let step = golfStep(holeState(5), circuit(ghz(5)));
    expect(step.strokes).toBe(5);
    expect(step.justHoledIn).toBe(true);
    expect(step.state.best[5]).toBe(5);

    // Replay the same hole: a flicker mid-build costs two strokes.
    let state = golfStep(step.state, empty).state; // clear → advance to hole 6
    state = { ...state, levelIndex: 4, holedIn: false }; // back on hole 5
    step = golfStep(state, circuit(ghz(4)));
    expect(step.strokes).toBe(4);
    step = golfStep(step.state, circuit(ghz(3))); // a CNOT occluded
    expect(step.strokes).toBe(5);
    step = golfStep(step.state, circuit(ghz(4))); // … and back
    expect(step.strokes).toBe(6);
    step = golfStep(step.state, circuit(ghz(5)));
    expect(step.strokes).toBe(7);
    expect(step.justHoledIn).toBe(true);
    expect(step.scoreName).toBe('PAR'); // par 7 (min 5 + 2), seven strokes
    expect(step.state.best[5]).toBe(5); // the flicker-free run keeps the best
  });

  it('keeps counting through a mid-hole wipe (#73), and resets on the restart', () => {
    let step = golfStep(holeState(5), circuit(ghz(2)));
    expect(step.strokes).toBe(2);
    // Sweeping the board without holing in is neither an advance nor a do-over:
    // the two tiles lifted are two more strokes, and the hole plays on.
    step = golfStep(step.state, empty);
    expect(step.advanced).toBe(false);
    expect(step.state.levelIndex).toBe(4);
    expect(step.strokes).toBe(4);
    expect(step.state.strokes).toBe(4);
    expect(step.state.gateKeys).toEqual({});

    // Rebuilding from the swept board keeps adding to the same card, so a
    // player cannot wipe an expensive hole clean by starting over.
    step = golfStep(step.state, circuit(ghz(5)));
    expect(step.strokes).toBe(9);
    expect(step.justHoledIn).toBe(true);
    expect(step.state.best[5]).toBe(9);

    // The complete screen: tiles sitting on it cost nothing, the restart is clean.
    const done = { ...initialGolfState({ 1: 1 }), levelIndex: 17, complete: true };
    step = golfStep(done, circuit(ghz(3)));
    expect(step.complete).toBe(true);
    expect(step.strokes).toBe(0);
    step = golfStep(step.state, empty);
    expect(step.restarted).toBe(true);
    expect(step.state.strokes).toBe(0);
    expect(step.state.gateKeys).toEqual({});
  });
});

describe('course totals', () => {
  it('sums best vs par across completed holes only', () => {
    // Cleared E1 (par 1) in 1, E3 (par 3) in 2 → 3 strokes, par 4 → −1.
    const t = courseTotals({ 1: 1, 3: 2 });
    expect(t).toEqual({ completed: 2, strokes: 3, par: 8, vsPar: -5 });
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
    expect(step.scoreName).toBe('EAGLE'); // minimum play beats the +2 par
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
      expect(inStep.state.best[n]).toBe(hole(n).par - 2); // reference = minimum
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

    // Final total: every hole cleared at the minimum → 2 under par apiece.
    const totals = courseTotals(state.best);
    expect(totals.completed).toBe(18);
    expect(totals.strokes).toBe(COURSE_PAR - 36);
    expect(totals.vsPar).toBe(-36);

    // On the complete screen, a board-clear restarts at hole 1 (best kept).
    const restart = golfStep(state, empty);
    expect(restart.restarted).toBe(true);
    expect(restart.state.levelIndex).toBe(0);
    expect(restart.state.complete).toBe(false);
    expect(restart.state.best[18]).toBe(hole(18).par - 2); // best carried over
  });

  it('holds the complete screen while gates sit on the board', () => {
    const state = {
      levelIndex: 17,
      holedIn: false,
      complete: true,
      best: {} as Record<number, number>,
      strokes: 0,
      gateKeys: {},
    };
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

  it('keys bests and reveals by the course version', () => {
    expect(GOLF_COURSE_VERSION).toBe(2);
    expect(GOLF_HOLES_KEY).toBe('entangible.pocket.golf.v2.holes');
    expect(GOLF_REVEALED_KEY).toBe('entangible.pocket.golf.v2.revealed');
    expect(GOLF_LEGACY_KEYS).not.toContain(GOLF_HOLES_KEY);
    expect(GOLF_LEGACY_KEYS).not.toContain(GOLF_REVEALED_KEY);
  });

  it('ignores every older course\'s records — they belong to holes that are gone', () => {
    // Version 1's per-hole bests/reveals and the 5-level course's per-level
    // bests, as a device that played them still holds them.
    const storage = fakeStorage({
      'entangible.pocket.golf': JSON.stringify({ 1: 1, 3: 3 }),
      'entangible.pocket.golf.holes': JSON.stringify({ 1: 1, 7: 3, 17: 3 }),
      'entangible.pocket.golf.revealed': JSON.stringify({ 2: true }),
    });
    expect(loadBest(storage)).toEqual({});
    expect(loadRevealed(storage)).toEqual({});
    // Nothing is migrated, rewritten or deleted.
    expect([...storage._map.keys()].sort()).toEqual([...GOLF_LEGACY_KEYS].sort());
    // Corrupt legacy data cannot crash a load either.
    const junk = fakeStorage(Object.fromEntries(GOLF_LEGACY_KEYS.map((k) => [k, '{ nope'])));
    expect(loadBest(junk)).toEqual({});
    expect(loadRevealed(junk)).toEqual({});
  });

  it('a new best lands beside the old records, never on top of them', () => {
    const storage = fakeStorage({ 'entangible.pocket.golf.holes': JSON.stringify({ 1: 1 }) });
    saveBest(storage, { 1: 3 });
    expect(loadBest(storage)).toEqual({ 1: 3 });
    expect(storage._map.get('entangible.pocket.golf.holes')).toBe(JSON.stringify({ 1: 1 }));
  });

  it('tolerates missing / corrupt storage', () => {
    expect(loadBest(null)).toEqual({});
    const bad = fakeStorage({ [GOLF_HOLES_KEY]: 'not json' });
    expect(loadBest(bad)).toEqual({});
  });
});

describe('the price of the mid-hole reveal (#99)', () => {
  const holeState = (n: number) => ({ ...initialGolfState(), levelIndex: n - 1 });

  it('floors a revealed hole at double par, and leaves the rest alone', () => {
    expect(holeScore(4, 4, false)).toBe(4);
    expect(holeScore(4, 4, true)).toBe(8); // clean play after a peek: double par
    expect(holeScore(11, 4, true)).toBe(11); // a shambles is still the shambles
    expect(holeScore(0, 3, true)).toBe(6);
  });

  it('records double par when the answer was revealed mid-hole', () => {
    // E2, par 4: build the Bell pair in two strokes — an eagle, but for the
    // reveal taken along the way.
    const peeked = golfReveal(holeState(2), 2);
    expect(peeked.revealed[2]).toBe(true);
    const step = golfStep(peeked, refCircuit(2));
    expect(step.justHoledIn).toBe(true);
    expect(step.strokes).toBe(2); // the board record is untouched (#68)
    expect(step.score).toBe(8); // …the CARD record is floored at 2 × par
    expect(step.state.best[2]).toBe(8);
    expect(step.scoreName).toBe('HOLE IN +4');
  });

  it('is charged once per hole — reopening the drawing is free', () => {
    const once = golfReveal(holeState(2), 2);
    const twice = golfReveal(once, 2);
    expect(twice).toBe(once); // same object: nothing happened at all
  });

  it('is free once the ball is in — that reveal is the pedagogy (#71)', () => {
    const holed = golfStep(holeState(2), refCircuit(2));
    expect(holed.state.holedIn).toBe(true);
    expect(golfReveal(holed.state, 2)).toBe(holed.state);
    expect(holed.state.best[2]).toBe(2); // the eagle stands
  });

  it('flows into vs-par, the totals and the celebration with no special-casing', () => {
    const step = golfStep(golfReveal(holeState(2), 2), refCircuit(2));
    // scoreKind reads the recorded score like any other, so a revealed hole is
    // simply an over-par hole from here on.
    expect(scoreKind(step.score, hole(2).par)).toBe('over');
    const totals = courseTotals(step.state.best);
    expect(totals.strokes).toBe(8);
    expect(totals.vsPar).toBe(4);
  });

  it('keeps the price across a replay of the same hole, and drops it on a restart', () => {
    // Seen once, floored ever after within the round: a reveal must not become
    // a free lesson followed by a free eagle.
    let step = golfStep(golfReveal(holeState(2), 2), refCircuit(2));
    step = golfStep(step.state, empty); // advance to hole 3
    expect(step.state.revealed[2]).toBe(true);

    // …but the board-clear that restarts a finished course deals new prices.
    const finished = { ...initialGolfState(), complete: true, revealed: { 2: true } };
    const restarted = golfStep(finished, empty);
    expect(restarted.restarted).toBe(true);
    expect(restarted.state.revealed).toEqual({});
    expect(restarted.state.best).toEqual(finished.best); // the record stands
  });

  it('round-trips the paid holes through storage (a refresh keeps them)', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    saveRevealed(storage, { 2: true, 7: true });
    expect(loadRevealed(storage)).toEqual({ 2: true, 7: true });
    // A state restored from storage still knows the price was paid …
    const restored = initialGolfState(loadBest(storage), 'classic', 0, loadRevealed(storage));
    expect(restored.revealed[2]).toBe(true);
    expect(golfReveal(restored, 2)).toBe(restored);
    // … and nonsense in storage reads as "nothing revealed", never as a throw.
    store.set(GOLF_REVEALED_KEY, '{ not json');
    expect(loadRevealed(storage)).toEqual({});
    expect(loadRevealed(null)).toEqual({});
  });

});

describe('the empty board is scored like any circuit (#12)', () => {
  const holeState = (n: number) => ({ ...initialGolfState(), levelIndex: n - 1 });

  it('|0…0⟩ reports its real fidelity: 50 % on E1, E2, E5; 0 where a wire must be 1', () => {
    const expected = [0.5, 0.5, 0, 0, 0.5]; // E3 and E4 carry a certain / paired 1
    for (const n of [1, 2, 3, 4, 5]) {
      const ev = evaluate(empty, hole(n));
      expect(ev.fidelity, hole(n).code).toBeCloseTo(expected[n - 1], 12);
      expect(ev.holedIn).toBe(false);
      expect(ev.gateCount).toBe(0);
      // Tee-off through the engine: the step reports the same number.
      expect(golfStep(holeState(n), empty).fidelity, hole(n).code).toBeCloseTo(expected[n - 1], 12);
    }
    expect(evaluate(empty, hole(10)).fidelity).toBeCloseTo(0, 12); // M5: orthogonal
  });

  it('after a mid-hole sweep and after a wipe the board reads |0…0⟩ again', () => {
    const one = circuit([g('X', 0, { qubit: 0 })]);
    let step = golfStep(holeState(2), one);
    expect(step.fidelity).toBeCloseTo(0, 12); // |10⟩ against Bell
    step = golfStep(step.state, empty); // swept
    expect(step.fidelity).toBeCloseTo(0.5, 12);
    expect(step.holedIn).toBe(false);
    const again = golfStep(step.state, one);
    const wiped = golfWipe(again.state, one);
    const cleared = golfStep(wiped, empty);
    expect(cleared.fidelity).toBeCloseTo(0.5, 12);
    expect(cleared.holedIn).toBe(false);
  });

  it('the advance and restart clears report the hole they show', () => {
    const holed = golfStep(holeState(1), refCircuit(1)).state;
    const advanced = golfStep(holed, empty);
    expect(advanced.advanced).toBe(true);
    expect(advanced.fidelity).toBeCloseTo(evaluate(empty, advanced.hole).fidelity, 12);
    expect(advanced.fidelity).toBeCloseTo(0.5, 12); // E2 Bell
    const done = golfStep({ ...initialGolfState(), complete: true }, empty);
    expect(done.restarted).toBe(true);
    expect(done.fidelity).toBeCloseTo(0.5, 12); // back on E1
  });

  it('no classic target is |0…0⟩-close, and an empty board never holes in', () => {
    HOLES.forEach((h, i) => {
      expect(bestFidelity(empty, h), h.code).toBeLessThan(HOLE_IN_THRESHOLD);
      expect(evaluate(empty, h).holedIn).toBe(false);
      const step = golfStep({ ...initialGolfState(), levelIndex: i }, empty);
      expect(step.holedIn || step.justHoledIn, h.code).toBe(false);
    });
  });

  it('even a target equal to |0…0⟩ would not hole in on the empty board (guard)', () => {
    const zero: Hole = { ...hole(1), hole: 99, targets: [statevector(empty)] };
    const ev = evaluate(empty, zero);
    expect(ev.fidelity).toBeCloseTo(1, 12);
    expect(ev.holedIn).toBe(false);
  });
});

describe('wipe the board for one stroke (#100)', () => {
  const holeState = (n: number) => ({ ...initialGolfState(), levelIndex: n - 1 });

  it('costs exactly one stroke however much was on the board', () => {
    // X tiles on distinct wires: a board that grows without ever holing in, so
    // the wipe is measured against a hole still in play.
    const junk = (n: number) => circuit([0, 1, 2, 3, 4].slice(0, n).map((q) => g('X', q, { qubit: q })));
    for (const gates of [1, 3, 5]) {
      // Build up `gates` tiles the honest way: one stroke each.
      let step = golfStep(holeState(5), empty);
      for (let i = 0; i < gates; i++) {
        step = golfStep(step.state, junk(i + 1));
      }
      expect(step.strokes).toBe(gates);

      // The wipe is one stroke, and the board-clear that follows it is free —
      // per-gate teardown would have cost `gates` more (#73).
      const wiped = golfWipe(step.state, junk(gates));
      expect(wiped.strokes).toBe(gates + 1);
      const cleared = golfStep(wiped, empty);
      expect(cleared.strokes).toBe(gates + 1);
      expect(cleared.advanced).toBe(false);
      expect(cleared.state.holedIn).toBe(false);
    }
  });

  it('is a no-op on an empty board, and after the ball is in', () => {
    const teed = holeState(2);
    expect(golfWipe(teed, empty)).toBe(teed);

    // Holed in: the score is written and clearing the board is how you leave —
    // charging a stroke to walk to the next tee would be nonsense.
    const holed = golfStep(teed, refCircuit(2)).state;
    expect(holed.holedIn).toBe(true);
    expect(golfWipe(holed, refCircuit(2))).toBe(holed);

    const done = { ...teed, complete: true };
    expect(golfWipe(done, refCircuit(2))).toBe(done);
  });

  it('leaves every other mid-hole rule where it was', () => {
    // Strokes keep counting from where the wipe left them, the hole plays on,
    // and re-adds cost one each — the wipe buys a clean board, not a do-over.
    let step = golfStep(holeState(2), circuit([g('X', 0, { qubit: 0 })]));
    expect(step.strokes).toBe(1);
    const wiped = golfWipe(step.state, circuit([g('X', 0, { qubit: 0 })]));
    step = golfStep(wiped, empty);
    expect(step.strokes).toBe(2);
    step = golfStep(step.state, refCircuit(2)); // two gates back on: two strokes
    expect(step.strokes).toBe(4);
    expect(step.justHoledIn).toBe(true);
    expect(step.state.best[2]).toBe(4);
  });

  it('does not wash away a revealed hole’s price (#99)', () => {
    // Peek, then wipe and start over: the answer has still been seen, so the
    // hole still records at least double par.
    const peeked = golfReveal(holeState(2), 2);
    const played = golfStep(peeked, circuit([g('X', 0, { qubit: 0 })]));
    const wiped = golfWipe(played.state, circuit([g('X', 0, { qubit: 0 })]));
    expect(wiped.revealed[2]).toBe(true);
    const holed = golfStep(golfStep(wiped, empty).state, refCircuit(2));
    expect(holed.strokes).toBe(4);
    expect(holed.score).toBe(8);
    expect(holed.state.best[2]).toBe(8);
  });
});

describe('jump straight to a hole (#101)', () => {
  const holeState = (n: number) => ({ ...initialGolfState(), levelIndex: n - 1 });
  const junk = circuit([g('X', 0, { qubit: 0 })]);

  it('plays any hole on demand, with no unlock gating', () => {
    // Hole 1, untouched → straight to X5 (hole 18), the hardest thing there is.
    const jumped = golfJumpTo(holeState(1), 18, empty);
    expect(jumped.levelIndex).toBe(17);
    expect(HOLES[jumped.levelIndex].code).toBe('X5');
    expect(jumped.strokes).toBe(0);
    // …and back down again, in one tap.
    expect(golfJumpTo(jumped, 6, empty).levelIndex).toBe(5);
  });

  it('parks the hole it leaves, and resumes it on the way back', () => {
    let step = golfStep(holeState(2), junk);
    step = golfStep(step.state, circuit([g('X', 0, { qubit: 0 }), g('X', 1, { qubit: 1 })]));
    expect(step.strokes).toBe(2);

    // Away to M1 — a fresh hole, teed off at zero, not carrying E2's fumbles.
    const away = golfJumpTo(step.state, 6, junk);
    expect(away.strokes).toBe(0);
    expect(away.parked[2]).toEqual({ strokes: 2, holedIn: false });

    // Back to E2: the round you were having is still there.
    const back = golfJumpTo(away, 2, junk);
    expect(back.strokes).toBe(2);
    expect(back.levelIndex).toBe(1);
  });

  it('costs nothing to arrive: the board becomes the new baseline (#68)', () => {
    // Jump with tiles still on the board, then keep playing — the tiles that
    // were already there are not charged as adds on the hole you land on.
    // (E5, so the stray X tile is nowhere near holing the hole in.)
    const jumped = golfJumpTo(holeState(1), 5, junk);
    expect(jumped.strokes).toBe(0);
    const step = golfStep(jumped, junk);
    expect(step.strokes).toBe(0);
    // Only a real change is a stroke.
    expect(golfStep(step.state, empty).strokes).toBe(1);
  });

  it('arrives unlatched on a hole already holed in, so a clear cannot advance', () => {
    const holed = golfStep(holeState(2), refCircuit(2)).state;
    expect(holed.holedIn).toBe(true);
    const away = golfJumpTo(holed, 6, refCircuit(2));
    const back = golfJumpTo(away, 2, refCircuit(2));
    expect(back.holedIn).toBe(false);
    expect(back.levelIndex).toBe(1);
    // The recorded score is untouched — replaying a hole cannot lose a best.
    expect(back.best[2]).toBe(2);
    // A board-clear here starts hole 2 over rather than walking to hole 3.
    const cleared = golfStep(back, empty);
    expect(cleared.advanced).toBe(false);
    expect(cleared.state.levelIndex).toBe(1);
  });

  it('ignores a jump to the hole in play, or to a hole this course has not got', () => {
    const state = holeState(2);
    expect(golfJumpTo(state, 2, empty)).toBe(state);
    expect(golfJumpTo(state, 99, empty)).toBe(state);
  });

  it('leaves nothing parked once a hole is finished and walked off', () => {
    // Park E2 mid-round, come back, finish it, advance: the parked strokes go
    // with the round on that hole, so a later jump tees it off clean.
    const away = golfJumpTo(golfStep(holeState(2), junk).state, 6, junk);
    expect(away.parked[2]?.strokes).toBe(1);
    const back = golfJumpTo(away, 2, empty);
    const holed = golfStep(back, refCircuit(2));
    const advanced = golfStep(holed.state, empty);
    expect(advanced.advanced).toBe(true);
    expect(advanced.state.parked[2]).toBeUndefined();
    expect(golfJumpTo(advanced.state, 2, empty).strokes).toBe(0);
  });

  it('starts a restarted course with nothing parked', () => {
    const finished = { ...initialGolfState(), complete: true, parked: { 4: { strokes: 9, holedIn: false } } };
    expect(golfStep(finished, empty).state.parked).toEqual({});
  });
});

describe('per-round competition scope (#102)', () => {
  it('names, selects and sums the holes of each scope', () => {
    expect(GOLF_SCOPES).toEqual(['full', 'easy', 'medium', 'difficult', 'extra']);
    expect(scopeLabel('full')).toBe('Full 18');
    expect(scopeLabel('difficult')).toBe('Difficult');

    expect(scopeHoles(HOLES, 'full').length).toBe(18);
    expect(scopeHoles(HOLES, 'easy').map((h) => h.code)).toEqual(['E1', 'E2', 'E3', 'E4', 'E5']);
    expect(scopeHoles(HOLES, 'extra').map((h) => h.code)).toEqual(['X1', 'X3', 'X5']);

    // Scope par is the scope's own holes, and the four add back up to the full
    // course — the constant everybody quotes stays exactly what it was.
    const pars = (['easy', 'medium', 'difficult', 'extra'] as const).map((s) =>
      coursePar(scopeHoles(HOLES, s)),
    );
    expect(pars).toEqual([26, 31, 33, 18]);
    expect(pars.reduce((a, b) => a + b, 0)).toBe(COURSE_PAR);
    expect(coursePar(scopeHoles(HOLES, 'full'))).toBe(COURSE_PAR);
  });

  it('tees off on the scope’s first hole', () => {
    expect(initialGolfState().levelIndex).toBe(0);
    expect(HOLES[initialGolfState({}, 'classic', 0, {}, 'difficult').levelIndex].code).toBe('D1');
    expect(HOLES[initialGolfState({}, 'classic', 0, {}, 'extra').levelIndex].code).toBe('X1');
  });

  it('advances within the scope and finishes at its last hole', () => {
    // Play the whole EXTRA round (X1, X3, X5) and nothing else.
    let state = initialGolfState({}, 'classic', 0, {}, 'extra');
    const played: string[] = [];
    for (let i = 0; i < 3; i++) {
      played.push(HOLES[state.levelIndex].code);
      const holed = golfStep(state, refCircuit(HOLES[state.levelIndex].hole));
      expect(holed.justHoledIn).toBe(true);
      const cleared = golfStep(holed.state, empty);
      state = cleared.state;
      // The third hole-in ENDS the competition — no walk into a fourth round.
      expect(cleared.justCompleted).toBe(i === 2);
      expect(cleared.complete).toBe(i === 2);
    }
    expect(played).toEqual(['X1', 'X3', 'X5']);
    expect(state.complete).toBe(true);

    // The card's result is the scope's: three holes against the extra par.
    const totals = courseTotals(state.best, scopeHoles(HOLES, 'extra'));
    expect(totals.completed).toBe(3);
    expect(totals.par).toBe(18);
  });

  it('restarts a scoped round on the scope’s own first hole', () => {
    const finished = { ...initialGolfState({}, 'classic', 0, {}, 'difficult'), complete: true };
    const restarted = golfStep(finished, empty);
    expect(restarted.restarted).toBe(true);
    expect(HOLES[restarted.state.levelIndex].code).toBe('D1');
    expect(restarted.hole.code).toBe('D1');
  });

  it('keeps a jump inside the competition (#101 × #102)', () => {
    const state = initialGolfState({}, 'classic', 0, {}, 'easy');
    // E4 is in the easy round: a legal move.
    expect(golfJumpTo(state, 4, empty).levelIndex).toBe(3);
    // M1 is on the card but not in this competition, so it is not a way in.
    expect(golfJumpTo(state, 6, empty)).toBe(state);
    // In the full round, everything is reachable.
    expect(golfJumpTo(initialGolfState(), 6, empty).levelIndex).toBe(5);
  });

  it('round-trips a scope through a link, and reads a link without one as full', () => {
    expect(scopeCode('full')).toBeNull();
    expect(scopeCode('easy')).toBe('E');
    expect(scopeCode('extra')).toBe('X');

    for (const scope of GOLF_SCOPES) {
      expect(parseScope(scopeCode(scope))).toBe(scope);
    }
    // Case and space are what people retype off a screen.
    expect(parseScope('d')).toBe('difficult');
    expect(parseScope(' M ')).toBe('medium');
    // Back-compat: every link and QR already in the wild says nothing about
    // scope, and must keep meaning the full course.
    expect(parseScope(null)).toBe('full');
    expect(parseScope(undefined)).toBe('full');
    expect(parseScope('')).toBe('full');
    expect(parseScope('nonsense')).toBe('full');
  });
});
