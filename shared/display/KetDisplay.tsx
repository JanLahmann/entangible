/**
 * KetDisplay — the live state in bra-ket notation (task #59).
 *
 * Renders the current statevector as `1/√2|00⟩ + 1/√2|11⟩`, sitting directly
 * under the golf evolution view so the MATH moves with the balls: fed the same
 * ANIMATED interpolated statevector `EvolvingState` gives the Q-sphere, every
 * frame of the roll-the-ball travel (#57) is mirrored here.
 *
 * Conventions — all shared with the sphere so the two never disagree:
 *   - Phases are RELATIVE to the reference amplitude (the first populated basis
 *     state in index order), exactly as `basisVisuals` colours the nodes. That
 *     is why this is reused verbatim rather than re-derived: a global phase can
 *     never leak into the notation, so a Bell state always reads
 *     `1/√2|00⟩ + 1/√2|11⟩` and never a phase-decorated variant of it.
 *   - Kets are MSB-first bitstrings (`index.toString(2).padStart(n, '0')`), the
 *     same labels the Q-sphere nodes and the histogram counts keys carry.
 *
 * Terms are shown in ASCENDING BASIS-INDEX order (#66) — the textbook reading
 * `|00⟩ + |11⟩`, stable as the animation moves amplitudes around. Truncation is
 * still by SIZE: the `maxTerms` largest-probability terms survive (ties broken by
 * ascending index, on probabilities quantized to `TIE_EPS` so float noise cannot
 * reshuffle them), and only then are the survivors put back in index order — a
 * negligible term can never evict a dominant one. A cut list gets a trailing
 * `+ ⋯`, so a spread-out state stays one readable line on a phone.
 *
 * Magnitudes typeset as EXACT fractions where one applies (`magnitudeLabel`):
 * golf states are built from H/X/Y/Z/S/T/CH, so `1/√2`, `1/2`, `1/(2√2)` and the
 * `√3/2` family cover the real cases and read as the math rather than as 0.71.
 * Anything off the table falls back to two decimals.
 *
 * Structural only — `${classPrefix}-ket*` classes, styled by the pocket (`pk-`)
 * and booth (`bo-`) skins.
 */
import { basisVisuals } from '@quantum/qsphere';
import type { StateVector } from '@quantum/statevector';

/** Phase tolerance (radians) for snapping to 0 / π / ±π/2. */
const PHASE_TOL = 0.01;
/** Magnitude tolerance for treating a coefficient as exactly 1. */
const MAG_TOL = 0.005;
/**
 * Probabilities are quantized to this before sorting, so amplitudes that are
 * equal in theory but differ by float noise (a purified Bloch state, an
 * interpolated frame) keep a STABLE index-order tie-break instead of swapping
 * places mid-animation. Quantizing (rather than an epsilon comparator) keeps the
 * ordering a proper total order.
 */
const TIE_EPS = 1e-9;

const MINUS = '−'; // U+2212 MINUS SIGN (not a hyphen)

/** How close a magnitude must be to a table value to be typeset as that exact form. */
const FRACTION_TOL = 1e-4;

/**
 * The exact magnitudes worth a closed form, most-common first. Deliberately
 * SHORT: every entry here is a magnitude the physical gate set (H/X/Y/Z/S/T/CH)
 * actually produces, so a match is evidence of real structure rather than a
 * coincidence of rounding. Everything else stays a decimal.
 */
const EXACT_MAGNITUDES: ReadonlyArray<readonly [number, string]> = [
  [1, ''], // a bare coefficient: |010⟩, not 1.00|010⟩
  [Math.SQRT1_2, '1/√2'], // H
  [0.5, '1/2'], // H·H on two wires, √3/2's partner
  [Math.sqrt(3) / 2, '√3/2'],
  [1 / Math.sqrt(3), '1/√3'],
  [1 / (2 * Math.SQRT2), '1/(2√2)'], // uniform over 8
  [1 / Math.sqrt(5), '1/√5'],
  [2 / Math.sqrt(5), '2/√5'],
];

/**
 * Magnitude as display text: an exact fraction when one is within `FRACTION_TOL`,
 * otherwise two decimals. `1` maps to the empty string — a unit coefficient is
 * written by leaving it out. Exported for direct unit testing.
 */
export function magnitudeLabel(m: number): string {
  for (const [value, label] of EXACT_MAGNITUDES) {
    if (Math.abs(m - value) <= FRACTION_TOL) return label;
  }
  return m.toFixed(2);
}

