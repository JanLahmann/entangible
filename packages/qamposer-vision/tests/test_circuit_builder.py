"""Circuit-builder tests: gate emission, CNOT pairing matrix, warnings."""

from __future__ import annotations

import math

import pytest

from qamposer_vision.circuit_builder import TilePlacement, build_circuit
from qamposer_vision.markers import ROTATION_ANGLES

QUBITS = 5

# Marker IDs.
H, X, Y, Z = 10, 11, 12, 13
CTRL, TGT = 14, 15
RX_HALF_PI = 21  # RX(pi/2)
RZ_HALF_PI = 29  # RZ(pi/2)
S, T = 40, 41    # emitted as RZ(pi/2) / RZ(pi/4)
RX_DIAL, RY_DIAL, RZ_DIAL = 42, 43, 44
SWAP = 45        # two × in a column → SWAP, emitted as 3 CNOTs


def _gate_tuples(gates: list[dict]) -> list[tuple]:
    """(id, type, control, target, position) for the CNOTs a SWAP emits."""
    return [
        (g["id"], g["type"], g.get("control"), g.get("target"), g["position"])
        for g in gates
    ]


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


@pytest.mark.parametrize("rotation,angle", list(enumerate(ROTATION_ANGLES)))
def test_dial_angle_from_rotation(rotation, angle) -> None:
    # An RX dial at (2, 3) turned to rotation r emits RX(ROTATION_ANGLES[r]).
    (gate,) = build_circuit(
        [TilePlacement(RX_DIAL, 2, 3, rotation=rotation)], QUBITS
    ).circuit["gates"]
    assert gate["type"] == "RX"
    assert gate["id"] == "rx-2-3"
    assert gate["qubit"] == 2 and gate["position"] == 3
    assert abs(gate["parameter"] - angle) < 1e-12


def test_dial_is_byte_identical_to_classic_rotation_tile() -> None:
    # RX dial at rotation 1 → RX(pi/2): the emitted gate must equal the classic
    # RX(pi/2) tile (id 21) at the same cell — indistinguishable downstream.
    dial = build_circuit([TilePlacement(RX_DIAL, 0, 0, rotation=1)], QUBITS).circuit
    classic = build_circuit([TilePlacement(RX_HALF_PI, 0, 0)], QUBITS).circuit
    assert dial == classic


def test_dial_default_rotation_is_zero() -> None:
    # No rotation given → r=0 → ROTATION_ANGLES[0] = pi/4.
    (gate,) = build_circuit([TilePlacement(RZ_DIAL, 1, 1)], QUBITS).circuit["gates"]
    assert gate["type"] == "RZ"
    assert abs(gate["parameter"] - math.pi / 4) < 1e-12


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


def test_swap_pair_emits_three_cnots_in_order() -> None:
    # Two × tiles in column 1 (rows 0 and 1) → SWAP(0,1) as cx(0,1), cx(1,0),
    # cx(0,1), all at position 1, ids swap-0-1-1/2/3 and in that exact order.
    result = build_circuit([TilePlacement(SWAP, 0, 1), TilePlacement(SWAP, 1, 1)], QUBITS)
    assert result.warnings == []
    assert _gate_tuples(result.circuit["gates"]) == [
        ("swap-0-1-1", "CNOT", 0, 1, 1),
        ("swap-0-1-2", "CNOT", 1, 0, 1),
        ("swap-0-1-3", "CNOT", 0, 1, 1),
    ]


def test_swap_order_survives_gate_sort() -> None:
    # The 3-CNOT order must hold regardless of tile input order (the builder sorts
    # gates, and the SWAP triple must not be reshuffled by control row).
    a = build_circuit([TilePlacement(SWAP, 2, 3), TilePlacement(SWAP, 4, 3)], QUBITS)
    b = build_circuit([TilePlacement(SWAP, 4, 3), TilePlacement(SWAP, 2, 3)], QUBITS)
    assert a.circuit == b.circuit
    ids = [g["id"] for g in a.circuit["gates"]]
    assert ids == ["swap-2-3-1", "swap-2-3-2", "swap-2-3-3"]
    ctrls = [g["control"] for g in a.circuit["gates"]]
    assert ctrls == [2, 4, 2]  # cx(a,b), cx(b,a), cx(a,b), never reordered


