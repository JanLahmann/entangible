import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import {
  CELEBRATION_COOLDOWN_MS,
  evaluateMoment,
  initialMomentState,
  type MomentState,
} from './moments';

let seq = 0;
function g(partial: Omit<Gate, 'id'>): Gate {
  return { id: `g${seq++}`, ...partial };
}
const EMPTY: Circuit = { qubits: 5, gates: [] };
function circuit(gates: Gate[]): Circuit {
  return { qubits: 5, gates };
}
const H = (q: number, position = 0) => g({ type: 'H', qubit: q, position });
const X = (q: number, position = 0) => g({ type: 'X', qubit: q, position });
const CNOT = (control: number, target: number, position = 1) =>
  g({ type: 'CNOT', control, target, position });

/** Run one step from EMPTY-or-given prev, returning the result. */
function step(prev: Circuit, next: Circuit, state: MomentState, now = 0) {
  return evaluateMoment(prev, next, state, now);
}

describe('moment engine — table rows', () => {
  it('First gate ever → "qN is alive!"', () => {
    const r = step(EMPTY, circuit([X(3)]), initialMomentState);
    expect(r.stripMessage).toBe('q3 is alive!');
    expect(r.celebration).toBeUndefined();
    expect(r.state.firstGateSeen).toBe(true);
  });

  it('Superposition — an H places a qubit into 0-and-1', () => {
    // first gate already seen, so the H triggers the superposition message
    let s = step(EMPTY, circuit([X(0)]), initialMomentState).state;
    const r = step(circuit([X(0)]), circuit([X(0), H(2, 1)]), s);
    expect(r.stripMessage).toBe('Superposition — q2 is 0 and 1');
  });

  it('Bit flip — an X drives a qubit to |1⟩', () => {
    const s = step(EMPTY, circuit([H(0)]), initialMomentState).state;
    const r = step(circuit([H(0)]), circuit([H(0), X(3, 1)]), s);
    expect(r.stripMessage).toBe('Bit flip — q3 is now 1');
  });

  it('Bell pair → confetti + banner + strip', () => {
    const s = step(EMPTY, circuit([H(0)]), initialMomentState).state;
    const r = step(circuit([H(0)]), circuit([H(0), CNOT(0, 1)]), s);
    expect(r.celebration).toEqual({ kind: 'bell', k: 2 });
    expect(r.stripMessage).toMatch(/answer together/);
    expect(r.state.bellCelebrated).toBe(true);
  });

  it('GHZ-k → bigger celebration carrying k', () => {
    const bell = circuit([H(0), CNOT(0, 1)]);
    const s = step(circuit([H(0)]), bell, initialMomentState).state;
    // extend to GHZ-3; give it enough time to clear the 10 s cooldown
    const r = step(bell, circuit([H(0), CNOT(0, 1), CNOT(0, 2)]), s, CELEBRATION_COOLDOWN_MS);
    expect(r.celebration).toEqual({ kind: 'ghz', k: 3 });
    expect(r.state.ghzCelebrated).toBe(true);
  });

  it('GHZ-5 reports k = 5', () => {
    const g4 = circuit([H(0), CNOT(0, 1), CNOT(0, 2), CNOT(0, 3)]);
    const g5 = circuit([H(0), CNOT(0, 1), CNOT(0, 2), CNOT(0, 3), CNOT(0, 4)]);
    const s = { ...initialMomentState };
    const r = step(g4, g5, s, 0);
    expect(r.celebration).toEqual({ kind: 'ghz', k: 5 });
  });

  it('All five rows carry an H → "32 possibilities at once"', () => {
    const four = circuit([H(0), H(1), H(2), H(3)]);
    const five = circuit([H(0), H(1), H(2), H(3), H(4)]);
    const s = step(circuit([H(0), H(1), H(2)]), four, {
      ...initialMomentState,
      firstGateSeen: true,
    }).state;
    const r = step(four, five, s);
    expect(r.stripMessage).toBe('32 possibilities at once');
    expect(r.state.uniformShown).toBe(true);
  });

  it('Board cleared after activity → resets achievements', () => {
    const primed: MomentState = {
      firstGateSeen: true,
      bellCelebrated: true,
      ghzCelebrated: true,
      uniformShown: true,
      lastCelebrationAt: 5_000,
    };
    const r = step(circuit([H(0), CNOT(0, 1)]), EMPTY, primed, 6_000);
    expect(r.stripMessage).toBe('Ready for the next quantum architect');
    expect(r.state.firstGateSeen).toBe(false);
    expect(r.state.bellCelebrated).toBe(false);
    expect(r.state.ghzCelebrated).toBe(false);
    // the global cooldown clock is preserved across a board clear
    expect(r.state.lastCelebrationAt).toBe(5_000);
  });

  it('an empty board that was already empty says nothing', () => {
    const r = step(EMPTY, EMPTY, initialMomentState);
    expect(r.stripMessage).toBeUndefined();
    expect(r.celebration).toBeUndefined();
  });
});

describe('moment engine — anti-spam', () => {
  it('Bell fires once, then stays silent until the board is cleared and rebuilt', () => {
    const bell = circuit([H(0), CNOT(0, 1)]);
    const s0 = step(circuit([H(0)]), bell, initialMomentState).state;
    expect(s0.bellCelebrated).toBe(true);

    // re-evaluating the same Bell state does not re-fire
    const again = step(bell, bell, s0, 20_000);
    expect(again.celebration).toBeUndefined();

    // clear the board → re-arm
    const cleared = step(bell, EMPTY, s0, 20_000).state;
    expect(cleared.bellCelebrated).toBe(false);

    // rebuild Bell → fires again (cooldown long elapsed)
    const refired = step(circuit([H(0)]), bell, cleared, 40_000);
    expect(refired.celebration).toEqual({ kind: 'bell', k: 2 });
  });

  it('honours the 10 s global cooldown between celebrations (fake clock)', () => {
    const bell = circuit([H(0), CNOT(0, 1)]);
    // Bell fires at t = 1000
    const s = step(circuit([H(0)]), bell, initialMomentState, 1_000).state;
    expect(s.lastCelebrationAt).toBe(1_000);

    // GHZ reached only 3 s later → suppressed by the cooldown
    const ghz = circuit([H(0), CNOT(0, 1), CNOT(0, 2)]);
    const tooSoon = step(bell, ghz, s, 4_000);
    expect(tooSoon.celebration).toBeUndefined();
    expect(tooSoon.state.ghzCelebrated).toBe(false);

    // the same transition after the cooldown elapses → fires
    const later = step(bell, ghz, s, 1_000 + CELEBRATION_COOLDOWN_MS);
    expect(later.celebration).toEqual({ kind: 'ghz', k: 3 });
  });

  it('a duplicated circuit (same state re-sent) never re-celebrates', () => {
    const bell = circuit([H(0), CNOT(0, 1)]);
    let s = step(circuit([H(0)]), bell, initialMomentState, 0).state;
    // simulate three redundant re-evaluations of the identical circuit
    for (let i = 0; i < 3; i++) {
      const r = step(bell, bell, s, 100_000 + i);
      expect(r.celebration).toBeUndefined();
      s = r.state;
    }
  });
});
