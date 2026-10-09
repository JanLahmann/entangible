/**
 * RESULTS panel — column bars with vertical bit-stack labels (SC2 shared).
 *
 * Serves both the booth (`bo-` classes) and pocket (`pk-` classes) via the
 * `classPrefix` seam; the chart math is the shared booth/Pocket rule
 * (`@shared/display/outcomes`). Probabilities come from the local statevector
 * (ideal). Columns carry `data-bits`/`data-prob` so a touch-to-inspect layer
 * can read an outcome.
 *
 * The outcome space is the DISPLAYED qubit count `D` (rows 0..D-1), following
 * the wire-trim setting, NOT the active subset. The recognized circuit is always
 * five physical qubits; the wire-trim transform guarantees no gate touches a row
 * >= D, so marginalizing the remaining |0⟩ rows is exact. Bit order: leftmost
 * stack bit = q0 (top wire).
 *
 *   - D = 3 (compact default): a FIXED 8-column axis, basis order 000..111,
 *     zero-probability columns kept as dim stubs (never hidden) so visitors
 *     watch probability move between fixed columns as tiles change.
 *   - D = 4 / 5: zero states hidden, > 8 nonzero → sorted top-6 + tail, a
 *     uniform spread → the compact micro pattern + callout.
 *
 * Paired (ideal + noisy) mode — OPTIONAL, opt-in via the `noisy` prop (a raw
 * physical probability vector from `@quantum/noise`'s `noisyProbabilities`, same
 * basis ordering as the statevector). Each outcome then renders a paired bar:
 * the ideal probability (solid, current styling) beside the noisy one (hatched,
 * `${prefix}-h-bar--noisy`). The displayed set is the UNION of ideal outcomes
 * above `ZERO_EPS` and noisy outcomes above `NOISY_EPS`, so a noisy-only leakage
 * outcome (a GHZ near-miss, a readout flip) — the whole pedagogic point —
 * surfaces even where the ideal peak is zero. Without the prop nothing below
 * changes (backwards compatible).
 *
 * Two behavioural seams parametrize a small pre-SC2 drift between the apps
 * (kept, not silently normalized — see the SC2 report):
 *   - `microColData`: whether the uniform-superposition micro columns carry
 *     `data-bits`/`data-prob` (pocket did; the booth did not).
 *   - `uniformSuffix`: text appended after "equally likely" in the uniform
 *     note (the booth appended " possibilities"; pocket did not).
 */
import { useMemo } from 'react';
import type { Circuit } from '@qamposer/react';
import { activeQubits } from '@quantum/statevector';
import { useT } from '@shared/i18n';
import {
  displayOutcomes,
  outcomesFromProbabilities,
  TOP_N,
  ZERO_EPS,
  NOISY_EPS,
  PAIRED_TOP_N,
  UNIFORM_EPS,
  MAX_PLAIN,
  type Outcome,
} from '@shared/display/outcomes';

function BitStack({ bits, classPrefix }: { bits: string; classPrefix: string }) {
  return (
    <span className={`${classPrefix}-h-stack`} aria-label={bits}>
      {bits.split('').map((b, i) => (
        <span key={i}>{b}</span>
      ))}
    </span>
  );
}

function Guide({ rows, classPrefix }: { rows: number[]; classPrefix: string }) {
  return (
    <span className={`${classPrefix}-h-guide`} aria-hidden="true">
      {rows.map((q) => (
        <span key={q}>q{q}</span>
      ))}
    </span>
  );
}

/** Legend shown only in paired mode; label text is prop-driven for localization. */
function Legend({
  classPrefix,
  idealLabel,
  noisyLabel,
}: {
  classPrefix: string;
  idealLabel: string;
  noisyLabel: string;
}) {
  const p = classPrefix;
  return (
    <div className={`${p}-h-legend`}>
      <span className={`${p}-h-legend-item`}>
        <span className={`${p}-h-swatch`} aria-hidden="true" />
        {idealLabel}
      </span>
      <span className={`${p}-h-legend-item`}>
        <span className={`${p}-h-swatch ${p}-h-swatch--noisy`} aria-hidden="true" />
        {noisyLabel}
      </span>
    </div>
  );
}

/**
 * The ideal + noisy bar pair for one column. The wrapper occupies exactly the
 * vertical space a single bar of `max(ideal, noisy)` would (so the surrounding
 * column layout is identical to single-series mode); the two bars then fill it
 * proportionally, bottom-aligned.
 */
function PairedBars({
  classPrefix,
  ideal,
  noisy,
  scale,
}: {
  classPrefix: string;
  ideal: number;
  noisy: number;
  /** Largest paired value across the shown columns — the 72% full-height ref. */
  scale: number;
}) {
  const p = classPrefix;
  const top = Math.max(ideal, noisy);
  const height = scale > 0 ? `${(top / scale) * 72}%` : '0%';
  const inner = (v: number) => (top > 0 ? `${(v / top) * 100}%` : '0%');
  return (
    <div className={`${p}-h-pair`} style={{ height }}>
      <div className={`${p}-h-bar`} style={{ height: inner(ideal) }} />
      <div className={`${p}-h-bar ${p}-h-bar--noisy`} style={{ height: inner(noisy) }} />
    </div>
  );
}