def test_swap_anchor_is_the_lower_row() -> None:
    # id prefix uses the lower of the two rows regardless of placement order.
    (g1, _g2, _g3) = build_circuit(
        [TilePlacement(SWAP, 3, 0), TilePlacement(SWAP, 1, 0)], QUBITS
    ).circuit["gates"]
    assert g1["id"] == "swap-1-0-1"
    assert (g1["control"], g1["target"]) == (1, 3)


def test_swap_pairs_nearest_by_row() -> None:
    # Rows {0,1,4,5} in one column → nearest pairs (0,1) and (4,5), never crossing.
    placements = [TilePlacement(SWAP, r, 0) for r in (0, 1, 4, 5)]
    result = build_circuit(placements, QUBITS)
    assert result.warnings == []
    anchors = sorted({g["id"].rsplit("-", 1)[0] for g in result.circuit["gates"]})
    assert anchors == ["swap-0-0", "swap-4-0"]


def test_lone_swap_warns_and_excludes() -> None:
    # A single × tile has no partner → lone_swap warning, no gate emitted.
    result = build_circuit([TilePlacement(H, 0, 0), TilePlacement(SWAP, 2, 1)], QUBITS)
    assert [g["id"] for g in result.circuit["gates"]] == ["h-0-0"]
    assert len(result.warnings) == 1
    w = result.warnings[0]
    assert w.kind == "lone_swap"
    assert (w.row, w.col) == (2, 1)
    assert w.marker_ids == (SWAP,)


def test_odd_swap_count_pairs_and_warns_leftover() -> None:
    # Three × in a column → one nearest pair + one lone_swap for the leftover.
    placements = [TilePlacement(SWAP, r, 0) for r in (0, 1, 4)]
    result = build_circuit(placements, QUBITS)
    swap_gates = [g for g in result.circuit["gates"] if g["id"].startswith("swap-")]
    assert len(swap_gates) == 3  # one SWAP = 3 CNOTs
    assert {g["id"].rsplit("-", 1)[0] for g in swap_gates} == {"swap-0-0"}
    lone = [w for w in result.warnings if w.kind == "lone_swap"]
    assert len(lone) == 1 and lone[0].row == 4


def test_two_swaps_in_different_columns() -> None:
    placements = [
        TilePlacement(SWAP, 0, 0), TilePlacement(SWAP, 1, 0),
        TilePlacement(SWAP, 2, 2), TilePlacement(SWAP, 3, 2),
    ]
    result = build_circuit(placements, QUBITS)
    assert result.warnings == []
    anchors = {g["id"].rsplit("-", 1)[0] for g in result.circuit["gates"]}
    assert anchors == {"swap-0-0", "swap-2-2"}


def test_cell_conflict_excludes_both() -> None:
    # Two tiles in the same cell → both excluded with a conflict warning.
    placements = [TilePlacement(H, 0, 0), TilePlacement(X, 0, 0), TilePlacement(Y, 1, 0)]
    result = build_circuit(placements, QUBITS)
    ids = [g["id"] for g in result.circuit["gates"]]
    assert ids == ["y-1-0"]
    conflicts = [w for w in result.warnings if w.kind == "cell_conflict"]
    assert len(conflicts) == 1
    assert conflicts[0].marker_ids == (H, X)


# --- Controlled gates via the ● modifier (task #51) ------------------------


def _one_gate(gates: list[dict]) -> dict:
    assert len(gates) == 1
    return gates[0]


def test_control_plus_x_is_cx_without_target_tile() -> None:
    # ● + X (a plain X tile, id 11) ≡ ● + ⊕: a native CNOT, control = ●'s row.
    result = build_circuit([TilePlacement(CTRL, 0, 0), TilePlacement(X, 1, 0)], QUBITS)
    assert result.warnings == []
    g = _one_gate(result.circuit["gates"])
    assert (g["type"], g["control"], g["target"], g["id"]) == ("CNOT", 0, 1, "cnot-0-0")


def test_control_plus_single_qubit_gate_controlled_forms() -> None:
    for marker, ctype in ((Y, "CY"), (Z, "CZ"), (H, "CH"), (S, "CS"), (T, "CT")):
        result = build_circuit(
            [TilePlacement(CTRL, 2, 0), TilePlacement(marker, 4, 0)], QUBITS
        )
        assert result.warnings == [], ctype
        g = _one_gate(result.circuit["gates"])
        assert g["type"] == ctype
        assert (g["control"], g["target"]) == (2, 4)
        assert g["id"] == f"{ctype.lower()}-2-0"
        assert "qubit" not in g


