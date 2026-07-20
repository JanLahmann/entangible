/**
 * Menu-pack wire schema, validation, normalization, and code↔item mapping —
 * the pure core of the Quantina "menu pack" concept (see docs/quantina.md).
 *
 * A **menu pack** encodes N menu items as the binary measurement outcomes of a
 * quantum circuit: press "serve", one (or k) shots are sampled from the live
 * probability vector, and the outcome bitstring picks what you get. This module
 * owns ONLY the data model + rules; sampling lives in `sample.ts` and the
 * bundled scenarios in `builtinPacks.ts`.
 *
 * Bit-order convention: a `code` is a bitstring whose **leftmost char is q0**
 * (the top wire) — the exact convention of `shared/display/outcomes.ts`
 * `Outcome.bits` (one char per displayed row, top(=q0) first). There is no
 * second convention: menu codes and histogram labels are byte-comparable, so a
 * peaked histogram column and its menu item share a bitstring.
 *
 * `validatePack` is the trust boundary: it takes untrusted JSON (host TOML packs
 * are converted to this wire schema before validation) and returns a fully
 * NORMALIZED pack — items completed (auto-padded), sorted, and stripped of
 * unknown fields — or the complete list of every error found (it never stops at
 * the first). The schema is forward-compatible: unknown extra fields are
 * ignored, so a newer pack still loads on an older client.
 */

/** How a serve turns the measured outcome(s) into an order. */
export type ServeMode = 'single' | 'shots' | 'subset';

/**
 * Where a serve's outcomes were sampled: the in-browser ideal distribution,
 * the noisy distribution (a noise preset was active), or `real` — a
 * staff-entered bitstring measured on a visitor's own device (the
 * real-hardware serve loop, docs/quantina.md decision 5). Canonical home of
 * the union — `shared/ws/messages` and the app surfaces re-export it (the
 * `NoisePreset` pattern).
 */
export type ShotSource = 'ideal' | 'noisy' | 'real';

/** One key/value in a dispatch program payload (Home Connect option shape). */
export interface ProgramOption {
  key: string;
  value: number | string | boolean;
}

/** Optional dispatch payload for an item (QN4; Home Connect program shape). */
export interface ItemProgram {
  key: string;
  options?: ProgramOption[];
}

export interface MenuItem {
  /**
   * single/shots modes: this item's outcome bitstring. LEFTMOST char = q0 (top
   * wire) — the exact convention of `shared/display/outcomes.ts` `Outcome.bits`.
   */
  code?: string;
  /** subset mode: this item's qubit (0..4); leftmost char of a bitstring = q0. */
  qubit?: number;
  name: string;
  subtitle?: string;
  /** Fallback glyph; every item is guaranteed one after normalization. */
  emoji?: string;
  /** Optional image URL (resolved by the pack loader). */
  image?: string;
  /** Optional dispatch payload (QN4, Home Connect shape). */
  program?: ItemProgram;
  /** True on auto-padded "Surprise me" items (honest leftover-amplitude answer). */
  house?: boolean;
}

/** Visitor-choosable shot count bounds (quantum-mixer's `numMeasurements`). */
export interface ShotsBounds {
  min: number;
  max: number;
  default: number;
}

/** Serve behaviour; `shots` bounds present only for mode `shots`. */
export interface ServeSpec {
  mode: ServeMode;
  shots?: ShotsBounds;
}

/** Optional per-pack branding overrides (CSS vars on tokens.css). */
export interface PackTheme {
  accent?: string;
  background?: string;
  logo?: string;
}

/** Optional footer link. */
export interface PackLink {
  name: string;
  url: string;
}

export interface MenuPack {
  id: string;
  title: string;
  tagline?: string;
  serve: ServeSpec;
  theme?: PackTheme;
  links?: PackLink[];
  /** Normalized: complete + sorted by code (single/shots) or qubit (subset). */
  items: MenuItem[];
  /**
   * Derived qubit count: `ceil(log2 N)` (floor 1) for single/shots over the
   * DECLARED item count, or the item count for subset.
   */
  qubits: number;
}

