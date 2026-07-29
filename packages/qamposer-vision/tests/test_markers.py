"""Tests for the marker table — the single source of truth for the tile scheme.

markers.py is a pure data module; these tests pin the documented ID scheme so
detection and the assets generator can never silently drift.
"""

from __future__ import annotations

import math

import pytest

from qamposer_vision import markers
from qamposer_vision.markers import (
    ARUCO_DICT_NAME,
    CORNER_IDS,
    DIAL_ANGLES,
    DIAL_IDS,
    GATE_TYPES,
    MARKER_TABLE,
    MEASURE_BLOCK_ID,
    QUBIT_WIRE_ID,
    RESERVED_IDS,
    ROTATION_ANGLES,
    GateSpec,
    octant_rotation,
    pretty_angle,
    quadrant_rotation,
)

# The exact IDs the scheme documents (docs/marker-ids.md must match). Written
# out in full on purpose: the assignment is explicit per ID, not a range — 10 is
# RZ(π), 30 is H, 35 is X and 17 is the CNOT control, while 11 and 14 are free.
EXPECTED_IDS = {
    0, 1, 2, 3,
    10, 12, 13, 15, 17,
    20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31,
    30, 35,
    40, 41, 42, 43, 44, 45,
}


def test_no_cv2_import() -> None:
    """markers.py must stay dependency-free so assets stays lightweight."""
    import sys

    assert "cv2" not in sys.modules or markers.__name__  # markers itself never imports cv2
    src = (markers.__file__ or "")
    assert src.endswith("markers.py")
    with open(markers.__file__, encoding="utf-8") as fh:
        text = fh.read()
    assert "import cv2" not in text
    assert "import numpy" not in text


def test_table_covers_exactly_documented_ids() -> None:
    assert set(MARKER_TABLE) == EXPECTED_IDS


def test_every_entry_is_a_gatespec() -> None:
    assert all(isinstance(spec, GateSpec) for spec in MARKER_TABLE.values())


def test_corner_ids_are_zero_to_three() -> None:
    corner_ids = {i for i, s in MARKER_TABLE.items() if s.kind == "corner"}
    assert corner_ids == {0, 1, 2, 3}
    assert set(CORNER_IDS) == {0, 1, 2, 3}
    for marker_id, role in CORNER_IDS.items():
        spec = MARKER_TABLE[marker_id]
        assert spec.kind == "corner"
        assert spec.role == role
        assert spec.gate == role
        assert spec.parameter is None


def test_all_gate_types_valid() -> None:
    for spec in MARKER_TABLE.values():
        if spec.kind == "gate":
            assert spec.gate in GATE_TYPES, spec


def test_single_qubit_gates() -> None:
    for marker_id, gate in ((30, "H"), (35, "X"), (12, "Y"), (13, "Z")):
        spec = MARKER_TABLE[marker_id]
        assert spec.kind == "gate"
        assert spec.gate == gate
        assert spec.parameter is None
        assert spec.role is None


def test_cnot_halves() -> None:
    control = MARKER_TABLE[17]
    target = MARKER_TABLE[15]
    assert control.gate == target.gate == "CNOT"
    assert control.role == "control"
    assert target.role == "target"


#: The fixed-angle rotation tiles, spelled out per family. RZ(π) sits on **10**
#: (freed when H moved to 30, task #96), so this is deliberately NOT ``range``
#: arithmetic — a regression here means someone reintroduced "base + offset".
ROTATION_ID_ORDER: dict[str, tuple[int, int, int, int]] = {
    "RX": (20, 21, 22, 23),
    "RY": (24, 25, 26, 27),
    "RZ": (28, 29, 10, 31),
}


def test_rotation_angles_match_documented_set() -> None:
    fixed_rotation_ids = {
        marker_id
        for marker_id, spec in MARKER_TABLE.items()
        if spec.gate in ("RX", "RY", "RZ") and spec.dial_axis is None
    }
    assert fixed_rotation_ids == {i for ids in ROTATION_ID_ORDER.values() for i in ids}

    for family, ids in ROTATION_ID_ORDER.items():
        angles = []
        for marker_id in ids:
            spec = MARKER_TABLE[marker_id]
            assert spec.gate == family, marker_id
            assert spec.parameter is not None
            angles.append(spec.parameter)
        # Each family carries exactly the four documented angles, in order.
        assert angles == list(ROTATION_ANGLES), family
        assert set(angles) == set(ROTATION_ANGLES)


