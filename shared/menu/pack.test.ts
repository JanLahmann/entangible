/**
 * The pack-validation matrix — the trust boundary's spec, mirroring
 * docs/quantina.md "Rules". Every rejection case asserts that errors are
 * COLLECTED (validatePack never stops at the first), and every acceptance case
 * asserts the NORMALIZED shape (padding, sorting, emoji guarantee).
 */
import { describe, it, expect } from 'vitest';
import {
  validatePack,
  itemForBits,
  subsetForBits,
  houseItem,
  type MenuPack,
  type ValidateOk,
} from './pack';

/** Assert-and-narrow: fail loudly if validation didn't succeed. */
function expectOk(input: unknown): ValidateOk {
  const res = validatePack(input);
  if (!res.ok) throw new Error(`expected ok, got errors: ${res.errors.join('; ')}`);
  return res;
}

function expectErr(input: unknown): string[] {
  const res = validatePack(input);
  if (res.ok) throw new Error('expected validation to fail');
  return res.errors;
}

describe('validatePack — acceptance & normalization', () => {
  it('accepts a minimal valid single pack (serve defaults to single)', () => {
    const { pack, warnings } = expectOk({
      id: 'mini',
      title: 'Mini',
      items: [
        { code: '0', name: 'A' },
        { code: '1', name: 'B' },
      ],
    });
    expect(pack.serve).toEqual({ mode: 'single' });
    expect(pack.qubits).toBe(1);
    expect(warnings).toEqual([]);
    // Emoji guarantee: absent emoji is filled with the default glyph.
    expect(pack.items.every((it) => typeof it.emoji === 'string' && it.emoji.length > 0)).toBe(true);
    expect(pack.items.map((it) => it.code)).toEqual(['0', '1']);
  });

  it('pads a 5-item pack to 8 with house items, warns, sets flag, sorts by code', () => {
    const { pack, warnings } = expectOk({
      id: 'pad',
      title: 'Pad',
      items: [
        { code: '000', name: 'A' },
        { code: '010', name: 'B' },
        { code: '100', name: 'C' },
        { code: '110', name: 'D' },
        { code: '111', name: 'E' },
      ],
    });
    expect(pack.qubits).toBe(3);
    expect(pack.items).toHaveLength(8);
    // Sorted by code across declared + house items.
    expect(pack.items.map((it) => it.code)).toEqual([
      '000', '001', '010', '011', '100', '101', '110', '111',
    ]);
    // The three unfilled codes became house items.
    const house = pack.items.filter((it) => it.house);
    expect(house.map((it) => it.code)).toEqual(['001', '011', '101']);
    for (const h of house) {
      expect(h).toEqual({ code: h.code, name: 'Surprise me', emoji: '✨', house: true });
    }
    // Exactly one warning, naming all three padded codes.
    expect(warnings).toHaveLength(1);
    for (const code of ['001', '011', '101']) expect(warnings[0]).toContain(code);
  });

  it('ignores unknown extra fields (forward-compatible wire schema)', () => {
    const { pack } = expectOk({
      id: 'fwd',
      title: 'Fwd',
      futureField: 'whatever',
      items: [
        { code: '0', name: 'A', someNewKey: 42 },
        { code: '1', name: 'B' },
      ],
    });
    expect((pack as unknown as Record<string, unknown>).futureField).toBeUndefined();
    expect((pack.items[0] as unknown as Record<string, unknown>).someNewKey).toBeUndefined();
  });

  it('preserves program payloads including option values', () => {
    const { pack } = expectOk({
      id: 'prog',
      title: 'Prog',
      items: [
        { code: '0', name: 'A', program: { key: 'K', options: [{ key: 'Fill', value: 50 }] } },
        { code: '1', name: 'B' },
      ],
    });
    expect(pack.items[0].program).toEqual({ key: 'K', options: [{ key: 'Fill', value: 50 }] });
  });
});

