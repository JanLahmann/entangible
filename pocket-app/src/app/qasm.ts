/**
 * Local OpenQASM 2.0 emission for Pocket (no WebSocket → no server-supplied
 * qasm, docs/pocket.md).
 *
 * Historically this delegated to `@qamposer/react`'s `circuitToQasm`, but that
 * emitter only knows the native gate set (H/X/Y/Z/CNOT/RX/RY/RZ) and silently
 * drops the controlled gates introduced by task #51 (CY/CZ/CH/CS/CT/CCX). So we
 * now carry a faithful TS port of `qamposer_vision/qasm.py` — byte-identical to
 * the repo's `tests/fixtures/circuits/*.qasm` goldens for the native cases, plus
 * native `cy`/`cz`/`ch`/`ccx` and `cu1(π/2)`/`cu1(π/4)` for CS/CT. The Python
 * emitter and this port MUST stay identical (golden-fixture parity is enforced).
 */
import type { Circuit } from '@qamposer/react';

const QASM_HEADER = 'OPENQASM 2.0;\ninclude "qelib1.inc";\n';

/** Gate type → OpenQASM instruction name (mirrors _GATE_TO_QASM in qasm.py). */
const GATE_TO_QASM: Readonly<Record<string, string>> = {
  H: 'h',
  X: 'x',
  Y: 'y',
  Z: 'z',
  CNOT: 'cx',
  RX: 'rx',
  RY: 'ry',
  RZ: 'rz',
  CY: 'cy',
  CZ: 'cz',
  CH: 'ch',
  CCX: 'ccx',
};

const ROTATION_TYPES = ['RX', 'RY', 'RZ'];
const CONTROLLED_TWO_QUBIT = ['CY', 'CZ', 'CH'];

interface QasmGate {
  type?: string;
  qubit?: number;
  control?: number;
  control2?: number;
  target?: number;
  parameter?: number;
  position: number;
}

/** Format a radian parameter for QASM (mirrors `format_parameter` in qasm.py). */
export function formatParameter(value: number): string {
  const pi = Math.PI;
  const tolerance = 0.0001;
  const fractions: Array<[number, string]> = [
    [pi, 'pi'],
    [-pi, '-pi'],
    [pi / 2, 'pi/2'],
    [-pi / 2, '-pi/2'],
    [pi / 4, 'pi/4'],
    [-pi / 4, '-pi/4'],
    [pi / 3, 'pi/3'],
    [-pi / 3, '-pi/3'],
    [(2 * pi) / 3, '2*pi/3'],
    [(-2 * pi) / 3, '-2*pi/3'],
  ];
  for (const [val, text] of fractions) {
    if (Math.abs(value - val) < tolerance) return text;
  }
  return value.toFixed(6).replace(/\.?0+$/, '');
}

function gateToInstruction(gate: QasmGate): string | null {
  const gateType = gate.type;

  // CS/CT are controlled-phase gates emitted via cu1 (no direct name), so
  // handle them before the name-lookup guard.
  if (gateType === 'CS' || gateType === 'CT') {
    const { control, target } = gate;
    if (control != null && target != null) {
      const angle = gateType === 'CS' ? Math.PI / 2 : Math.PI / 4;
      return `cu1(${formatParameter(angle)}) q[${control}], q[${target}];`;
    }
    return null;
  }

  const qasmGate = gateType ? GATE_TO_QASM[gateType] : undefined;
  if (!qasmGate) return null;

  if (gateType === 'CNOT') {
    const { control, target } = gate;
    if (control != null && target != null) return `cx q[${control}], q[${target}];`;
    return null;
  }

  if (gateType === 'CCX') {
    const { control, control2, target } = gate;
    if (control != null && control2 != null && target != null) {
      return `ccx q[${control}], q[${control2}], q[${target}];`;
    }
    return null;
  }

  if (CONTROLLED_TWO_QUBIT.includes(gateType!)) {
    const { control, target } = gate;
    if (control != null && target != null) return `${qasmGate} q[${control}], q[${target}];`;
    return null;
  }

  if (ROTATION_TYPES.includes(gateType!)) {
    const param = gate.parameter ?? 0;
    return `${qasmGate}(${formatParameter(param)}) q[${gate.qubit}];`;
  }

  if (gate.qubit != null) return `${qasmGate} q[${gate.qubit}];`;

  return null;
}

export function qasmForCircuit(circuit: Circuit): string {
  const gates = circuit.gates as unknown as QasmGate[];
  const lines: string[] = [QASM_HEADER];
  lines.push(`qreg q[${circuit.qubits}];`);
  lines.push(`creg c[${circuit.qubits}];`);

  if (gates.length === 0) return lines.join('\n') + '\n';

  lines.push(''); // blank line before gates

  // Stable sort by position so equal-column gates keep their input order.
  const sorted = [...gates].sort((a, b) => a.position - b.position);
  for (const gate of sorted) {
    const instruction = gateToInstruction(gate);
    if (instruction) lines.push(instruction);
  }

  return lines.join('\n') + '\n';
}