export interface KetDisplayProps {
  /** The state to typeset — the ANIMATED statevector when driven by EvolvingState. */
  statevector: StateVector;
  /** Qubit count of the displayed space (ket width). */
  n: number;
  /** CSS class prefix, e.g. 'pk' or 'bo'. */
  classPrefix: string;
  /** Maximum terms shown before eliding with `+ ⋯`. */
  maxTerms?: number;
  /** Below this probability a basis state is not a term. */
  minProb?: number;
}

/** One typeset term: the join operator, the coefficient, and the ket. */
interface Term {
  index: number;
  /** Leading operator — '' for a positive first term, '+ ' / '− ' otherwise. */
  op: string;
  /** Magnitude text — exact fraction or two decimals, '' for a bare 1. */
  coef: string;
  /** Imaginary unit suffix, '' or 'i'. */
  unit: string;
  /** Exponent (`<sup>`) text for the general-phase form, else null. */
  exponent: string | null;
  ket: string;
}

/** Normalise a [0, 360) degree phase to radians in (−π, π]. */
function signedRadians(phaseDeg: number): number {
  const deg = phaseDeg > 180 ? phaseDeg - 360 : phaseDeg;
  return (deg * Math.PI) / 180;
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** π-fraction exponent text, e.g. 0.7854 → `i0.25π`, −0.7854 → `−i0.25π`. */
function exponentText(phase: number): string {
  const frac = phase / Math.PI;
  const sign = frac < 0 ? MINUS : '';
  return `${sign}i${Math.abs(frac).toFixed(2)}π`;
}

/**
 * The terms of `statevector` in display order, plus whether the list was cut
 * short. Exported for tests / reuse; pure, no React.
 */
export function ketTerms(
  statevector: StateVector,
  n: number,
  maxTerms = 6,
  minProb = 0.005,
): { terms: Term[]; truncated: boolean } {
  const count = Math.min(1 << n, statevector.length);
  // Reference-relative phases, identical to what the Q-sphere colours by.
  const visuals = basisVisuals(statevector, count).filter((v) => v.prob > minProb);
  // Select by SIZE (so the cut drops the least significant terms)…
  const rank = (p: number) => Math.round(p / TIE_EPS);
  visuals.sort((a, b) => rank(b.prob) - rank(a.prob) || a.index - b.index);
  const truncated = visuals.length > maxTerms;
  // …then read out in INDEX order, the way the state is written down.
  const shown = visuals.slice(0, maxTerms).sort((a, b) => a.index - b.index);

  const terms = shown.map((v, i) => {
    const mag = Math.sqrt(v.prob);
    const phase = signedRadians(v.phaseDeg);
    const abs = Math.abs(phase);

    let negative = false;
    let unit = '';
    let exponent: string | null = null;
    if (near(abs, 0, PHASE_TOL)) {
      // positive real
    } else if (near(abs, Math.PI, PHASE_TOL)) {
      negative = true;
    } else if (near(abs, Math.PI / 2, PHASE_TOL)) {
      unit = 'i';
      negative = phase < 0;
    } else {
      exponent = exponentText(phase);
    }

    // A lone populated basis state carries no reference-relative phase, so an
    // amplitude of magnitude 1 always typesets as the bare ket |010⟩.
    const bare = exponent === null && !unit && !negative && near(mag, 1, MAG_TOL);
    const op = i === 0 ? (negative ? `${MINUS} ` : '') : negative ? ` ${MINUS} ` : ' + ';
    return {
      index: v.index,
      op,
      coef: bare ? '' : magnitudeLabel(mag),
      unit,
      exponent,
      ket: `|${v.index.toString(2).padStart(n, '0')}⟩`,
    };
  });
  return { terms, truncated };
}

export function KetDisplay({
  statevector,
  n,
  classPrefix,
  maxTerms = 6,
  minProb = 0.005,
}: KetDisplayProps) {
  const p = classPrefix;
  const { terms, truncated } = ketTerms(statevector, n, maxTerms, minProb);
  // A zero / empty state has nothing to say — render nothing at all.
  if (terms.length === 0) return null;

  return (
    <div className={`${p}-ket`} aria-label="Current state in bra-ket notation">
      {terms.map((t) => (
        <span key={t.index} className={`${p}-ket-term`}>
          {t.op}
          <span className={`${p}-ket-coef`}>
            {t.coef}
            {t.exponent !== null && (
              <>
                e<sup>{t.exponent}</sup>
              </>
            )}
            {t.unit}
          </span>
          {t.ket}
        </span>
      ))}
      {truncated && <span className={`${p}-ket-more`}> + ⋯</span>}
    </div>
  );
}

export default KetDisplay;