describe('validatePack — single/shots rejections', () => {
  it('rejects < 2 items', () => {
    expect(expectErr({ id: 'x', title: 'X', items: [{ code: '0', name: 'A' }] }).join(' ')).toContain(
      'at least 2',
    );
  });

  it('rejects > 32 items', () => {
    const items = Array.from({ length: 33 }, (_, i) => ({
      code: i.toString(2).padStart(6, '0'),
      name: `n${i}`,
    }));
    expect(expectErr({ id: 'x', title: 'X', items }).join(' ')).toContain('at most 32');
  });

  it('rejects duplicate codes', () => {
    const errs = expectErr({
      id: 'x',
      title: 'X',
      items: [
        { code: '0', name: 'A' },
        { code: '0', name: 'B' },
      ],
    });
    expect(errs.join(' ')).toContain('duplicate code');
  });

  it('rejects a wrong-width code', () => {
    const errs = expectErr({
      id: 'x',
      title: 'X',
      items: [
        { code: '00', name: 'A' }, // qubits = 2, but paired with a 1-wide sibling
        { code: '01', name: 'B' },
        { code: '1', name: 'C' },
      ],
    });
    expect(errs.join(' ')).toContain('must be 2 bits wide');
  });

  it('rejects a non-bitstring code', () => {
    const errs = expectErr({
      id: 'x',
      title: 'X',
      items: [
        { code: '0a', name: 'A' },
        { code: '01', name: 'B' },
        { code: '10', name: 'C' },
      ],
    });
    expect(errs.join(' ')).toContain('is not a bitstring');
  });
});

describe('validatePack — id / title / mode rejections', () => {
  it('rejects a bad id', () => {
    expect(
      expectErr({ id: 'Bad Id!', title: 'X', items: [{ code: '0', name: 'A' }, { code: '1', name: 'B' }] }).join(' '),
    ).toContain('id must');
  });

  it('rejects a missing title', () => {
    expect(
      expectErr({ id: 'x', items: [{ code: '0', name: 'A' }, { code: '1', name: 'B' }] }).join(' '),
    ).toContain('title must');
  });

  it('rejects an unknown serve mode', () => {
    expect(
      expectErr({
        id: 'x',
        title: 'X',
        serve: { mode: 'teleport' },
        items: [{ code: '0', name: 'A' }, { code: '1', name: 'B' }],
      }).join(' '),
    ).toContain('serve.mode');
  });
});

describe('validatePack — shots bounds rejections', () => {
  const base = (shots: unknown) => ({
    id: 'x',
    title: 'X',
    serve: { mode: 'shots', shots },
    items: [{ code: '0', name: 'A' }, { code: '1', name: 'B' }],
  });

  it('defaults absent shots bounds to {1,1,1}', () => {
    const { pack } = expectOk({
      id: 'x',
      title: 'X',
      serve: { mode: 'shots' },
      items: [{ code: '0', name: 'A' }, { code: '1', name: 'B' }],
    });
    expect(pack.serve).toEqual({ mode: 'shots', shots: { min: 1, max: 1, default: 1 } });
  });

  it('rejects min > default', () => {
    expect(expectErr(base({ min: 3, max: 5, default: 2 })).join(' ')).toContain('min ≤ default');
  });

  it('rejects default > max', () => {
    expect(expectErr(base({ min: 1, max: 2, default: 3 })).join(' ')).toContain('default ≤ max');
  });

  it('rejects max > 20', () => {
    expect(expectErr(base({ min: 1, max: 21, default: 1 })).join(' ')).toContain('≤ 20');
  });

  it('rejects min < 1', () => {
    expect(expectErr(base({ min: 0, max: 3, default: 1 })).join(' ')).toContain('min must be ≥ 1');
  });
});

