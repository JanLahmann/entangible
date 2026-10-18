/**
 * The classic course, hole by hole (course version 2) — the TOTALITY checks
 * every hole must pass, so a hole edited later cannot quietly break one:
 *
 *  - its target is the state written in the table (an independent amplitude
 *    list), and its `targetKet` string says the same state;
 *  - par = the PROVEN shortest solution + 2, with the round's own clubs;
 *  - the round's new clubs are necessary wherever the course claims they are
 *    (the random course's club-necessity rule, #77);
 *  - no idle wire, no |0…0⟩-close target, no phases in the easy round;
 *  - its goal line, in English and German, says nothing the target denies;
 *  - its shortest solution and a par-length one fit the physical booth kit.
 *
 * The same numbers are written out for people in docs/golf-course.md.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Circuit, Gate, GateType } from '@qamposer/react';
import {
  HOLES,
  ROUND_CLUBS,
  clubGateTypes,
  evaluate,
  gateTypesForClubs,
  holeTargetState,
  type GolfRound,
  type Hole,
} from './golf';
import { optimalSearch } from './optimal';
import { DIM, fidelity, statevector, zeroState, type Complex, type StateVector } from './statevector';
import { basisVisuals } from './qsphere';
import { en } from '@shared/i18n/en';
import { de } from '@shared/i18n/de';

const R = Math.SQRT1_2;
const c = (re: number, im = 0): Complex => ({ re, im });
const SIN8 = Math.sin(Math.PI / 8);
const COS8 = Math.cos(Math.PI / 8);

/** A state from MSB-first labels (leftmost bit = highest wire, like the ket line). */
function fromLabels(terms: Record<string, Complex>): StateVector {
  const s: StateVector = Array.from({ length: DIM }, () => c(0));
  for (const [label, a] of Object.entries(terms)) s[parseInt(label, 2)] = a;
  return s;
}

/** The course table, written out independently of the solutions that define it. */
const TABLE: Record<string, Record<string, Complex>> = {
  E1: { '0': c(R), '1': c(R) },
  E2: { '00': c(R), '11': c(R) },
  E3: { '010': c(0.5), '011': c(0.5), '110': c(0.5), '111': c(0.5) },
  E4: { '0100': c(0.5), '0111': c(0.5), '1000': c(0.5), '1011': c(0.5) },
  E5: { '00000': c(R), '11111': c(R) },
  M1: { '0': c(R), '1': c(-R) },
  M2: { '01': c(R), '10': c(-R) },
  M3: { '001': c(0.5), '010': c(-0.5), '101': c(0.5), '110': c(-0.5) },
  M4: { '0100': c(0.5), '0111': c(-0.5), '1000': c(-0.5), '1011': c(0.5) },
  M5: { '00001': c(R), '11110': c(-R) },
  D1: { '0': c(R), '1': c(0, R) },
  D2: { '00': c(R), '11': c(0, R) },
  D3: Object.fromEntries(
    ['000', '001', '010', '011', '100', '101', '110', '111'].map((l) => {
      const sign = l[1] === '1' ? -1 : 1; // q1 is |−⟩
      const a = (sign * R) / 2;
      return [l, l[0] === '1' ? c(0, a) : c(a)]; // q2 is |i⟩, q0 is |+⟩
    }),
  ),
  D4: { '0000': c(0.5), '0011': c(0, 0.5), '1100': c(0, 0.5), '1111': c(-0.5) },
  D5: { '00000': c(R), '11111': c(0, -R) },
  X1: { '0': c(SIN8), '1': c(0, COS8) },
  X3: { '000': c(R), '001': c(0.5), '111': c(0.5) },
  X5: {
    '00000': c(R),
    '00001': c(0.5),
    '00011': c(R / 2),
    '00111': c(0.25),
    '01111': c(R / 4),
    '11111': c(R / 4),
  },
};

const ROUND_BELOW: Record<GolfRound, GolfRound | null> = {
  easy: null,
  medium: 'easy',
  difficult: 'medium',
  extra: 'difficult',
};

const byCode = (code: string) => HOLES.find((h) => h.code === code)!;
const circuit = (gates: Gate[]): Circuit => ({ qubits: 5, gates });