def test_freed_ids_are_unassigned() -> None:
    """11 (old X) and 14 (old CNOT control) are free — no gate, not reserved."""
    from qamposer_vision.markers import DETECTABLE_IDS

    for freed in (11, 14):
        assert freed not in MARKER_TABLE
        assert freed not in DETECTABLE_IDS
        assert freed not in RESERVED_IDS


def test_rotation_angle_values() -> None:
    assert ROTATION_ANGLES == (math.pi / 4, math.pi / 2, math.pi, -math.pi / 2)


def test_no_id_collision_with_reserved_range() -> None:
    assert RESERVED_IDS == range(48, 50)
    assert not (set(MARKER_TABLE) & set(RESERVED_IDS))
    # 46 left the reserved range for the qubit-wire block (#95) and 47 for the
    # measurement block (#97): both are board furniture, so neither may be in
    # the gate table.
    assert QUBIT_WIRE_ID == 46
    assert MEASURE_BLOCK_ID == 47
    assert QUBIT_WIRE_ID not in MARKER_TABLE
    assert MEASURE_BLOCK_ID not in MARKER_TABLE
    assert QUBIT_WIRE_ID not in RESERVED_IDS
    assert MEASURE_BLOCK_ID not in RESERVED_IDS


def test_furniture_ids_are_detectable_but_not_gates() -> None:
    """Both furniture blocks must DECODE but must never resolve to a gate."""
    from qamposer_vision.markers import DETECTABLE_IDS

    assert {QUBIT_WIRE_ID, MEASURE_BLOCK_ID} <= DETECTABLE_IDS
    assert DETECTABLE_IDS == set(MARKER_TABLE) | {QUBIT_WIRE_ID, MEASURE_BLOCK_ID}
    # Furniture is the ONLY thing outside the gate/corner table.
    assert DETECTABLE_IDS - set(MARKER_TABLE) == {QUBIT_WIRE_ID, MEASURE_BLOCK_ID}


def test_swap_tile() -> None:
    # ID 45 is the SWAP × tile: a physical-tile identity (gate == "SWAP") with no
    # native @qamposer/react type, so it carries no parameter and no emit_as (the
    # circuit builder expands a pair of × tiles into 3 CNOTs itself).
    spec = MARKER_TABLE[45]
    assert spec.kind == "gate"
    assert spec.gate == "SWAP"
    assert spec.label == "SWAP ×"
    assert spec.parameter is None
    assert spec.role is None
    assert spec.emit_as is None
    assert spec.dial_axis is None
    # Exactly one SWAP tile in the table.
    swaps = {mid for mid, s in MARKER_TABLE.items() if s.gate == "SWAP"}
    assert swaps == {45}


def test_dial_tiles() -> None:
    # One dial tile per rotation axis, IDs 42/43/44.
    assert DIAL_IDS == {42: "RX", 43: "RY", 44: "RZ"}
    for marker_id, axis in DIAL_IDS.items():
        spec = MARKER_TABLE[marker_id]
        assert spec.kind == "gate"
        assert spec.gate == axis          # emitted as that rotation axis
        assert spec.dial_axis == axis
        assert spec.parameter is None     # angle comes from the tile's rotation
        assert spec.emit_as is None
        assert spec.label == f"{axis} dial"
    # dial_axis is set on exactly the three dial tiles and nowhere else.
    with_dial = {mid for mid, s in MARKER_TABLE.items() if s.dial_axis is not None}
    assert with_dial == set(DIAL_IDS)


def test_quadrant_rotation_maps_corner_offset_to_cw_steps() -> None:
    # printed top-left corner offset (dx right, dy down) → clockwise 90° index.
    assert quadrant_rotation(-1, -1) == 0   # TL of centre  (canonical)
    assert quadrant_rotation(+1, -1) == 1   # TR  (turned 90° CW)
    assert quadrant_rotation(+1, +1) == 2   # BR  (180°)
    assert quadrant_rotation(-1, +1) == 3   # BL  (270°)


