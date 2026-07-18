"""Circuit-builder tests: gate emission, CNOT pairing matrix, warnings."""

from __future__ import annotations

import math

from qamposer_vision.circuit_builder import TilePlacement, build_circuit

QUBITS = 5

# Marker IDs.
H, X, Y, Z = 10, 11, 12, 13
CTRL, TGT = 14, 15
RX_HALF_PI = 21  # RX(pi/2)
RZ_HALF_PI = 29  # RZ(pi/2)
S, T = 40, 41    # emitted as RZ(pi/2) / RZ(pi/4)


def _cnot_pairs(gates: list[dict]) -> set[tuple[int, int, int]]:
    return {
        (g["control"], g["target"], g["position"])
        for g in gates
        if g["type"] == "CNOT"
    }


def test_single_qubit_gate_shape() -> None:
    result = build_circuit([TilePlacement(H, 0, 0)], QUBITS)
    assert result.circuit == {
        "qubits": 5,
        "gates": [{"id": "h-0-0", "type": "H", "qubit": 0, "position": 0}],
    }
    assert result.warnings == []


def test_rotation_gate_includes_parameter() -> None:
    result = build_circuit([TilePlacement(RX_HALF_PI, 2, 3)], QUBITS)
    (gate,) = result.circuit["gates"]
    assert gate["type"] == "RX"
    assert gate["qubit"] == 2
    assert gate["position"] == 3
    assert abs(gate["parameter"] - 1.5707963267948966) < 1e-12
    assert gate["id"] == "rx-2-3"


def test_s_tile_emits_rz_half_pi() -> None:
    result = build_circuit([TilePlacement(S, 0, 2)], QUBITS)
    assert result.circuit == {
        "qubits": 5,
        "gates": [
            {
                "id": "rz-0-2",
                "type": "RZ",
                "qubit": 0,
                "position": 2,
                "parameter": math.pi / 2,
            }
        ],
    }
    assert result.warnings == []


def test_t_tile_emits_rz_quarter_pi() -> None:
    (gate,) = build_circuit([TilePlacement(T, 1, 0)], QUBITS).circuit["gates"]
    assert gate["type"] == "RZ"
    assert gate["id"] == "rz-1-0"
    assert abs(gate["parameter"] - math.pi / 4) < 1e-12


def test_s_and_real_rz_coexist_without_collision() -> None:
    # An S tile and a real RZ(pi/2) tile in *different* columns produce identical
    # gates, but their ids differ by position, so React identity stays stable and
    # nothing collides (design.md: this coexistence is intended).
    result = build_circuit(
        [TilePlacement(S, 0, 1), TilePlacement(RZ_HALF_PI, 0, 3)], QUBITS
    )
    gates = result.circuit["gates"]
    ids = [g["id"] for g in gates]
    assert ids == ["rz-0-1", "rz-0-3"]
    assert len(set(ids)) == 2  # collision-free
    assert all(g["type"] == "RZ" for g in gates)
    assert all(abs(g["parameter"] - math.pi / 2) < 1e-12 for g in gates)
    assert result.warnings == []


def test_deterministic_ids_and_ordering() -> None:
    placements = [TilePlacement(Z, 3, 0), TilePlacement(H, 0, 0), TilePlacement(X, 1, 0)]
    first = build_circuit(placements, QUBITS).circuit
    second = build_circuit(list(reversed(placements)), QUBITS).circuit
    assert first == second  # order-independent, deterministic
    ids = [g["id"] for g in first["gates"]]
    assert ids == ["h-0-0", "x-1-0", "z-3-0"]  # sorted by (col, row)


def test_bell_cnot_pairing() -> None:
    result = build_circuit(
        [TilePlacement(H, 0, 0), TilePlacement(CTRL, 0, 1), TilePlacement(TGT, 1, 1)],
        QUBITS,
    )
    assert _cnot_pairs(result.circuit["gates"]) == {(0, 1, 1)}
    assert result.warnings == []


def test_multiple_pairs_same_column() -> None:
    # controls {0,2}, targets {1,3} in column 0 → nearest pairs (0,1) and (2,3).
    placements = [
        TilePlacement(CTRL, 0, 0), TilePlacement(CTRL, 2, 0),
        TilePlacement(TGT, 1, 0), TilePlacement(TGT, 3, 0),
    ]
    result = build_circuit(placements, QUBITS)
    assert _cnot_pairs(result.circuit["gates"]) == {(0, 1, 0), (2, 3, 0)}
    assert result.warnings == []


def test_crossing_layout_pairs_nearest() -> None:
    # controls {1,3}, targets {0,4}: nearest-by-row gives (1,0) and (3,4),
    # never the crossing (1,4)/(3,0).
    placements = [
        TilePlacement(CTRL, 1, 2), TilePlacement(CTRL, 3, 2),
        TilePlacement(TGT, 0, 2), TilePlacement(TGT, 4, 2),
    ]
    result = build_circuit(placements, QUBITS)
    assert _cnot_pairs(result.circuit["gates"]) == {(1, 0, 2), (3, 4, 2)}


def test_lone_control_warns_and_excludes() -> None:
    result = build_circuit(
        [TilePlacement(H, 0, 0), TilePlacement(CTRL, 1, 1)], QUBITS
    )
    assert [g["id"] for g in result.circuit["gates"]] == ["h-0-0"]
    assert len(result.warnings) == 1
    w = result.warnings[0]
    assert w.kind == "lone_control"
    assert (w.row, w.col) == (1, 1)
    assert w.marker_ids == (CTRL,)


def test_lone_target_warns_and_excludes() -> None:
    result = build_circuit([TilePlacement(TGT, 2, 0)], QUBITS)
    assert result.circuit["gates"] == []
    assert result.warnings[0].kind == "lone_target"


def test_extra_control_leaves_one_lone() -> None:
    # Two controls, one target → one pair + one lone control.
    placements = [
        TilePlacement(CTRL, 0, 0), TilePlacement(CTRL, 4, 0), TilePlacement(TGT, 1, 0)
    ]
    result = build_circuit(placements, QUBITS)
    assert _cnot_pairs(result.circuit["gates"]) == {(0, 1, 0)}
    lone = [w for w in result.warnings if w.kind == "lone_control"]
    assert len(lone) == 1
    assert lone[0].row == 4


def test_cell_conflict_excludes_both() -> None:
    # Two tiles in the same cell → both excluded with a conflict warning.
    placements = [TilePlacement(H, 0, 0), TilePlacement(X, 0, 0), TilePlacement(Y, 1, 0)]
    result = build_circuit(placements, QUBITS)
    ids = [g["id"] for g in result.circuit["gates"]]
    assert ids == ["y-1-0"]
    conflicts = [w for w in result.warnings if w.kind == "cell_conflict"]
    assert len(conflicts) == 1
    assert conflicts[0].marker_ids == (H, X)


def test_warning_to_dict_is_json_safe() -> None:
    result = build_circuit([TilePlacement(CTRL, 1, 1)], QUBITS)
    d = result.warnings[0].to_dict()
    assert d == {
        "kind": "lone_control",
        "message": d["message"],
        "row": 1,
        "col": 1,
        "marker_ids": [CTRL],
    }
