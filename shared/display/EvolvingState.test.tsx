// @vitest-environment jsdom
/**
 * EvolvingState (task #53) — the golf state-evolution scrubber. jsdom lacks
 * `matchMedia`, so these tests stub it as `reduce: true`: under reduced-motion
 * the animation JUMPS (no rAF tweening), which makes every assertion
 * deterministic and also exercises the required reduced-motion behaviour —
 * land on the final state, scrubber still steps instantly.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
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
});
