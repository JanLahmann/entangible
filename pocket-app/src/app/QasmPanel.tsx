/**
 * OPENQASM panel — the last few QASM lines with gate-tinted colouring, ported
 * from the booth's QasmPanel (BoothView.tsx). Pocket generates the QASM locally
 * via `qasmForCircuit` (no server).
 */
import { useMemo } from 'react';
import type { Circuit } from '@qamposer/react';
import { qasmForCircuit } from './qasm';

/** QASM gate-line tint (gate colours at ~75% on the dark inset). */
const QASM_TINTS: ReadonlyArray<[RegExp, string]> = [
  [/^h /, 'rgba(250, 77, 86, 0.75)'],
  [/^(x|cx) /, 'rgba(94, 132, 235, 0.85)'],
  [/^(y|rx|ry)/, 'rgba(214, 82, 150, 0.8)'],
  [/^(z|rz|s |t )/, 'rgba(51, 177, 255, 0.75)'],
];

export function QasmPanel({ circuit }: { circuit: Circuit }) {
  const lines = useMemo(() => {
    const qasm = qasmForCircuit(circuit);
    return qasm.split('\n').filter((l) => l.trim().length > 0).slice(-8);
  }, [circuit]);

  return (
    <div>
      <div className="pk-label">OpenQASM 2.0</div>
      <div className="pk-well pk-qasm">
        {lines.map((line, i) => {
          const tint = QASM_TINTS.find(([re]) => re.test(line))?.[1];
          const isKw = /^(OPENQASM|include|qreg|creg)/.test(line);
          return (
            <div key={i} className={isKw ? 'kw' : undefined} style={tint ? { color: tint } : undefined}>
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default QasmPanel;
