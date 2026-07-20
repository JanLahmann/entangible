/**
 * Quantina serve helpers (pocket) — the SINGLE source of the menu's numbers.
 *
 * Every probability the menu shows and every serve it draws comes from the same
 * `Outcome[]` the RESULTS histogram renders (`@shared/display/outcomes`),
 * marginalized onto the pack's qubit count. There is no second simulation and no
 * second bit-order convention: a peaked histogram column and its menu item share
 * a bitstring, and "real hardware might make you an espresso instead" falls out
 * for free whenever the caller passes the NOISY probability vector.
 *
 * Marginalizing the 5-qubit display vector onto rows 0..pack.qubits-1 is exact:
 * a pack uses q0..q(qubits-1), and any stray tile a visitor drops on a higher
 * row just acts as environment (its |0⟩/|1⟩ mass folds into the shown rows) — we
 * deliberately do NOT special-case it. All draws are RNG-injectable (seeded
 * `mulberry32` in tests, `cryptoRng()` in the UI).
 */
import type { Circuit } from '@qamposer/react';
import type { Outcome } from '@shared/display/outcomes';
import { displayOutcomes, outcomesFromProbabilities } from '@shared/display/outcomes';
import type { MenuItem, MenuPack, ShotSource } from '@shared/menu/pack';
import { itemForBits, subsetForBits } from '@shared/menu/pack';
import { builtinPack } from '@shared/menu/builtinPacks';
import { sampleOutcome, sampleShots, type Rng } from '@shared/menu/sample';

/**
 * Where a serve's outcomes were sampled from ('real' is QN2's staff-entered
 * real-hardware bitstring, unused on the standalone serve path). Canonical
 * union in `@shared/menu/pack`; re-exported here for settings-style ergonomics.
 */
export type { ShotSource };

/** The outcome of one serve — a bitstring list plus where it was sampled from. */
export interface ServeResult {
  packId: string;
  /** length 1 for single/subset, length k for shots. Each is a `pack.qubits`-wide bitstring. */
  outcomes: string[];
  shotSource: ShotSource;
}

/** One resolved order line: a menu item and how many of it the serve produced. */
export interface OrderLine {
  item: MenuItem;
  count: number;
}

/**
 * The live outcome vector the menu reads, marginalized onto `pack.qubits`. With
 * a noise preset active the caller passes the NOISY physical vector (length
 * 2^physical) and we marginalize it; otherwise we read the ideal statevector.
 * Either way the result is byte-identical to the vector the paired histogram
 * shows over the same qubit count.
 */
export function menuOutcomes(
  circuit: Circuit,
  pack: MenuPack,
  noisyProbs?: readonly number[],
): Outcome[] {
  return noisyProbs
    ? outcomesFromProbabilities(noisyProbs, pack.qubits)
    : displayOutcomes(circuit, pack.qubits);
}

/**
 * Draw a serve from the live outcomes. `single`/`subset` take ONE shot (one
 * bitstring); `shots` takes `shots` independent draws (duplicates welcome — k
 * scoops). The RNG is injected so tests are deterministic under `mulberry32`.
 */
export function serveFrom(
  outcomes: readonly Outcome[],
  pack: MenuPack,
  shots: number,
  rng: Rng,
  shotSource: ShotSource,
): ServeResult {
  const drawn =
    pack.serve.mode === 'shots'
      ? sampleShots(outcomes, shots, rng)
      : [sampleOutcome(outcomes, rng)];
  return { packId: pack.id, outcomes: drawn, shotSource };
}

/**
 * Resolve a serve's bitstrings to order lines:
 *  - `single`: the one item for the bitstring (auto-padded codes resolve to the
 *    house item — the measurement is the measurement).
 *  - `shots`: aggregate duplicate outcomes into per-item counts, sorted by count
 *    descending ("2× Strawberry, 1× Mango").
 *  - `subset`: the ingredients whose qubit bit is set, one each. An empty list
 *    ("just the glass") returns `[]` — the order card renders a friendly line.
 */
export function orderLines(pack: MenuPack, result: ServeResult): OrderLine[] {
  if (pack.serve.mode === 'subset') {
    const bits = result.outcomes[0] ?? '';
    return subsetForBits(pack, bits).map((item) => ({ item, count: 1 }));
  }

  if (pack.serve.mode === 'shots') {
    // Insertion-ordered map keeps ties stable; sort brings the peaks to the top.
    const counts = new Map<string, number>();
    for (const bits of result.outcomes) counts.set(bits, (counts.get(bits) ?? 0) + 1);
    const lines: OrderLine[] = [];
    for (const [bits, count] of counts) {
      const item = itemForBits(pack, bits);
      if (item) lines.push({ item, count });
    }
    lines.sort((a, b) => b.count - a.count);
    return lines;
  }

  // single
  const item = itemForBits(pack, result.outcomes[0] ?? '');
  return item ? [{ item, count: 1 }] : [];
}

/**
 * Resolve a settings menu id to a bundled pack, falling back to `coffee` (the
 * default 3-qubit menu) with a console warning if the id names no known pack.
 * Pure + deterministic given the id — the warn is a diagnostic side-effect, so
 * callers memoize on the id to avoid re-warning every render.
 */
export function resolvePack(menuId: string): MenuPack {
  const pack = builtinPack(menuId);
  if (pack) return pack;
  // eslint-disable-next-line no-console
  console.warn(`[quantina] unknown menu pack "${menuId}" — falling back to "coffee"`);
  return builtinPack('coffee')!;
}
