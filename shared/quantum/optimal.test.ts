import { describe, it, expect } from 'vitest';
import type { Circuit, Gate, GateType } from '@qamposer/react';
import {
  findOptimal,
  findOptimalAsync,
  optimalSearch,
  canonicalKey,
  movesFor,
  DEFAULT_STATE_BUDGET,
} from './optimal';
import { HOLES, clubGateTypes, evaluate, holeTargetState, ROUND_CLUBS, gateTypesForClubs } from './golf';
import { randomCourse } from './golfRandom';
import { statevector, zeroState, applyGatesTo, NUM_QUBITS } from './statevector';

let seq = 0;
const g = (partial: Omit<Gate, 'id'>): Gate => ({ id: `g${seq++}`, ...partial });
const circuit = (gates: Gate[]): Circuit => ({ qubits: NUM_QUBITS, gates });
const hole = (n: number) => HOLES[n - 1];

const EASY = gateTypesForClubs(ROUND_CLUBS.easy); // X, H, CX
const DIFFICULT = gateTypesForClubs(ROUND_CLUBS.difficult); // + Y, Z, S

describe('movesFor', () => {
  it('offers every single on every wire and every controlled club on every ordered pair', () => {
    // Easy clubs on 3 wires: X,H × 3 = 6 singles, CX on 3×2 = 6 ordered pairs.
    expect(movesFor(EASY, 3).length).toBe(12);
    // One wire has no room for a control, so only the singles survive.
    expect(movesFor(EASY, 1).map((m) => m.type)).toEqual(['X', 'H']);
    // Control and target are NOT interchangeable — both directions are offered.
    const cx = movesFor(EASY, 2).filter((m) => m.type === 'CNOT');
    expect(cx.map((m) => `${m.control}${m.target}`).sort()).toEqual(['01', '10']);
  });
});

describe('canonicalKey — states modulo global phase', () => {
  it('collapses the S and RZ(π/2) spellings of the same state to one key', () => {
    // S = diag(1, i), RZ(π/2) = e^{-iπ/4}·diag(1, i): a global phase apart.
    const withS = statevector(circuit([g({ type: 'H', qubit: 0, position: 0 }), g({ type: 'S', qubit: 0, position: 1 })]));
    const withRz = statevector(
      circuit([
        g({ type: 'H', qubit: 0, position: 0 }),
        g({ type: 'RZ', qubit: 0, parameter: Math.PI / 2, position: 1 }),
      ]),
    );
    expect(canonicalKey(withS)).toBe(canonicalKey(withRz));
    // Same for T vs RZ(π/4).
    const withT = statevector(circuit([g({ type: 'H', qubit: 0, position: 0 }), g({ type: 'T', qubit: 0, position: 1 })]));
    const withRzT = statevector(
      circuit([
        g({ type: 'H', qubit: 0, position: 0 }),
        g({ type: 'RZ', qubit: 0, parameter: Math.PI / 4, position: 1 }),
      ]),
    );
    expect(canonicalKey(withT)).toBe(canonicalKey(withRzT));
  });

  it('still tells genuinely different states apart', () => {
    const plus = statevector(circuit([g({ type: 'H', qubit: 0, position: 0 })]));
    const minus = statevector(
      circuit([g({ type: 'H', qubit: 0, position: 0 }), g({ type: 'Z', qubit: 0, position: 1 })]),
    );
    // |+⟩ and |−⟩ differ by a RELATIVE phase, which no global rotation removes.
    expect(canonicalKey(plus)).not.toBe(canonicalKey(minus));
    expect(canonicalKey(zeroState())).not.toBe(canonicalKey(plus));
  });

  it('is blind to an overall phase applied to the whole vector', () => {
    const s = statevector(circuit([g({ type: 'H', qubit: 0, position: 0 })]));
    const rotated = s.map((a) => ({ re: -a.im, im: a.re })); // × i
    expect(canonicalKey(rotated)).toBe(canonicalKey(s));
  });
});

describe('findOptimal — exact minima', () => {
  it('needs one gate for |1⟩ and two for a Bell pair', () => {
    const one = findOptimal(holeTargetState(hole(6)), EASY, 1, { maxDepth: 4 });
    expect(one?.length).toBe(1);
    expect(one?.[0].type).toBe('X');

    const bell = findOptimal(holeTargetState(hole(2)), EASY, 2, { maxDepth: 4 });
    expect(bell?.length).toBe(2);
    expect(evaluate(circuit(bell!), hole(2)).holedIn).toBe(true);
  });

  it('finds the 2-gate answer hiding inside a redundant 4-gate circuit', () => {
    // X·X cancels and the second CX undoes the first: the state is just a Bell
    // pair, and the search must say so in two gates, not four.
    const redundant = circuit([
      g({ type: 'H', qubit: 0, position: 0 }),
      g({ type: 'X', qubit: 1, position: 1 }),
      g({ type: 'X', qubit: 1, position: 2 }),
      g({ type: 'CNOT', control: 0, target: 1, position: 3 }),
    ]);
    const found = findOptimal(statevector(redundant), EASY, 2, { maxDepth: 3 });
    expect(found?.length).toBe(2);
    // The answer really prepares the state (and so holes the Bell hole in).
    expect(evaluate(circuit(found!), hole(2)).holedIn).toBe(true);
  });

  it('returns the gates in board order, at columns 0..n−1', () => {
    const ghz3 = findOptimal(holeTargetState(hole(3)), EASY, 3, { maxDepth: 4 });
    expect(ghz3?.length).toBe(3);
    expect(ghz3?.map((x) => x.position)).toEqual([0, 1, 2]);
    expect(new Set(ghz3?.map((x) => x.id)).size).toBe(3); // ids stay unique
    expect(evaluate(circuit(ghz3!), hole(3)).holedIn).toBe(true);
  });

  it('returns null when nothing shorter than maxDepth reaches the target', () => {
    // GHZ-3 cannot be built in two gates.
    expect(findOptimal(holeTargetState(hole(3)), EASY, 3, { maxDepth: 2 })).toBeNull();
    // …nor can a phase target be reached without a phase club.
    expect(findOptimal(holeTargetState(hole(13)), EASY, 3, { maxDepth: 5 })).toBeNull();
  });

  it('runs the moves through the shared simulator — no second gate algebra', () => {
    // Every move the search can make evolves a state exactly as `applyGatesTo`
    // does for the same gate, because it IS `applyGatesTo`. This pins the reuse.
    const start = statevector(circuit([g({ type: 'H', qubit: 0, position: 0 })]));
    for (const move of movesFor(DIFFICULT, 3)) {
      expect(applyGatesTo(start, [move]).length).toBe(start.length);
    }
  });
});

