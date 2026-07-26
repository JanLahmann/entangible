"""Every gate marker yields a well-formed tile SVG."""

from __future__ import annotations

import pytest

from qamposer_assets.config import load_config
from qamposer_assets.tile_face import gate_marker_ids, tile_label, tile_svg
from qamposer_vision.markers import MARKER_TABLE

CFG = load_config()
GATE_IDS = gate_marker_ids()


def test_gate_ids_are_the_kind_gate_entries():
    expected = sorted(
        mid for mid, spec in MARKER_TABLE.items() if spec.kind == "gate"
    )
    assert GATE_IDS == expected
    # H=30, X=35, Y=12, Z=13, CNOT ●=17 / ⊕=15, rotations 20-29 + 10 (RZ(π))
    # + 31, S/T 40/41, RX/RY/RZ dials 42/43/44 and SWAP × 45. Spelled out, not a
    # range: the assignment is explicit per ID (task #96) and 11/14 are free.
    assert set(GATE_IDS) == {
        10, 12, 13, 15, 17,
        20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
        35, 40, 41, 42, 43, 44, 45,
    }


@pytest.mark.parametrize("marker_id", GATE_IDS)
def test_tile_has_three_semantic_groups(marker_id):
    svg = tile_svg(marker_id, CFG)
    assert 'id="outline"' in svg
    assert 'id="marker"' in svg
    assert 'id="symbol"' in svg
    # Real mm units: width/height in mm with a matching viewBox.
    assert f'width="{int(CFG.tile.size)}mm"' in svg
    assert f'viewBox="0 0 {int(CFG.tile.size)} {int(CFG.tile.size)}"' in svg


@pytest.mark.parametrize("marker_id", GATE_IDS)
def test_band_color_matches_gate_color(marker_id):
    spec = MARKER_TABLE[marker_id]
    svg = tile_svg(marker_id, CFG)
    assert CFG.colors.for_gate(spec.gate) in svg


@pytest.mark.parametrize(
    "marker_id,fragment",
    [
        (30, ">H<"),
        (35, ">X<"),
        (12, ">Y<"),
        (13, ">Z<"),
        (17, "CONTROL"),
        (15, "TARGET"),
        (40, ">S<"),
        (41, ">T<"),
    ],
)
def test_single_and_cnot_labels(marker_id, fragment):
    assert fragment in tile_svg(marker_id, CFG)


def test_swap_tile_face():
    # SWAP × prints in the CNOT-family colour with a "SWAP" band caption and a
    # vector × glyph (two round-capped diagonals), like the CNOT ●/⊕ glyphs.
    from qamposer_vision.markers import MARKER_TABLE as MT

    spec = MT[45]
    assert tile_label(spec) == "SWAP"
    svg = tile_svg(45, CFG)
    cnot_color = CFG.colors.for_gate("CNOT")
    assert CFG.colors.for_gate("SWAP") == cnot_color
    assert cnot_color in svg
    assert ">SWAP<" in svg
    # Two diagonal strokes with round caps form the × glyph.
    assert svg.count('stroke-linecap="round"') >= 2
    for group in ('id="outline"', 'id="marker"', 'id="symbol"'):
        assert group in svg


def test_s_and_t_tiles_use_z_family_color():
    # S/T print in the Z-family colour and carry a big single-letter label,
    # exactly like H/X/Y/Z.
    z_color = CFG.colors.for_gate("Z")
    for marker_id, letter in ((40, "S"), (41, "T")):
        spec = MARKER_TABLE[marker_id]
        assert tile_label(spec) == letter
        assert CFG.colors.for_gate(spec.gate) == z_color
        svg = tile_svg(marker_id, CFG)
        assert z_color in svg
        assert f">{letter}<" in svg


@pytest.mark.parametrize(
    "marker_id", [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 10, 31]
)
def test_rotation_label_has_family_and_angle(marker_id):
    spec = MARKER_TABLE[marker_id]
    label = tile_label(spec)
    assert label.startswith(spec.gate)
    assert spec.param_label in label
    assert label in tile_svg(marker_id, CFG)


@pytest.mark.parametrize("marker_id,axis", [(42, "RX"), (43, "RY"), (44, "RZ")])
def test_dial_tile_face(marker_id, axis):
    from qamposer_vision.markers import ROTATION_ANGLES, pretty_angle

    svg = tile_svg(marker_id, CFG)
    # Three semantic groups like every tile.
    for group in ('id="outline"', 'id="marker"', 'id="symbol"'):
        assert group in svg
    # Family colour frame.
    assert CFG.colors.for_gate(axis) in svg
    # All four angle labels present (one per edge / rotation).
    for angle in ROTATION_ANGLES:
        assert f">{pretty_angle(angle)}<" in svg
    # Axis name in the bottom band, and a ▲ pointer (polygon) for canonical top.
    assert f"{axis} dial" in svg
    assert "<polygon" in svg


def test_dial_label_orientation_is_consistent_with_rotation():
    # The label that reaches board-top at rotation r is ROTATION_ANGLES[r], drawn
    # spun -90*r degrees so a clockwise r-turn brings it upright. Verify the two
    # off-axis labels carry the expected rotate() transform.
    svg = tile_svg(42, CFG)  # RX dial
    # r=1 (left edge, π/2) is drawn rotated -90; r=3 (right edge, -π/2) rotated 90.
    assert 'transform="rotate(-90' in svg
    assert 'transform="rotate(90' in svg
    # r=2 (bottom edge, π) is drawn upside down (±180).
    assert 'transform="rotate(-180' in svg


def test_non_gate_marker_rejected():
    with pytest.raises(ValueError):
        tile_svg(0, CFG)  # corner marker, not a gate tile
