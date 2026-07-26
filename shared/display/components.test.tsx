// @vitest-environment jsdom
/**
 * SC2 drift guards for the shared structural components. Each was two nearly
 * identical files (booth `bo-`/`ent-`, pocket `pk-`) before consolidation; these
 * tests assert that BOTH class-prefix bindings render the exact class names the
 * app CSS depends on, and that every parametrized per-app divergence
 * (microColData / uniformSuffix / monoKet / hideWhenEmpty / dismissGuard-free
 * booth vs pocket) is honoured. Runs once, in the pocket suite (jsdom pragma).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import type { Circuit, Gate } from '@qamposer/react';
import { Histogram } from './Histogram';
import { StatePanel } from './StatePanel';
import { QasmPanel } from './QasmPanel';
import { MessageStrip } from './MessageStrip';
import { Scorecard, courseShareLink } from './Scorecard';
import { MiniCircuit } from './MiniCircuit';
import { resetCourseTimers } from './courseTimer';
import { Celebrations } from './Celebrations';
import {
  COURSE_PAR,
  HOLES,
  completionCelebration,
  courseTotals,
  golfStep,
  golfReveal,
  initialGolfState,
} from '@quantum/golf';
import { courseCode, randomCourse } from '@quantum/golfRandom';

afterEach(cleanup);
// The course clock and the per-hole stuck clocks are module stores (#83, #98):
// one test's fake-time stamps must never be inherited by the next.
afterEach(resetCourseTimers);

let seq = 0;
const g = (partial: Omit<Gate, 'id'>): Gate => ({ id: `g${seq++}`, ...partial });
const circuit = (gates: Gate[]): Circuit => ({ qubits: 5, gates });

const bell = circuit([
  g({ type: 'H', qubit: 0, position: 0 }),
  g({ type: 'CNOT', control: 0, target: 1, position: 1 }),
]);
// H on rows 0..3 → 16 equally likely outcomes → the uniform "micro" branch.
const uniform4 = circuit([0, 1, 2, 3].map((q) => g({ type: 'H', qubit: q, position: q })));

describe('Histogram (shared)', () => {
  it('renders bo- and pk- class names for the fixed 8-column (D=3) view', () => {
    for (const p of ['bo', 'pk'] as const) {
      const { container } = render(
        <Histogram circuit={bell} displayQubits={3} classPrefix={p} />,
      );
      expect(container.querySelector(`.${p}-label`)).not.toBeNull();
      expect(container.querySelector(`.${p}-h-plot`)).not.toBeNull();
      expect(container.querySelectorAll(`.${p}-h-col`).length).toBe(8);
      expect(container.querySelector(`.${p}-h-bar`)).not.toBeNull();
      expect(container.querySelector(`.${p}-h-stack`)).not.toBeNull();
      cleanup();
    }
  });

  it('renders the empty-state class when nothing is placed (D>=4)', () => {
    for (const p of ['bo', 'pk'] as const) {
      const { container } = render(
        <Histogram circuit={circuit([])} displayQubits={4} classPrefix={p} />,
      );
      expect(container.querySelector(`.${p}-h-empty`)?.textContent).toBe(
        'Place a tile to see outcomes',
      );
      cleanup();
    }
  });

  it('honours the microColData seam: booth micro cols carry no data-bits, pocket cols do', () => {
    // Booth binding: microColData=false, uniformSuffix=" possibilities".
    const booth = render(
      <Histogram
        circuit={uniform4}
        displayQubits={4}
        classPrefix="bo"
        microColData={false}
        uniformSuffix=" possibilities"
      />,
    );
    expect(booth.container.querySelector('.bo-h-plot.is-micro')).not.toBeNull();
    expect(booth.container.querySelectorAll('.bo-h-col[data-bits]').length).toBe(0);
    expect(booth.container.querySelector('.bo-h-note')?.textContent).toMatch(
      /equally likely possibilities$/,
    );
    cleanup();

    // Pocket binding: microColData=true, uniformSuffix="".
    const pocket = render(
      <Histogram
        circuit={uniform4}
        displayQubits={4}
        classPrefix="pk"
        microColData={true}
        uniformSuffix=""
      />,
    );
    expect(pocket.container.querySelectorAll('.pk-h-col[data-bits]').length).toBe(16);
    expect(pocket.container.querySelector('.pk-h-note')?.textContent).toMatch(
      /equally likely$/,
    );
  });
});

describe('Histogram (shared) — paired ideal + noisy series', () => {
  // Build a 32-length physical probability vector (statevector basis ordering).
  const noisyVec = (entries: Record<number, number>): number[] => {
    const v = new Array<number>(32).fill(0);
    for (const [i, p] of Object.entries(entries)) v[+i] = p;
    return v;
  };
  // Bell on q0/q1, D=5: ideal peaks are 00000 (index 0) and 11000 (index 3, q0+q1).
  // 00100 (index 4, a q2 flip) is ideal-zero — a noisy-only leakage outcome.
  const bellNoisy = noisyVec({ 0: 0.4, 3: 0.4, 4: 0.06, 1: 0.05, 2: 0.05, 5: 0.0001 });

  it('single-series rendering is unchanged when no noisy prop is given', () => {
    const { container } = render(<Histogram circuit={bell} displayQubits={5} classPrefix="pk" />);
    expect(container.querySelector('.pk-h-bar--noisy')).toBeNull();
    expect(container.querySelector('.pk-h-legend')).toBeNull();
    expect(container.querySelector('.pk-h-pair')).toBeNull();
  });

  it('renders paired bars over the UNION of ideal peaks and noisy leakage', () => {
    const { container } = render(
      <Histogram circuit={bell} displayQubits={5} classPrefix="pk" noisy={bellNoisy} />,
    );
    // A noisy bar per column + the pair wrapper.
    expect(container.querySelector('.pk-h-bar--noisy')).not.toBeNull();
    expect(container.querySelector('.pk-h-pair')).not.toBeNull();
    const bits = [...container.querySelectorAll('.pk-h-col[data-bits]')].map((c) =>
      c.getAttribute('data-bits'),
    );
    // Both ideal peaks are present…
    expect(bits).toContain('00000');
    expect(bits).toContain('11000');
    // …and so is the ideal-zero, noisy-only leakage outcome (the whole point).
    expect(bits).toContain('00100');
    // A noisy outcome below the noisy floor (0.0001) is NOT surfaced.
    expect(bits).not.toContain('10100');
  });

  it('renders the legend only in paired mode, with prop-driven labels', () => {
    const { container } = render(
      <Histogram
        circuit={bell}
        displayQubits={5}
        classPrefix="pk"
        noisy={bellNoisy}
        idealLabel="perfect"
        noisyLabel="on hardware"
      />,
    );
    const legend = container.querySelector('.pk-h-legend');
    expect(legend).not.toBeNull();
    expect(legend?.textContent).toContain('perfect');
    expect(legend?.textContent).toContain('on hardware');
    expect(container.querySelector('.pk-h-swatch--noisy')).not.toBeNull();
  });

  it('D=3 fixed axis lights a noisy-only leakage column (not a dim stub)', () => {
    // 00100 (index 4) is ideal-zero for Bell but carries noisy weight → not dim.
    const { container } = render(
      <Histogram circuit={bell} displayQubits={3} classPrefix="pk" noisy={bellNoisy} />,
    );
    expect(container.querySelectorAll('.pk-h-col').length).toBe(8);
    expect(container.querySelector('.pk-h-bar--noisy')).not.toBeNull();
    expect(container.querySelector('.pk-h-legend')).not.toBeNull();
    const leak = container.querySelector('.pk-h-col[data-bits="001"]');
    expect(leak?.className).not.toContain('is-dim');
  });

  it('with noise on, an empty circuit still renders (readout leakage), not the placeholder', () => {
    const { container } = render(
      <Histogram
        circuit={circuit([])}
        displayQubits={5}
        classPrefix="pk"
        noisy={noisyVec({ 0: 0.9, 1: 0.03, 2: 0.03, 4: 0.02 })}
      />,
    );
    expect(container.querySelector('.pk-h-empty')).toBeNull();
    expect(container.querySelector('.pk-h-pair')).not.toBeNull();
    const bits = [...container.querySelectorAll('.pk-h-col[data-bits]')].map((c) =>
      c.getAttribute('data-bits'),
    );
    expect(bits).toContain('00000');
  });
});

describe('StatePanel (shared)', () => {
  it('renders bo-/pk- class names and the three stats', () => {
    for (const p of ['bo', 'pk'] as const) {
      const { container } = render(<StatePanel circuit={bell} classPrefix={p} />);
      expect(container.querySelector(`.${p}-label`)?.textContent).toBe('State');
      expect(container.querySelectorAll(`.${p}-stat`).length).toBe(3);
      // qubits touched = 2 (H on q0, CNOT touches q0,q1); gates = 2; columns = 2.
      const stats = container.querySelectorAll(`.${p}-stat b`);
      expect([...stats].map((b) => b.textContent)).toEqual(['2', '2', '2']);
      cleanup();
    }
  });
});

describe('QasmPanel (shared)', () => {
  const lines = ['OPENQASM 2.0;', 'qreg q[5];', 'h q[0];', 'cx q[0],q[1];'];

  it('renders bo-/pk- class names, keyword + tint classes', () => {
    for (const p of ['bo', 'pk'] as const) {
      const { container } = render(<QasmPanel lines={lines} classPrefix={p} />);
      expect(container.querySelector(`.${p}-label`)?.textContent).toBe('OpenQASM 2.0');
      expect(container.querySelector(`.${p}-well.${p}-qasm`)).not.toBeNull();
      // OPENQASM / qreg lines are keyword-classed; gate lines are tinted.
      expect(container.querySelectorAll('.kw').length).toBe(2);
      cleanup();
    }
  });

  it('honours hideWhenEmpty: booth hides an empty panel, pocket renders it', () => {
    const hidden = render(<QasmPanel lines={[]} classPrefix="bo" hideWhenEmpty />);
    expect(hidden.container.firstChild).toBeNull();
    cleanup();
    const shown = render(<QasmPanel lines={[]} classPrefix="pk" />);
    expect(shown.container.querySelector('.pk-label')).not.toBeNull();
  });
});

describe('MessageStrip (shared)', () => {
  it('renders the ent-/pk- strip classes and shows the first message immediately', () => {
    for (const p of ['ent', 'pk'] as const) {
      const { container } = render(
        <MessageStrip message={{ text: 'Bell pair!', token: 1 }} classPrefix={p} />,
      );
      const text = container.querySelector(`.${p}-strip__text`);
      expect(container.querySelector(`.${p}-strip`)).not.toBeNull();
      expect(text?.textContent).toBe('Bell pair!');
      expect(text?.className).toContain('is-visible');
      cleanup();
    }
  });
});

describe('Scorecard (shared)', () => {
  it('renders bo-/pk- class names for the hole-1 scorecard with all 18 chips', () => {
    for (const p of ['bo', 'pk'] as const) {
      const { container } = render(
        <Scorecard state={initialGolfState()} circuit={bell} classPrefix={p} />,
      );
      expect(container.querySelector(`.${p}-golf`)).not.toBeNull();
      expect(container.querySelector(`.${p}-golf-ket`)).not.toBeNull();
      // The full 18-hole course strip (E1..E5, M1..M5, D1..D5, X1/X3/X5).
      expect(container.querySelectorAll(`.${p}-golf-chip`).length).toBe(18);
      cleanup();
    }
  });

  it('shows the hole’s cumulative strokes, not the gates on the board (#68)', () => {
    // `bell` is a 2-gate circuit, but the hole has cost 5 strokes so far.
    const state = { ...initialGolfState(), strokes: 5 };
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    const stats = Array.from(container.querySelectorAll('.pk-stat')).map((n) => n.textContent);
    expect(stats).toContain('strokes 5');
  });

  it('honours the monoKet seam: pocket tints the ket, the booth does not', () => {
    const booth = render(
      <Scorecard state={initialGolfState()} circuit={bell} classPrefix="bo" />,
    );
    expect(booth.container.querySelector('.bo-golf-ket')?.className).toBe('bo-golf-ket');
    cleanup();
    const pocket = render(
      <Scorecard state={initialGolfState()} circuit={bell} classPrefix="pk" monoKet />,
    );
    expect(pocket.container.querySelector('.pk-golf-ket')?.className).toBe('pk-golf-ket pk-mono');
  });

  it('renders a random round through the same layout, with a course chip (#70)', () => {
    const state = initialGolfState({}, 'random', 4242);
    const hole = randomCourse(4242)[0];
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    expect(container.querySelector('.pk-golf-random')?.textContent).toBe('Random round');
    expect(container.querySelector('.pk-golf-name')?.textContent).toBe(`E1 — ${hole.name}`);
    expect(container.querySelector('.pk-golf-ket')?.textContent).toBe(`Target${hole.targetKet}`);
    const stats = Array.from(container.querySelectorAll('.pk-stat')).map((n) => n.textContent);
    expect(stats).toContain(`par ${hole.par}`);
    // Same 18-chip strip — the structure is shared with the classic course.
    expect(container.querySelectorAll('.pk-golf-chip').length).toBe(18);
  });

  it('draws the hole’s solution only after a hole-in, and only on request (#71)', () => {
    for (const p of ['bo', 'pk'] as const) {
      // Mid-hole: nothing to reveal, because the hole is not in yet.
      const playing = render(
        <Scorecard state={initialGolfState()} circuit={bell} classPrefix={p} />,
      );
      expect(playing.container.querySelector(`.${p}-golf-solution-btn`)).toBeNull();
      cleanup();

      // Holed in on E2 (Bell): the toggle appears, collapsed.
      const state = { ...initialGolfState(), levelIndex: 1, holedIn: true, strokes: 4 };
      const { container } = render(<Scorecard state={state} circuit={bell} classPrefix={p} />);
      const btn = container.querySelector(`.${p}-golf-solution-btn`) as HTMLButtonElement;
      expect(btn.textContent).toBe('Show solution');
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      expect(container.querySelector(`.${p}-golf-solution`)).toBeNull();

      // Expanded: the reference path DRAWN — H on q0, then a CX down to q1.
      fireEvent.click(btn);
      const svg = container.querySelector(`.${p}-golf-solution .${p}-mini-circ`);
      expect(svg).not.toBeNull();
      expect(svg?.querySelectorAll(`.${p}-mini-circ-wire`).length).toBe(2);
      expect(
        Array.from(svg!.querySelectorAll(`.${p}-mini-circ-gate`)).map((n) => n.textContent),
      ).toEqual(['H']);
      expect(svg?.querySelectorAll(`.${p}-mini-circ-dot`).length).toBe(1);
      expect(svg?.querySelectorAll(`.${p}-mini-circ-cross`).length).toBe(1);
      expect(btn.textContent).toBe('Hide solution');
      // The 18-hole strip is untouched.
      expect(container.querySelectorAll(`.${p}-golf-chip`).length).toBe(18);

      // Collapses again on the next tap.
      fireEvent.click(btn);
      expect(container.querySelector(`.${p}-golf-solution`)).toBeNull();
      cleanup();
    }
  });

  it('draws a generated hole’s generator on the random course (#71)', async () => {
    const state = { ...initialGolfState({}, 'random', 4242), holedIn: true, strokes: 9 };
    const generated = randomCourse(4242)[0];
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    fireEvent.click(container.querySelector('.pk-golf-solution-btn') as HTMLButtonElement);
    const svg = container.querySelector('.pk-golf-solution .pk-mini-circ');
    expect(svg).not.toBeNull();
    // E1 is a 1-qubit hole, so its generator draws on exactly one wire.
    expect(svg?.querySelectorAll('.pk-mini-circ-wire').length).toBe(generated.qubits);
    // Every generator gate is drawn (a 1-qubit hole has no controlled gates).
    expect(svg?.querySelectorAll('.pk-mini-circ-box').length).toBe(
      generated.solution!.gates.length,
    );
    // Let the optimal search (#72) settle before the card unmounts, so its
    // re-render lands inside the test rather than after it.
    await waitFor(() => expect(container.querySelector('.pk-golf-sol-label')).not.toBeNull());
  });

  it('the reveal is inert: it cannot touch the board or the score (#68)', () => {
    const state = { ...initialGolfState(), levelIndex: 1, holedIn: true, strokes: 7 };
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    const strokesBefore = container.querySelector('.pk-stat')?.parentElement?.textContent;
    fireEvent.click(container.querySelector('.pk-golf-solution-btn') as HTMLButtonElement);
    expect(container.querySelector('.pk-stat')?.parentElement?.textContent).toBe(strokesBefore);
    // The drawing takes no pointer events, so tap-to-inspect and the editor
    // never see gates that only exist as an illustration.
    expect((container.querySelector('.pk-mini-circ') as SVGElement).style.pointerEvents).toBe(
      'none',
    );
    expect(state.strokes).toBe(7);
  });

  it('promotes a minimal stored solution to "Solution — optimal" (#72)', async () => {
    // E2 (Bell) really is minimal in two gates, and proving it is instant.
    const state = { ...initialGolfState(), levelIndex: 1, holedIn: true, strokes: 4 };
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    fireEvent.click(container.querySelector('.pk-golf-solution-btn') as HTMLButtonElement);
    await waitFor(() =>
      expect(container.querySelector('.pk-golf-sol-label')?.textContent).toBe(
        'Solution — optimal',
      ),
    );
    // One drawing only: there is nothing shorter to show.
    expect(container.querySelectorAll('.pk-golf-solution').length).toBe(1);
  });

  it('calls a random hole’s solution optimal — generation already shortened it (#76)', async () => {
    // Since #76 a generated hole ships the SHORTEST circuit it could find, so
    // the reveal's own search confirms it rather than beating it: one drawing,
    // labelled optimal. (The two-drawing path stays for the holes whose
    // generation-time search ran out of budget — the wide EXTRA slot.)
    const state = { ...initialGolfState({}, 'random', 4242), holedIn: true, strokes: 9 };
    const hole = randomCourse(4242)[0];
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    fireEvent.click(container.querySelector('.pk-golf-solution-btn') as HTMLButtonElement);
    await waitFor(() =>
      expect(container.querySelector('.pk-golf-sol-label')?.textContent).toBe(
        'Solution — optimal',
      ),
    );
    expect(container.querySelectorAll('.pk-golf-solution').length).toBe(1);
    // …and par is that solution plus two, the classic course's own rule.
    expect(hole.par).toBe(hole.solution!.gates.length + 2);
    const stats = Array.from(container.querySelectorAll('.pk-stat')).map((n) => n.textContent);
    expect(stats).toContain(`par ${hole.par}`);
  });

  it('says nothing when the search cannot decide, and never blocks the reveal', () => {
    // Before any result lands, the card looks exactly as it did pre-#72: the
    // stored solution, unlabelled. An exhausted budget leaves it that way.
    const state = { ...initialGolfState(), levelIndex: 17, holedIn: true, strokes: 12 };
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    fireEvent.click(container.querySelector('.pk-golf-solution-btn') as HTMLButtonElement);
    expect(container.querySelectorAll('.pk-golf-solution').length).toBe(1);
    expect(container.querySelector('.pk-golf-sol-label')).toBeNull();
    expect(container.querySelector('.pk-mini-circ')).not.toBeNull();
  });

  it('offers the solution once a hole costs par + 3, before it is holed in (#79)', () => {
    for (const p of ['bo', 'pk'] as const) {
      // E2, par 4: at 6 strokes there is still no offer …
      const nearly = { ...initialGolfState(), levelIndex: 1, strokes: 6 };
      const before = render(<Scorecard state={nearly} circuit={bell} classPrefix={p} />);
      expect(before.container.querySelector(`.${p}-golf-solution-btn`)).toBeNull();
      cleanup();

      // … at 7 (par + 3) the offer appears, and says why it is there.
      const stuck = { ...initialGolfState(), levelIndex: 1, strokes: 7 };
      const { container } = render(<Scorecard state={stuck} circuit={bell} classPrefix={p} />);
      const btn = container.querySelector(`.${p}-golf-solution-btn`) as HTMLButtonElement;
      expect(btn.textContent).toBe('Stuck? Show solution');
      // It is an offer, not a score line: no hole-in row alongside it.
      expect(container.querySelector(`.${p}-golf-holed`)).toBeNull();
      expect(container.querySelector(`.${p}-golf-stuck`)).not.toBeNull();

      fireEvent.click(btn);
      expect(container.querySelector(`.${p}-golf-solution .${p}-mini-circ`)).not.toBeNull();
      expect(btn.textContent).toBe('Hide solution');
      cleanup();
    }
  });

  it('offers it a minute after the FIRST stroke, never after idle reading (#79)', () => {
    // `Date` must be faked too: the hole clock stamps `Date.now()` into the
    // module store, and the card re-reads it on a one-second interval (#98) —
    // without both the interval fires but no time has "passed".
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    });
    try {
      // A board nobody has touched: the clock has not started, so a minute of
      // reading the target must not trigger the offer.
      const idle = { ...initialGolfState(), levelIndex: 1, strokes: 0 };
      const untouched = render(<Scorecard state={idle} circuit={bell} classPrefix="pk" />);
      act(() => {
        vi.advanceTimersByTime(120_000);
      });
      untouched.rerender(<Scorecard state={idle} circuit={bell} classPrefix="pk" />);
      expect(untouched.container.querySelector('.pk-golf-solution-btn')).toBeNull();
      cleanup();

      // One stroke starts the clock. Well under a minute: still no offer.
      const playing = { ...initialGolfState(), levelIndex: 1, strokes: 1 };
      const { container, rerender } = render(
        <Scorecard state={playing} circuit={bell} classPrefix="pk" />,
      );
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      rerender(<Scorecard state={playing} circuit={bell} classPrefix="pk" />);
      expect(container.querySelector('.pk-golf-solution-btn')).toBeNull();

      // Past the minute it appears — without needing another gate to be played.
      act(() => {
        vi.advanceTimersByTime(31_000);
      });
      expect(
        (container.querySelector('.pk-golf-solution-btn') as HTMLButtonElement).textContent,
      ).toBe('Stuck? Show solution');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the stuck window across a remount of the card (#98)', () => {
    // The field bug: the sixty-second door never opened, only the par+3 one.
    // The difference between them is where the fact lives — strokes come from
    // engine state, which outlives a remount, while the window used to sit in a
    // component ref that was stamped afresh every time the card mounted with a
    // stroke already on the board. A card that remounts mid-hole (a panel
    // toggling, a layout change) restarted the minute under the player.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    });
    try {
      for (const course of ['classic', 'random'] as const) {
        resetCourseTimers();
        const playing = { ...initialGolfState({}, course, 4242), levelIndex: 1, strokes: 1 };
        const first = render(<Scorecard state={playing} circuit={bell} classPrefix="pk" />);
        act(() => {
          vi.advanceTimersByTime(40_000);
        });
        expect(first.container.querySelector('.pk-golf-stuck')).toBeNull();
        cleanup();

        // Same hole, same stroke, a fresh mount 40 seconds in: the remaining
        // twenty seconds are all that is owed.
        const { container } = render(<Scorecard state={playing} circuit={bell} classPrefix="pk" />);
        act(() => {
          vi.advanceTimersByTime(21_000);
        });
        expect(container.querySelector('.pk-golf-stuck')).not.toBeNull();
        cleanup();
      }
    } finally {
      vi.useRealTimers();
      resetCourseTimers();
    }
  });

  it('offers it a minute in on a GENERATED hole too, bloch and qsphere (#98)', () => {
    // The 60s trigger was dead on random rounds in the field: the offer only
    // ever arrived through the strokes >= par+3 door. Both display paths are
    // exercised — a 1-qubit hole draws a Bloch sphere, wider ones a Q-sphere —
    // because the reveal hangs off the same card either way.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    try {
      const holes = randomCourse(4242);
      const bloch = holes.findIndex((h) => h.view === 'bloch');
      const qsphere = holes.findIndex((h) => h.view === 'qsphere');
      expect(bloch).toBeGreaterThanOrEqual(0);
      expect(qsphere).toBeGreaterThanOrEqual(0);

      for (const levelIndex of [bloch, qsphere]) {
        resetCourseTimers();
        // One stroke, far below par + 3, so only the clock can open the offer.
        const playing = { ...initialGolfState({}, 'random', 4242), levelIndex, strokes: 1 };
        expect(playing.strokes).toBeLessThan(holes[levelIndex].par + 3);
        const { container } = render(<Scorecard state={playing} circuit={bell} classPrefix="pk" />);
        expect(container.querySelector('.pk-golf-solution-btn')).toBeNull();

        act(() => {
          vi.advanceTimersByTime(61_000);
        });
        expect(container.querySelector('.pk-golf-stuck')).not.toBeNull();
        cleanup();
      }
    } finally {
      vi.useRealTimers();
      resetCourseTimers();
    }
  });

  it('restarts the stuck clock on the next hole, on both courses (#98)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
    try {
      for (const course of ['classic', 'random'] as const) {
        resetCourseTimers();
        const base = initialGolfState({}, course, 4242);
        const first = { ...base, levelIndex: 1, strokes: 1 };
        const { container, rerender } = render(
          <Scorecard state={first} circuit={bell} classPrefix="pk" />,
        );
        act(() => {
          vi.advanceTimersByTime(61_000);
        });
        expect(container.querySelector('.pk-golf-stuck')).not.toBeNull();

        // Next hole, first stroke just played: the window starts over, so the
        // player is not greeted by an offer they did not earn.
        const next = { ...base, levelIndex: 2, strokes: 1 };
        rerender(<Scorecard state={next} circuit={bell} classPrefix="pk" />);
        expect(container.querySelector('.pk-golf-stuck')).toBeNull();
        act(() => {
          vi.advanceTimersByTime(61_000);
        });
        expect(container.querySelector('.pk-golf-stuck')).not.toBeNull();
        cleanup();
      }
    } finally {
      vi.useRealTimers();
      resetCourseTimers();
    }
  });

  it('names the price of a mid-hole reveal before it is taken (#99)', () => {
    for (const p of ['bo', 'pk'] as const) {
      // E2, par 4 → the offer says what it will cost, in strokes, up front.
      const stuck = { ...initialGolfState(), levelIndex: 1, strokes: 7 };
      const taken: number[] = [];
      const { container } = render(
        <Scorecard
          state={stuck}
          circuit={bell}
          classPrefix={p}
          onReveal={(h) => taken.push(h)}
        />,
      );
      const btn = container.querySelector(`.${p}-golf-solution-btn`) as HTMLButtonElement;
      expect(btn.textContent).toBe('Show solution (scores double par — 8)');
      expect(container.querySelector(`.${p}-golf-stuck-note`)).toBeNull();

      // Taking it asks the ENGINE (#68/#73: the card never touches a score) …
      fireEvent.click(btn);
      expect(taken).toEqual([2]);
      expect(container.querySelector(`.${p}-golf-solution .${p}-mini-circ`)).not.toBeNull();
      cleanup();
    }
  });

  it('stops charging once the hole is paid for, and says what it now costs (#99)', () => {
    const paid = golfReveal({ ...initialGolfState(), levelIndex: 1, strokes: 7 }, 2);
    const taken: number[] = [];
    const { container } = render(
      <Scorecard state={paid} circuit={bell} classPrefix="pk" onReveal={(h) => taken.push(h)} />,
    );
    const btn = container.querySelector('.pk-golf-solution-btn') as HTMLButtonElement;
    // No price on the button — this hole is already bought …
    expect(btn.textContent).toBe('Stuck? Show solution');
    // … and the receipt says what the hole is now heading for.
    expect(container.querySelector('.pk-golf-stuck-note')?.textContent).toBe(
      'this hole scores at least 8',
    );
    fireEvent.click(btn);
    expect(taken).toEqual([]);
    expect(btn.textContent).toBe('Hide solution');
  });

  it('never prices the reveal on a surface that cannot charge, or after the hole-in (#99)', () => {
    // The kiosk passes no handler: an unattended card must not print a price it
    // will never take.
    const stuck = { ...initialGolfState(), levelIndex: 1, strokes: 7 };
    const kiosk = render(<Scorecard state={stuck} circuit={bell} classPrefix="bo" />);
    expect(kiosk.container.querySelector('.bo-golf-solution-btn')?.textContent).toBe(
      'Stuck? Show solution',
    );
    cleanup();

    // And the post-hole-in reveal stays free everywhere (#71).
    const holed = { ...initialGolfState(), levelIndex: 1, holedIn: true, strokes: 9 };
    const taken: number[] = [];
    const { container } = render(
      <Scorecard state={holed} circuit={bell} classPrefix="pk" onReveal={(h) => taken.push(h)} />,
    );
    const btn = container.querySelector('.pk-golf-solution-btn') as HTMLButtonElement;
    expect(btn.textContent).toBe('Show solution');
    fireEvent.click(btn);
    expect(taken).toEqual([]);
  });

  it('keeps saying "Show solution" once the ball is in, and stays inert (#79)', () => {
    // A holed-in hole that also passed the stuck thresholds keeps the original
    // wording — the offer is for people still playing.
    const state = { ...initialGolfState(), levelIndex: 1, holedIn: true, strokes: 9 };
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    const btn = container.querySelector('.pk-golf-solution-btn') as HTMLButtonElement;
    expect(btn.textContent).toBe('Show solution');
    expect(container.querySelector('.pk-golf-stuck')).toBeNull();

    // …and the mid-hole offer cannot touch the score either (#68).
    const mid = { ...initialGolfState(), levelIndex: 1, strokes: 7 };
    cleanup();
    const stuck = render(<Scorecard state={mid} circuit={bell} classPrefix="pk" />);
    const strokesBefore = stuck.container.querySelector('.pk-stats')?.textContent;
    fireEvent.click(stuck.container.querySelector('.pk-golf-solution-btn') as HTMLButtonElement);
    expect(stuck.container.querySelector('.pk-stats')?.textContent).toBe(strokesBefore);
    expect(mid.strokes).toBe(7);
  });

  it('shows a course clock once the round is under way, not before (#83)', () => {
    resetCourseTimers();
    // Dealt but untouched: no clock — reading the first target is not playing.
    const fresh = render(<Scorecard state={initialGolfState()} circuit={bell} classPrefix="pk" />);
    expect(
      Array.from(fresh.container.querySelectorAll('.pk-stat')).map((n) => n.textContent),
    ).not.toContain('time 0:00');
    cleanup();

    // A stroke on the board starts it, and it reads beside the total.
    const playing = { ...initialGolfState(), strokes: 3 };
    const { container } = render(<Scorecard state={playing} circuit={bell} classPrefix="pk" />);
    const stats = Array.from(container.querySelectorAll('.pk-stat')).map((n) => n.textContent);
    expect(stats.some((t) => t?.startsWith('time '))).toBe(true);
    resetCourseTimers();
  });

  it('freezes the clock on the summary and shows strokes AND time (#83)', () => {
    resetCourseTimers();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      const best: Record<number, number> = {};
      for (const h of HOLES) best[h.hole] = h.par;
      // Play: one stroke starts the clock …
      const playing = { ...initialGolfState(best), strokes: 1 };
      const live = render(<Scorecard state={playing} circuit={bell} classPrefix="pk" />);
      act(() => {
        vi.advanceTimersByTime(90_000);
      });
      cleanup();

      // … and completing freezes it into the summary's result line.
      const done = { ...initialGolfState(best), levelIndex: 17, complete: true };
      const { container } = render(<Scorecard state={done} circuit={bell} classPrefix="pk" />);
      const result = container.querySelector('.pk-golf-time');
      expect(result?.textContent).toBe(`${COURSE_PAR} strokes in 1:30`);
      // Time on the summary screen does not change the recorded result.
      vi.advanceTimersByTime(300_000);
      const again = render(<Scorecard state={done} circuit={bell} classPrefix="pk" />);
      expect(again.container.querySelector('.pk-golf-time')?.textContent).toBe(
        `${COURSE_PAR} strokes in 1:30`,
      );
      expect(live).toBeTruthy();
    } finally {
      vi.useRealTimers();
      resetCourseTimers();
    }
  });

  it('hides the reveal on the completed-course summary (no hole is in play)', () => {
    const state = { ...initialGolfState(), levelIndex: 17, complete: true };
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    expect(container.querySelector('.pk-golf-solution-btn')).toBeNull();
  });

  it('labels the round rows E / M / D / X — the extra row is not another E (#74)', () => {
    for (const p of ['bo', 'pk'] as const) {
      const { container } = render(
        <Scorecard state={initialGolfState()} circuit={bell} classPrefix={p} />,
      );
      expect(
        Array.from(container.querySelectorAll(`.${p}-golf-round`)).map((n) => n.textContent),
      ).toEqual(['E', 'M', 'D', 'X']);
      cleanup();
    }
  });

  it('shows each completed hole’s result on its chip, coloured by score (#74)', () => {
    // E1 par 3 in 1 (eagle), E2 par 4 in 3 (birdie), E3 par 5 in 5 (par),
    // E4 par 6 in 9 (over). E5 is untouched.
    const state = initialGolfState({ 1: 1, 2: 3, 3: 5, 4: 9 });
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    const chips = Array.from(container.querySelectorAll('.pk-golf-chip')).slice(0, 5);
    const read = (i: number) => ({
      best: chips[i].querySelector('.pk-golf-chip-best')?.textContent,
      vsPar: chips[i].querySelector('.pk-golf-chip-vspar')?.textContent ?? null,
      kind: ['eagle', 'birdie', 'par', 'over'].find((k) =>
        chips[i].classList.contains(`pk-golf-chip--${k}`),
      ),
    });
    expect(read(0)).toEqual({ best: '1', vsPar: '−2', kind: 'eagle' });
    expect(read(1)).toEqual({ best: '3', vsPar: '−1', kind: 'birdie' });
    expect(read(2)).toEqual({ best: '5', vsPar: 'E', kind: 'par' });
    expect(read(3)).toEqual({ best: '9', vsPar: '+3', kind: 'over' });
    // An unplayed hole is unchanged: a dot, no vs-par, no score colour.
    expect(read(4)).toEqual({ best: '·', vsPar: null, kind: undefined });
    expect(chips[4].classList.contains('is-done')).toBe(false);
    // The tooltip carries the same result in words.
    expect(chips[0].getAttribute('title')).toBe('E1 · Superposition · par 3 · best 1 (−2)');
    expect(chips[4].getAttribute('title')).toBe('E5 · GHZ-5 · par 7');
  });

  it('shows a random round’s course code and copies a share link (#78)', async () => {
    const writes: string[] = [];
    const original = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (t: string) => (writes.push(t), Promise.resolve()) },
      configurable: true,
    });
    const state = initialGolfState({}, 'random', 4242);
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    const chip = container.querySelector('.pk-golf-code') as HTMLButtonElement;
    expect(chip.textContent).toBe(`Course #${courseCode(4242)}`);

    fireEvent.click(chip);
    expect(writes).toEqual([
      courseShareLink(location.origin + location.pathname, courseCode(4242)),
    ]);
    await waitFor(() => expect(chip.textContent).toBe('link copied'));

    Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
  });

  it('survives a browser with no clipboard, and shows no code on the classic card', () => {
    const original = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const random = render(
      <Scorecard state={initialGolfState({}, 'random', 7)} circuit={bell} classPrefix="pk" />,
    );
    // A tap must not throw where clipboard access is unavailable (http, old iOS).
    expect(() =>
      fireEvent.click(random.container.querySelector('.pk-golf-code') as HTMLButtonElement),
    ).not.toThrow();
    cleanup();
    Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });

    const classic = render(
      <Scorecard state={initialGolfState()} circuit={bell} classPrefix="pk" />,
    );
    expect(classic.container.querySelector('.pk-golf-code')).toBeNull();
  });

  it('renders an injected challenge control beside the course code (#84)', () => {
    const seen: { code: string; link: string }[] = [];
    const state = initialGolfState({}, 'random', 4242);
    const { container } = render(
      <Scorecard
        state={state}
        circuit={bell}
        classPrefix="pk"
        challenge={(args) => {
          seen.push(args);
          return <button className="pk-golf-challenge">Challenge</button>;
        }}
      />,
    );
    // It is handed the course's own code and the exact share link.
    expect(seen).toEqual([
      {
        code: courseCode(4242),
        link: courseShareLink(location.origin + location.pathname, courseCode(4242)),
      },
    ]);
    expect(container.querySelector('.pk-golf-challenge')).not.toBeNull();
    cleanup();

    // The classic course has no code to share, so nothing is offered …
    const classic = render(
      <Scorecard state={initialGolfState()} circuit={bell} classPrefix="pk" challenge={() => <b />} />,
    );
    expect(classic.container.querySelector('.pk-golf-challenge')).toBeNull();
    cleanup();

    // … and a surface that passes no renderer (the kiosk) shows nothing extra.
    const kiosk = render(<Scorecard state={state} circuit={bell} classPrefix="bo" />);
    expect(kiosk.container.querySelector('.bo-golf-code')).not.toBeNull();
    expect(kiosk.container.querySelector('.bo-golf-challenge')).toBeNull();
  });

  it('leaves the classic card free of any course chip', () => {
    const { container } = render(
      <Scorecard state={initialGolfState()} circuit={bell} classPrefix="pk" />,
    );
    expect(container.querySelector('.pk-golf-random')).toBeNull();
  });
});

describe('MiniCircuit (shared)', () => {
  // H q0 ; CX q0→q1 ; CZ q1→q2 (a lettered target) ; RZ(π/2) q2 — one of each
  // shape the drawing knows, at four occupied positions.
  const mixed = circuit([
    g({ type: 'H', qubit: 0, position: 0 }),
    g({ type: 'CNOT', control: 0, target: 1, position: 1 }),
    g({ type: 'CZ', control: 1, target: 2, position: 2 }),
    g({ type: 'RZ', qubit: 2, parameter: Math.PI / 2, position: 3 }),
  ]);

  it('draws a wire + label per qubit and the right shape per gate', () => {
    for (const p of ['bo', 'pk'] as const) {
      const { container } = render(<MiniCircuit circuit={mixed} n={3} classPrefix={p} />);
      const svg = container.querySelector(`.${p}-mini-circ`)!;
      expect(svg.querySelectorAll(`.${p}-mini-circ-wire`).length).toBe(3);
      expect(
        Array.from(svg.querySelectorAll(`.${p}-mini-circ-label`)).map((n) => n.textContent),
      ).toEqual(['q0', 'q1', 'q2']);
      // Boxes: H, the CZ's lettered target, and the rotation. CX draws a ⊕.
      expect(
        Array.from(svg.querySelectorAll(`.${p}-mini-circ-gate`)).map((n) => n.textContent),
      ).toEqual(['H', 'Z', 'RZ']);
      expect(svg.querySelectorAll(`.${p}-mini-circ-box`).length).toBe(3);
      expect(svg.querySelectorAll(`.${p}-mini-circ-dot`).length).toBe(2); // CX + CZ controls
      expect(svg.querySelectorAll(`.${p}-mini-circ-link`).length).toBe(2);
      expect(svg.querySelectorAll(`.${p}-mini-circ-target`).length).toBe(1); // only the CX
      expect(svg.querySelectorAll(`.${p}-mini-circ-cross`).length).toBe(1);
      // A rotation carries its angle, typeset like the inspect popovers.
      expect(svg.querySelector(`.${p}-mini-circ-angle`)?.textContent).toBe('0.50π');
      cleanup();
    }
  });

  it('colours by gate family, matching the editor and the printed tiles', () => {
    const { container } = render(<MiniCircuit circuit={mixed} n={3} classPrefix="pk" />);
    const fills = Array.from(container.querySelectorAll('.pk-mini-circ-box')).map((n) =>
      n.getAttribute('fill'),
    );
    expect(fills).toEqual(['#fa4d56', '#33b1ff', '#33b1ff']); // H red, Z/RZ cyan
    expect(container.querySelector('.pk-mini-circ-dot')?.getAttribute('fill')).toBe('#002d9c');
  });

  it('draws a CCX as two control dots on one link into a ⊕', () => {
    const ccx = circuit([g({ type: 'CCX', control: 0, control2: 1, target: 2, position: 0 })]);
    const { container } = render(<MiniCircuit circuit={ccx} n={3} classPrefix="pk" />);
    expect(container.querySelectorAll('.pk-mini-circ-dot').length).toBe(2);
    expect(container.querySelectorAll('.pk-mini-circ-link').length).toBe(1);
    expect(container.querySelectorAll('.pk-mini-circ-target').length).toBe(1);
    expect(container.querySelectorAll('.pk-mini-circ-cross').length).toBe(1);
    expect(container.querySelectorAll('.pk-mini-circ-box').length).toBe(0);
  });

  it('compacts sparse columns and never clips a gate off the drawing', () => {
    // Positions 0/4/9 draw as three ADJACENT columns …
    const sparse = circuit([
      g({ type: 'X', qubit: 0, position: 0 }),
      g({ type: 'X', qubit: 0, position: 4 }),
      g({ type: 'X', qubit: 0, position: 9 }),
    ]);
    const { container } = render(<MiniCircuit circuit={sparse} n={1} classPrefix="pk" />);
    const xs = Array.from(container.querySelectorAll('.pk-mini-circ-box')).map((n) =>
      Number(n.getAttribute('x')),
    );
    expect(xs[1] - xs[0]).toBe(30);
    expect(xs[2] - xs[1]).toBe(30);
    cleanup();

    // … and a gate above the asked-for wire count grows the drawing, not clips it.
    const high = circuit([g({ type: 'H', qubit: 4, position: 0 })]);
    const grown = render(<MiniCircuit circuit={high} n={2} classPrefix="pk" />);
    expect(grown.container.querySelectorAll('.pk-mini-circ-wire').length).toBe(5);
  });
});

describe('course-end celebration wiring (#80)', () => {
  /** The driver logic both apps run on a golf step, in miniature: fire once per
   *  completion, scaled and worded by the round, and re-arm after a restart. */
  function driveToCompletion(best: Record<number, number>) {
    const fired: { banner?: string; intensity?: number }[] = [];
    let completed = false;
    let state = { ...initialGolfState(best), levelIndex: 17, holedIn: true };
    const empty: Circuit = { qubits: 5, gates: [] };
    const push = (s: typeof state) => {
      const step = golfStep(s, empty);
      if (step.justCompleted && !completed) {
        completed = true;
        const done = completionCelebration(courseTotals(step.state.best).vsPar);
        fired.push({ banner: done.copy, intensity: done.intensity });
      }
      if (!step.state.complete) completed = false;
      return step.state;
    };
    state = push(state); // the clear that finishes the course
    state = push(state); // a replayed identical frame must not re-fire
    return { fired, state, push };
  }

  it('fires once per completion, worded by the score', () => {
    // Every hole at par − 2 (the minimum): the legendary tier.
    const perfect: Record<number, number> = {};
    for (const h of HOLES) perfect[h.hole] = h.par - 2;
    const { fired, state, push } = driveToCompletion(perfect);
    expect(fired.length).toBe(1);
    expect(fired[0].banner).toBe('Legendary round — 36 under par!');
    expect(fired[0].intensity).toBeGreaterThan(1);

    // Restarting re-arms it: a second round can be celebrated again.
    const restarted = push(state);
    expect(restarted.complete).toBe(false);
  });

  it('still celebrates a round played over par, modestly', () => {
    const scrappy: Record<number, number> = {};
    for (const h of HOLES) scrappy[h.hole] = h.par + 1;
    const { fired } = driveToCompletion(scrappy);
    expect(fired.length).toBe(1);
    expect(fired[0].banner).toBe('Course complete — +18.');
    expect(fired[0].intensity).toBeLessThan(1);
  });

  it('scales the particle budget by intensity, under the low-power ceiling', () => {
    const budgets: number[] = [];
    const render1 = (intensity: number, maxParticles: number) => {
      cleanup();
      const { rerender } = render(
        <Celebrations
          celebration={null}
          classPrefix="pk"
          particleBudget={() => 100}
          maxParticles={maxParticles}
        />,
      );
      rerender(
        <Celebrations
          celebration={{ kind: 'ghz', k: 5, banner: 'x', intensity, token: 1 }}
          classPrefix="pk"
          particleBudget={(k) => {
            budgets.push(k === 'ghz' ? 100 : 50);
            return 100;
          }}
          maxParticles={maxParticles}
        />,
      );
    };
    // The budget function is consulted for every burst; the ceiling still caps.
    render1(2, 1000);
    expect(budgets.length).toBe(1);
    render1(0.6, 10);
    expect(budgets.length).toBe(2);
  });
});

describe('Celebrations (shared)', () => {
  it('renders the ent-/pk- overlay + canvas classes', () => {
    for (const p of ['ent', 'pk'] as const) {
      const { container } = render(
        <Celebrations
          celebration={null}
          classPrefix={p}
          particleBudget={() => 100}
          maxParticles={100}
        />,
      );
      expect(container.querySelector(`.${p}-celebrate`)).not.toBeNull();
      expect(container.querySelector(`.${p}-celebrate__canvas`)).not.toBeNull();
      cleanup();
    }
  });

  it('renders the banner with prefix-scoped kind + phase classes on a fire', () => {
    // Stub rAF/canvas so the confetti loop is inert under jsdom.
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    try {
      const { container } = render(
        <Celebrations
          celebration={{ kind: 'bell', k: 2, token: 1 }}
          classPrefix="pk"
          particleBudget={() => 100}
          maxParticles={100}
        />,
      );
      const banner = container.querySelector('.pk-banner');
      expect(banner).not.toBeNull();
      expect(banner?.className).toContain('pk-banner--bell');
      expect(banner?.className).toContain('pk-banner--in');
      expect(banner?.textContent).toBe('ENTANGLEMENT!');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
