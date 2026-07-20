/**
 * Quantina serve-helper tests (QN1). The parity argument is the load-bearing
 * one: the menu's numbers and its draws come from the SAME `Outcome[]` the
 * histogram renders, so a Bell-on-2-qubits menu vector is byte-identical to
 * `displayOutcomes(circuit, 2)`. Serves are pinned deterministic under a seeded
 * `mulberry32`; `orderLines` covers shots aggregation, house-code resolution,
 * and the subset empty-glass case.
 */
import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import { displayOutcomes, outcomesFromProbabilities } from '@shared/display/outcomes';
import { validatePack, type MenuPack } from '@shared/menu/pack';
import { builtinPack } from '@shared/menu/builtinPacks';
import { mulberry32 } from '@shared/menu/sample';
import { menuOutcomes, orderLines, resolvePack, serveFrom, type ServeResult } from './quantina';

let seq = 0;
const g = (partial: Omit<Gate, 'id'>): Gate => ({ id: `g${seq++}`, ...partial });
const circuit = (gates: Gate[]): Circuit => ({ qubits: 5, gates });

/** Bell over q0/q1: |00⟩+|11⟩, each 0.5. */
const bell = circuit([
  g({ type: 'H', qubit: 0, position: 0 }),
  g({ type: 'CNOT', control: 0, target: 1, position: 1 }),
]);

const demo = builtinPack('demo')!; // 2 qubits, single mode, fully filled
const icecream = builtinPack('icecream')!; // 3 qubits, shots mode
const juice = builtinPack('juice')!; // 3 qubits, subset mode

describe('menuOutcomes — histogram parity', () => {
  it('a Bell-on-2-qubits menu vector equals displayOutcomes(circuit, 2) exactly', () => {
    expect(menuOutcomes(bell, demo)).toEqual(displayOutcomes(bell, 2));
  });

  it('the noisy path marginalizes the PASSED vector, not the statevector', () => {
    // A physical vector unrelated to `bell` — the menu must read THIS one.
    const noisy = new Array(32).fill(0);
    noisy[0] = 0.7; // |00000⟩
    noisy[3] = 0.3; // q0=1,q1=1
    expect(menuOutcomes(bell, demo, noisy)).toEqual(outcomesFromProbabilities(noisy, 2));
  });
});

describe('serveFrom — deterministic under a seed', () => {
  it('single draws exactly one bitstring, reproducibly', () => {
    const outcomes = menuOutcomes(bell, demo);
    const a = serveFrom(outcomes, demo, 1, mulberry32(7), 'ideal');
    const b = serveFrom(outcomes, demo, 1, mulberry32(7), 'ideal');
    expect(a.outcomes).toHaveLength(1);
    expect(a).toEqual(b);
    expect(a.packId).toBe('demo');
    expect(a.shotSource).toBe('ideal');
  });

  it('shots draws exactly k bitstrings (k=3), reproducibly', () => {
    const outcomes = menuOutcomes(bell, icecream);
    const a = serveFrom(outcomes, icecream, 3, mulberry32(99), 'noisy');
    const b = serveFrom(outcomes, icecream, 3, mulberry32(99), 'noisy');
    expect(a.outcomes).toHaveLength(3);
    expect(a).toEqual(b);
    expect(a.shotSource).toBe('noisy');
  });

  it('subset draws one bitstring, reproducibly', () => {
    const outcomes = menuOutcomes(bell, juice);
    const a = serveFrom(outcomes, juice, 1, mulberry32(3), 'ideal');
    const b = serveFrom(outcomes, juice, 1, mulberry32(3), 'ideal');
    expect(a.outcomes).toHaveLength(1);
    expect(a).toEqual(b);
  });
});

describe('orderLines', () => {
  it('single: resolves the one item for the bitstring', () => {
    const result: ServeResult = { packId: 'demo', outcomes: ['10'], shotSource: 'ideal' };
    const lines = orderLines(demo, result);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ item: demo.items.find((i) => i.code === '10'), count: 1 });
    expect(lines[0].item.name).toBe('Taco');
  });

  it('shots: aggregates duplicates into per-item counts, sorted desc ("2×")', () => {
    // 000 twice, 001 once → Strawberry ×2, Lemon ×1.
    const result: ServeResult = {
      packId: 'icecream',
      outcomes: ['000', '001', '000'],
      shotSource: 'noisy',
    };
    const lines = orderLines(icecream, result);
    expect(lines.map((l) => [l.item.name, l.count])).toEqual([
      ['Strawberry', 2],
      ['Lemon', 1],
    ]);
  });

  it('single: a padded house code resolves to the house item', () => {
    // 3 items over 2 qubits → code "11" is auto-padded with a house item.
    const res = validatePack({
      id: 'houses',
      title: 'Houses',
      serve: { mode: 'single' },
      items: [
        { code: '00', name: 'A' },
        { code: '01', name: 'B' },
        { code: '10', name: 'C' },
      ],
    });
    expect(res.ok).toBe(true);
    const pack = (res as { ok: true; pack: MenuPack }).pack;
    const lines = orderLines(pack, { packId: 'houses', outcomes: ['11'], shotSource: 'ideal' });
    expect(lines).toHaveLength(1);
    expect(lines[0].item.house).toBe(true);
    expect(lines[0].item.name).toBe('Surprise me');
  });

  it('subset: an all-zero bitstring is the empty glass (no lines)', () => {
    const lines = orderLines(juice, { packId: 'juice', outcomes: ['000'], shotSource: 'ideal' });
    expect(lines).toEqual([]);
  });

  it('subset: set bits become the ingredients, one each', () => {
    // q0 and q2 set → Orange juice + Sparkling water.
    const lines = orderLines(juice, { packId: 'juice', outcomes: ['101'], shotSource: 'ideal' });
    expect(lines.map((l) => l.item.name)).toEqual(['Orange juice', 'Sparkling water']);
    expect(lines.every((l) => l.count === 1)).toBe(true);
  });
});

describe('resolvePack', () => {
  it('resolves a known built-in id', () => {
    expect(resolvePack('cocktails').id).toBe('cocktails');
  });

  it('falls back to coffee for an unknown id', () => {
    expect(resolvePack('does-not-exist').id).toBe('coffee');
  });
});