/** Successful validation: a normalized pack plus any non-fatal warnings. */
export interface ValidateOk {
  ok: true;
  pack: MenuPack;
  warnings: string[];
}

/** Failed validation: every error found (never truncated at the first). */
export interface ValidateErr {
  ok: false;
  errors: string[];
}

export type ValidateResult = ValidateOk | ValidateErr;

/** Default glyph for an item that declares no emoji (normalization guarantee). */
const DEFAULT_EMOJI = '🍽️';

const ID_RE = /^[a-z0-9-]+$/;
const BITS_RE = /^[01]+$/;

/**
 * The "Surprise me ✨" house item minted for an unfilled code — an honest
 * answer to leftover amplitude. The measurement is the measurement: we never
 * re-roll and never remap a code onto a different item.
 */
export function houseItem(code: string): MenuItem {
  return { code, name: 'Surprise me', emoji: '✨', house: true };
}

/**
 * Qubit count for `n` items in single/shots mode: the smallest `q ≥ 1` with
 * `2^q ≥ n`, i.e. `max(1, ceil(log2 n))`. Computed by integer doubling to dodge
 * the float rounding of `Math.log2` on exact powers of two.
 */
function bitsForCount(n: number): number {
  let q = 1;
  while (1 << q < n) q++;
  return q;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Normalize a validated program payload, keeping only known fields. */
function cleanProgram(raw: Record<string, unknown>): ItemProgram {
  const out: ItemProgram = { key: raw.key as string };
  if (Array.isArray(raw.options)) {
    out.options = raw.options.map((o) => {
      const opt = o as Record<string, unknown>;
      return { key: opt.key as string, value: opt.value as number | string | boolean };
    });
  }
  return out;
}

/**
 * Build a normalized item from validated raw input, keeping only wire-schema
 * fields and guaranteeing an emoji. `mode` decides whether `code` or `qubit`
 * is carried — never both.
 */
function cleanItem(raw: Record<string, unknown>, mode: ServeMode): MenuItem {
  const out: MenuItem = { name: raw.name as string };
  if (mode === 'subset') out.qubit = raw.qubit as number;
  else out.code = raw.code as string;
  if (typeof raw.subtitle === 'string') out.subtitle = raw.subtitle;
  out.emoji = isNonEmptyString(raw.emoji) ? raw.emoji : DEFAULT_EMOJI;
  if (typeof raw.image === 'string') out.image = raw.image;
  if (isObject(raw.program)) out.program = cleanProgram(raw.program);
  return out;
}

/** Validate an optional program payload, pushing any errors for item `i`. */
function validateProgram(program: unknown, i: number, errors: string[]): void {
  if (program === undefined) return;
  if (!isObject(program)) {
    errors.push(`item ${i}: program must be an object`);
    return;
  }
  if (!isNonEmptyString(program.key)) errors.push(`item ${i}: program.key must be a nonempty string`);
  if (program.options !== undefined) {
    if (!Array.isArray(program.options)) {
      errors.push(`item ${i}: program.options must be an array`);
    } else {
      program.options.forEach((o, j) => {
        if (!isObject(o) || !isNonEmptyString(o.key)) {
          errors.push(`item ${i}: program.options[${j}].key must be a nonempty string`);
        } else if (!['number', 'string', 'boolean'].includes(typeof o.value)) {
          errors.push(`item ${i}: program.options[${j}].value must be number|string|boolean`);
        }
      });
    }
  }
}

/** Validate optional `links`, returning the cleaned array (or undefined). */
function validateLinks(raw: unknown, errors: string[]): PackLink[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    errors.push('links must be an array');
    return undefined;
  }
  const out: PackLink[] = [];
  raw.forEach((l, i) => {
    if (!isObject(l) || !isNonEmptyString(l.name) || !isNonEmptyString(l.url)) {
      errors.push(`links[${i}] must have a nonempty name and url`);
    } else {
      out.push({ name: l.name, url: l.url });
    }
  });
  return out;
}

/** Validate optional `theme`, returning the cleaned object (or undefined). */
function validateTheme(raw: unknown, errors: string[]): PackTheme | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    errors.push('theme must be an object');
    return undefined;
  }
  const out: PackTheme = {};
  for (const key of ['accent', 'background', 'logo'] as const) {
    const v = raw[key];
    if (v === undefined) continue;
    if (typeof v !== 'string') errors.push(`theme.${key} must be a string`);
    else out[key] = v;
  }
  return out;
}

