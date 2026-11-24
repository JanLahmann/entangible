// @vitest-environment jsdom
/**
 * One bit order across every display (Qiskit's: leftmost char = highest wire,
 * rightmost = q0). For each Classic hole, the histogram columns, the bra-ket
 * line and the Q-sphere labels must spell the target's outcomes as the very
 * same strings, each with the same probability — a reversed convention
 * anywhere shows up as a mismatch on the holes that are not mirror-symmetric.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Histogram } from './Histogram';
import { ketTerms } from './KetDisplay';
import { ZERO_EPS } from './outcomes';
import { QSphereView } from '@quantum/QSphereView';
import { basisVisuals } from '@quantum/qsphere';
import { HOLES, holeSolution, holeTargetState, type Hole } from '@quantum/golf';

afterEach(cleanup);

/**
 * The holes whose target is NOT the same state (up to a global phase) after
 * reversing the wire order, i.e. where a reversed label would be visible.
 */
const ASYMMETRIC = ['E4', 'M3', 'M4', 'M5', 'D3', 'X3', 'X5'];

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** |⟨ψ|Rψ⟩| for the hole's target ψ and R = reversing its k wires. */
function mirrorOverlap(h: Hole): number {
  const sv = holeTargetState(h);
  const k = h.qubits;
  const rev = (i: number) =>
    parseInt(i.toString(2).padStart(k, '0').split('').reverse().join(''), 2);
  let re = 0;
  let im = 0;
  for (let i = 0; i < 1 << k; i++) {
    const a = sv[i];
    const b = sv[rev(i)];
    re += a.re * b.re + a.im * b.im;
    im += a.re * b.im - a.im * b.re;
  }
  return Math.hypot(re, im);
}

/** Bra-ket line labels (without the |…⟩ brackets) → target probability. */
function ketLine(h: Hole): Record<string, number> {
  const target = holeTargetState(h);
  const { terms, truncated } = ketTerms(target, h.qubits, 64, 1e-9);
  expect(truncated).toBe(false);
  const prob = new Map(basisVisuals(target, 1 << h.qubits).map((v) => [v.index, v.prob]));
  return Object.fromEntries(terms.map((t) => [t.ket.slice(1, -1), round6(prob.get(t.index)!)]));
}

/** Histogram columns with real weight for the hole's shortest solution: label → probability. */
function histogram(h: Hole): Record<string, number> {
  const { container } = render(
    <Histogram circuit={holeSolution(h.hole)} displayQubits={h.qubits} classPrefix="pk" />,
  );
  const cols = [...container.querySelectorAll('.pk-h-col[data-bits]')].filter(
    (c) => Number(c.getAttribute('data-prob')) > ZERO_EPS,
  );
  // The upright stack reads top to bottom exactly like its own data-bits.
  for (const c of cols) {
    expect(c.querySelector('.pk-h-stack')?.textContent).toBe(c.getAttribute('data-bits'));
  }
  const out = Object.fromEntries(
    cols.map((c) => [c.getAttribute('data-bits')!, round6(Number(c.getAttribute('data-prob')))]),
  );
  cleanup();
  return out;
}

/** Q-sphere node labels for the hole's target, without the brackets. */
function sphereLabels(h: Hole): string[] {
  const { container } = render(
    <QSphereView statevector={holeTargetState(h)} n={h.qubits} classPrefix="pk" />,
  );
  const labels = [...container.querySelectorAll('.pk-qs-label')].map((e) =>
    e.textContent!.slice(1, -1),
  );
  cleanup();
  return labels.sort();
}

describe('bit order — one convention across histogram, ket line and Q-sphere', () => {
  it('names exactly the holes a reversed label would be visible on', () => {
    const asymmetric = HOLES.filter((h) => mirrorOverlap(h) < 1 - 1e-9).map((h) => h.code);
    expect(asymmetric).toEqual(ASYMMETRIC);
  });

  for (const h of HOLES.filter((x) => x.qubits > 1)) {
    it(`${h.code}: histogram, ket line and Q-sphere spell the same outcomes`, () => {
      const ket = ketLine(h);
      expect(histogram(h)).toEqual(ket);
      expect(sphereLabels(h)).toEqual(Object.keys(ket).sort());
    });
  }
});