/** A paired outcome: same bits, an ideal probability and a noisy one. */
interface PairedOutcome {
  bits: string;
  ideal: number;
  noisy: number;
}

export function Histogram({
  circuit,
  displayQubits,
  classPrefix,
  microColData = false,
  uniformSuffix = '',
  noisy,
  idealLabel: idealProp,
  noisyLabel: noisyProp,
}: {
  circuit: Circuit;
  displayQubits: number;
  classPrefix: string;
  microColData?: boolean;
  uniformSuffix?: string;
  /**
   * OPTIONAL noisy series: a raw physical probability vector (length 2^physical
   * qubits, statevector basis ordering) — pass `noisyProbabilities(circuit,
   * params)`. Present → paired bars + a legend; absent → the ideal-only chart is
   * byte-for-byte unchanged.
   */
  noisy?: readonly number[];
  /** Legend label for the ideal series (paired mode only). */
  idealLabel?: string;
  /** Legend label for the noisy series (paired mode only). */
  noisyLabel?: string;
}) {
  const p = classPrefix;
  const t = useT().histogram;
  // Legend labels default to the active language's ("ideal" / "with noise").
  const idealLabel = idealProp ?? t.ideal;
  const noisyLabel = noisyProp ?? t.withNoise;
  const D = displayQubits;
  const outcomes = useMemo(() => displayOutcomes(circuit, D), [circuit, D]);
  const rows = useMemo(() => Array.from({ length: D }, (_, r) => r), [D]);
  const noisyOutcomes = useMemo(
    () => (noisy ? outcomesFromProbabilities(noisy, D) : null),
    [noisy, D],
  );
  const paired = noisyOutcomes !== null;

  // D = 3: fixed 8-column axis; zero columns are dim stubs, never hidden.
  if (D === 3) {
    // A column is a dim stub only when BOTH series are ~zero there — a noisy-only
    // leakage column stays lit so its error bar is visible.
    const noisyAt = (bits: string) => noisyOutcomes!.find((o) => o.bits === bits)?.prob ?? 0;
    const max =
      outcomes.reduce(
        (m, o) => Math.max(m, o.prob, paired ? noisyAt(o.bits) : 0),
        0,
      ) || 1;
    return (
      <div>
        <div className={`${p}-label`}>{t.eightOutcomes}</div>
        <div className={`${p}-well`}>
          <div className={`${p}-h-plot`}>
            <Guide rows={rows} classPrefix={p} />
            {outcomes.map((o) => {
              const ni = paired ? noisyAt(o.bits) : 0;
              const dim = o.prob <= ZERO_EPS && ni <= ZERO_EPS;
              return (
                <div
                  className={`${p}-h-col ${dim ? 'is-dim' : ''}`}
                  key={o.bits}
                  data-bits={o.bits}
                  data-prob={o.prob}
                  title={
                    paired
                      ? `${o.bits}: ${idealLabel} ${(o.prob * 100).toFixed(1)}% · ${noisyLabel} ${(ni * 100).toFixed(1)}%`
                      : `${o.bits}: ${(o.prob * 100).toFixed(1)}%`
                  }
                >
                  <span className={`${p}-h-pct`}>
                    {o.prob >= 0.05 ? `${Math.round(o.prob * 100)}%` : ''}
                  </span>
                  {paired ? (
                    <PairedBars classPrefix={p} ideal={o.prob} noisy={ni} scale={max} />
                  ) : (
                    <div
                      className={`${p}-h-bar`}
                      style={{ height: dim ? '2px' : `${(o.prob / max) * 72}%` }}
                    />
                  )}
                  <BitStack bits={o.bits} classPrefix={p} />
                </div>
              );
            })}
          </div>
          {paired && (
            <Legend classPrefix={p} idealLabel={idealLabel} noisyLabel={noisyLabel} />
          )}
        </div>
      </div>
    );
  }

  // D >= 4: booth strategy over the D-qubit outcome list. An empty board shows
  // the placeholder — UNLESS a noisy series is on, where even an identity circuit
  // leaks (readout flips) and that leakage is exactly what we want to show.
  const active = activeQubits(circuit);
  if (active.length === 0 && !paired) {
    return (
      <div>
        <div className={`${p}-label`}>{t.results}</div>
        <div className={`${p}-well`}>
          <div className={`${p}-h-empty`}>{t.placeTile}</div>
        </div>
      </div>
    );
  }

  // ----- Paired (ideal + noisy) union path -----
  if (paired) {
    const merged: PairedOutcome[] = outcomes.map((o, i) => ({
      bits: o.bits,
      ideal: o.prob,
      noisy: noisyOutcomes![i].prob,
    }));
    // Union: keep an outcome if EITHER series clears its floor (the noisy floor
    // is deliberately low — leakage is the lesson), then rank by the taller bar.
    const sig = merged
      .filter((m) => m.ideal > ZERO_EPS || m.noisy > NOISY_EPS)
      .sort((a, b) => Math.max(b.ideal, b.noisy) - Math.max(a.ideal, a.noisy));
    const shown = sig.slice(0, PAIRED_TOP_N);
    const tail = sig.slice(PAIRED_TOP_N);
    const max = shown.reduce((m, x) => Math.max(m, x.ideal, x.noisy), 0) || 1;
    return (
      <div>
        <div className={`${p}-label`}>
          {tail.length > 0 ? t.top(shown.length) : t.outcomes(shown.length)}
        </div>
        <div className={`${p}-well`}>
          <div className={`${p}-h-plot`}>
            <Guide rows={rows} classPrefix={p} />
            {shown.map((o) => (
              <div
                className={`${p}-h-col`}
                key={o.bits}
                data-bits={o.bits}
                data-prob={o.ideal}
                title={`${o.bits}: ${idealLabel} ${(o.ideal * 100).toFixed(1)}% · ${noisyLabel} ${(o.noisy * 100).toFixed(1)}%`}
              >
                <span className={`${p}-h-pct`}>
                  {o.ideal >= 0.05 ? `${Math.round(o.ideal * 100)}%` : ''}
                </span>
                <PairedBars classPrefix={p} ideal={o.ideal} noisy={o.noisy} scale={max} />
                <BitStack bits={o.bits} classPrefix={p} />
              </div>
            ))}
          </div>
          {tail.length > 0 && (
            <div className={`${p}-h-tail`}>{t.more(tail.length)}</div>
          )}
          <Legend classPrefix={p} idealLabel={idealLabel} noisyLabel={noisyLabel} />
        </div>
      </div>
    );
  }

  const total = outcomes.length;
  const nonzero = outcomes.filter((o) => o.prob > ZERO_EPS);
  const max = nonzero.reduce((m, o) => Math.max(m, o.prob), 0) || 1;

  // Uniform superposition: a featured state, not a failed chart.
  const isUniform =
    nonzero.length === total &&
    total > MAX_PLAIN &&
    nonzero.every((o) => Math.abs(o.prob - 1 / total) < UNIFORM_EPS);

  if (isUniform) {
    return (
      <div>
        <div className={`${p}-label`}>{t.outcomes(total)}</div>
        <div className={`${p}-well`}>
          <div className={`${p}-h-plot is-micro`}>
            {outcomes.map((o) =>
              microColData ? (
                <div className={`${p}-h-col`} key={o.bits} data-bits={o.bits} data-prob={o.prob}>
                  <div className={`${p}-h-bar`} style={{ height: '36%' }} />
                </div>
              ) : (
                <div className={`${p}-h-col`} key={o.bits}>
                  <div className={`${p}-h-bar`} style={{ height: '36%' }} />
                </div>
              ),
            )}
          </div>
          <div className={`${p}-h-note`}>
            {t.uniform((100 / total).toFixed(1), total, uniformSuffix)}
          </div>
        </div>
      </div>
    );
  }

  let shown = nonzero;
  let tail: Outcome[] = [];
  if (nonzero.length > MAX_PLAIN) {
    const sorted = [...nonzero].sort((a, b) => b.prob - a.prob);
    shown = sorted.slice(0, TOP_N);
    tail = sorted.slice(TOP_N);
  }

  return (
    <div>
      <div className={`${p}-label`}>
        {nonzero.length > MAX_PLAIN
          ? t.topOf(shown.length, nonzero.length)
          : t.shownOf(shown.length, total)}
      </div>
      <div className={`${p}-well`}>
        <div className={`${p}-h-plot`}>
          <Guide rows={rows} classPrefix={p} />
          {shown.map((o) => (
            <div
              className={`${p}-h-col`}
              key={o.bits}
              data-bits={o.bits}
              data-prob={o.prob}
              title={`${o.bits}: ${(o.prob * 100).toFixed(1)}%`}
            >
              <span className={`${p}-h-pct`}>
                {o.prob >= 0.05 ? `${Math.round(o.prob * 100)}%` : ''}
              </span>
              <div className={`${p}-h-bar`} style={{ height: `${(o.prob / max) * 72}%` }} />
              <BitStack bits={o.bits} classPrefix={p} />
            </div>
          ))}
        </div>
        {tail.length > 0 && (
          <div className={`${p}-h-tail`}>
            {t.moreEach(tail.length, (tail[0].prob * 100).toFixed(1))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Histogram;
