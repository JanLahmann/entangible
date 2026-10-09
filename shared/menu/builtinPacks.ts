/**
 * The five bundled menu packs — the offline, standalone-safe defaults migrated
 * from quantum-mixer's usecase YAMLs (same author/family). Data only: each
 * constant is ALREADY in `validatePack`'s normalized form (items sorted by code
 * or qubit, every item carrying an emoji, unknown fields absent), so a round-trip
 * through `validatePack` returns it unchanged with zero warnings — asserted in
 * `builtinPacks.test.ts`.
 *
 * Design choices carried from the migration:
 * - Home Connect `program` keys are preserved as dispatch payloads (QN4); the
 *   "Tea" item had the YAML key `NotImplemented`, so it carries no program.
 * - Icons are dropped in favour of emoji: built-in packs are emoji-only by
 *   design (no photo-licensing burden — real photos arrive via custom packs).
 * - The mixer's "Cappucino" typo is fixed to "Cappuccino".
 * - `icecream` generalizes the mixer's `numMeasurements` into `shots` mode
 *   (k scoops per serve), and `juice` is the new `subset`/entanglement showcase.
 */
import type { MenuPack } from './pack';
import type { Messages } from '@shared/i18n/en';

/** Home Connect program-key prefix shared by the coffee items. */
const CM = 'ConsumerProducts.CoffeeMaker.Program';
const FILL_QUANTITY = 'ConsumerProducts.CoffeeMaker.Option.FillQuantity';

/** id `coffee` — "QoffeeMaker": order your coffee with a quantum computer. */
const coffee: MenuPack = {
  id: 'coffee',
  title: 'QoffeeMaker',
  tagline: 'Order your coffee with a quantum computer',
  serve: { mode: 'single' },
  links: [
    { name: 'IBM Quantum', url: 'https://www.ibm.com/quantum' },
    { name: 'Qiskit', url: 'https://www.ibm.com/quantum/qiskit' },
    { name: 'Qoffee Maker', url: 'https://qoffee-maker.org' },
  ],
  items: [
    { code: '000', name: 'Tea', emoji: '🍵' },
    { code: '001', name: 'Hot Chocolate', emoji: '🍫', program: { key: `${CM}.Beverage.MilkFroth` } },
    {
      code: '010',
      name: 'Espresso',
      emoji: '☕',
      program: { key: `${CM}.Beverage.Espresso`, options: [{ key: FILL_QUANTITY, value: 50 }] },
    },
    { code: '011', name: 'Coffee', emoji: '🧉', program: { key: `${CM}.Beverage.Coffee` } },
    { code: '100', name: 'Cappuccino', emoji: '🧋', program: { key: `${CM}.Beverage.Cappuccino` } },
    { code: '101', name: 'Latte Macchiato', emoji: '🥛', program: { key: `${CM}.Beverage.LatteMacchiato` } },
    { code: '110', name: 'Viennese Melange', emoji: '🍰', program: { key: `${CM}.CoffeeWorld.WienerMelange` } },
    { code: '111', name: 'Americano', emoji: '🥤', program: { key: `${CM}.CoffeeWorld.Americano` } },
  ],
  qubits: 3,
};

/** id `cocktails` — "Qocktail": mix your drink with a quantum computer. */
const cocktails: MenuPack = {
  id: 'cocktails',
  title: 'Qocktail',
  tagline: 'Mix your drink with a quantum computer',
  serve: { mode: 'single' },
  items: [
    { code: '000', name: 'Whiskey Sour', emoji: '🥃' },
    { code: '001', name: 'Long Island Iced Tea', emoji: '🧉' },
    { code: '010', name: 'Margarita', emoji: '🍸' },
    { code: '011', name: 'Cosmopolitan', emoji: '🍸' },
    { code: '100', name: 'Uptown Rocks', emoji: '🥂' },
    { code: '101', name: 'Old Fashioned', emoji: '🥃' },
    { code: '110', name: 'Lemon Drop', emoji: '🍋' },
    { code: '111', name: 'Water', emoji: '💧' },
  ],
  qubits: 3,
};

/** id `icecream` — "IceQream": k scoops by superposition (shots mode). */
const icecream: MenuPack = {
  id: 'icecream',
  title: 'IceQream',
  tagline: 'Scoops by superposition',
  serve: { mode: 'shots', shots: { min: 1, max: 3, default: 3 } },
  items: [
    { code: '000', name: 'Strawberry', emoji: '🍓' },
    { code: '001', name: 'Lemon', emoji: '🍋' },
    { code: '010', name: 'Lemon/Cuke', emoji: '🥒' },
    { code: '011', name: 'Cappuccino', emoji: '☕' },
    { code: '100', name: 'Sesame', emoji: '🌰' },
    { code: '101', name: 'Chocolate', emoji: '🍫' },
    { code: '110', name: 'Salted Peanut', emoji: '🥜' },
    {
      code: '111',
      name: 'Melted :(',
      emoji: '🫠',
      subtitle: 'the honest answer to leftover amplitude',
    },
  ],
  qubits: 3,
};

/** id `juice` — "Quantum Juice Bar": subset mode, one ingredient per qubit. */
const juice: MenuPack = {
  id: 'juice',
  title: 'Quantum Juice Bar',
  tagline: 'Every set bit lands in your glass',
  serve: { mode: 'subset' },
  items: [
    { qubit: 0, name: 'Orange juice', emoji: '🍊', subtitle: 'the sunny base of every glass' },
    { qubit: 1, name: 'Mango', emoji: '🥭', subtitle: 'a tropical splash when its bit is set' },
    { qubit: 2, name: 'Sparkling water', emoji: '🫧', subtitle: 'the fizz — entangle it to always fizz together' },
  ],
  qubits: 3,
};

/** id `demo` — "Quantum Diner": the four-outcome docs & test pack. */
const demo: MenuPack = {
  id: 'demo',
  title: 'Quantum Diner',
  tagline: 'The four-outcome docs & test pack',
  serve: { mode: 'single' },
  items: [
    { code: '00', name: 'Pizza', emoji: '🍕' },
    { code: '01', name: 'Sushi', emoji: '🍣' },
    { code: '10', name: 'Taco', emoji: '🌮' },
    { code: '11', name: 'Ramen', emoji: '🍜' },
  ],
  qubits: 2,
};

/** All bundled packs, already normalized. */
export const BUILTIN_PACKS: readonly MenuPack[] = [coffee, cocktails, icecream, juice, demo];

/** Look up a bundled pack by id. */
export function builtinPack(id: string): MenuPack | undefined {
  return BUILTIN_PACKS.find((p) => p.id === id);
}

/**
 * A BUILT-IN pack in the visitor's language: its tagline, item names and
 * subtitles from `t.quantina.packs` (keyed by item code, or `q<n>` for a subset
 * pack's qubit items); anything without a translation stays as authored. The
 * pack title is a brand and never changes. Custom and remote packs — anything
 * that is not one of the bundled objects — are returned untouched: they are
 * shown exactly as their author wrote them.
 */
export function localizePack(pack: MenuPack, t: Messages): MenuPack {
  if (!BUILTIN_PACKS.includes(pack)) return pack;
  const copy = t.quantina.packs[pack.id];
  if (!copy) return pack;
  return {
    ...pack,
    tagline: copy.tagline,
    items: pack.items.map((item) => {
      const key = item.code ?? `q${item.qubit}`;
      const name = copy.items[key];
      const subtitle = copy.subtitles[key];
      return name === undefined && subtitle === undefined
        ? item
        : { ...item, name: name ?? item.name, subtitle: subtitle ?? item.subtitle };
    }),
  };
}