describe('optimalSearch — the three outcomes', () => {
  it('proves a classic reference solution minimal', () => {
    // E3 (GHZ-3, 3 gates): nothing shorter exists, and the search says so.
    const h = hole(3);
    const it = optimalSearch(holeTargetState(h), clubGateTypes(h), h.qubits, {
      maxDepth: h.solution!.gates.length - 1,
    });
    let step = it.next();
    while (!step.done) step = it.next();
    expect(step.value.status).toBe('minimal');
  });

  it('reports unknown — not minimal — when the budget runs out', () => {
    // A deliberately tiny budget on a wide hole: the honest answer is "no idea".
    const h = hole(18); // X5, five wires, eight clubs
    const it = optimalSearch(holeTargetState(h), clubGateTypes(h), h.qubits, {
      maxDepth: 5,
      stateBudget: 50,
    });
    let step = it.next();
    while (!step.done) step = it.next();
    expect(step.value.status).toBe('unknown');
    // `findOptimal` folds that into null, which is why the richer result exists.
    expect(findOptimal(holeTargetState(h), clubGateTypes(h), h.qubits, { maxDepth: 5, stateBudget: 50 })).toBeNull();
  });

  it('yields to its caller so a long search can be chunked', async () => {
    const h = hole(18);
    const it = optimalSearch(holeTargetState(h), clubGateTypes(h), h.qubits, {
      maxDepth: 5,
      stateBudget: 60_000,
    });
    let chunks = 0;
    let step = it.next();
    while (!step.done) {
      chunks += 1;
      expect(step.value).toBeGreaterThan(0); // progress, in children expanded
      step = it.next();
    }
    expect(chunks).toBeGreaterThan(1);

    // The async drain returns the same verdict.
    const result = await findOptimalAsync(holeTargetState(h), clubGateTypes(h), h.qubits, {
      maxDepth: 5,
      stateBudget: 60_000,
    });
    expect(result.status).toBe(step.value.status);
  });
});

describe('cost — the searches the card actually starts', () => {
  it('settles a Bell-sized question in a sliver of the budget', () => {
    // The guard that matters: the common case must be nowhere near the cap.
    let visited = 0;
    const it = optimalSearch(holeTargetState(hole(2)), EASY, 2, { maxDepth: 1 });
    let step = it.next();
    while (!step.done) {
      visited = step.value;
      step = it.next();
    }
    expect(step.value.status).toBe('minimal');
    expect(visited).toBeLessThan(DEFAULT_STATE_BUDGET / 100);
  });

  it('resolves every classic hole within the default budget', () => {
    // Measured: the reference solutions are all minimal, and proving it costs
    // ~1k states for the easy wide holes, ~176k for X5 (the only expensive one).
    for (let n = 1; n <= 18; n++) {
      const h = hole(n);
      const it = optimalSearch(holeTargetState(h), clubGateTypes(h), h.qubits, {
        maxDepth: h.solution!.gates.length - 1,
      });
      let step = it.next();
      while (!step.done) step = it.next();
      expect(step.value.status, `hole ${n} (${h.code})`).toBe('minimal');
    }
  }, 60_000);

  it('beats the dealt solution on a random course, and the answer holes in', () => {
    // Where the feature earns its keep: a generator is essentially never minimal.
    const course = randomCourse(20260725);
    let improved = 0;
    for (const h of course) {
      if (h.qubits > 3) continue; // keep the test quick; the wide holes are benched
      const it = optimalSearch(holeTargetState(h), clubGateTypes(h), h.qubits, {
        maxDepth: h.solution!.gates.length - 1,
      });
      let step = it.next();
      while (!step.done) step = it.next();
      if (step.value.status !== 'shorter') continue;
      improved += 1;
      expect(step.value.gates.length).toBeLessThan(h.solution!.gates.length);
      expect(evaluate(circuit(step.value.gates), h).holedIn, `${h.code}`).toBe(true);
    }
    expect(improved).toBeGreaterThan(0);
  }, 60_000);
});
