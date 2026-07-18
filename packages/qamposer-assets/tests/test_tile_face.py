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
    # 10-15 (H/X/Y/Z + CNOT halves), 20-31 (rotations) and 40/41 (S/T).
    assert set(GATE_IDS) == set(range(10, 16)) | set(range(20, 32)) | {40, 41}


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
        (10, ">H<"),
        (11, ">X<"),
        (12, ">Y<"),
        (13, ">Z<"),
        (14, "CONTROL"),
        (15, "TARGET"),
        (40, ">S<"),
        (41, ">T<"),
    ],
)
def test_single_and_cnot_labels(marker_id, fragment):
    assert fragment in tile_svg(marker_id, CFG)


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


@pytest.mark.parametrize("marker_id", range(20, 32))
def test_rotation_label_has_family_and_angle(marker_id):
    spec = MARKER_TABLE[marker_id]
    label = tile_label(spec)
    assert label.startswith(spec.gate)
    assert spec.param_label in label
    assert label in tile_svg(marker_id, CFG)


def test_non_gate_marker_rejected():
    with pytest.raises(ValueError):
        tile_svg(0, CFG)  # corner marker, not a gate tile
