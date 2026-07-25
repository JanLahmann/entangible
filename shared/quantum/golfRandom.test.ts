import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import { mulberry32 } from '@shared/menu/sample';
import { activeQubits, probOne, statevector } from './statevector';
import {
  HOLES,
  ROUND_CLUBS,
  clubGateTypes,
  coursePar,
  courseTotals,
  evaluate,
  golfStep,
  initialGolfState,
  persistsBest,
  holeTargetState,
  bestFidelity,
  saveBest,
  GOLF_HOLES_KEY,
  HOLE_IN_THRESHOLD,
} from './golf';
import {
  ROUND_BONUS,
  courseHoles,
  currentHole,
  generateCourse,
  randomBaseSeed,
  randomCourse,
} from './golfRandom';

const CONTROLLED = new Set(['CNOT', 'CX', 'CY', 'CZ', 'CH', 'CS', 'CT', 'CCX']);

/** A comparable fingerprint of a generated circuit (ids aside). */
const shape = (c: Circuit) =>
  c.gates.map((g) => [g.type, g.position, g.qubit, g.control, g.target].join('|')).join(',');

/** Move a generator off qubits 0..k−1 onto `wires` (position j → wires[j]). */
function remap(c: Circuit, wires: readonly number[]): Circuit {
  const gates: Gate[] = c.gates.map((g) => ({
    ...g,
    qubit: g.qubit === undefined ? undefined : wires[g.qubit],
    control: g.control === undefined ? undefined : wires[g.control],
    target: g.target === undefined ? undefined : wires[g.target],
  }));
  return { qubits: c.qubits, gates };
}

