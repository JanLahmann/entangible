"""Laser export: red-cut / black-engrave SVGs, correct dims, bed nesting, CLI."""

from __future__ import annotations

import math
import re

import pytest

from qamposer_assets import cli
from qamposer_assets.config import load_config
from qamposer_assets.laser import (
    CUT_COLOR,
    CUT_STROKE_MM,
    ENGRAVE_COLOR,
    laser_bed_grid,
    laser_sheet_svgs,
    laser_tile_body,
    laser_tile_svg,
)
from qamposer_assets.marker_svg import marker_group
from qamposer_assets.sheets import kit_tile_ids
from qamposer_assets.svgbase import fmt
from qamposer_assets.tile_face import gate_marker_ids

CFG = load_config()
GATE_IDS = gate_marker_ids()

# Every #rrggbb hex colour token that appears anywhere in an SVG string.
_HEX = re.compile(r"#[0-9a-fA-F]{6}")


# ---------------------------------------------------------------------------
# Layer encoding: red cut, black engrave, nothing else
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("marker_id", GATE_IDS)
def test_tile_has_cut_and_engrave_layers(marker_id):
    svg = laser_tile_svg(marker_id, CFG)
    assert 'id="cut"' in svg
    assert 'id="engrave"' in svg


@pytest.mark.parametrize("marker_id", GATE_IDS)
def test_only_two_colours_red_cut_black_engrave(marker_id):
    svg = laser_tile_svg(marker_id, CFG)
    colours = set(_HEX.findall(svg))
    assert colours <= {CUT_COLOR, ENGRAVE_COLOR}, colours
    assert CUT_COLOR in colours  # a cut path is always present
    assert ENGRAVE_COLOR in colours  # marker modules always engrave
    # No white fill / page background anywhere — the bare wood is the field.
    assert "#ffffff" not in svg


@pytest.mark.parametrize("marker_id", [10, 14, 15, 21, 40, 42, 45])
def test_cut_is_red_hairline_stroke_no_fill(marker_id):
    svg = laser_tile_body(marker_id, CFG)
    cut = svg.split('id="cut"', 1)[1].split("</g>", 1)[0]
    assert f'stroke="{CUT_COLOR}"' in cut
    assert f'stroke-width="{fmt(CUT_STROKE_MM)}"' in cut
    assert 'fill="none"' in cut


def test_engrave_marker_modules_are_black_fills():
    svg = laser_tile_body(10, CFG)
    engrave = svg.split('id="engrave"', 1)[1]
    assert f'fill="{ENGRAVE_COLOR}"' in engrave
    assert "<image" not in svg  # never a raster


# ---------------------------------------------------------------------------
# Dimensions come from assets.toml
# ---------------------------------------------------------------------------


def test_tile_document_is_60mm_from_assets_toml():
    svg = laser_tile_svg(10, CFG)
    assert CFG.tile.size == 60.0
    assert f'width="{int(CFG.tile.size)}mm"' in svg
    assert f'height="{int(CFG.tile.size)}mm"' in svg
    assert f'viewBox="0 0 {int(CFG.tile.size)} {int(CFG.tile.size)}"' in svg


def test_marker_is_36mm_at_the_config_position():
    # The engraved marker must be byte-identical to marker_svg's own output at
    # the assets.toml position/size (36 mm, horizontally centred, marker_top).
    t = CFG.tile
    assert t.marker_size == 36.0
    expected = marker_group(
        10,
        t.marker_x,
        t.marker_y,
        t.marker_size,
        dictionary=CFG.aruco_dictionary,
        group_id="marker",
        with_background=False,
    )
    assert expected in laser_tile_body(10, CFG)


def test_dial_marker_is_centred():
    t = CFG.tile
    ms = t.marker_size
    expected = marker_group(
        42,
        (t.size - ms) / 2.0,
        (t.size - ms) / 2.0,
        ms,
        dictionary=CFG.aruco_dictionary,
        group_id="marker",
        with_background=False,
    )
    assert expected in laser_tile_body(42, CFG)


def test_non_gate_marker_rejected():
    with pytest.raises(ValueError):
        laser_tile_body(0, CFG)  # a corner marker, not a gate tile


