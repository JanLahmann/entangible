/**
 * Local OpenQASM 2.0 emission for Pocket (no WebSocket → no server-supplied
 * qasm, docs/pocket.md). Qamposer ships `circuitToQasm`, whose output is
 * byte-identical to the repo's `tests/fixtures/circuits/*.qasm` goldens (which
 * come from `qamposer_vision/qasm.py`), so we reuse it rather than re-porting
 * the formatter. This thin wrapper is the single call site + test entry point.
 */
import { circuitToQasm, type Circuit } from '@qamposer/react';

export function qasmForCircuit(circuit: Circuit): string {
  return circuitToQasm(circuit);
}
