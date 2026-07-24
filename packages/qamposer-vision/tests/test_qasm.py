"""QASM tests: golden strings for the fixture circuits + parameter formatting."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from qamposer_vision.qasm import circuit_to_qasm, format_parameter

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "circuits"

SCENARIO_NAMES = [
    "empty",
    "single_h",
    "bell",
    "ghz3",
    "all_families",
    "warn_lone_control",
    "s_and_t",
    "swap",
    # Controlled gates via the ● modifier (task #51).
    "cx_plain",
    "ch",
    "ccx",
    "controlled_family",
]


@pytest.mark.parametrize("name", SCENARIO_NAMES)
def test_golden_qasm(name: str) -> None:
    circuit = json.loads((FIXTURES / f"{name}.json").read_text())
    expected = (FIXTURES / f"{name}.qasm").read_text()
    assert circuit_to_qasm(circuit) == expected


def test_header_and_registers() -> None:
    qasm = circuit_to_qasm({"qubits": 5, "gates": []})
    assert qasm.startswith('OPENQASM 2.0;\ninclude "qelib1.inc";\n')
    assert "qreg q[5];" in qasm
    assert "creg c[5];" in qasm
    assert qasm.endswith("\n")


def test_cnot_spacing() -> None:
    circuit = {
        "qubits": 5,
        "gates": [{"id": "cnot-0-0", "type": "CNOT", "control": 0, "target": 3, "position": 0}],
    }
    assert "cx q[0], q[3];" in circuit_to_qasm(circuit)


def test_format_parameter_pi_fractions() -> None:
    assert format_parameter(math.pi) == "pi"
    assert format_parameter(-math.pi) == "-pi"
    assert format_parameter(math.pi / 2) == "pi/2"
    assert format_parameter(-math.pi / 2) == "-pi/2"
    assert format_parameter(math.pi / 4) == "pi/4"
    assert format_parameter(2 * math.pi / 3) == "2*pi/3"


def test_format_parameter_decimal_fallback() -> None:
    # Matches TS toFixed(6) then trailing-zero strip.
    assert format_parameter(0.5) == "0.5"
    assert format_parameter(1.0) == "1"
    assert format_parameter(0.123456789) == "0.123457"


def test_controlled_gates_native_qasm() -> None:
    # cy/cz/ch/ccx are native qelib1; CS/CT are controlled-phase cu1(π/2)/cu1(π/4).
    circuit = {
        "qubits": 5,
        "gates": [
            {"id": "cy-0-0", "type": "CY", "control": 0, "target": 1, "position": 0},
            {"id": "cz-0-1", "type": "CZ", "control": 0, "target": 1, "position": 1},
            {"id": "ch-0-2", "type": "CH", "control": 0, "target": 1, "position": 2},
            {"id": "cs-0-3", "type": "CS", "control": 0, "target": 1, "position": 3},
            {"id": "ct-0-4", "type": "CT", "control": 0, "target": 1, "position": 4},
            {"id": "ccx-0-1-5", "type": "CCX", "control": 0, "control2": 1, "target": 2, "position": 5},
        ],
    }
    qasm = circuit_to_qasm(circuit)
    assert "cy q[0], q[1];" in qasm
    assert "cz q[0], q[1];" in qasm
    assert "ch q[0], q[1];" in qasm
    assert "cu1(pi/2) q[0], q[1];" in qasm
    assert "cu1(pi/4) q[0], q[1];" in qasm
    assert "ccx q[0], q[1], q[2];" in qasm


def test_gates_sorted_by_position() -> None:
    # Out-of-order gates should be emitted by ascending column.
    circuit = {
        "qubits": 5,
        "gates": [
            {"id": "x-0-2", "type": "X", "qubit": 0, "position": 2},
            {"id": "h-0-0", "type": "H", "qubit": 0, "position": 0},
        ],
    }
    qasm = circuit_to_qasm(circuit)
    assert qasm.index("h q[0];") < qasm.index("x q[0];")
