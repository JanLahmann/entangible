/**
 * The golf goal line — plain words for a target state.
 *
 * TOTALITY (project discipline): the sentence is generated, so it is asserted
 * over EVERY hole it can be asked about — all eighteen holes of the four
 * built-in rounds, and a seeded sample of generated random-course holes — not
 * just the handful a reviewer thought of. Every sentence must be non-empty and
 * shaped like a goal, and every SPECIFIC claim a template makes ("certain to
 * land on …", "always … or …", "N outcomes, all equally likely", no twist) is
 * re-checked against the state itself, so a template can be vague but never
 * wrong. Round 1 (Easy) is pinned word for word: it is the first thing a new
 * player reads.
 */
import { describe, it, expect } from 'vitest';
import { HOLES, holeTargetState, type Hole } from '@quantum/golf';
import { generateCourse } from '@quantum/golfRandom';
import { basisVisuals } from '@quantum/qsphere';
import type { StateVector } from '@quantum/statevector';
import { GOAL_FALLBACK, classifyGoal, goalSentence, holeGoal, renderGoal } from './goalLine';
import { de } from '@shared/i18n/de';

const R = Math.SQRT1_2;
const c = (re: number, im = 0) => ({ re, im });

/** A 32-amplitude vector from {index: amplitude}. */
function vec(terms: Record<number, { re: number; im: number }>): StateVector {
  const out: StateVector = Array.from({ length: 32 }, () => c(0));
  for (const [i, a] of Object.entries(terms)) out[Number(i)] = a;
  return out;
}

/** Multiply every amplitude by e^{iθ} — a global phase, invisible to physics. */
function globalPhase(sv: StateVector, theta: number): StateVector {
  const [co, si] = [Math.cos(theta), Math.sin(theta)];
  return sv.map((a) => c(a.re * co - a.im * si, a.re * si + a.im * co));
}

/**
 * Re-derive every concrete claim a sentence makes from the state, independently
 * of the classifier, so the test proves the words TRUE rather than restating the
 * implementation.
 */
function assertHonest(sentence: string, target: StateVector, k: number) {
  const label = (i: number) => i.toString(2).padStart(k, '0');
  const live = basisVisuals(target, 1 << k).filter((v) => v.prob > 1e-9);
  const twisted = live.some((v) => {
    const off = v.phaseDeg > 180 ? 360 - v.phaseDeg : v.phaseDeg;
    return off > 0.5;
  });

  const certain = sentence.match(/certain to land on ([01]+)/);
  if (certain) {
    expect(live).toHaveLength(1);
    expect(label(live[0].index)).toBe(certain[1]);
  }
  const pair = sentence.match(/([01]+) or ([01]+)/);
  if (pair) {
    expect(live.map((v) => label(v.index)).sort()).toEqual([pair[1], pair[2]].sort());
  }
  if (/50\/50|agree|disagree/.test(sentence) && !/outcomes/.test(sentence)) {
    if (!/coins/.test(sentence)) {
      expect(live).toHaveLength(2);
      for (const v of live) expect(v.prob).toBeCloseTo(0.5, 9);
    }
  }
  if (/always agree/.test(sentence)) {
    expect(live.map((v) => v.index).sort((a, b) => a - b)).toEqual([0, (1 << k) - 1]);
  }
  if (/always disagree/.test(sentence)) {
    expect(live.map((v) => label(v.index)).sort()).toEqual(['01', '10']);
  }
  const outcomes = sentence.match(/(\d+) outcomes, all equally likely/);
  if (outcomes) {
    expect(live).toHaveLength(Number(outcomes[1]));
    for (const v of live) expect(v.prob).toBeCloseTo(1 / live.length, 9);
  }
  if (/fair 50\/50 coins/.test(sentence)) {
    expect(live).toHaveLength(1 << k);
    expect(twisted).toBe(false);
  }
  // A twist is claimed exactly when one is there (or the line is the fallback,
  // which claims nothing at all).
  if (sentence !== GOAL_FALLBACK && live.length > 1) {
    expect(/phase twist/.test(sentence)).toBe(twisted);
  }
}

/** Three full random courses (54 holes), dealt once and shared by the en and de sweeps. */
let RANDOM_HOLES: Hole[] | null = null;
function randomHoles(): Hole[] {
  RANDOM_HOLES ??= [1, 4242, 20260725].flatMap((seed) => generateCourse(seed).map((g) => g.hole));
  return RANDOM_HOLES;
}

