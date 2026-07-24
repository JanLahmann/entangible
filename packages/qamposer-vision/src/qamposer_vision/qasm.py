"""OpenQASM 2.0 emission — a faithful Python port of ``circuitToQasm``.

Mirrors ``qamposer-react/src/utils/openqasm.ts`` line for line so the physical
pipeline produces byte-identical QASM to the web composer for the same circuit:
same header, ``qreg``/``creg`` naming, lowercase gate names, ``cx q[c], q[t];``
spacing, pi-fraction parameter formatting, and stable sort by column position.
"""

from __future__ import annotations

import math
from typing import Any

__all__ = ["circuit_to_qasm", "format_parameter"]

_QASM_HEADER = 'OPENQASM 2.0;\ninclude "qelib1.inc";\n'

#: Gate type -> OpenQASM instruction (mirrors GATE_TO_QASM in openqasm.ts).
_GATE_TO_QASM: dict[str, str] = {
    "H": "h",
    "X": "x",
    "Y": "y",
    "Z": "z",
    "CNOT": "cx",
    "RX": "rx",
    "RY": "ry",
    "RZ": "rz",
    # Controlled gates (task #51). cx/cy/cz/ch/ccx are native qelib1; CS/CT are
    # emitted as controlled-phase cu1(π/2)/cu1(π/4) — see _gate_to_instruction.
    "CY": "cy",
    "CZ": "cz",
    "CH": "ch",
    "CCX": "ccx",
}

_ROTATION_TYPES = ("RX", "RY", "RZ")

#: Two-qubit controlled gates emitted as ``<name> q[c], q[t];``.
_CONTROLLED_TWO_QUBIT = ("CY", "CZ", "CH")


def format_parameter(value: float) -> str:
    """Format a radian parameter for QASM, matching ``formatParameter`` in TS.

    Recognises the same pi-fraction table (tolerance 1e-4); otherwise falls back
    to a 6-decimal value with trailing zeros stripped.
    """
    pi = math.pi
    tolerance = 0.0001
    fractions: list[tuple[float, str]] = [
        (pi, "pi"),
        (-pi, "-pi"),
        (pi / 2, "pi/2"),
        (-pi / 2, "-pi/2"),
        (pi / 4, "pi/4"),
        (-pi / 4, "-pi/4"),
        (pi / 3, "pi/3"),
        (-pi / 3, "-pi/3"),
        (2 * pi / 3, "2*pi/3"),
        (-2 * pi / 3, "-2*pi/3"),
    ]
    for val, text in fractions:
        if abs(value - val) < tolerance:
            return text

    # JS Number.prototype.toFixed(6) then strip trailing zeros / dot.
    formatted = f"{value:.6f}"
    formatted = formatted.rstrip("0").rstrip(".")
    return formatted


def _gate_to_instruction(gate: dict[str, Any]) -> str | None:
    """Convert a single gate dict to a QASM instruction (or None to skip)."""
    gate_type = gate.get("type")
    # CS/CT are controlled-phase gates emitted via cu1 (no direct name in
    # _GATE_TO_QASM), so handle them before the name-lookup guard below.
    if gate_type in ("CS", "CT"):
        # Controlled-S = cu1(π/2), controlled-T = cu1(π/4). cu1 preserves the
        # controlled-phase global-phase semantics on qelib1's u1 (unlike a
        # controlled-RZ, whose control-conditional phase would differ).
        # control/target order is irrelevant to cu1's symmetric physics.
        control = gate.get("control")
        target = gate.get("target")
        if control is not None and target is not None:
            angle = math.pi / 2 if gate_type == "CS" else math.pi / 4
            return f"cu1({format_parameter(angle)}) q[{control}], q[{target}];"
        return None

    qasm_gate = _GATE_TO_QASM.get(gate_type)
    if not qasm_gate:
        return None

    if gate_type == "CNOT":
        control = gate.get("control")
        target = gate.get("target")
        if control is not None and target is not None:
            return f"cx q[{control}], q[{target}];"
        return None

    if gate_type == "CCX":
        control = gate.get("control")
        control2 = gate.get("control2")
        target = gate.get("target")
        if control is not None and control2 is not None and target is not None:
            return f"ccx q[{control}], q[{control2}], q[{target}];"
        return None

    if gate_type in _CONTROLLED_TWO_QUBIT:
        control = gate.get("control")
        target = gate.get("target")
        if control is not None and target is not None:
            return f"{qasm_gate} q[{control}], q[{target}];"
        return None

    if gate_type in _ROTATION_TYPES:
        param = gate.get("parameter")
        if param is None:
            param = 0
        return f"{qasm_gate}({format_parameter(param)}) q[{gate.get('qubit')}];"

    if gate.get("qubit") is not None:
        return f"{qasm_gate} q[{gate.get('qubit')}];"

    return None


def circuit_to_qasm(circuit: dict[str, Any]) -> str:
    """Convert a Circuit dict to OpenQASM 2.0 text (port of ``circuitToQasm``)."""
    qubits = circuit["qubits"]
    gates = circuit["gates"]
    lines: list[str] = [_QASM_HEADER]

    lines.append(f"qreg q[{qubits}];")
    lines.append(f"creg c[{qubits}];")

    if len(gates) == 0:
        return "\n".join(lines) + "\n"

    lines.append("")  # blank line before gates

    # Stable sort by position (Python's sort is stable, like Array.prototype.sort
    # on modern engines) so equal-column gates keep their input order.
    sorted_gates = sorted(gates, key=lambda g: g["position"])

    for gate in sorted_gates:
        instruction = _gate_to_instruction(gate)
        if instruction:
            lines.append(instruction)

    return "\n".join(lines) + "\n"