describe('random course generation (#70)', () => {
  it('is deterministic per seed — same holes AND same generators', () => {
    const a = generateCourse(4242);
    const b = generateCourse(4242);
    expect(a.map((h) => shape(h.circuit))).toEqual(b.map((h) => shape(h.circuit)));
    expect(a.map((h) => h.hole.targetKet)).toEqual(b.map((h) => h.hole.targetKet));
    expect(a.map((h) => h.hole.par)).toEqual(b.map((h) => h.hole.par));
  });

  it('deals a different course for a different base seed', () => {
    const a = generateCourse(1).map((h) => shape(h.circuit));
    const b = generateCourse(2).map((h) => shape(h.circuit));
    expect(a).not.toEqual(b);
  });

  it('mirrors the classic 18-slot structure (rounds, levels, codes, views)', () => {
    const course = randomCourse(7);
    expect(course.length).toBe(18);
    expect(course.map((h) => h.hole)).toEqual(HOLES.map((h) => h.hole));
    expect(course.map((h) => h.round)).toEqual(HOLES.map((h) => h.round));
    expect(course.map((h) => h.level)).toEqual(HOLES.map((h) => h.level));
    expect(course.map((h) => h.code)).toEqual(HOLES.map((h) => h.code));
    expect(course.map((h) => h.name)).toEqual(HOLES.map((h) => `Random ${h.code}`));
    // Level-1 holes play on the Bloch sphere, exactly like the fixed course.
    for (const h of course) expect(h.view).toBe(h.qubits === 1 ? 'bloch' : 'qsphere');
    // Clubs are the round's, so the palette is unchanged from classic.
    for (const h of course) expect(h.clubs).toEqual(ROUND_CLUBS[h.round]);
  });

  it('par IS the generator gate count (level + the round bonus, no +2)', () => {
    for (const { hole, circuit } of generateCourse(99)) {
      expect(hole.par).toBe(circuit.gates.length);
      expect(hole.par).toBe(hole.level + ROUND_BONUS[hole.round]);
    }
    // …and therefore a random course's par is its own sum, not COURSE_PAR.
    expect(coursePar(randomCourse(99))).toBe(
      HOLES.reduce((s, h) => s + h.level + ROUND_BONUS[h.round], 0),
    );
  });

  it('draws only legal gates: the round’s clubs, on the hole’s qubits', () => {
    for (let seed = 0; seed < 40; seed++) {
      for (const { hole, circuit } of generateCourse(seed * 7919)) {
        const legal = new Set<string>(clubGateTypes(hole));
        for (const g of circuit.gates) {
          expect(legal.has(g.type)).toBe(true);
          if (CONTROLLED.has(g.type)) {
            // Controlled gates need a second wire: level ≥ 2, control ≠ target.
            expect(hole.level).toBeGreaterThanOrEqual(2);
            expect(g.control).not.toBe(g.target);
            expect(g.control).toBeLessThan(hole.level);
            expect(g.target).toBeLessThan(hole.level);
          } else {
            expect(g.qubit).toBeLessThan(hole.level);
          }
        }
      }
    }
  });

  it('enforces both constraints on every generated hole (property loop)', () => {
    for (let seed = 0; seed < 40; seed++) {
      for (const { hole, circuit } of generateCourse(seed * 104729 + 3)) {
        const target = statevector(circuit);
        // (a) the target is not |0…0⟩, which an empty board would hole in.
        expect(target[0].re ** 2 + target[0].im ** 2).toBeLessThan(1 - 1e-9);
        expect(evaluate({ qubits: 5, gates: [] }, hole).holedIn).toBe(false);
        // (b) no DEAD wire: every qubit carries |1⟩ population in the target.
        for (let q = 0; q < hole.level; q++) {
          expect(probOne(target, q)).toBeGreaterThan(1e-9);
        }
        // …which implies the circuit-level property it replaced: a wire the
        // generator never touched could only ever be exactly |0⟩.
        expect(activeQubits(circuit)).toEqual(
          Array.from({ length: hole.level }, (_, i) => i),
        );
      }
    }
  });

  it('retries past dead-wire draws the circuit-level check used to accept', () => {
    // Seed 20260725's E3 slot first draws [CNOT(1→2) CNOT(2→1) H1 CNOT(2→0)]:
    // it touches all three wires — so the old circuit-level rule took it — yet
    // leaves q0 and q2 pinned to |0⟩, making the "3-qubit" target
    // (|000⟩+|010⟩)/√2 a one-H hole with two idle wires. Still a legal draw,
    // now a rejected one.
    const stale: Circuit = {
      qubits: 5,
      gates: [
        { id: 'a', type: 'CNOT', position: 0, control: 1, target: 2 },
        { id: 'b', type: 'CNOT', position: 1, control: 2, target: 1 },
        { id: 'c', type: 'H', position: 2, qubit: 1 },
        { id: 'd', type: 'CNOT', position: 3, control: 2, target: 0 },
      ],
    };
    expect(activeQubits(stale)).toEqual([0, 1, 2]); // the old check passed …
    expect(probOne(statevector(stale), 0)).toBe(0); // … but q0 and q2 are dead.
    expect(probOne(statevector(stale), 2)).toBe(0);

    const e3 = generateCourse(20260725)[2];
    expect(e3.hole.level).toBe(3);
    expect(e3.hole.targetKet).not.toBe('1/√2|000⟩ + 1/√2|010⟩');
    const target = statevector(e3.circuit);
    for (let q = 0; q < 3; q++) expect(probOne(target, q)).toBeGreaterThan(1e-9);
  });

  it('still accepts honest PRODUCT targets — every wire busy is enough', () => {
    // Products are fine pedagogically: H⊗H is a legal target because no qubit
    // is idle. The constraint rejects dead wires, not the absence of entanglement.
    const hh: Circuit = {
      qubits: 5,
      gates: [
        { id: 'a', type: 'H', position: 0, qubit: 0 },
        { id: 'b', type: 'H', position: 1, qubit: 1 },
      ],
    };
    const sv = statevector(hh);
    for (let q = 0; q < 2; q++) expect(probOne(sv, q)).toBeCloseTo(0.5, 12);
    // Generated product targets do occur, and they hole in on their generator.
    const products = generateCourse(11).filter(
      ({ hole, circuit }) =>
        hole.level >= 2 && circuit.gates.every((g) => !CONTROLLED.has(g.type)),
    );
    expect(products.length).toBeGreaterThan(0);
    for (const { hole, circuit } of products) {
      expect(evaluate(circuit, hole).holedIn).toBe(true);
    }
  });

  it('holes in when the generator itself is played — on any wires, in any order', () => {
    for (const { hole, circuit } of generateCourse(20260725)) {
      const ev = evaluate(circuit, hole);
      expect(ev.fidelity).toBeGreaterThan(1 - 1e-9);
      expect(ev.holedIn).toBe(true);
      expect(ev.gateCount).toBe(hole.par);
    }
    // The ordered-placement machinery (as on the Cascade hole) means the same
    // answer built on other rows, reversed, scores identically.
    const two = generateCourse(20260725).find((g) => g.hole.level === 2)!;
    expect(bestFidelity(remap(two.circuit, [4, 2]), two.hole)).toBeGreaterThan(
      HOLE_IN_THRESHOLD,
    );
  });

  it('carries its own canonical target for the sphere ghost', () => {
    const { hole, circuit } = generateCourse(5150)[2];
    expect(holeTargetState(hole)).toEqual(statevector(circuit));
  });

  it('writes the target ket from the shared ketTerms typesetting', () => {
    for (const h of randomCourse(31337)) {
      expect(h.targetKet.length).toBeGreaterThan(0);
      expect(h.targetKet).toContain('|');
      expect(h.target).toBe(h.targetKet);
      // The ket is written in the HOLE's state space, not all five qubits.
      const width = h.targetKet.slice(h.targetKet.indexOf('|') + 1, h.targetKet.indexOf('⟩'));
      expect(width.length).toBe(h.qubits);
    }
  });

  it('seeds a fresh base from an injectable RNG, inside the 32-bit range', () => {
    expect(randomBaseSeed(mulberry32(1))).toBe(randomBaseSeed(mulberry32(1)));
    expect(randomBaseSeed(mulberry32(1))).not.toBe(randomBaseSeed(mulberry32(2)));
    for (let s = 0; s < 20; s++) {
      const seed = randomBaseSeed(mulberry32(s));
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('course selection', () => {
  it('leaves the classic path on the fixed holes (identity, not a copy)', () => {
    expect(courseHoles(initialGolfState())).toBe(HOLES);
    expect(currentHole(initialGolfState())).toBe(HOLES[0]);
    // The default `holes` argument of golfStep IS the classic course.
    const c: Circuit = { qubits: 5, gates: [{ id: 'h', type: 'H', position: 0, qubit: 0 }] };
    const implicit = golfStep(initialGolfState(), c);
    const explicit = golfStep(initialGolfState(), c, HOLES);
    expect(implicit).toEqual(explicit);
    expect(implicit.hole).toBe(HOLES[0]);
  });

  it('memoizes a seed’s course so re-renders keep hole identity stable', () => {
    const state = initialGolfState({}, 'random', 77);
    expect(courseHoles(state)).toBe(courseHoles(state));
    expect(currentHole(state).name).toBe('Random E1');
  });

  it('plays a generated course through golfStep, scoring against its own pars', () => {
    const seed = 8080;
    const course = generateCourse(seed);
    const holes = randomCourse(seed);
    let state = initialGolfState({}, 'random', seed);
    const empty: Circuit = { qubits: 5, gates: [] };

    // Hole 1: play the generator, hole in at exactly par (every gate an add).
    let step = golfStep(state, course[0].circuit, holes);
    expect(step.hole.name).toBe('Random E1');
    expect(step.holedIn).toBe(true);
    expect(step.strokes).toBe(holes[0].par);
    expect(step.scoreName).toBe('PAR');
    state = step.state;
    expect(state.best[1]).toBe(holes[0].par);

    // Clear → advance to the generated hole 2.
    step = golfStep(state, empty, holes);
    expect(step.advanced).toBe(true);
    expect(step.hole.name).toBe('Random E2');
    expect(step.hole.par).toBe(holes[1].par);

    // The running total is measured against the GENERATED pars.
    expect(courseTotals(step.state.best, holes).par).toBe(holes[0].par);
    expect(courseTotals(step.state.best, holes).vsPar).toBe(0);
  });

  it('keeps random bests off the device card (session-only by policy)', () => {
    expect(persistsBest(initialGolfState())).toBe(true);
    expect(persistsBest(initialGolfState({}, 'random', 1))).toBe(false);
    // A fresh random round starts with an empty card of its own.
    expect(initialGolfState({}, 'random', 1).best).toEqual({});

    // The App's hole-in branch, mirrored: a random hole-in never reaches
    // localStorage, while the same play on the classic course does.
    const writes: string[] = [];
    const store = { setItem: (k: string) => writes.push(k) };
    const seed = 2468;
    const holes = randomCourse(seed);
    const gen = generateCourse(seed)[0].circuit;
    const teeOff = (state: ReturnType<typeof initialGolfState>, c: Circuit, hs = HOLES) => {
      const step = golfStep(state, c, hs);
      expect(step.justHoledIn).toBe(true);
      if (persistsBest(step.state)) saveBest(store, step.state.best);
    };
    teeOff(initialGolfState({}, 'random', seed), gen, holes);
    expect(writes).toEqual([]);
    teeOff(initialGolfState(), { qubits: 5, gates: [{ id: 'h', type: 'H', position: 0, qubit: 0 }] });
    expect(writes).toEqual([GOLF_HOLES_KEY]);
  });

  it('carries the course + seed through every golfStep branch', () => {
    const seed = 606;
    const holes = randomCourse(seed);
    const done = { ...initialGolfState({}, 'random', seed), levelIndex: 17, complete: true };
    const restarted = golfStep(done, { qubits: 5, gates: [] }, holes);
    expect(restarted.restarted).toBe(true);
    expect(restarted.state.course).toBe('random');
    expect(restarted.state.randomSeed).toBe(seed);
    expect(restarted.hole).toBe(holes[0]);
  });
});
