/**
 * Ideal probability histogram, computed locally from the 5-qubit statevector.
 *
 * The spec's layout puts the circuit on the left (~62 %) and the histogram on
 * the right (~38 %). The composer's own results panel (`ResultsPanel`) lives in
 * a separate bundle with its own React context, so it can't share the booth's
 * `QamposerProvider`; rather than fight the packaging we render our own bars in
 * Carbon blue from the exact statevector — instant, dependency-free, and always
 * in sync with the moment engine.
 */
import { useMemo } from 'react';
import type { Circuit } from '@qamposer/react';
import { DIM, NUM_QUBITS, statevector } from '../quantum/statevector';

const CARBON_BLUE = '#0f62fe';
const MIN_PROB = 0.001;

interface Bar {
  state: string;
  prob: number;
}

export function Histogram({ circuit }: { circuit: Circuit }) {
  const bars = useMemo<Bar[]>(() => {
    const sv = statevector(circuit);
    const out: Bar[] = [];
    for (let i = 0; i < DIM; i++) {
      const p = sv[i].re * sv[i].re + sv[i].im * sv[i].im;
      if (p > MIN_PROB) out.push({ state: i.toString(2).padStart(NUM_QUBITS, '0'), prob: p });
    }
    return out;
  }, [circuit]);

  const max = bars.reduce((m, b) => Math.max(m, b.prob), 0) || 1;
  const empty = circuit.gates.length === 0;

  return (
    <div className="ent-histo">
      <div className="ent-histo__title">Probabilities</div>
      <div className="ent-histo__plot" data-count={bars.length}>
        {bars.map((b) => (
          <div className="ent-histo__col" key={b.state} title={`${b.state}: ${(b.prob * 100).toFixed(1)}%`}>
            <div className="ent-histo__bar-wrap">
              <div
                className="ent-histo__bar"
                style={{ height: `${(b.prob / max) * 100}%`, background: CARBON_BLUE }}
              />
            </div>
            <div className="ent-histo__label">{b.state}</div>
          </div>
        ))}
        {empty && <div className="ent-histo__hint">Place a tile to see outcomes</div>}
      </div>
    </div>
  );
}

export default Histogram;
