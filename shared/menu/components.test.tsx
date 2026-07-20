// @vitest-environment jsdom
/**
 * Quantina shared components (QN1) — classPrefix render guards. Each is
 * style-free and app-styled via `<prefix>-…` classes; these tests assert the
 * `pk-` bindings render the class names + content the app CSS and the reveal
 * animation depend on: one MenuGrid card per item with a live probability and
 * the argmax highlight, an OrderCard with its lines + shot-source tag, and a
 * ServeReveal that re-keys on `seq`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { Outcome } from '@shared/display/outcomes';
import { MenuGrid } from './MenuGrid';
import { OrderCard, type OrderLine } from './OrderCard';
import { ServeReveal } from './ServeReveal';
import { builtinPack } from './builtinPacks';

afterEach(cleanup);

const coffee = builtinPack('coffee')!; // 8 items, single, 3 qubits
const juice = builtinPack('juice')!; // 3 items, subset
const icecream = builtinPack('icecream')!; // shots

describe('MenuGrid', () => {
  it('renders one card per item with a probability and highlights the argmax', () => {
    // Peak on 010 (Espresso). Missing codes default to 0 via the byBits lookup.
    const outcomes: Outcome[] = [
      { bits: '000', prob: 0.05 },
      { bits: '010', prob: 0.6 },
      { bits: '111', prob: 0.35 },
    ];
    const { container } = render(
      <MenuGrid pack={coffee} outcomes={outcomes} classPrefix="pk" />,
    );
    expect(container.querySelectorAll('.pk-menu-card')).toHaveLength(coffee.items.length);
    // Every card shows a percent.
    expect(container.querySelectorAll('.pk-menu-p')).toHaveLength(coffee.items.length);
    const peak = container.querySelector('.pk-menu-card.is-peak');
    expect(peak).not.toBeNull();
    expect(peak!.textContent).toContain('Espresso');
    expect(peak!.textContent).toContain('60%');
    // The code chip is present.
    expect(peak!.querySelector('.pk-menu-chip')!.textContent).toBe('010');
  });

  it('subset mode reads qubit marginals and renders q-chips', () => {
    // q0 marginal 0.7 (bits[0]==='1' at 0.7) → Orange juice peaks.
    const outcomes: Outcome[] = [
      { bits: '100', prob: 0.7 },
      { bits: '000', prob: 0.3 },
    ];
    const { container } = render(
      <MenuGrid pack={juice} outcomes={outcomes} classPrefix="pk" />,
    );
    const chips = [...container.querySelectorAll('.pk-menu-chip')].map((c) => c.textContent);
    expect(chips).toEqual(['q0', 'q1', 'q2']);
    const peak = container.querySelector('.pk-menu-card.is-peak')!;
    expect(peak.textContent).toContain('Orange juice');
  });
});

describe('OrderCard', () => {
  it('renders per-item lines with counts and the shot-source tag', () => {
    const lines: OrderLine[] = [
      { item: icecream.items.find((i) => i.code === '000')!, count: 2 },
      { item: icecream.items.find((i) => i.code === '001')!, count: 1 },
    ];
    const { container } = render(
      <OrderCard
        pack={icecream}
        result={{ outcomes: ['000', '001', '000'], shotSource: 'noisy' }}
        lines={lines}
        classPrefix="pk"
      />,
    );
    expect(container.querySelectorAll('.pk-order-line')).toHaveLength(2);
    expect(container.textContent).toContain('Strawberry');
    expect(container.querySelector('.pk-order-count')!.textContent).toBe('2×');
    // One chip per served bitstring.
    expect(container.querySelectorAll('.pk-order-chip')).toHaveLength(3);
    expect(container.querySelector('.pk-order-tag')!.textContent).toBe(
      'sampled with hardware noise',
    );
  });

  it('renders the friendly empty line for an empty (subset) serve', () => {
    const { container } = render(
      <OrderCard
        pack={juice}
        result={{ outcomes: ['000'], shotSource: 'ideal' }}
        lines={[]}
        classPrefix="pk"
      />,
    );
    expect(container.querySelector('.pk-order-empty')!.textContent).toContain('just the glass');
    expect(container.querySelector('.pk-order-tag')!.textContent).toBe(
      'sampled from the ideal state',
    );
  });
});

describe('ServeReveal', () => {
  it('re-keys on seq change so the reveal animation replays', () => {
    const { container, rerender } = render(
      <ServeReveal seq={1} classPrefix="pk">
        <span>order</span>
      </ServeReveal>,
    );
    const first = container.querySelector('.pk-reveal')!;
    expect(first.getAttribute('data-seq')).toBe('1');

    rerender(
      <ServeReveal seq={2} classPrefix="pk">
        <span>order</span>
      </ServeReveal>,
    );
    const second = container.querySelector('.pk-reveal')!;
    expect(second.getAttribute('data-seq')).toBe('2');
    // A new key → a fresh element (the animation restarts).
    expect(second).not.toBe(first);
  });
});
