// @vitest-environment jsdom
/**
 * EvolvingState (task #53) — the golf state-evolution scrubber. jsdom lacks
 * `matchMedia`, so these tests stub it as `reduce: true`: under reduced-motion
 * the animation JUMPS (no rAF tweening), which makes every assertion
 * deterministic and also exercises the required reduced-motion behaviour —
 * land on the final state, scrubber still steps instantly.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import type { Circuit, Gate } from '@qamposer/react';
import { EvolvingState } from './EvolvingState';

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => mockReducedMotion(true));
afterEach(cleanup);

let seq = 0;
const g = (partial: Omit<Gate, 'id'>): Gate => ({ id: `g${seq++}`, ...partial });
const circuit = (gates: Gate[]): Circuit => ({ qubits: 5, gates });

// H on q0 (col 0), CNOT 0→1 (col 1): 2 columns → 3 evolution steps.
const bell = circuit([
  g({ type: 'H', qubit: 0, position: 0 }),
  g({ type: 'CNOT', control: 0, target: 1, position: 1 }),
]);

const dots = (root: HTMLElement, p: string) =>
  Array.from(root.querySelectorAll(`.${p}-evo-dot`)) as HTMLButtonElement[];

describe('EvolvingState scrubber', () => {
  it('renders one step dot per column plus the initial state', () => {
    const { container } = render(
      <EvolvingState circuit={bell} view="qsphere" classPrefix="pk" />,
    );
    // initial |0…0⟩ + after col 0 + after col 1 = 3 dots.
    expect(dots(container, 'pk')).toHaveLength(3);
  });

  it('lands on the FINAL step (current state) after auto-play', () => {
    const { container, getByText } = render(
      <EvolvingState circuit={bell} view="qsphere" classPrefix="pk" />,
    );
    const all = dots(container, 'pk');
    // Under reduced-motion auto-play jumps straight to the last column.
    expect(all[2].className).toContain('pk-evo-dot--active');
    expect(all[0].className).not.toContain('pk-evo-dot--active');
    expect(getByText('after column 2')).toBeTruthy();
    // The Q-sphere shows the Bell state: two full-probability nodes.
    const qsDots = Array.from(container.querySelectorAll('.pk-qs-dot')) as SVGCircleElement[];
    const big = qsDots.map((d) => Number(d.getAttribute('r'))).filter((r) => r > 5);
    expect(big).toHaveLength(2);
  });

  it('scrubs back to any earlier column (instant under reduced-motion)', () => {
    const { container, getByText, getByLabelText } = render(
      <EvolvingState circuit={bell} view="qsphere" classPrefix="pk" />,
    );
    // Click the first dot → jump to the initial state.
    fireEvent.click(dots(container, 'pk')[0]);
    expect(getByText('start')).toBeTruthy();
    expect(dots(container, 'pk')[0].className).toContain('pk-evo-dot--active');
    // The ground state: exactly one full-probability node (|0…0⟩).
    const qsDots = Array.from(container.querySelectorAll('.pk-qs-dot')) as SVGCircleElement[];
    expect(qsDots.map((d) => Number(d.getAttribute('r'))).filter((r) => r > 5)).toHaveLength(1);
    // Next advances one column.
    fireEvent.click(getByLabelText('Next step'));
    expect(getByText('after column 1')).toBeTruthy();
  });

  it('disables prev at the start and next at the end', () => {
    const { container, getByLabelText } = render(
      <EvolvingState circuit={bell} view="qsphere" classPrefix="pk" />,
    );
    // Auto-play landed on the last step → Next disabled, Prev enabled.
    expect((getByLabelText('Next step') as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText('Previous step') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(dots(container, 'pk')[0]);
    expect((getByLabelText('Previous step') as HTMLButtonElement).disabled).toBe(true);
    expect((getByLabelText('Next step') as HTMLButtonElement).disabled).toBe(false);
  });

  it('replays the whole evolution from the start (#56)', () => {
    const { container, getByText, getByLabelText } = render(
      <EvolvingState circuit={bell} view="qsphere" classPrefix="pk" />,
    );
    // Park the scrubber at the start, then replay.
    fireEvent.click(dots(container, 'pk')[0]);
    expect(getByText('start')).toBeTruthy();
    fireEvent.click(getByLabelText('Replay animation'));
    // Under reduced-motion the replay jumps: it lands on the final step again.
    const all = dots(container, 'pk');
    expect(all[2].getAttribute('aria-current')).toBe('step');
    expect(all[0].getAttribute('aria-current')).toBeNull();
    expect(getByText('after column 2')).toBeTruthy();
  });

  it('hides the replay button with the rest of the scrubber on an empty board', () => {
    const { queryByLabelText } = render(
      <EvolvingState circuit={circuit([])} view="qsphere" classPrefix="pk" />,
    );
    expect(queryByLabelText('Replay animation')).toBeNull();
  });

  it('renders the Bloch view for level 1 and steps through it', () => {
    const superpos = circuit([g({ type: 'H', qubit: 0, position: 0 })]);
    const { container } = render(
      <EvolvingState circuit={superpos} view="bloch" classPrefix="bo" />,
    );
    expect(container.querySelector('.bo-bl-svg')).not.toBeNull();
    // 1 column → initial + after col 0 = 2 dots.
    expect(dots(container, 'bo')).toHaveLength(2);
  });

  it('hides the scrubber for an empty board (nothing to step through)', () => {
    const { container } = render(
      <EvolvingState circuit={circuit([])} view="qsphere" classPrefix="pk" />,
    );
    expect(container.querySelector('.pk-evo-scrubber')).toBeNull();
    // The view still renders (the ground state).
    expect(container.querySelector('.pk-qs-svg')).not.toBeNull();
  });

  it('honours both class-prefix skins', () => {
    const { container } = render(
      <EvolvingState circuit={bell} view="qsphere" classPrefix="bo" />,
    );
    expect(container.querySelector('.bo-evo')).not.toBeNull();
    expect(container.querySelector('.bo-evo-scrubber')).not.toBeNull();
  });

  it('draws NO travelers under reduced motion (#57)', () => {
    const { container } = render(
      <EvolvingState circuit={bell} view="qsphere" classPrefix="pk" />,
    );
    expect(container.querySelectorAll('.pk-qs-traveler')).toHaveLength(0);
    // …and none at any scrubbed step either: reduced motion never tweens.
    fireEvent.click(dots(container, 'pk')[1]);
    expect(container.querySelectorAll('.pk-qs-traveler')).toHaveLength(0);
  });
});

/**
 * Roll-the-ball (#57) needs a RUNNING animation, so this block turns
 * reduced-motion off and drives the rAF clock by hand: each `frame(now)` call
 * advances the tween to a chosen position, making mid-segment assertions exact.
 * Auto-play spans the whole circuit, so `dur = PER_STEP_MS · lastIndex`.
 */