/** Populated outcomes of a hole's target: MSB label, probability, phase (deg, vs the first). */
function outcomes(h: Hole) {
  return basisVisuals(holeTargetState(h), 1 << h.qubits)
    .filter((v) => v.prob > 1e-9)
    .map((v) => ({ label: v.index.toString(2).padStart(h.qubits, '0'), prob: v.prob, phase: v.phaseDeg }));
}

const phaseIs = (deg: number, want: number) => Math.abs(((deg - want + 540) % 360) - 180) < 0.5;

/** Purity of qubit q's reduced state — 1 for every q iff the state is a product. */
function purity(s: StateVector, k: number, q: number): number {
  let p0 = 0;
  let p1 = 0;
  let offRe = 0;
  let offIm = 0;
  for (let i = 0; i < 1 << k; i++) {
    if ((i >> q) & 1) continue;
    const a = s[i];
    const b = s[i | (1 << q)];
    p0 += a.re * a.re + a.im * a.im;
    p1 += b.re * b.re + b.im * b.im;
    // ρ01 = Σ a·conj(b)
    offRe += a.re * b.re + a.im * b.im;
    offIm += a.im * b.re - a.re * b.im;
  }
  return p0 * p0 + p1 * p1 + 2 * (offRe * offRe + offIm * offIm);
}
const isProduct = (h: Hole) =>
  Array.from({ length: h.qubits }, (_, q) => q).every((q) => purity(holeTargetState(h), h.qubits, q) > 1 - 1e-9);

// ---------------------------------------------------------------------------
// A reader for the scorecard's ket strings
// ---------------------------------------------------------------------------

/** "(|01⟩+|10⟩)(|00⟩+|11⟩)/2", "|i⟩|−⟩|+⟩", "sin(π/8)|0⟩+i·cos(π/8)|1⟩" … → amplitudes
 *  by MSB-first label (unnormalised; the comparison is by fidelity). */
function readKet(text: string): Map<string, Complex> {
  // Drop a top-level normalisation "/…" (the last '/' outside any parentheses).
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === '/' && depth === 0 && !text.slice(i).startsWith('/8')) cut = i;
  }
  const body = cut >= 0 ? text.slice(0, cut) : text;
  // A top-level sign (outside parentheses and kets) makes it a sum.
  depth = 0;
  let inKet = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '|') inKet = true;
    else if (ch === '⟩') inKet = false;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (!inKet && depth === 0 && i > 0 && (ch === '+' || ch === '−')) return readSum(body);
  }
  // Otherwise a product of factors, leftmost = highest wires.
  const factors: Map<string, Complex>[] = [];
  const re = /\(([^()]*(?:\([^()]*\)[^()]*)*)\)|\|([^⟩]+)⟩/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[1] !== undefined) factors.push(readSum(m[1]));
    else factors.push(single(m[2]));
  }
  return factors.reduce((acc, f) => {
    const out = new Map<string, Complex>();
    for (const [la, a] of acc) for (const [lb, b] of f) out.set(la + lb, mul(a, b));
    return out;
  });
}
const mul = (a: Complex, b: Complex): Complex => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
function single(sym: string): Map<string, Complex> {
  const table: Record<string, [Complex, Complex]> = {
    '0': [c(1), c(0)],
    '1': [c(0), c(1)],
    '+': [c(R), c(R)],
    '−': [c(R), c(-R)],
    i: [c(R), c(0, R)],
  };
  if (/^[01]+$/.test(sym) && sym.length > 1) return new Map([[sym, c(1)]]);
  const [a, b] = table[sym];
  return new Map([['0', a], ['1', b]]);
}
function readSum(text: string): Map<string, Complex> {
  const out = new Map<string, Complex>();
  const re = /([+−]?)([^|+−]*)\|([01]+)⟩/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const sign = m[1] === '−' ? -1 : 1;
    const coef = m[2];
    const cm = /^(i·?)?(\d*)(√2)?(sin\(π\/8\)|cos\(π\/8\))?(i)?$/.exec(coef);
    if (!cm) throw new Error(`unread coefficient "${coef}" in ${text}`);
    let mag = cm[2] ? Number(cm[2]) : 1;
    if (cm[3]) mag *= Math.SQRT2;
    if (cm[4]) mag *= cm[4].startsWith('sin') ? SIN8 : COS8;
    const imag = Boolean(cm[1] || cm[5]);
    out.set(m[3], imag ? c(0, sign * mag) : c(sign * mag));
  }
  return out;
}
function ketState(text: string): StateVector {
  const s: StateVector = Array.from({ length: DIM }, () => c(0));
  let n = 0;
  for (const [label, a] of readKet(text)) {
    s[parseInt(label, 2)] = a;
    n += a.re * a.re + a.im * a.im;
  }
  const m = Math.sqrt(n);
  return s.map((a) => c(a.re / m, a.im / m));
}

