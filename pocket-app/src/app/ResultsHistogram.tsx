/**
 * RESULTS panel — column bars with vertical bit-stack labels, zero states
 * hidden. The chart logic is ported verbatim from the booth's
 * `display-app/src/booth/Histogram.tsx` (final form per docs/booth-ux.md); only
 * the class names differ (`pk-` prefix) so Pocket keeps its own stylesheet.
 * Probabilities come from the shared local statevector (imported, not copied).
 */
import { useMemo } from 'react';
import type { Circuit } from '@qamposer/react';
import { activeQubits, DIM, NUM_QUBITS, statevector } from '@quantum/statevector';

const TOP_N = 6;
const ZERO_EPS = 0.001;
const UNIFORM_EPS = 0.004;
const MAX_PLAIN = 8;

interface Outcome {
  bits: string;
  prob: number;
}

function reducedOutcomes(circuit: Circuit, active: number[]): Outcome[] {
  const sv = statevector(circuit);
  const k = active.length;
  const probs = new Array<number>(1 << k).fill(0);
  for (let i = 0; i < DIM; i++) {
    const p = sv[i].re * sv[i].re + sv[i].im * sv[i].im;
    if (p === 0) continue;
    let idx = 0;
    for (let b = 0; b < k; b++) {
      idx = (idx << 1) | ((i >> (NUM_QUBITS - 1 - active[b])) & 1);
    }
    probs[idx] += p;
  }
  return probs.map((prob, idx) => ({ bits: idx.toString(2).padStart(k, '0'), prob }));
}

function BitStack({ bits }: { bits: string }) {
  return (
    <span className="pk-h-stack" aria-label={bits}>
      {bits.split('').map((b, i) => (
        <span key={i}>{b}</span>
      ))}
    </span>
  );
}

function Guide({ active }: { active: number[] }) {
  return (
    <span className="pk-h-guide" aria-hidden="true">
      {active.map((q) => (
        <span key={q}>q{q}</span>
      ))}
    </span>
  );
}

export function ResultsHistogram({ circuit }: { circuit: Circuit }) {
  const active = useMemo(() => activeQubits(circuit), [circuit]);
  const outcomes = useMemo(
    () => (active.length === 0 ? [] : reducedOutcomes(circuit, active)),
    [circuit, active],
  );

  if (active.length === 0) {
    return (
      <div>
        <div className="pk-label">Results</div>
        <div className="pk-well">
          <div className="pk-h-empty">Place a tile to see outcomes</div>
        </div>
      </div>
    );
  }

  const total = outcomes.length;
  const nonzero = outcomes.filter((o) => o.prob > ZERO_EPS);
  const max = nonzero.reduce((m, o) => Math.max(m, o.prob), 0) || 1;

  const isUniform =
    nonzero.length === total &&
    total > MAX_PLAIN &&
    nonzero.every((o) => Math.abs(o.prob - 1 / total) < UNIFORM_EPS);

  if (isUniform) {
    return (
      <div>
        <div className="pk-label">Results · {total} outcomes</div>
        <div className="pk-well">
          <div className="pk-h-plot is-micro">
            {outcomes.map((o) => (
              <div className="pk-h-col" key={o.bits}>
                <div className="pk-h-bar" style={{ height: '36%' }} />
              </div>
            ))}
          </div>
          <div className="pk-h-note">
            all outcomes ≈ {(100 / total).toFixed(1)}% — {total} equally likely
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
      <div className="pk-label">
        {nonzero.length > MAX_PLAIN
          ? `Results · top ${shown.length} of ${nonzero.length}`
          : `Results · ${shown.length} of ${total} outcomes`}
      </div>
      <div className="pk-well">
        <div className="pk-h-plot">
          <Guide active={active} />
          {shown.map((o) => (
            <div
              className="pk-h-col"
              key={o.bits}
              title={`${o.bits}: ${(o.prob * 100).toFixed(1)}%`}
            >
              <span className="pk-h-pct">{o.prob >= 0.05 ? `${Math.round(o.prob * 100)}%` : ''}</span>
              <div className="pk-h-bar" style={{ height: `${(o.prob / max) * 72}%` }} />
              <BitStack bits={o.bits} />
            </div>
          ))}
        </div>
        {tail.length > 0 && (
          <div className="pk-h-tail">
            + {tail.length} more outcomes ≤ {(tail[0].prob * 100).toFixed(1)}% each
          </div>
        )}
      </div>
    </div>
  );
}

export default ResultsHistogram;