describe('EvolvingState travelers (#57)', () => {
  let frame: FrameRequestCallback | null = null;
  let now = 0;

  beforeEach(() => {
    mockReducedMotion(false);
    frame = null;
    now = 0;
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => {
      frame = f;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const advance = (ms: number) =>
    act(() => {
      now = ms;
      frame?.(now);
    });

  const balls = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('.pk-qs-traveler')) as SVGCircleElement[];

  it('carries mass only mid-segment — nothing at the segment ends', () => {
    const { container } = render(
      <EvolvingState circuit={bell} view="qsphere" classPrefix="pk" />,
    );
    // t = 0 (auto-play parked at the start): no ball has left yet.
    expect(balls(container)).toHaveLength(0);

    // Half way through column 0 (H on q0): the |00000⟩ ball is on its way to
    // |00001⟩. Weight 0.5 ⇒ the node radius mapping at p = 0.5.
    advance(250); // pos 0.5 of 2 columns (dur = 1000 ms)
    const mid = balls(container);
    expect(mid).toHaveLength(1);
    expect(Number(mid[0].getAttribute('r'))).toBeCloseTo(2.5 + 10.5 * 0.5, 6);
    // sin(π/2) · FAR_OPACITY: under the neutral camera (#75) this arc's
    // midpoint sits on the far hemisphere, so the depth dim applies.
    expect(Number(mid[0].getAttribute('fill-opacity'))).toBeCloseTo(0.32, 6);

    // Landing exactly on column 1: the ball has arrived, the node owns the mass.
    advance(500); // pos 1.0
    expect(balls(container)).toHaveLength(0);

    // Half way through column 1 (CNOT 0→1): |00001⟩ travels to |00011⟩.
    advance(750); // pos 1.5
    expect(balls(container)).toHaveLength(1);

    // The final state: no balls in flight.
    advance(1000);
    expect(balls(container)).toHaveLength(0);
  });

  it('splits one ball into several when a column spreads the mass', () => {
    // H on q0 AND H on q1 in the SAME column: |00000⟩ spreads over four basis
    // states — three of them are somewhere else, so three balls travel.
    const spread = circuit([
      g({ type: 'H', qubit: 0, position: 0 }),
      g({ type: 'H', qubit: 1, position: 0 }),
    ]);
    const { container } = render(
      <EvolvingState circuit={spread} view="qsphere" classPrefix="pk" />,
    );
    advance(250); // one column ⇒ dur = 500 ms, so pos 0.5
    const flying = balls(container);
    expect(flying).toHaveLength(3);
    // Each carries a quarter of the probability.
    for (const b of flying) expect(Number(b.getAttribute('r'))).toBeCloseTo(2.5 + 10.5 * 0.25, 6);
  });

  it('fades in and out across a segment (never double-drawn on a node)', () => {
    const { container } = render(
      <EvolvingState circuit={bell} view="qsphere" classPrefix="pk" />,
    );
    advance(60); // early in column 0
    const early = Number(balls(container)[0].getAttribute('fill-opacity'));
    advance(250); // half way
    const middle = Number(balls(container)[0].getAttribute('fill-opacity'));
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(middle);
    // Far-hemisphere midpoint under the neutral camera (#75): peak = FAR_OPACITY.
    expect(middle).toBeCloseTo(0.32, 6);
  });

  it('leaves the Bloch view alone (level 1 is unchanged)', () => {
    const superpos = circuit([g({ type: 'H', qubit: 0, position: 0 })]);
    const { container } = render(
      <EvolvingState circuit={superpos} view="bloch" classPrefix="pk" />,
    );
    advance(250);
    expect(container.querySelectorAll('.pk-qs-traveler')).toHaveLength(0);
    expect(container.querySelector('.pk-bl-svg')).not.toBeNull();
  });
});

/**
 * The bra-ket line (#59) must be fed the ANIMATED statevector, so it moves with
 * the balls rather than snapping to the final state. Reduced-motion cases below
 * check opt-in + scrubber tracking; the last case drives the rAF clock to assert
 * a genuinely MID-TWEEN reading.
 */
describe('EvolvingState bra-ket line (#59)', () => {
  const ket = (root: HTMLElement) => root.querySelector('.pk-ket')?.textContent ?? null;

  it('is opt-in — nothing is rendered without showKet', () => {
    const { container } = render(
      <EvolvingState circuit={bell} view="qsphere" classPrefix="pk" />,
    );
    expect(container.querySelector('.pk-ket')).toBeNull();
  });

  it('shows the current state and tracks the scrubber', () => {
    const { container } = render(
      <EvolvingState circuit={bell} view="qsphere" classPrefix="pk" showKet />,
    );
    // Auto-play lands on the final state: the Bell pair over 5 displayed qubits.
    expect(ket(container)).toBe('1/√2|00000⟩ + 1/√2|00011⟩');

    fireEvent.click(dots(container, 'pk')[0]);
    expect(ket(container)).toBe('|00000⟩');

    fireEvent.click(dots(container, 'pk')[1]);
    expect(ket(container)).toBe('1/√2|00000⟩ + 1/√2|00001⟩');
  });

  it('renders under the Bloch view too (purified statevector)', () => {
    const superpos = circuit([g({ type: 'H', qubit: 0, position: 0 })]);
    const { container } = render(
      <EvolvingState circuit={superpos} view="bloch" classPrefix="pk" showKet />,
    );
    expect(container.querySelector('.pk-bl-svg')).not.toBeNull();
    expect(ket(container)).toBe('1/√2|00000⟩ + 1/√2|00001⟩');
  });

  it('highlights target terms the live state does not match (the missed − sign)', () => {
    // Live: Bell (+|00..0⟩ +|11..1⟩ terms, both positive). Target: same
    // magnitudes but a − on the second term → exactly that term must carry the
    // --diff class; the matching first term must not.
    const target: StateVector = Array.from({ length: 32 }, (_, i) =>
      i === 0 ? { re: Math.SQRT1_2, im: 0 } : i === 3 ? { re: -Math.SQRT1_2, im: 0 } : { re: 0, im: 0 },
    );
    const { container } = render(
      <EvolvingState
        circuit={bell}
        view="qsphere"
        classPrefix="pk"
        showKet
        targetState={target}
      />,
    );
    const targetLine = Array.from(container.querySelectorAll('.pk-ket')).find((el) =>
      el.textContent?.startsWith('Target'),
    ) as HTMLElement;
    expect(targetLine).toBeTruthy();
    const diff = Array.from(targetLine.querySelectorAll('.pk-ket-term--diff'));
    expect(diff.map((el) => el.textContent)).toEqual(['− 1/√2|00011⟩']);
    // A target equal to the live final state highlights nothing once settled.
  });

  it('sits between the view and the scrubber', () => {
    const { container } = render(
      <EvolvingState circuit={bell} view="qsphere" classPrefix="pk" showKet />,
    );
    const kids = Array.from((container.querySelector('.pk-evo') as HTMLElement).children);
    expect(kids.map((el) => el.className)).toEqual(['pk-view-label', 'pk-qsphere', 'pk-ket', 'pk-evo-scrubber']);
  });

  it('follows the animation mid-tween (the math moves with the balls)', () => {
    mockReducedMotion(false);
    let frame: FrameRequestCallback | null = null;
    let now = 0;
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => {
      frame = f;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const { container } = render(
        <EvolvingState circuit={bell} view="qsphere" classPrefix="pk" showKet />,
      );
      // Parked at the start of the auto-play (dur = 2 × 500 ms).
      expect(ket(container)).toBe('|00000⟩');
      // Half way through column 0: eased(0.5) = 0.5, so the probabilities are
      // 0.75 / 0.25 — magnitudes √3/2 and 1/2, a reading no snapshot produces.
      act(() => {
        now = 250;
        frame?.(now);
      });
      expect(ket(container)).toBe('√3/2|00000⟩ + 1/2|00001⟩');
      act(() => {
        now = 1000;
        frame?.(now);
      });
      expect(ket(container)).toBe('1/√2|00000⟩ + 1/√2|00011⟩');
    } finally {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    }
  });
});