def test_octant_rotation_maps_corner_offset_to_45_degree_steps() -> None:
    # printed top-left corner offset (dx right, dy down) → clockwise 45° index.
    # All eight directions, swept in full.
    assert octant_rotation(-1, -1) == 0   # TL of centre  (canonical)
    assert octant_rotation(0, -1) == 1    # straight up    (45° CW)
    assert octant_rotation(+1, -1) == 2   # TR             (90°)
    assert octant_rotation(+1, 0) == 3    # right          (135°)
    assert octant_rotation(+1, +1) == 4   # BR             (180°)
    assert octant_rotation(0, +1) == 5    # down           (225°)
    assert octant_rotation(-1, +1) == 6   # BL             (270°)
    assert octant_rotation(-1, 0) == 7    # left           (315°)


def test_octant_rotation_agrees_with_quadrant_rotation_on_even_steps() -> None:
    # The two are the same measurement at two resolutions: an exact quarter turn
    # must read as 2·r in octants. Swept over every quadrant.
    for quadrant, (dx, dy) in enumerate(((-1, -1), (+1, -1), (+1, +1), (-1, +1))):
        assert quadrant_rotation(dx, dy) == quadrant
        assert octant_rotation(dx, dy) == 2 * quadrant
        assert octant_rotation(dx, dy) // 2 == quadrant_rotation(dx, dy)


def test_dial_angles_are_the_physical_turn() -> None:
    # Eight positions, 45° apart, wrapped to (-pi, pi]; the angle IS the
    # clockwise turn. r=0 is the identity 0.0 — emitted, never dropped.
    assert len(DIAL_ANGLES) == 8
    assert DIAL_ANGLES[0] == 0.0
    for r, angle in enumerate(DIAL_ANGLES):
        expected = r * math.pi / 4.0
        if expected > math.pi:
            expected -= 2.0 * math.pi
        assert angle == pytest.approx(expected), r
        assert -math.pi < angle <= math.pi
    # Distinct from the fixed-angle print set of the classic rotation tiles.
    assert DIAL_ANGLES != ROTATION_ANGLES
    # Every classic printed angle is still reachable by turning a dial.
    for angle in ROTATION_ANGLES:
        assert any(a == pytest.approx(angle) for a in DIAL_ANGLES)


def test_s_and_t_tiles() -> None:
    s = MARKER_TABLE[40]
    t = MARKER_TABLE[41]
    assert s.kind == t.kind == "gate"
    assert (s.gate, s.label) == ("S", "S")
    assert (t.gate, t.label) == ("T", "T")
    # No native @qamposer/react type: the tile's own parameter stays None; the
    # RZ equivalent is carried on emit_as.
    assert s.parameter is None
    assert t.parameter is None
    assert s.emit_as == ("RZ", math.pi / 2)
    assert t.emit_as == ("RZ", math.pi / 4)


def test_emit_as_only_on_s_and_t() -> None:
    with_mapping = {mid for mid, spec in MARKER_TABLE.items() if spec.emit_as is not None}
    assert with_mapping == {40, 41}
    # Every emit_as target is itself a real, emittable gate type.
    for spec in MARKER_TABLE.values():
        if spec.emit_as is not None:
            emit_type, _ = spec.emit_as
            assert emit_type in GATE_TYPES


def test_aruco_dict_name() -> None:
    assert ARUCO_DICT_NAME == "DICT_4X4_50"


def test_pretty_angle() -> None:
    assert pretty_angle(math.pi / 4) == "π/4"
    assert pretty_angle(math.pi / 2) == "π/2"
    assert pretty_angle(math.pi) == "π"
    assert pretty_angle(-math.pi / 2) == "-π/2"
    assert pretty_angle(0) == "0"
    assert pretty_angle(3 * math.pi / 4) == "3π/4"
    assert pretty_angle(-3 * math.pi / 4) == "-3π/4"


def test_every_dial_angle_has_a_crisp_label() -> None:
    # No dial position may fall back to a 4-decimal radian value — all eight are
    # printed on the tile face.
    expected = ["0", "π/4", "π/2", "3π/4", "π", "-3π/4", "-π/2", "-π/4"]
    assert [pretty_angle(a) for a in DIAL_ANGLES] == expected


def test_param_label_matches_pretty_angle() -> None:
    for spec in MARKER_TABLE.values():
        if spec.parameter is None:
            assert spec.param_label is None
        else:
            assert spec.param_label == pretty_angle(spec.parameter)
            assert spec.param_label in spec.label  # label embeds the pretty angle


def test_gatespec_is_frozen() -> None:
    spec = MARKER_TABLE[30]
    try:
        spec.gate = "X"  # type: ignore[misc]
    except Exception:
        return
    raise AssertionError("GateSpec should be frozen")
