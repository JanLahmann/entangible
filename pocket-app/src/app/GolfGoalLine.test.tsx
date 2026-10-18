// @vitest-environment jsdom
/**
 * The golf goal line is never cut off (Jan, iOS app, a random-course hole:
 * "Ziel: eine Kugel als faire 50/50-Münze, die anderen sicher – 10 ode…").
 *
 * jsdom does no layout, so the wrapping itself is pinned in
 * pocketLayoutCss.test.ts (no nowrap / ellipsis / line clamp on the line).
 * Here: the LONGEST sentence the goal templates can produce — enumerated over
 * every template, twist and width up to five balls, so a longer wording in a
 * later translation is covered automatically — reaches the sphere panel
 * whole, in English and German, as plain text with no tooltip copy.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef, useState } from 'react';
import type { Circuit } from '@qamposer/react';
import { LangProvider } from '@shared/i18n';
import { en } from '@shared/i18n/en';
import { de } from '@shared/i18n/de';
import type { Messages } from '@shared/i18n/en';
import { renderGoal, type Goal, type GoalTwist } from '@shared/display/goalLine';
import { ManualEditSource } from '../sources/ManualEditSource';
import { GolfBoard } from './GolfBoard';
import { TapPlay } from './TapPlay';
import { useGolfGame } from './useGolfGame';

const shown = vi.hoisted(() => ({ goal: '' }));
vi.mock('@shared/display/goalLine', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@shared/display/goalLine')>();
  return { ...orig, holeGoal: () => shown.goal };
});

/** Every goal the templates can state for holes of up to five balls. */
function allGoals(): Goal[] {
  const twists: (GoalTwist | null)[] = [null, ...(Object.keys(en.goal.twist) as GoalTwist[])];
  const out: Goal[] = [{ kind: 'fallback' }, { kind: 'certainOne' }, { kind: 'certainZero' }];
  for (let k = 1; k <= 5; k++) {
    const a = '1'.repeat(k);
    const b = '0'.repeat(k);
    out.push({ kind: 'certain', balls: k, bits: a }, { kind: 'allCoins', balls: k });
    for (const twist of twists) {
      out.push(
        { kind: 'fairCoin', twist },
        { kind: 'agree', balls: k, twist },
        { kind: 'disagree', twist },
        { kind: 'complement', balls: k, a: b, b: a, twist },
        { kind: 'oneCoin', a: b, b: a, twist },
      );
      for (let e = 2; e <= k; e++) {
        out.push({ kind: 'someEntangled', entangled: e, balls: k, a: b, b: a, twist });
      }
    }
  }
  for (let m = 3; m <= 32; m++) {
    for (const twist of twists) out.push({ kind: 'equallyLikely', outcomes: m, twist });
  }
  return out;
}

/** Every goal line a player can meet: the generated ones (random course) and
 *  the authored line of every classic hole (`t.golf.holeGoals`). */
function everyGoalLine(t: Messages): string[] {
  return [...allGoals().map((g) => renderGoal(g, t)), ...Object.values(t.golf.holeGoals)];
}

function longestGoal(t: Messages): string {
  return everyGoalLine(t).reduce((x, y) => (y.length > x.length ? y : x), '');
}

function Harness() {
  const sourceRef = useRef(new ManualEditSource());
  const [circuit] = useState<Circuit>({ qubits: 5, gates: [] } as Circuit);
  const game = useGolfGame({
    storage: null,
    courseCode: null,
    courseScope: null,
    setCourseCode: () => {},
    setCourseScope: () => {},
    clearBoard: () => sourceRef.current.clear(),
    circuit,
    onCelebrate: () => {},
  });
  return (
    <GolfBoard
      game={game}
      circuit={circuit}
      underSphere={<TapPlay game={game} circuit={circuit} onChange={() => {}} />}
    />
  );
}

afterEach(() => cleanup());

describe('golf goal line: the longest goal is shown whole', () => {
  it.each([
    ['en', en],
    ['de', de],
  ] as const)('%s', async (lang, t) => {
    shown.goal = longestGoal(t);
    // A real worst case, not a short placeholder: well past one phone line.
    expect(shown.goal.length).toBeGreaterThan(90);
    const { container } = render(
      <LangProvider lang={lang}>
        <Harness />
      </LangProvider>,
    );
    await act(async () => {});
    const line = container.querySelector('.pk-side-hero .pk-golf-goal');
    expect(line).not.toBeNull();
    expect(line!.textContent).toBe(shown.goal);
    expect(line!.textContent).not.toContain('…');
    // Nothing is hidden, so there is no tooltip copy for VoiceOver to repeat.
    expect(line!.hasAttribute('title')).toBe(false);
  });

  it.each([
    ['en', en],
    ['de', de],
  ] as const)('%s: every authored classic-hole line reaches the panel whole', async (lang, t) => {
    const lines = Object.values(t.golf.holeGoals);
    expect(lines).toHaveLength(18);
    for (const goal of lines) {
      shown.goal = goal;
      const { container } = render(
        <LangProvider lang={lang}>
          <Harness />
        </LangProvider>,
      );
      await act(async () => {});
      const line = container.querySelector('.pk-side-hero .pk-golf-goal');
      expect(line!.textContent, goal).toBe(goal);
      // No line of the course itself looks truncated.
      expect(goal, goal).not.toContain('…');
      expect(line!.hasAttribute('title')).toBe(false);
      cleanup();
    }
  });
});
