import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import { mulberry32 } from '@shared/menu/sample';
import { basisVisuals } from './qsphere';
import { activeQubits, probOne, statevector, type StateVector } from './statevector';
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

/** The reference amplitude `basisVisuals` aligns phases to: the first populated
 *  basis state in index order (unit-modulus, so dividing by it is a conjugate
 *  multiply / |ref|). */
function refAmp(sv: StateVector, k: number): { re: number; im: number } {
  for (let i = 0; i < 1 << k; i++) {
    const a = sv[i];
    const p = a.re * a.re + a.im * a.im;
    if (p >= 1e-3) return { re: a.re / Math.sqrt(p), im: a.im / Math.sqrt(p) };
  }
  return { re: 1, im: 0 };
}

/** `a` divided by the unit-modulus reference — the global phase taken out. */
function align(a: { re: number; im: number }, ref: { re: number; im: number }) {
  return { re: a.re * ref.re + a.im * ref.im, im: a.im * ref.re - a.re * ref.im };
}

/** How many basis states of a k-qubit target carry real amplitude. */
function populatedTerms(sv: StateVector, k: number): number {
  let n = 0;
  for (let i = 0; i < 1 << k; i++) {
    const a = sv[i];
    if (a.re * a.re + a.im * a.im > 1e-9) n += 1;
  }
  return n;
}

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

  it('par is the generator gate count + 1 slack (level + round bonus + 1)', () => {
    for (const { hole, circuit } of generateCourse(99)) {
      expect(hole.par).toBe(circuit.gates.length + 1);
      expect(hole.par).toBe(hole.level + ROUND_BONUS[hole.round] + 1);
    }
    // …and therefore a random course's par is its own sum, not COURSE_PAR.
    expect(coursePar(randomCourse(99))).toBe(
      HOLES.reduce((s, h) => s + h.level + ROUND_BONUS[h.round] + 1, 0),
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

  it('keeps EASY and MEDIUM targets phase-free (property loop)', () => {
    for (let seed = 0; seed < 40; seed++) {
      for (const { hole, circuit } of generateCourse(seed * 7907 + 11)) {
        if (hole.round !== 'easy' && hole.round !== 'medium') continue;
        const target = statevector(circuit);
        // Every populated amplitude sits at 0° against the reference…
        for (const v of basisVisuals(target, 1 << hole.level)) {
          if (v.prob <= 1e-9) continue;
          expect(Math.min(v.phaseDeg, 360 - v.phaseDeg)).toBeLessThanOrEqual(1e-6);
        }
        // …i.e. after aligning the reference out, every amplitude is real and
        // non-negative — no minus signs, no i, nothing to compose a CZ for.
        const ref = refAmp(target, hole.level);
        for (let i = 0; i < 1 << hole.level; i++) {
          const a = align(target[i], ref);
          expect(Math.abs(a.im)).toBeLessThan(1e-9);
          expect(a.re).toBeGreaterThan(-1e-9);
        }
        // The scorecard ket says the same thing: no minus, no i, no e^.
        expect(hole.targetKet).not.toContain('−');
        expect(hole.targetKet).not.toContain('i');
        expect(hole.targetKet).not.toContain('e^');
      }
    }
  });

  it('caps every target at 16 populated terms, so the ket prints in full', () => {
    for (let seed = 0; seed < 40; seed++) {
      for (const { hole, circuit } of generateCourse(seed * 3571 + 17)) {
        expect(populatedTerms(statevector(circuit), hole.level)).toBeLessThanOrEqual(16);
        // The scorecard ket is therefore never elided — no "+ ⋯" on a target.
        expect(hole.targetKet).not.toContain('⋯');
      }
    }
  });

  it('retries past an over-full 5-qubit draw (documented seed)', () => {
    // Base seed 1107, slot E5 (seed 5107): the first draw to clear (a), (b) and
    // (c) is attempt 28, `H4 CNOT(0→1) H2 H3 H1 H0` — an H on every wire, i.e.
    // the uniform superposition over ALL 32 basis states. Every wire is alive,
    // nothing carries a phase, and it is nowhere near |0…0⟩, so the pre-(d)
    // generator took it happily — and handed the player a target the ket line
    // could only show half of.
    const stale: Circuit = {
      qubits: 5,
      gates: [
        { id: 'a', type: 'H', position: 0, qubit: 4 },
        { id: 'b', type: 'CNOT', position: 1, control: 0, target: 1 },
        { id: 'c', type: 'H', position: 2, qubit: 2 },
        { id: 'd', type: 'H', position: 3, qubit: 3 },
        { id: 'e', type: 'H', position: 4, qubit: 1 },
        { id: 'f', type: 'H', position: 5, qubit: 0 },
      ],
    };
    const staleTarget = statevector(stale);
    for (let q = 0; q < 5; q++) expect(probOne(staleTarget, q)).toBeCloseTo(0.5, 12); // (b) ✓
    for (const v of basisVisuals(staleTarget, 32)) {
      expect(Math.min(v.phaseDeg, 360 - v.phaseDeg)).toBeLessThanOrEqual(1e-6); // (c) ✓
    }
    expect(populatedTerms(staleTarget, 5)).toBe(32); // … but (d) ✗

    const e5 = generateCourse(1107)[4];
    expect(e5.hole.code).toBe('E5');
    expect(shape(e5.circuit)).not.toBe(shape(stale));
    expect(populatedTerms(statevector(e5.circuit), 5)).toBeLessThanOrEqual(16);
    expect(e5.hole.targetKet).not.toContain('⋯');
  });

  it('leaves DIFFICULT and EXTRA free to carry phases — the rule does not leak', () => {
    let phased = 0;
    let total = 0;
    for (let seed = 0; seed < 30; seed++) {
      for (const { hole, circuit } of generateCourse(seed * 31 + 5)) {
        if (hole.round === 'easy' || hole.round === 'medium') continue;
        total += 1;
        const visuals = basisVisuals(statevector(circuit), 1 << hole.level);
        const hasPhase = visuals.some(
          (v) => v.prob > 1e-9 && Math.min(v.phaseDeg, 360 - v.phaseDeg) > 1e-6,
        );
        if (hasPhase) phased += 1;
      }
    }
    expect(total).toBe(30 * 8); // 5 difficult + 3 extra holes per course
    // Phase IS the D/X lesson, so a large fraction of them must carry one.
    expect(phased).toBeGreaterThan(total / 5);

    // Anchored on one shipped seed: the new rule cost M4 its minus sign, while
    // D4 and X1 — same base seed, untouched slot seeds — still carry theirs.
    const course = generateCourse(20260725);
    expect(course[8].hole.code).toBe('M4');
    expect(course[8].hole.targetKet).not.toContain('−');
    expect(course[13].hole.code).toBe('D4');
    expect(course[13].hole.targetKet).toContain('−');
    expect(course[15].hole.code).toBe('X1');
    expect(course[15].hole.targetKet).toContain('−');
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
      expect(ev.gateCount).toBe(hole.par - 1); // generator = par − 1 slack
      // …which is exactly the answer the card reveals after a hole-in (#71):
      // the hole carries its generator, so the reveal inherits this proof.
      expect(hole.solution).toBe(circuit);
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
    expect(step.strokes).toBe(holes[0].par - 1);
    expect(step.scoreName).toBe('BIRDIE'); // generator play beats par by the slack stroke
    state = step.state;
    expect(state.best[1]).toBe(holes[0].par - 1);

    // Clear → advance to the generated hole 2.
    step = golfStep(state, empty, holes);
    expect(step.advanced).toBe(true);
    expect(step.hole.name).toBe('Random E2');
    expect(step.hole.par).toBe(holes[1].par);

    // The running total is measured against the GENERATED pars.
    expect(courseTotals(step.state.best, holes).par).toBe(holes[0].par);
    expect(courseTotals(step.state.best, holes).vsPar).toBe(-1);
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