/**
 * Validate untrusted pack JSON and return a NORMALIZED pack. Collects EVERY
 * error (never stops at the first). On success the pack's items are complete
 * (auto-padded for single/shots), sorted, and stripped of unknown fields; the
 * `warnings` list names any auto-padded codes.
 */
export function validatePack(input: unknown): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(input)) {
    return { ok: false, errors: ['pack must be an object'] };
  }

  // --- id / title ----------------------------------------------------------
  const id = input.id;
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    errors.push('id must be a nonempty string matching /^[a-z0-9-]+$/');
  }
  const title = input.title;
  if (!isNonEmptyString(title)) errors.push('title must be a nonempty string');

  if (input.tagline !== undefined && typeof input.tagline !== 'string') {
    errors.push('tagline must be a string');
  }

  // --- serve.mode ----------------------------------------------------------
  let mode: ServeMode = 'single';
  let modeValid = true;
  const serveRaw = input.serve;
  if (serveRaw !== undefined && serveRaw !== null) {
    if (!isObject(serveRaw)) {
      errors.push('serve must be an object');
      modeValid = false;
    } else {
      const m = serveRaw.mode;
      if (m === undefined) mode = 'single';
      else if (m === 'single' || m === 'shots' || m === 'subset') mode = m;
      else {
        errors.push(`serve.mode must be one of single|shots|subset (got ${JSON.stringify(m)})`);
        modeValid = false;
      }
    }
  }
  const serveObj = isObject(serveRaw) ? serveRaw : undefined;

  // --- optional theme / links ---------------------------------------------
  const theme = validateTheme(input.theme, errors);
  const links = validateLinks(input.links, errors);

  // --- items array ---------------------------------------------------------
  const rawItems = input.items;
  if (!Array.isArray(rawItems)) {
    errors.push('items must be an array');
    return { ok: false, errors };
  }

  // Every item needs a nonempty name and, if present, a well-formed program.
  rawItems.forEach((it, i) => {
    if (!isObject(it)) {
      errors.push(`item ${i} must be an object`);
      return;
    }
    if (!isNonEmptyString(it.name)) errors.push(`item ${i}: name must be a nonempty string`);
    validateProgram(it.program, i, errors);
  });

  const N = rawItems.length;
  let qubits = 0;
  let paddedCodes: string[] = [];

  if (modeValid && (mode === 'single' || mode === 'shots')) {
    // --- single / shots: code-addressed items -----------------------------
    if (N < 2) errors.push(`single/shots packs need at least 2 items (got ${N})`);
    if (N > 32) errors.push(`single/shots packs allow at most 32 items (got ${N})`);
    qubits = bitsForCount(N);

    const seen = new Set<string>();
    rawItems.forEach((it, i) => {
      if (!isObject(it)) return;
      if (it.qubit !== undefined) errors.push(`item ${i}: qubit is only valid in subset mode`);
      const code = it.code;
      if (typeof code !== 'string') {
        errors.push(`item ${i}: code is required in ${mode} mode`);
      } else if (!BITS_RE.test(code)) {
        errors.push(`item ${i}: code "${code}" is not a bitstring`);
      } else if (code.length !== qubits) {
        errors.push(`item ${i}: code "${code}" must be ${qubits} bits wide`);
      } else if (seen.has(code)) {
        errors.push(`item ${i}: duplicate code "${code}"`);
      } else {
        seen.add(code);
      }
    });

    // Auto-pad every unfilled code with a house item (only reported on success).
    if (N >= 2 && N <= 32) {
      for (let v = 0; v < 1 << qubits; v++) {
        const code = v.toString(2).padStart(qubits, '0');
        if (!seen.has(code)) paddedCodes.push(code);
      }
    }

    // --- shots bounds -----------------------------------------------------
    if (mode === 'shots') {
      const sb = serveObj?.shots;
      if (sb !== undefined && sb !== null && !isObject(sb)) {
        errors.push('serve.shots must be an object');
      } else {
        const bounds = isObject(sb) ? sb : { min: 1, max: 1, default: 1 };
        const min = bounds.min;
        const max = bounds.max;
        const def = bounds.default;
        if (typeof min !== 'number' || typeof max !== 'number' || typeof def !== 'number') {
          errors.push('serve.shots must have numeric min, max, and default');
        } else {
          if (min < 1) errors.push(`serve.shots.min must be ≥ 1 (got ${min})`);
          if (min > def) errors.push(`serve.shots requires min ≤ default (${min} > ${def})`);
          if (def > max) errors.push(`serve.shots requires default ≤ max (${def} > ${max})`);
          if (max > 20) errors.push(`serve.shots.max must be ≤ 20 (got ${max})`);
        }
      }
    }
  } else if (modeValid && mode === 'subset') {
    // --- subset: one qubit per item ---------------------------------------
    if (N < 2) errors.push(`subset packs need at least 2 items (got ${N})`);
    if (N > 5) errors.push(`subset packs allow at most 5 items (got ${N})`);
    qubits = N;

    const qubitVals: number[] = [];
    rawItems.forEach((it, i) => {
      if (!isObject(it)) return;
      if (it.code !== undefined) errors.push(`item ${i}: code is not allowed in subset mode`);
      if (typeof it.qubit !== 'number' || !Number.isInteger(it.qubit)) {
        errors.push(`item ${i}: subset items require an integer qubit`);
      } else {
        qubitVals.push(it.qubit);
      }
    });
    // The qubit values must be EXACTLY the permutation 0..N-1 — otherwise the
    // wire count would be ambiguous (a gap or a duplicate breaks the mapping).
    const sorted = [...qubitVals].sort((a, b) => a - b);
    const isPermutation = qubitVals.length === N && sorted.every((q, i) => q === i);
    if (!isPermutation) {
      errors.push(`subset qubits must be exactly the permutation 0..${N - 1}`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // --- success: build the normalized pack ---------------------------------
  let items: MenuItem[];
  if (mode === 'subset') {
    items = rawItems
      .map((it) => cleanItem(it as Record<string, unknown>, 'subset'))
      .sort((a, b) => a.qubit! - b.qubit!);
  } else {
    items = rawItems.map((it) => cleanItem(it as Record<string, unknown>, mode));
    for (const code of paddedCodes) items.push(houseItem(code));
    items.sort((a, b) => (a.code! < b.code! ? -1 : a.code! > b.code! ? 1 : 0));
    if (paddedCodes.length > 0) {
      warnings.push(
        `padded ${paddedCodes.length} unfilled code(s) with house items: ${paddedCodes.join(', ')}`,
      );
    }
  }

  const serve: ServeSpec =
    mode === 'shots'
      ? { mode, shots: normalizeShots(serveObj?.shots) }
      : { mode };

  const pack: MenuPack = {
    id: id as string,
    title: title as string,
    serve,
    items,
    qubits,
  };
  if (typeof input.tagline === 'string') pack.tagline = input.tagline;
  if (theme && Object.keys(theme).length > 0) pack.theme = theme;
  if (links && links.length > 0) pack.links = links;

  return { ok: true, pack, warnings };
}

/** Resolve validated shots input to concrete bounds (absent → {1,1,1}). */
function normalizeShots(sb: unknown): ShotsBounds {
  if (!isObject(sb)) return { min: 1, max: 1, default: 1 };
  return { min: sb.min as number, max: sb.max as number, default: sb.default as number };
}

/** single/shots lookup: the item whose code equals `bits`, or undefined. */
export function itemForBits(pack: MenuPack, bits: string): MenuItem | undefined {
  return pack.items.find((it) => it.code === bits);
}

/**
 * subset lookup: the items whose qubit's char in `bits` is '1'. The char index
 * is the qubit and the LEFTMOST char is q0 — the `Outcome.bits` convention. A
 * set bit means "this ingredient landed in the glass".
 */
export function subsetForBits(pack: MenuPack, bits: string): MenuItem[] {
  return pack.items.filter((it) => it.qubit !== undefined && bits[it.qubit] === '1');
}