// ---------------------------------------------------------------------------
// Physical kit (assets.toml) and how a solution sits on the mat
// ---------------------------------------------------------------------------

function tomlSection(name: string): Record<string, number> {
  const text = readFileSync(new URL('../../assets.toml', import.meta.url), 'utf8');
  const start = text.indexOf(`[${name}]`);
  const rest = text.slice(start + name.length + 2);
  const end = rest.search(/^\[/m);
  const out: Record<string, number> = {};
  for (const line of (end < 0 ? rest : rest.slice(0, end)).split('\n')) {
    const m = /^\s*([A-Za-z_]+)\s*=\s*([\d.]+)/.exec(line);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}
const KIT = tomlSection('kit');
const BOARD = tomlSection('board');

type Tiles = Record<'H' | 'X' | 'Y' | 'Z' | 'S' | 'T' | 'control', number>;
/** Tiles a circuit lays: a CX is ● + X, a CH is ● + H (marker-ids.md, #51). */
function tilesOf(gates: readonly Gate[]): Tiles {
  const t: Tiles = { H: 0, X: 0, Y: 0, Z: 0, S: 0, T: 0, control: 0 };
  for (const g of gates) {
    if (g.type === 'CNOT') {
      t.control++;
      t.X++;
    } else if (g.type === 'CH') {
      t.control++;
      t.H++;
    } else t[g.type as keyof Tiles]++;
  }
  return t;
}
/** Columns the circuit needs on the mat: a controlled gate's column holds only
 *  its ● and its target (a second tile there is ambiguous); singles on
 *  different wires may share a column; gate order on a wire is kept. */
function columnsOf(gates: readonly Gate[]): number {
  const free = new Array(5).fill(0);
  const cols: ('single' | 'controlled')[] = [];
  for (const g of gates) {
    if (g.control !== undefined) {
      let col = Math.max(free[g.control], free[g.target!]);
      while (cols[col] !== undefined) col++;
      cols[col] = 'controlled';
      free[g.control] = free[g.target!] = col + 1;
    } else {
      let col = free[g.qubit!];
      while (cols[col] === 'controlled') col++;
      cols[col] = 'single';
      free[g.qubit!] = col + 1;
    }
  }
  return cols.length;
}
const kitHas = (t: Tiles) =>
  t.H <= KIT.H && t.X <= KIT.X && t.Y <= KIT.Y && t.Z <= KIT.Z && t.S <= KIT.S && t.T <= KIT.T &&
  t.control <= KIT.CNOT_control;

/** A par-length answer: the shortest one plus a cancelling pair of a spare tile. */
function parLength(h: Hole): Gate[] | null {
  const gates = h.solution!.gates;
  const used = tilesOf(gates);
  for (const type of ['Z', 'Y', 'X', 'H'] as const) {
    if (KIT[type] - used[type] < 2) continue;
    for (let q = 0; q < h.qubits; q++) {
      const pad = [0, 1].map((i) => ({ id: `pad${i}`, type, position: gates.length + i, qubit: q }) as Gate);
      const all = [...gates, ...pad];
      if (columnsOf(all) <= BOARD.cols) return all;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------

describe('classic course v2 — the target of every hole', () => {
  it('is the table\'s state, normalised, and the scorecard ket says the same', () => {
    expect(Object.keys(TABLE)).toEqual(HOLES.map((h) => h.code));
    for (const h of HOLES) {
      const target = holeTargetState(h);
      const norm = target.reduce((s, a) => s + a.re * a.re + a.im * a.im, 0);
      expect(norm, h.code).toBeCloseTo(1, 12);
      // Nothing lives above the hole's own wires.
      for (let i = 1 << h.qubits; i < DIM; i++) expect(Math.hypot(target[i].re, target[i].im), h.code).toBe(0);
      expect(fidelity(target, fromLabels(TABLE[h.code])), `${h.code} vs table`).toBeGreaterThan(1 - 1e-9);
      expect(fidelity(target, ketState(h.targetKet)), `${h.code} vs "${h.targetKet}"`).toBeGreaterThan(1 - 1e-9);
    }
  });

  it('keeps every wire alive and the empty board well away from the target', () => {
    for (const h of HOLES) {
      const s = holeTargetState(h);
      for (let q = 0; q < h.qubits; q++) {
        let p1 = 0;
        for (let i = 0; i < DIM; i++) if ((i >> q) & 1) p1 += s[i].re * s[i].re + s[i].im * s[i].im;
        expect(p1, `${h.code} q${q} is idle`).toBeGreaterThan(0.02); // the Waterfall's last wire: 1/32
      }
      expect(fidelity(zeroState(), s), `${h.code} is |0…0⟩-close`).toBeLessThanOrEqual(0.5 + 1e-12);
      expect(evaluate(circuit([]), h).holedIn).toBe(false);
    }
  });

  it('asks for no phase in the easy round, and for one in every difficult hole', () => {
    for (const h of HOLES.filter((x) => x.round === 'easy')) {
      for (const o of outcomes(h)) expect(phaseIs(o.phase, 0), `${h.code} ${o.label}`).toBe(true);
    }
    for (const h of HOLES.filter((x) => x.round === 'difficult')) {
      const quarter = outcomes(h).some((o) => phaseIs(o.phase, 90) || phaseIs(o.phase, 270));
      expect(quarter, h.code).toBe(true);
    }
  });
});

describe('classic course v2 — par is the proven minimum + 2', () => {
  it('every reference solution holes in, uses only its round\'s clubs, and is par − 2 long', () => {
    for (const h of HOLES) {
      const gates = h.solution!.gates;
      expect(evaluate(h.solution!, h).holedIn, h.code).toBe(true);
      expect(gates.length, h.code).toBe(h.par - 2);
      const clubs = new Set<GateType>(clubGateTypes(h));
      for (const g of gates) expect(clubs.has(g.type), `${h.code} ${g.type}`).toBe(true);
    }
  });

  it('nothing shorter exists with the round\'s clubs (BFS over every wiring)', () => {
    for (const h of HOLES) {
      const it = optimalSearch(holeTargetState(h), clubGateTypes(h), h.qubits, { maxDepth: h.par - 3 });
      let step = it.next();
      while (!step.done) step = it.next();
      expect(step.value.status, `${h.code} (${h.name})`).toBe('minimal');
    }
  }, 120_000);
});

describe('classic course v2 — each round\'s new clubs are needed (#77)', () => {
  // M1 is exempt like on the random course: on one wire, Y is X·Z up to a
  // global phase, so no one-qubit target can need it. Its idea is the minus.
  const claimed = HOLES.filter((h) => h.round !== 'easy' && h.code !== 'M1');

  it('medium: the easy clubs need MORE strokes than par − 2 (BFS)', () => {
    for (const h of claimed.filter((x) => x.round === 'medium')) {
      const it = optimalSearch(holeTargetState(h), gateTypesForClubs(ROUND_CLUBS.easy), h.qubits, {
        maxDepth: h.par - 2,
      });
      let step = it.next();
      while (!step.done) step = it.next();
      expect(step.value.status, h.code).toBe('minimal');
    }
  }, 60_000);

  it('difficult: a quarter-turn phase the medium clubs can never make', () => {
    // X, H, CX are real matrices and Y is i times one, so every medium-club
    // state is REAL up to a global phase. Each difficult target is not.
    for (const h of claimed.filter((x) => x.round === 'difficult')) {
      const s = holeTargetState(h);
      const ref = s.find((a) => a.re * a.re + a.im * a.im > 1e-9)!;
      const m = Math.hypot(ref.re, ref.im);
      const imag = s.some((a) => Math.abs((a.im * ref.re - a.re * ref.im) / m) > 1e-6);
      expect(imag, h.code).toBe(true);
    }
    // And the search agrees where it is cheap (≤ 3 wires): unreachable.
    for (const h of claimed.filter((x) => x.round === 'difficult' && x.qubits <= 3)) {
      const it = optimalSearch(holeTargetState(h), gateTypesForClubs(ROUND_CLUBS.medium), h.qubits, {
        maxDepth: 12,
      });
      let step = it.next();
      while (!step.done) step = it.next();
      expect(step.value.status, h.code).toBe('minimal');
    }
  }, 60_000);

  it('extra: uneven odds no Clifford club (X, H, CX, Y, Z, S) can make', () => {
    // A stabiliser state spreads its probability EVENLY over its outcomes, and
    // the difficult clubs only ever make stabiliser states. Every extra target
    // is uneven.
    for (const h of claimed.filter((x) => x.round === 'extra')) {
      const probs = outcomes(h).map((o) => o.prob);
      expect(Math.max(...probs) - Math.min(...probs), h.code).toBeGreaterThan(0.05);
    }
    for (const h of claimed.filter((x) => x.round === 'extra' && x.qubits <= 3)) {
      const it = optimalSearch(holeTargetState(h), gateTypesForClubs(ROUND_CLUBS.difficult), h.qubits, {
        maxDepth: 12,
      });
      let step = it.next();
      while (!step.done) step = it.next();
      expect(step.value.status, h.code).toBe('minimal');
    }
  }, 60_000);

  it('the round below really is the one each hole out-builds', () => {
    for (const h of claimed) expect(ROUND_BELOW[h.round], h.code).not.toBeNull();
  });
});

describe('classic course v2 — the goal lines never contradict the target', () => {
  const langs = [
    ['en', en],
    ['de', de],
  ] as const;

  it('has an authored line for every hole in both languages, and no stray ones', () => {
    for (const [lang, t] of langs) {
      expect(Object.keys(t.golf.holeGoals).sort(), lang).toEqual(HOLES.map((h) => h.name).sort());
      for (const h of HOLES) {
        const line = t.golf.holeGoals[h.name];
        expect(line, `${lang} ${h.code}`).toMatch(lang === 'en' ? /^Goal: .+\.$/ : /^Ziel: .+\.$/);
        expect(line.length, `${lang} ${h.code} is long for one phone line`).toBeLessThanOrEqual(64);
      }
    }
  });

  it('every claim a line makes holds for the target', () => {
    for (const [lang, t] of langs) {
      for (const h of HOLES) {
        const line = t.golf.holeGoals[h.name];
        const where = `${lang} ${h.code}: ${line}`;
        const outs = outcomes(h);
        const labels = new Set(outs.map((o) => o.label));
        // Every bitstring named is an outcome.
        for (const bits of line.match(/\b[01]{2,}\b/g) ?? []) {
          if (bits.length === h.qubits) expect(labels.has(bits), where).toBe(true);
        }
        // Every percentage is an outcome's probability.
        if (line.includes('%')) {
          const nums = (line.match(/\d+(?:[.,]\d+)?/g) ?? [])
            .filter((n) => !(/^[01]+$/.test(n) && n.length === h.qubits))
            .map((n) => Number(n.replace(',', '.')));
          expect(nums.length, where).toBeGreaterThan(0);
          for (const n of nums) expect(outs.some((o) => Math.abs(o.prob * 100 - n) < 0.6), `${where} (${n} %)`).toBe(true);
        }
        // "50/50" is a fair coin on one wire.
        if (line.includes('50/50')) {
          expect(h.qubits, where).toBe(1);
          expect(outs.map((o) => o.prob), where).toEqual([0.5, 0.5].map((p) => expect.closeTo(p, 9)));
        }
        // A minus is a half-turn somewhere; a quarter / three-quarter turn likewise.
        if (/minus|Minus|−1/.test(line)) expect(outs.some((o) => phaseIs(o.phase, 180)), where).toBe(true);
        if (/quarter|Viertel/.test(line) && !/three-quarter|Dreiviertel/.test(line)) {
          expect(outs.some((o) => phaseIs(o.phase, 90)), where).toBe(true);
        }
        if (/three-quarter|Dreiviertel/.test(line)) expect(outs.some((o) => phaseIs(o.phase, 270)), where).toBe(true);
        if (/phase|Phase/.test(line)) expect(outs.some((o) => !phaseIs(o.phase, 0)), where).toBe(true);
        // Entanglement words against the state itself.
        if (/no entanglement|ohne Verschränkung|free coins|freie Münzen/.test(line)) {
          expect(isProduct(h), where).toBe(true);
        } else if (/entangle|verschränk|pair|Paar|couple|Pärchen|singlet|Singulett|disagree|verschieden|against|gegen/.test(line)) {
          expect(isProduct(h), where).toBe(false);
        }
        if (/always agree|immer übereinstimmen/.test(line)) {
          for (const o of outs) expect(/^(0+|1+)$/.test(o.label), where).toBe(true);
        }
        if (/always disagree|immer verschieden/.test(line)) {
          for (const o of outs) expect(/^(0+|1+)$/.test(o.label), where).toBe(false);
        }
        if (/sure 1|sichere 1/.test(line)) {
          const s = holeTargetState(h);
          const sure = Array.from({ length: h.qubits }, (_, q) => q).some((q) =>
            s.every((a, i) => ((i >> q) & 1) === 1 || a.re * a.re + a.im * a.im < 1e-12),
          );
          expect(sure, where).toBe(true);
        }
        // "like E1" / "as E4": the same odds as that hole, but not the same state.
        for (const ref of line.match(/\b[EMDX][1-5]\b/g) ?? []) {
          const other = byCode(ref);
          const p = (x: Hole) => outcomes(x).map((o) => o.prob.toFixed(9)).sort();
          expect(p(other), where).toEqual(p(h));
          expect(fidelity(holeTargetState(other), holeTargetState(h)), where).toBeLessThan(0.99);
        }
        // A club named on its own ("try Y", "(S)", "H is …") is in the round and in the answer.
        for (const club of line.match(/\b[HXYZST]\b/g) ?? []) {
          expect(h.clubs, where).toContain(club);
          expect(h.solution!.gates.some((g) => g.type === club), where).toBe(true);
        }
        // A wire count named outright is the hole's.
        const count = /\ball (\d)\b|\balle (\d)\b/.exec(line);
        if (count) expect(Number(count[1] ?? count[2]), where).toBe(h.qubits);
      }
    }
  });
});

describe('classic course v2 — every hole is buildable from the booth kit', () => {
  it('reads the kit and the mat from assets.toml', () => {
    expect(KIT).toMatchObject({ H: 5, X: 5, Y: 2, Z: 2, S: 2, T: 2, CNOT_control: 4 });
    expect(BOARD.rows).toBe(5);
    expect(BOARD.cols).toBe(8);
  });

  it('lays the shortest solution AND a par-length one with the tiles there are', () => {
    for (const h of HOLES) {
      const gates = h.solution!.gates;
      expect(kitHas(tilesOf(gates)), `${h.code} shortest: ${JSON.stringify(tilesOf(gates))}`).toBe(true);
      expect(columnsOf(gates), `${h.code} columns`).toBeLessThanOrEqual(BOARD.cols);
      const par = parLength(h);
      expect(par, `${h.code} has no par-length layout`).not.toBeNull();
      expect(par!.length).toBe(h.par);
      expect(kitHas(tilesOf(par!)), h.code).toBe(true);
      expect(evaluate(circuit(par!), h).holedIn, h.code).toBe(true);
      // The pad cancels: the par-length board prepares the very same state.
      expect(fidelity(statevector(circuit(par!)), statevector(h.solution!)), h.code).toBeGreaterThan(1 - 1e-9);
    }
  });
});