describe('validatePack — subset rejections', () => {
  it('rejects duplicate qubits', () => {
    const errs = expectErr({
      id: 'x',
      title: 'X',
      serve: { mode: 'subset' },
      items: [
        { qubit: 0, name: 'A' },
        { qubit: 0, name: 'B' },
      ],
    });
    expect(errs.join(' ')).toContain('permutation');
  });

  it('rejects qubits that are not a permutation of 0..N-1', () => {
    const errs = expectErr({
      id: 'x',
      title: 'X',
      serve: { mode: 'subset' },
      items: [
        { qubit: 0, name: 'A' },
        { qubit: 2, name: 'B' }, // gap at 1
      ],
    });
    expect(errs.join(' ')).toContain('permutation');
  });

  it('rejects more than 5 items', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ qubit: i, name: `n${i}` }));
    expect(
      expectErr({ id: 'x', title: 'X', serve: { mode: 'subset' }, items }).join(' '),
    ).toContain('at most 5');
  });

  it('rejects a code in subset mode', () => {
    const errs = expectErr({
      id: 'x',
      title: 'X',
      serve: { mode: 'subset' },
      items: [
        { qubit: 0, code: '0', name: 'A' },
        { qubit: 1, name: 'B' },
      ],
    });
    expect(errs.join(' ')).toContain('code is not allowed in subset');
  });

  it('accepts and sorts a valid subset pack by qubit', () => {
    const { pack } = expectOk({
      id: 'sub',
      title: 'Sub',
      serve: { mode: 'subset' },
      items: [
        { qubit: 2, name: 'C' },
        { qubit: 0, name: 'A' },
        { qubit: 1, name: 'B' },
      ],
    });
    expect(pack.qubits).toBe(3);
    expect(pack.items.map((it) => it.qubit)).toEqual([0, 1, 2]);
    expect(pack.items.map((it) => it.name)).toEqual(['A', 'B', 'C']);
  });
});

describe('validatePack — collects multiple errors at once', () => {
  it('reports a bad id, a missing title, AND a too-short item list together', () => {
    const errs = expectErr({ id: 'BAD', items: [{ code: '0', name: 'A' }] });
    expect(errs.length).toBeGreaterThanOrEqual(3);
    expect(errs.join(' ')).toContain('id must');
    expect(errs.join(' ')).toContain('title must');
    expect(errs.join(' ')).toContain('at least 2');
  });
});

describe('itemForBits / subsetForBits / houseItem', () => {
  const single: MenuPack = expectOk({
    id: 'demo',
    title: 'Demo',
    items: [
      { code: '00', name: 'Pizza' },
      { code: '01', name: 'Sushi' },
      { code: '10', name: 'Taco' },
      { code: '11', name: 'Ramen' },
    ],
  }).pack;

  const subset: MenuPack = expectOk({
    id: 'juice',
    title: 'Juice',
    serve: { mode: 'subset' },
    items: [
      { qubit: 0, name: 'Orange' },
      { qubit: 1, name: 'Mango' },
      { qubit: 2, name: 'Fizz' },
    ],
  }).pack;

  it('itemForBits looks up by exact code', () => {
    expect(itemForBits(single, '10')?.name).toBe('Taco');
    expect(itemForBits(single, '11')?.name).toBe('Ramen');
    expect(itemForBits(single, '99')).toBeUndefined();
  });

  it('subsetForBits returns the set-bit ingredients (Qiskit order: rightmost char = q0)', () => {
    // '101' → qubits 0 and 2 set → Orange + Fizz, NOT Mango.
    const got = subsetForBits(subset, '101').map((it) => it.name);
    expect(got).toEqual(['Orange', 'Fizz']);
    expect(subsetForBits(subset, '000')).toEqual([]);
    expect(subsetForBits(subset, '111').map((it) => it.name)).toEqual(['Orange', 'Mango', 'Fizz']);
    expect(subsetForBits(subset, '010').map((it) => it.name)).toEqual(['Mango']);
    // Asymmetric: '001' is q0 alone, '100' is q2 alone.
    expect(subsetForBits(subset, '001').map((it) => it.name)).toEqual(['Orange']);
    expect(subsetForBits(subset, '100').map((it) => it.name)).toEqual(['Fizz']);
  });

  it('houseItem mints the honest leftover-amplitude answer', () => {
    expect(houseItem('011')).toEqual({ code: '011', name: 'Surprise me', emoji: '✨', house: true });
  });
});
