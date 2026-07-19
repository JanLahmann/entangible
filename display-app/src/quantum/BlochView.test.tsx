import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { BlochView } from './BlochView';
import { type Complex, type StateVector, DIM } from './statevector';

afterEach(cleanup);

const R = Math.SQRT1_2;
function state(entries: Record<number, Complex>): StateVector {
  const sv: StateVector = new Array(DIM);
  for (let i = 0; i < DIM; i++) sv[i] = { re: 0, im: 0 };
  for (const [k, v] of Object.entries(entries)) sv[Number(k)] = v;
  return sv;
}
const plus: StateVector = state({ 0: { re: R, im: 0 }, 1: { re: R, im: 0 } });

describe('BlochView labels', () => {
  it('renders all six eigenstate kets', () => {
    const { container } = render(<BlochView statevector={plus} classPrefix="bo" />);
    const kets = Array.from(container.querySelectorAll('.bo-bl-ket')).map((t) => t.textContent);
    expect(kets.sort()).toEqual(['|+⟩', '|0⟩', '|1⟩', '|i+⟩', '|i−⟩', '|−⟩'].sort());
  });

  it('renders exactly three axis letters (x, y, z) at the positive ends', () => {
    const { container } = render(<BlochView statevector={plus} classPrefix="pk" />);
    const letters = Array.from(container.querySelectorAll('.pk-bl-axis-label')).map(
      (t) => t.textContent,
    );
    expect(letters.sort()).toEqual(['x', 'y', 'z']);
  });

  it('draws the three x/y/z axes as six hairline half-segments from the centre', () => {
    const { container } = render(<BlochView statevector={plus} classPrefix="bo" size={220} />);
    const axisLines = Array.from(container.querySelectorAll('.bo-bl-axis')) as SVGLineElement[];
    expect(axisLines).toHaveLength(6);
    // Every half-segment starts at the sphere centre (110,110 for size 220).
    for (const l of axisLines) {
      expect(Number(l.getAttribute('x1'))).toBeCloseTo(110);
      expect(Number(l.getAttribute('y1'))).toBeCloseTo(110);
    }
  });

  it('depth-dims the far hemisphere: three ends full opacity, three dimmed', () => {
    const { container } = render(<BlochView statevector={plus} classPrefix="bo" />);
    const kets = Array.from(container.querySelectorAll('.bo-bl-ket')) as SVGTextElement[];
    const opac = kets.map((t) => Number(t.getAttribute('opacity')));
    expect(opac.filter((o) => o === 1)).toHaveLength(3); // near ends
    expect(opac.filter((o) => o > 0 && o < 1)).toHaveLength(3); // far, dimmed
  });

  it('|+⟩ label sits at the +x tip, just outside the sphere silhouette', () => {
    const size = 220;
    const { container } = render(<BlochView statevector={plus} classPrefix="bo" size={size} />);
    const plusKet = Array.from(container.querySelectorAll('.bo-bl-ket')).find(
      (t) => t.textContent === '|+⟩',
    ) as SVGTextElement;
    const cx = size / 2;
    const cy = size / 2;
    const R2 = size / 2 - 26; // MARGIN
    const dist = Math.hypot(
      Number(plusKet.getAttribute('x')) - cx,
      Number(plusKet.getAttribute('y')) - cy,
    );
    expect(dist).toBeGreaterThan(R2); // outside the silhouette
    expect(dist).toBeLessThan(R2 + 24); // but only just outside
  });

  it('still offers the reset-orientation button', () => {
    render(<BlochView statevector={plus} classPrefix="bo" />);
    const btn = screen.getByRole('button', { name: 'Reset orientation' });
    fireEvent.click(btn); // no-op smoke
    expect(btn).toBeTruthy();
  });
});