function assertWellFormed(sentence: string) {
  expect(sentence.trim().length).toBeGreaterThan('Goal: '.length);
  expect(sentence.startsWith('Goal: ')).toBe(true);
  expect(sentence.endsWith('.')).toBe(true);
  // One line: nothing that would break it.
  expect(sentence).not.toMatch(/\n/);
}

describe('goalSentence — the families', () => {
  it('reads |1⟩ as a certain flip, |+⟩ as a fair coin, Bell as agreement', () => {
    expect(goalSentence(vec({ 1: c(1) }), 1)).toBe(
      'Goal: make the ball certain to land on 1 — flip it.',
    );
    expect(goalSentence(vec({ 0: c(R), 1: c(R) }), 1)).toBe('Goal: a fair 50/50 coin.');
    expect(goalSentence(vec({ 0: c(R), 3: c(R) }), 2)).toBe(
      'Goal: entangle the two balls so they always agree.',
    );
  });

  it('names a phase twist when the amplitudes match but the phases do not', () => {
    expect(goalSentence(vec({ 0: c(R), 1: c(-R) }), 1)).toBe(
      'Goal: a fair 50/50 coin, plus a half-turn phase twist.',
    );
    expect(goalSentence(vec({ 0: c(R), 7: c(0, R) }), 3)).toBe(
      'Goal: entangle all 3 balls so they always agree, plus a quarter-turn phase twist.',
    );
    expect(goalSentence(vec({ 0: c(R), 1: c(0.5, 0.5) }), 1)).toBe(
      'Goal: a fair 50/50 coin, plus an eighth-turn phase twist.',
    );
  });

  it('never mistakes a global phase for a twist', () => {
    const plus = vec({ 0: c(R), 1: c(R) });
    const bell = vec({ 0: c(R), 3: c(R) });
    for (const theta of [0.3, Math.PI / 2, Math.PI, 2.5]) {
      expect(goalSentence(globalPhase(plus, theta), 1)).toBe('Goal: a fair 50/50 coin.');
      expect(goalSentence(globalPhase(bell, theta), 2)).toBe(
        'Goal: entangle the two balls so they always agree.',
      );
    }
  });

  it('reads an even spread over every outcome as independent coins', () => {
    expect(goalSentence(vec({ 0: c(0.5), 1: c(0.5), 2: c(0.5), 3: c(0.5) }), 2)).toBe(
      'Goal: make both balls fair 50/50 coins.',
    );
  });

  it('falls back honestly on unequal weights (the Cascade)', () => {
    const cascade = HOLES.find((h) => h.name === 'Cascade')!;
    expect(holeGoal(cascade)).toBe(GOAL_FALLBACK);
    expect(goalSentence(vec({ 0: c(Math.sqrt(0.8)), 1: c(Math.sqrt(0.2)) }), 1)).toBe(
      GOAL_FALLBACK,
    );
  });
});

describe('goalSentence — totality over the built-in course', () => {
  it('pins round 1 (Easy) word for word — the first lines a new player reads', () => {
    const easy = HOLES.filter((h) => h.round === 'easy');
    expect(easy.map((h) => [h.code, holeGoal(h)])).toEqual([
      ['E1', 'Goal: a fair 50/50 coin.'],
      ['E2', 'Goal: entangle the two balls so they always agree.'],
      ['E3', 'Goal: entangle all 3 balls so they always agree.'],
      ['E4', 'Goal: entangle all 4 balls so they always agree.'],
      ['E5', 'Goal: entangle all 5 balls so they always agree.'],
    ]);
  });

  it('pins the medium round’s first two holes (the flip and the anti-Bell)', () => {
    const [m1, m2] = HOLES.filter((h) => h.round === 'medium');
    expect(holeGoal(m1)).toBe('Goal: make the ball certain to land on 1 — flip it.');
    expect(holeGoal(m2)).toBe('Goal: entangle the two balls so they always disagree.');
  });

  it('every hole of all four rounds gets a well-formed, honest sentence', () => {
    expect(HOLES).toHaveLength(18);
    for (const round of ['easy', 'medium', 'difficult', 'extra'] as const) {
      expect(HOLES.some((h) => h.round === round)).toBe(true);
    }
    for (const h of HOLES) {
      const s = holeGoal(h);
      assertWellFormed(s);
      assertHonest(s, holeTargetState(h), h.qubits);
    }
  });

  it('only the unequal-weight hole needs the fallback on the classic course', () => {
    const fallbacks = HOLES.filter((h) => holeGoal(h) === GOAL_FALLBACK).map((h) => h.code);
    expect(fallbacks).toEqual(['X3']);
  });
});