def test_two_controls_plus_x_is_ccx() -> None:
    result = build_circuit(
        [TilePlacement(CTRL, 0, 0), TilePlacement(CTRL, 1, 0), TilePlacement(X, 2, 0)],
        QUBITS,
    )
    assert result.warnings == []
    g = _one_gate(result.circuit["gates"])
    assert g["type"] == "CCX"
    assert (g["control"], g["control2"], g["target"]) == (0, 1, 2)
    assert g["id"] == "ccx-0-1-0"


def test_ccx_controls_sorted_regardless_of_order() -> None:
    # Control rows given high-then-low still store control < control2.
    result = build_circuit(
        [TilePlacement(CTRL, 4, 0), TilePlacement(CTRL, 1, 0), TilePlacement(X, 2, 0)],
        QUBITS,
    )
    g = _one_gate(result.circuit["gates"])
    assert (g["control"], g["control2"], g["target"]) == (1, 4, 2)


def test_control_with_two_gate_tiles_is_ambiguous() -> None:
    result = build_circuit(
        [TilePlacement(CTRL, 0, 0), TilePlacement(H, 1, 0), TilePlacement(X, 2, 0)],
        QUBITS,
    )
    assert result.circuit["gates"] == []
    assert len(result.warnings) == 1
    assert result.warnings[0].kind == "control_ambiguous"


def test_two_controls_with_non_x_gate_is_ambiguous() -> None:
    result = build_circuit(
        [TilePlacement(CTRL, 0, 0), TilePlacement(CTRL, 1, 0), TilePlacement(H, 2, 0)],
        QUBITS,
    )
    assert result.circuit["gates"] == []
    assert result.warnings[0].kind == "control_ambiguous"


def test_three_controls_is_ambiguous() -> None:
    result = build_circuit(
        [
            TilePlacement(CTRL, 0, 0),
            TilePlacement(CTRL, 1, 0),
            TilePlacement(CTRL, 2, 0),
            TilePlacement(X, 3, 0),
        ],
        QUBITS,
    )
    assert result.circuit["gates"] == []
    assert result.warnings[0].kind == "control_ambiguous"


def test_control_plus_rotation_is_ambiguous() -> None:
    # No controlled rotations in v1: ● + RX(π/2) is excluded with a warning.
    result = build_circuit(
        [TilePlacement(CTRL, 0, 0), TilePlacement(RX_HALF_PI, 1, 0)], QUBITS
    )
    assert result.circuit["gates"] == []
    assert result.warnings[0].kind == "control_ambiguous"


def test_control_plus_dial_rotation_is_ambiguous() -> None:
    # Dial tiles resolve to RX/RY/RZ, so ● + dial is also a controlled rotation.
    result = build_circuit(
        [TilePlacement(CTRL, 0, 0), TilePlacement(RX_DIAL, 1, 0, rotation=1)], QUBITS
    )
    assert result.circuit["gates"] == []
    assert result.warnings[0].kind == "control_ambiguous"


def test_control_target_and_gate_together_is_ambiguous() -> None:
    # ● + ⊕ + another gate in one column is ambiguous → all excluded.
    result = build_circuit(
        [TilePlacement(CTRL, 0, 0), TilePlacement(TGT, 1, 0), TilePlacement(H, 2, 0)],
        QUBITS,
    )
    assert result.circuit["gates"] == []
    assert result.warnings[0].kind == "control_ambiguous"


def test_legacy_cnot_pairing_unchanged_with_two_controls_one_target() -> None:
    # ● ● + ⊕ (no gate tile) stays the LEGACY nearest-pairing (one CX + one lone
    # control), NOT a CCX — CCX requires an X *gate* tile, and this preserves the
    # existing pairing behaviour byte-for-byte.
    result = build_circuit(
        [TilePlacement(CTRL, 0, 0), TilePlacement(CTRL, 4, 0), TilePlacement(TGT, 1, 0)],
        QUBITS,
    )
    assert _cnot_pairs(result.circuit["gates"]) == {(0, 1, 0)}
    lone = [w for w in result.warnings if w.kind == "lone_control"]
    assert len(lone) == 1 and lone[0].row == 4


def test_control_and_gate_in_different_columns_do_not_interact() -> None:
    # A ● in column 1 and an unrelated H in column 0 stay independent: the H is a
    # plain gate; the ● is a lone control.
    result = build_circuit([TilePlacement(H, 0, 0), TilePlacement(CTRL, 2, 1)], QUBITS)
    assert [g["id"] for g in result.circuit["gates"]] == ["h-0-0"]
    assert result.warnings[0].kind == "lone_control"


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
