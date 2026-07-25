// @vitest-environment jsdom
/**
 * KetDisplay (task #59) — the live bra-ket line under the golf evolution view.
 *
 * The assertions are on rendered TEXT, because that text is the product: it must
 * read like the state a physicist would write down, and it must agree with the
 * Q-sphere's reference-phase convention (so a global phase can never appear).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DIM, type Complex, type StateVector } from '@quantum/statevector';
import { KetDisplay } from './KetDisplay';

afterEach(cleanup);

const R = Math.SQRT1_2;

/** A 32-amplitude state with the given (index → amplitude) entries. */
function state(entries: Record<number, Complex>): StateVector {
  const s: StateVector = Array.from({ length: DIM }, () => ({ re: 0, im: 0 }));
  for (const [i, a] of Object.entries(entries)) s[Number(i)] = a;
  return s;
}

const c = (re: number, im = 0): Complex => ({ re, im });
/** r·e^{iθ}. */
const polar = (r: number, theta: number): Complex => ({
  re: r * Math.cos(theta),
  im: r * Math.sin(theta),
});

function text(sv: StateVector, n: number, props: Partial<{ maxTerms: number; minProb: number }> = {}) {
  const { container } = render(<KetDisplay statevector={sv} n={n} classPrefix="pk" {...props} />);
  return container.querySelector('.pk-ket')?.textContent ?? null;
}

describe('KetDisplay', () => {
  it('typesets a Bell state as 0.71|00⟩ + 0.71|11⟩', () => {
    // H q0 · CNOT 0→1 populates indices 0 and 3 (little-endian amplitudes).
    expect(text(state({ 0: c(R), 3: c(R) }), 2)).toBe('0.71|00⟩ + 0.71|11⟩');
  });

  it('renders a lone basis state as a bare ket (X → |1⟩)', () => {
    expect(text(state({ 1: c(1) }), 1)).toBe('|1⟩');
    expect(text(state({ 2: c(1) }), 3)).toBe('|010⟩');
  });

  it('renders a π phase as a minus sign (H · Z)', () => {
    expect(text(state({ 0: c(R), 1: c(-R) }), 1)).toBe('0.71|0⟩ − 0.71|1⟩');
  });

  it('renders ±π/2 phases as ±i (H · S and H · S†)', () => {
    expect(text(state({ 0: c(R), 1: c(0, R) }), 1)).toBe('0.71|0⟩ + 0.71i|1⟩');
    expect(text(state({ 0: c(R), 1: c(0, -R) }), 1)).toBe('0.71|0⟩ − 0.71i|1⟩');
  });

  it('renders a general phase as a π-fraction exponent in a <sup> (H · T)', () => {
    const { container } = render(
      <KetDisplay statevector={state({ 0: c(R), 1: polar(R, Math.PI / 4) })} n={1} classPrefix="pk" />,
    );
    const sup = container.querySelector('.pk-ket sup');
    expect(sup?.textContent).toBe('i0.25π');
    expect(container.querySelector('.pk-ket')?.textContent).toBe('0.71|0⟩ + 0.71ei0.25π|1⟩');
  });

  it('renders a negative general phase with a leading minus in the exponent', () => {
    const { container } = render(
      <KetDisplay statevector={state({ 0: c(R), 1: polar(R, -Math.PI / 4) })} n={1} classPrefix="pk" />,
    );
    expect(container.querySelector('.pk-ket sup')?.textContent).toBe('−i0.25π');
  });

  it('sorts by descending probability, ties by ascending index', () => {
    const sv = state({ 0: c(0.5), 1: c(Math.sqrt(0.5)), 2: c(0.5) });
    // p = 0.5 (index 1) first, then the two 0.25 ties in index order.
    expect(text(sv, 2)).toBe('0.71|01⟩ + 0.50|00⟩ + 0.50|10⟩');
  });

  it('keeps a stable index order for probabilities that tie within float noise', () => {
    // Equal in theory, one ULP apart in practice (as a purified Bloch state or
    // an interpolated frame can be) — the order must not depend on the noise.
    const sv = state({ 0: c(R), 1: c(R + Number.EPSILON) });
    expect(text(sv, 1)).toBe('0.71|0⟩ + 0.71|1⟩');
  });

  it('caps at maxTerms and appends an ellipsis', () => {
    // Uniform over 8 basis states: each amplitude 1/√8, p = 0.125.
    const amp = 1 / Math.sqrt(8);
    const sv = state(Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i, c(amp)])));
    const t = text(sv, 3, { maxTerms: 3 });
    expect(t).toBe('0.35|000⟩ + 0.35|001⟩ + 0.35|010⟩ + ⋯');

    // At the default cap of 6 the same state shows 6 terms + the ellipsis.
    cleanup();
    const { container } = render(<KetDisplay statevector={sv} n={3} classPrefix="pk" />);
    expect(container.querySelectorAll('.pk-ket-term')).toHaveLength(6);
    expect(container.querySelector('.pk-ket-more')).not.toBeNull();
  });

  it('drops no term and shows no ellipsis when everything fits', () => {
    const { container } = render(
      <KetDisplay statevector={state({ 0: c(R), 3: c(R) })} n={2} classPrefix="pk" />,
    );
    expect(container.querySelectorAll('.pk-ket-term')).toHaveLength(2);
    expect(container.querySelector('.pk-ket-more')).toBeNull();
  });

  it('drops basis states below minProb', () => {
    // p = 0.0001 for index 1 — well under the 0.005 default.
    const sv = state({ 0: c(Math.sqrt(0.9999)), 1: c(0.01) });
    expect(text(sv, 1)).toBe('|0⟩');
  });

  it('renders nothing for an empty or all-zero statevector', () => {
    for (const sv of [state({}), [] as StateVector]) {
      const { container } = render(<KetDisplay statevector={sv} n={2} classPrefix="pk" />);
      expect(container.querySelector('.pk-ket')).toBeNull();
      expect(container.textContent).toBe('');
      cleanup();
    }
  });

  it('uses the Q-sphere reference convention — a global phase never shows', () => {
    const plain = state({ 0: c(R), 3: c(R) });
    for (const g of [0.3, Math.PI / 2, Math.PI, -2.1]) {
      const rotated = plain.map((a) => polar(Math.hypot(a.re, a.im), Math.atan2(a.im, a.re) + g));
      expect(text(rotated, 2)).toBe('0.71|00⟩ + 0.71|11⟩');
      cleanup();
    }
  });

  it('carries the structural classes for both skins', () => {
    for (const p of ['pk', 'bo'] as const) {
      const { container } = render(
        <KetDisplay statevector={state({ 0: c(R), 3: c(R) })} n={2} classPrefix={p} />,
      );
      const root = container.querySelector(`.${p}-ket`) as HTMLElement;
      expect(root).not.toBeNull();
      expect(root.getAttribute('aria-label')).toBe('Current state in bra-ket notation');
      expect(container.querySelectorAll(`.${p}-ket-term`)).toHaveLength(2);
      expect(container.querySelectorAll(`.${p}-ket-coef`)).toHaveLength(2);
      cleanup();
    }
  });
});
