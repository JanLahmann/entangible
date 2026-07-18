"""Tests for the marker table — the single source of truth for the tile scheme.

markers.py is a pure data module; these tests pin the documented ID scheme so
detection and the assets generator can never silently drift.
"""

from __future__ import annotations

import math

from qamposer_vision import markers
from qamposer_vision.markers import (
    ARUCO_DICT_NAME,
    CORNER_IDS,
    DIAL_IDS,
    GATE_TYPES,
    MARKER_TABLE,
    RESERVED_IDS,
    ROTATION_ANGLES,
    GateSpec,
    pretty_angle,
    quadrant_rotation,
)

# The exact IDs the scheme documents (docs/marker-ids.md must match).
EXPECTED_IDS = {0, 1, 2, 3, 10, 11, 12, 13, 14, 15, *range(20, 32), 40, 41, 42, 43, 44}


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
    for marker_id, gate in ((10, "H"), (11, "X"), (12, "Y"), (13, "Z")):
        spec = MARKER_TABLE[marker_id]
        assert spec.kind == "gate"
        assert spec.gate == gate
        assert spec.parameter is None
        assert spec.role is None


def test_cnot_halves() -> None:
    control = MARKER_TABLE[14]
    target = MARKER_TABLE[15]
    assert control.gate == target.gate == "CNOT"
    assert control.role == "control"
    assert target.role == "target"


def test_rotation_angles_match_documented_set() -> None:
    rotations = {
        family: {} for family in ("RX", "RY", "RZ")
    }
    for marker_id in range(20, 32):
        spec = MARKER_TABLE[marker_id]
        assert spec.gate in rotations
        assert spec.parameter is not None
        rotations[spec.gate][marker_id] = spec.parameter

    for family, id_range in (("RX", range(20, 24)), ("RY", range(24, 28)), ("RZ", range(28, 32))):
        angles = [MARKER_TABLE[i].parameter for i in id_range]
        assert angles == list(ROTATION_ANGLES), family
        # Each family carries exactly the four documented angles, in order.
        assert set(angles) == set(ROTATION_ANGLES)


def test_rotation_angle_values() -> None:
    assert ROTATION_ANGLES == (math.pi / 4, math.pi / 2, math.pi, -math.pi / 2)


def test_no_id_collision_with_reserved_range() -> None:
    assert RESERVED_IDS == range(45, 50)
    assert not (set(MARKER_TABLE) & set(RESERVED_IDS))


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


def test_param_label_matches_pretty_angle() -> None:
    for spec in MARKER_TABLE.values():
        if spec.parameter is None:
            assert spec.param_label is None
        else:
            assert spec.param_label == pretty_angle(spec.parameter)
            assert spec.param_label in spec.label  # label embeds the pretty angle


def test_gatespec_is_frozen() -> None:
    spec = MARKER_TABLE[10]
    try:
        spec.gate = "X"  # type: ignore[misc]
    except Exception:
        return
    raise AssertionError("GateSpec should be frozen")