describe('goalSentence — totality over generated random courses', () => {
  // Three full random courses: 54 holes across every slot (E1…X5). A cold deal
  // builds the club orbits first, so this pays seconds of generation — hence
  // the generous timeout, as in golfRandom.test.ts. (Dealt once by
  // `randomHoles`, shared with the German sweep below.)

  it(
    'every one of ≥50 seeded random holes gets a well-formed, honest sentence',
    () => {
      const holes = randomHoles();
      expect(holes.length).toBeGreaterThanOrEqual(50);
      for (const h of holes) {
        const s = holeGoal(h);
        assertWellFormed(s);
        assertHonest(s, holeTargetState(h), h.qubits);
      }
      // The templates carry the course: the fallback stays the exception.
      const specific = holes.filter((h) => holeGoal(h) !== GOAL_FALLBACK).length;
      expect(specific / holes.length).toBeGreaterThan(0.8);
    },
    240_000,
  );
});

// ---------------------------------------------------------------------------
// German (shared/i18n/de.ts). The same rule binds every language: the line may
// be vague but never wrong. Each German template's concrete claims are
// re-derived from the state by an independent German reader, over the same
// totality sweep as English, and every hole must read from the SAME
// classification in both languages.
// ---------------------------------------------------------------------------

/** `assertHonest` for German: every concrete claim re-checked against the state. */
function assertHonestDe(sentence: string, target: StateVector, k: number) {
  const label = (i: number) => i.toString(2).padStart(k, '0');
  const live = basisVisuals(target, 1 << k).filter((v) => v.prob > 1e-9);
  const twisted = live.some((v) => {
    const off = v.phaseDeg > 180 ? 360 - v.phaseDeg : v.phaseDeg;
    return off > 0.5;
  });

  const certain = sentence.match(/sicher auf ([01]+) landen/);
  if (certain) {
    expect(live).toHaveLength(1);
    expect(label(live[0].index)).toBe(certain[1]);
  }
  const pair = sentence.match(/([01]+) oder ([01]+)/);
  if (pair) {
    expect(live.map((v) => label(v.index)).sort()).toEqual([pair[1], pair[2]].sort());
  }
  if (/50\/50|landen (immer|nie) gleich/.test(sentence) && !/Ergebnisse/.test(sentence)) {
    if (!/Münzen/.test(sentence)) {
      expect(live).toHaveLength(2);
      for (const v of live) expect(v.prob).toBeCloseTo(0.5, 9);
    }
  }
  if (/landen immer gleich/.test(sentence)) {
    expect(live.map((v) => v.index).sort((a, b) => a - b)).toEqual([0, (1 << k) - 1]);
  }
  if (/landen nie gleich/.test(sentence)) {
    expect(live.map((v) => label(v.index)).sort()).toEqual(['01', '10']);
  }
  const outcomes = sentence.match(/(\d+) Ergebnisse, alle gleich wahrscheinlich/);
  if (outcomes) {
    expect(live).toHaveLength(Number(outcomes[1]));
    for (const v of live) expect(v.prob).toBeCloseTo(1 / live.length, 9);
  }
  if (/fairen 50\/50-Münzen/.test(sentence)) {
    expect(live).toHaveLength(1 << k);
    expect(twisted).toBe(false);
  }
  if (sentence !== de.goal.fallback && live.length > 1) {
    expect(/Phasendrehung/.test(sentence)).toBe(twisted);
  }
}

function assertWellFormedDe(sentence: string) {
  expect(sentence.trim().length).toBeGreaterThan('Ziel: '.length);
  expect(sentence.startsWith('Ziel: ')).toBe(true);
  expect(sentence.endsWith('.')).toBe(true);
  expect(sentence).not.toMatch(/\n/);
  // Nothing English left in a German line.
  expect(sentence).not.toMatch(/\b(Goal|balls?|coin|entangle|always|outcomes|twist)\b/);
}

