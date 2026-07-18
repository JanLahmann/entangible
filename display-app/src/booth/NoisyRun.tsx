/**
 * Optional "Run on a noisy simulator" control (docs/booth-ux.md → Optional
 * noisy Run). Staff-only by intent: small, corner-placed, mouse-operated.
 *
 * - Polls `/api/health` every 10 s; the control only appears when
 *   `backend.healthy` is true (hidden entirely at a backend-less booth).
 * - On click it runs the circuit on a noisy fake backend via `qiskitAdapter`
 *   (baseUrl `/qamposer-api`, profile `noisy_fake`) and renders ideal (computed
 *   locally from the statevector, Carbon blue #0f62fe) vs noisy (from the
 *   backend, gray #8d8d8d) side-by-side bars.
 * - Auto-reverts to ideal-only on the next circuit change.
 * - Graceful: any error hides the control and logs `console.warn` — never
 *   throws into the booth view.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { qiskitAdapter, type Circuit, type CircuitRequest } from '@qamposer/react';
import { statevector, DIM } from '../quantum/statevector';

const BACKEND_BASE = '/qamposer-api';
const HEALTH_URL = '/api/health';
const POLL_MS = 10_000;
const SHOTS = 1024;
const IDEAL_COLOR = '#0f62fe';
const NOISY_COLOR = '#8d8d8d';

interface BarRow {
  state: string;
  ideal: number;
  noisy: number;
}

/** Local ideal probabilities keyed by 5-bit big-endian (q4…q0) strings. */
function idealProbs(circuit: Circuit): Map<string, number> {
  const sv = statevector(circuit);
  const m = new Map<string, number>();
  for (let i = 0; i < DIM; i++) {
    const p = sv[i].re * sv[i].re + sv[i].im * sv[i].im;
    if (p > 1e-9) m.set(i.toString(2).padStart(5, '0'), p);
  }
  return m;
}

function normalizeCounts(counts: Record<string, number>): Map<string, number> {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const m = new Map<string, number>();
  for (const [state, n] of Object.entries(counts)) {
    m.set(state.padStart(5, '0'), n / total);
  }
  return m;
}

export function NoisyRun({
  circuit,
  onMessage,
}: {
  circuit: Circuit;
  onMessage: (text: string) => void;
}) {
  const [healthy, setHealthy] = useState(false);
  const backendNameRef = useRef<string | null>(null);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<BarRow[] | null>(null);

  const adapter = useMemo(() => qiskitAdapter({ baseUrl: BACKEND_BASE }), []);

  // Poll backend health.
  useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        const resp = await fetch(HEALTH_URL, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`health ${resp.status}`);
        const data = (await resp.json()) as { backend?: { healthy?: boolean } };
        if (!cancelled) setHealthy(Boolean(data.backend?.healthy));
      } catch (err) {
        if (!cancelled) setHealthy(false);
        console.warn('[NoisyRun] health probe failed:', err);
      }
    }
    probe();
    const id = window.setInterval(probe, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Auto-revert to ideal-only whenever the circuit changes.
  useEffect(() => {
    setRows(null);
  }, [circuit]);

  async function resolveBackendName(): Promise<string> {
    if (backendNameRef.current) return backendNameRef.current;
    try {
      const resp = await fetch(`${BACKEND_BASE}/api/circuit/backends`, { cache: 'no-store' });
      if (resp.ok) {
        const list = (await resp.json()) as Array<{ id: string; backend_type: string }>;
        const noisy = list.find((b) => b.backend_type === 'noisy_fake');
        if (noisy) {
          backendNameRef.current = noisy.id;
          return noisy.id;
        }
      }
    } catch (err) {
      console.warn('[NoisyRun] backend list failed, falling back:', err);
    }
    backendNameRef.current = 'fake_manila';
    return 'fake_manila';
  }

  async function run() {
    if (running || circuit.gates.length === 0) return;
    setRunning(true);
    try {
      const backendName = await resolveBackendName();
      const request: CircuitRequest = {
        qubits: 5,
        gates: circuit.gates.map(({ id: _id, ...g }) => g),
        shots: SHOTS,
        profile: { type: 'noisy_fake', backend_name: backendName },
      };
      const result = await adapter.simulate(request);
      const ideal = idealProbs(circuit);
      const noisy = normalizeCounts(result.counts);
      const states = new Set<string>([...ideal.keys(), ...noisy.keys()]);
      const merged: BarRow[] = [...states]
        .map((state) => ({ state, ideal: ideal.get(state) ?? 0, noisy: noisy.get(state) ?? 0 }))
        .filter((r) => r.ideal > 0.005 || r.noisy > 0.005)
        .sort((a, b) => b.ideal - a.ideal || b.noisy - a.noisy)
        .slice(0, 8);
      setRows(merged);
      onMessage('Real quantum computers are noisy — see the difference');
    } catch (err) {
      console.warn('[NoisyRun] simulation failed:', err);
      setHealthy(false);
      setRows(null);
    } finally {
      setRunning(false);
    }
  }

  if (!healthy) return null;

  return (
    <div className="ent-noisy">
      <button className="ent-noisy__btn" type="button" onClick={run} disabled={running}>
        {running ? 'Running…' : 'Run on a noisy simulator'}
      </button>

      {rows && rows.length > 0 && (
        <div className="ent-noisy__panel">
          <div className="ent-noisy__legend">
            <span><i style={{ background: IDEAL_COLOR }} /> ideal</span>
            <span><i style={{ background: NOISY_COLOR }} /> noisy</span>
          </div>
          <div className="ent-noisy__bars">
            {rows.map((r) => (
              <div className="ent-noisy__row" key={r.state}>
                <div className="ent-noisy__pair">
                  <span
                    className="ent-noisy__bar"
                    style={{ height: `${Math.round(r.ideal * 100)}%`, background: IDEAL_COLOR }}
                    title={`ideal ${(r.ideal * 100).toFixed(1)}%`}
                  />
                  <span
                    className="ent-noisy__bar"
                    style={{ height: `${Math.round(r.noisy * 100)}%`, background: NOISY_COLOR }}
                    title={`noisy ${(r.noisy * 100).toFixed(1)}%`}
                  />
                </div>
                <div className="ent-noisy__label">{r.state}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default NoisyRun;