# ---------------------------------------------------------------------------
# Kerf: outset the cut outline by kerf/2
# ---------------------------------------------------------------------------


def test_kerf_outsets_the_cut_rect():
    kerf = 0.2
    body = laser_tile_body(10, CFG, kerf=kerf)
    cut = body.split('id="cut"', 1)[1].split("</g>", 1)[0]
    # Cut rect grows by kerf overall and shifts by -kerf/2 on each axis.
    assert f'x="{fmt(-kerf / 2.0)}"' in cut
    assert f'width="{fmt(CFG.tile.size + kerf)}"' in cut
    assert f'height="{fmt(CFG.tile.size + kerf)}"' in cut
    # Nominal (kerf 0) draws the outline at exactly the tile size.
    nominal = laser_tile_body(10, CFG).split('id="cut"', 1)[1].split("</g>", 1)[0]
    assert f'width="{fmt(CFG.tile.size)}"' in nominal


# ---------------------------------------------------------------------------
# Bed nesting
# ---------------------------------------------------------------------------


def test_bed_grid_default_bed():
    # 300x200 bed, 10 mm margin, 3 mm spacing, 60 mm tile -> 4 x 2.
    cols, rows = laser_bed_grid(CFG, 300.0, 200.0, spacing=3.0, margin=10.0)
    assert (cols, rows) == (4, 2)


def test_bed_grid_too_small_raises():
    with pytest.raises(ValueError):
        laser_sheet_svgs(CFG, [10], 50.0, 50.0)


def test_sheet_count_matches_grid():
    ids = kit_tile_ids(CFG)  # 49 tiles
    cols, rows = laser_bed_grid(CFG, 300.0, 200.0, spacing=3.0, margin=10.0)
    per_sheet = cols * rows  # 8
    svgs = laser_sheet_svgs(CFG, ids, 300.0, 200.0, spacing=3.0)
    assert len(svgs) == math.ceil(len(ids) / per_sheet) == 7
    # Each sheet document is sized to the bed.
    assert 'width="300mm"' in svgs[0]
    assert 'height="200mm"' in svgs[0]


def test_sheet_places_expected_tile_count_on_full_sheet():
    ids = list(range(10, 16)) + list(range(20, 30))  # 16 tiles > 8 per sheet
    svgs = laser_sheet_svgs(CFG, ids, 300.0, 200.0, spacing=3.0)
    assert len(svgs) == 2
    # First (full) sheet holds exactly cols*rows = 8 tile groups.
    assert svgs[0].count("laser-tile-") == 8
    assert svgs[1].count("laser-tile-") == 8


# ---------------------------------------------------------------------------
# CLI file-set emission
# ---------------------------------------------------------------------------


def test_cli_laser_emits_full_file_set(tmp_path):
    rc = cli.main(["--out", str(tmp_path), "laser"])
    assert rc == 0

    sheets = sorted((tmp_path / "laser" / "sheets").glob("*.svg"))
    tiles = sorted((tmp_path / "laser" / "tiles").glob("*.svg"))
    readme = tmp_path / "laser" / "README.txt"

    # 49 kit tiles over 8-per-sheet -> 7 sheets.
    assert len(sheets) == 7
    # One single-tile SVG per gate.
    assert len(tiles) == len(GATE_IDS) == 24
    assert readme.is_file()
    notes = readme.read_text(encoding="utf-8")
    assert "CUT" in notes and "ENGRAVE" in notes


def test_cli_laser_respects_bed_and_kerf(tmp_path):
    rc = cli.main(
        ["--out", str(tmp_path), "--bed", "600x400", "--kerf", "0.15", "laser"]
    )
    assert rc == 0
    # A 600x400 bed fits many more tiles -> a single kit sheet.
    sheets = sorted((tmp_path / "laser" / "sheets").glob("*.svg"))
    assert len(sheets) == 1
    assert "600x400" in sheets[0].name
    # Kerf outset propagated into the sheet's tile cuts.
    assert f'x="{fmt(-0.15 / 2.0)}"' in sheets[0].read_text(encoding="utf-8")