/** Both languages say the same thing: one classification, two renderings. */
function assertSameReading(h: Hole) {
  const goal = classifyGoal(holeTargetState(h), h.qubits);
  const enLine = holeGoal(h);
  const deLine = holeGoal(h, de);
  expect(enLine).toBe(renderGoal(goal));
  expect(deLine).toBe(renderGoal(goal, de));
  expect(enLine === GOAL_FALLBACK).toBe(deLine === de.goal.fallback);
  expect(deLine).not.toBe(enLine);
}

describe('goalSentence — German', () => {
  it('pins round 1 (Easy) word for word in German', () => {
    const easy = HOLES.filter((h) => h.round === 'easy');
    expect(easy.map((h) => [h.code, holeGoal(h, de)])).toEqual([
      ['E1', 'Ziel: eine faire 50/50-Münze.'],
      ['E2', 'Ziel: beide Kugeln verschränken – sie landen immer gleich.'],
      ['E3', 'Ziel: alle 3 Kugeln verschränken – sie landen immer gleich.'],
      ['E4', 'Ziel: alle 4 Kugeln verschränken – sie landen immer gleich.'],
      ['E5', 'Ziel: alle 5 Kugeln verschränken – sie landen immer gleich.'],
    ]);
  });

  it('words every template, twists included, in German', () => {
    expect(goalSentence(vec({ 1: c(1) }), 1, de)).toBe(
      'Ziel: die Kugel sicher auf 1 landen lassen – kipp sie um.',
    );
    expect(goalSentence(vec({ 0: c(1) }), 1, de)).toBe('Ziel: die Kugel sicher auf 0 landen lassen.');
    expect(goalSentence(vec({ 2: c(1) }), 2, de)).toBe('Ziel: beide Kugeln sicher auf 10 landen lassen.');
    expect(goalSentence(vec({ 0: c(R), 1: c(-R) }), 1, de)).toBe(
      'Ziel: eine faire 50/50-Münze, dazu eine halbe Phasendrehung.',
    );
    expect(goalSentence(vec({ 0: c(R), 7: c(0, R) }), 3, de)).toBe(
      'Ziel: alle 3 Kugeln verschränken – sie landen immer gleich, dazu eine Viertel-Phasendrehung.',
    );
    expect(goalSentence(vec({ 1: c(R), 2: c(R) }), 2, de)).toBe(
      'Ziel: beide Kugeln verschränken – sie landen nie gleich.',
    );
    expect(goalSentence(vec({ 1: c(R), 6: c(R) }), 3, de)).toBe(
      'Ziel: alle 3 Kugeln verschränken – immer 001 oder 110, 50/50.',
    );
    expect(goalSentence(vec({ 1: c(R), 3: c(R) }), 3, de)).toBe(
      'Ziel: eine Kugel als faire 50/50-Münze, die anderen sicher – 001 oder 011.',
    );
    expect(goalSentence(vec({ 1: c(R), 7: c(R) }), 3, de)).toBe(
      'Ziel: 2 der 3 Kugeln verschränken – immer 001 oder 111, 50/50.',
    );
    expect(goalSentence(vec({ 0: c(0.5), 1: c(0.5), 2: c(0.5), 3: c(0.5) }), 2, de)).toBe(
      'Ziel: beide Kugeln zu fairen 50/50-Münzen machen.',
    );
    expect(goalSentence(vec({ 0: c(0.5), 1: c(0.5), 2: c(0.5), 3: c(-0.5) }), 2, de)).toBe(
      'Ziel: 4 Ergebnisse, alle gleich wahrscheinlich, dazu eine Phasendrehung.',
    );
    expect(goalSentence(vec({ 0: c(Math.sqrt(0.8)), 1: c(Math.sqrt(0.2)) }), 1, de)).toBe(
      de.goal.fallback,
    );
  });

  it('every classic hole: well-formed, honest German from the same reading as English', () => {
    for (const h of HOLES) {
      const s = holeGoal(h, de);
      assertWellFormedDe(s);
      assertHonestDe(s, holeTargetState(h), h.qubits);
      assertSameReading(h);
    }
  });

  it(
    'every one of the ≥50 seeded random holes: well-formed, honest German, same reading',
    () => {
      const holes = randomHoles();
      expect(holes.length).toBeGreaterThanOrEqual(50);
      for (const h of holes) {
        const s = holeGoal(h, de);
        assertWellFormedDe(s);
        assertHonestDe(s, holeTargetState(h), h.qubits);
        assertSameReading(h);
      }
    },
    240_000,
  );
});
