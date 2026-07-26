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
    laser_corner_body,
    laser_corner_svg,
    laser_sheet_svgs,
    laser_tile_body,
    laser_tile_svg,
    laser_measure_body,
    laser_measure_svg,
    laser_wire_body,
    laser_wire_svg,
)
from qamposer_assets.corner_block import (
    corner_block_ids,
    corner_block_label,
    corner_block_marker_origin,
)
from qamposer_assets.measure_block import (
    MEASURE_BLOCK_COPIES,
    MEASURE_BLOCK_ID,
    MEASURE_BLOCK_SLUG,
    measure_gauge,
    measure_glyph_box,
    measure_line_y,
    measure_marker_origin,
    measure_segments,
)
from qamposer_assets.qubit_wire_block import (
    QUBIT_WIRE_COPIES,
    QUBIT_WIRE_ID,
    QUBIT_WIRE_LABEL,
    QUBIT_WIRE_SLUG,
    WIRE_STROKE_MM,
    qubit_wire_line_y,
    qubit_wire_marker_origin,
    qubit_wire_segments,
)
from qamposer_assets.marker_svg import marker_group
from qamposer_assets.sheets import kit_tile_ids
from qamposer_assets.svgbase import fmt
from qamposer_assets.tile_face import gate_marker_ids

CFG = load_config()
GATE_IDS = gate_marker_ids()
CORNER_IDS_LIST = corner_block_ids()

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


# ---------------------------------------------------------------------------
# Board-corner blocks (opt-in): the mat's corner, cut in wood
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("marker_id", CORNER_IDS_LIST)
def test_corner_block_has_cut_and_engrave_layers(marker_id):
    svg = laser_corner_svg(marker_id, CFG)
    assert 'id="cut"' in svg
    assert 'id="engrave"' in svg
    colours = set(_HEX.findall(svg))
    assert colours == {CUT_COLOR, ENGRAVE_COLOR}, colours
    assert "#ffffff" not in svg


@pytest.mark.parametrize("marker_id", CORNER_IDS_LIST)
def test_corner_block_marker_is_the_mats_corner_marker(marker_id):
    """40 mm, at the mat's own inset, unrotated — byte-identical artwork."""
    x, y = corner_block_marker_origin(marker_id, CFG)
    expected = marker_group(
        marker_id,
        x,
        y,
        CFG.board.corner_marker_size,
        dictionary=CFG.aruco_dictionary,
        group_id="marker",
        with_background=False,
    )
    assert expected in laser_corner_body(marker_id, CFG)


@pytest.mark.parametrize("marker_id", CORNER_IDS_LIST)
def test_corner_block_engraves_its_label(marker_id):
    body = laser_corner_body(marker_id, CFG)
    label = corner_block_label(marker_id)
    engrave = body.split('id="engrave"', 1)[1]
    assert f">{label}</text>" in engrave


def test_corner_block_has_no_border_score():
    """A frame score would fall inside the marker's quiet zone on two sides."""
    for marker_id in CORNER_IDS_LIST:
        engrave = laser_corner_body(marker_id, CFG).split('id="engrave"', 1)[1]
        assert f'stroke="{ENGRAVE_COLOR}"' not in engrave  # fills only, no score


def test_corner_block_rejects_a_gate_marker():
    with pytest.raises(ValueError):
        laser_corner_body(10, CFG)


def test_sheet_nesting_dispatches_corner_blocks():
    """``laser_sheet_svgs`` handles corner IDs exactly like gate IDs."""
    svgs = laser_sheet_svgs(CFG, [10, 0, 2], 300.0, 200.0)
    assert len(svgs) == 1
    assert 'id="laser-tile-10"' in svgs[0]
    assert 'id="laser-corner-0"' in svgs[0]
    assert 'id="laser-corner-2"' in svgs[0]


def test_cli_laser_corners_are_opt_in(tmp_path):
    rc = cli.main(["--out", str(tmp_path), "laser"])
    assert rc == 0
    assert not (tmp_path / "laser" / "corners").exists()
    notes = (tmp_path / "laser" / "README.txt").read_text(encoding="utf-8")
    assert "Board-corner blocks" not in notes


def test_cli_laser_corners_emit_svgs_and_notes(tmp_path):
    rc = cli.main(["--out", str(tmp_path), "--corners", "laser"])
    assert rc == 0
    corners = sorted((tmp_path / "laser" / "corners").glob("*.svg"))
    assert [p.name for p in corners] == [
        "corner-0.svg",
        "corner-1.svg",
        "corner-2.svg",
        "corner-3.svg",
        # One file per furniture family that ships as five identical pieces.
        f"{MEASURE_BLOCK_SLUG}.svg",
        f"{QUBIT_WIRE_SLUG}.svg",
    ]
    for path in corners:
        assert path.stat().st_size > 500
    notes = (tmp_path / "laser" / "README.txt").read_text(encoding="utf-8")
    assert "Board-corner blocks" in notes
    assert "ROTATION MATTERS" in notes
    assert f"{fmt(CFG.board.corner_margin)}" in notes
    # The blocks join the nested sheets too (4 more pieces than the plain run).
    sheets = sorted((tmp_path / "laser" / "sheets").glob("*.svg"))
    nested = "".join(p.read_text(encoding="utf-8") for p in sheets)
    for marker_id in CORNER_IDS_LIST:
        assert f'id="laser-corner-{marker_id}"' in nested


# ---------------------------------------------------------------------------
# Qubit-wire block (opt-in): one design, five pieces, cut in wood
# ---------------------------------------------------------------------------


def test_wire_block_has_cut_and_engrave_layers():
    svg = laser_wire_svg(CFG)
    assert 'id="cut"' in svg
    assert 'id="engrave"' in svg
    colours = set(_HEX.findall(svg))
    assert colours == {CUT_COLOR, ENGRAVE_COLOR}, colours
    assert "#ffffff" not in svg


def test_wire_block_marker_is_the_tile_marker_centred():
    """The tiles' 36 mm marker, centred — byte-identical artwork to a tile's."""
    x, y = qubit_wire_marker_origin(CFG)
    assert (x, y) == pytest.approx(((CFG.tile.size - CFG.tile.marker_size) / 2.0,) * 2)
    expected = marker_group(
        QUBIT_WIRE_ID,
        x,
        y,
        CFG.tile.marker_size,
        dictionary=CFG.aruco_dictionary,
        group_id="marker",
        with_background=False,
    )
    assert expected in laser_wire_body(CFG)


def test_wire_block_engraves_both_runs_at_mid_height():
    """Two black lines at y = size/2, each touching one edge of the block."""
    engrave = laser_wire_body(CFG).split('id="engrave"', 1)[1]
    cy = qubit_wire_line_y(CFG)
    for x0, x1 in qubit_wire_segments(CFG):
        assert (
            f'<line x1="{fmt(x0)}" y1="{fmt(cy)}" x2="{fmt(x1)}" y2="{fmt(cy)}" '
            f'stroke="{ENGRAVE_COLOR}" stroke-width="{fmt(WIRE_STROKE_MM)}"'
        ) in engrave
    assert engrave.count("<line ") == 2  # exactly the two runs, nothing else
    assert f">{QUBIT_WIRE_LABEL}</text>" in engrave


def test_wire_block_ink_never_enters_the_quiet_zone():
    """Every engraved x is outside the marker ± ``min_quiet_zone``.

    The marker's own module rects are excluded (they *are* the marker); what is
    checked is that the wire runs and the glyph keep out of the white ring.
    """
    t = CFG.tile
    mx, _my = qubit_wire_marker_origin(CFG)
    lo, hi = mx - t.min_quiet_zone, mx + t.marker_size + t.min_quiet_zone
    body = laser_wire_body(CFG)
    engrave = body.split('id="engrave"', 1)[1]
    art = engrave.split("</g>", 1)[1]  # drop the marker group
    for x0, x1 in re.findall(r'<line x1="([-\d.]+)"[^>]*x2="([-\d.]+)"', art):
        assert float(x0) <= lo + 1e-9 or float(x0) >= hi - 1e-9
        assert float(x1) <= lo + 1e-9 or float(x1) >= hi - 1e-9
    for x in re.findall(r'<text x="([-\d.]+)"', art):
        assert float(x) >= hi - 1e-9


def test_wire_block_has_no_border_score():
    """A frame score would cross the wire line and enter the quiet zone."""
    engrave = laser_wire_body(CFG).split('id="engrave"', 1)[1]
    assert f'<rect' not in engrave.split('id="marker"', 1)[1].split("</g>", 1)[1]


def test_sheet_nesting_dispatches_the_wire_block():
    """``laser_sheet_svgs`` handles the wire ID exactly like a gate or corner ID."""
    svgs = laser_sheet_svgs(CFG, [10, 0, QUBIT_WIRE_ID], 300.0, 200.0)
    assert len(svgs) == 1
    assert 'id="laser-tile-10"' in svgs[0]
    assert 'id="laser-corner-0"' in svgs[0]
    assert f'id="laser-wire-{QUBIT_WIRE_ID}"' in svgs[0]


def test_single_tile_svg_rejects_the_wire_block():
    with pytest.raises(ValueError):
        laser_tile_body(QUBIT_WIRE_ID, CFG)


def test_cli_laser_nests_five_wire_blocks_and_documents_them(tmp_path):
    rc = cli.main(["--out", str(tmp_path), "--corners", "laser"])
    assert rc == 0
    one_off = tmp_path / "laser" / "corners" / f"{QUBIT_WIRE_SLUG}.svg"
    assert one_off.stat().st_size > 500
    sheets = sorted((tmp_path / "laser" / "sheets").glob("*.svg"))
    nested = "".join(p.read_text(encoding="utf-8") for p in sheets)
    # Five copies of the one design nested across the sheets — the count is the
    # signal, so a full set has to be cuttable from the kit sheets.
    assert nested.count(f'id="laser-wire-{QUBIT_WIRE_ID}"') == QUBIT_WIRE_COPIES
    notes = (tmp_path / "laser" / "README.txt").read_text(encoding="utf-8")
    assert "Qubit-wire blocks" in notes
    assert f"{QUBIT_WIRE_SLUG}.svg" in notes
    assert f"{fmt(CFG.board.pitch)} mm apart" in notes


def test_cli_laser_wire_block_is_opt_in(tmp_path):
    rc = cli.main(["--out", str(tmp_path), "laser"])
    assert rc == 0
    sheets = sorted((tmp_path / "laser" / "sheets").glob("*.svg"))
    nested = "".join(p.read_text(encoding="utf-8") for p in sheets)
    assert f'id="laser-wire-{QUBIT_WIRE_ID}"' not in nested
    notes = (tmp_path / "laser" / "README.txt").read_text(encoding="utf-8")
    assert "Qubit-wire blocks" not in notes


# ---------------------------------------------------------------------------
# Measurement block (opt-in): the wire block mirrored, with a vector gauge
# ---------------------------------------------------------------------------


def test_measure_block_has_cut_and_engrave_layers():
    svg = laser_measure_svg(CFG)
    assert 'id="cut"' in svg
    assert 'id="engrave"' in svg
    colours = set(_HEX.findall(svg))
    assert colours == {CUT_COLOR, ENGRAVE_COLOR}, colours
    assert "#ffffff" not in svg


def test_measure_block_marker_is_the_tile_marker_centred():
    """The tiles' 36 mm marker, centred — same convention as the wire block."""
    x, y = measure_marker_origin(CFG)
    assert (x, y) == pytest.approx(((CFG.tile.size - CFG.tile.marker_size) / 2.0,) * 2)
    expected = marker_group(
        MEASURE_BLOCK_ID,
        x,
        y,
        CFG.tile.marker_size,
        dictionary=CFG.aruco_dictionary,
        group_id="marker",
        with_background=False,
    )
    assert expected in laser_measure_body(CFG)


def test_measure_block_engraves_both_runs_at_mid_height():
    """Two black lines at y = size/2, each touching one edge of the block.

    Byte-identical placement to the wire block's, which is what lets a left and
    a right block put their bars on one line across the table.
    """
    engrave = laser_measure_body(CFG).split('id="engrave"', 1)[1]
    cy = measure_line_y(CFG)
    assert cy == qubit_wire_line_y(CFG)
    for x0, x1 in measure_segments(CFG):
        assert (
            f'<line x1="{fmt(x0)}" y1="{fmt(cy)}" x2="{fmt(x1)}" y2="{fmt(cy)}" '
            f'stroke="{ENGRAVE_COLOR}" stroke-width="{fmt(WIRE_STROKE_MM)}"'
        ) in engrave


def test_measure_block_engraves_a_vector_gauge_and_no_text():
    """Arc + needle + pivot, drawn as shapes — and not one ``<text>`` element.

    A font substitution on a piece that carries a fiducial is a silent shipping
    defect, so the gauge may never be a glyph (see ``symbols.measure_gauge``).
    """
    body = laser_measure_body(CFG)
    engrave = body.split('id="engrave"', 1)[1]
    assert "<text" not in body
    art = engrave.split("</g>", 1)[1]  # drop the marker group
    assert art.count("<path ") == 1  # the dial arc
    assert art.count("<circle ") == 1  # the pivot dot
    # ... and exactly three lines: the two bar runs plus the needle.
    assert art.count("<line ") == 3
    g = measure_gauge(measure_glyph_box(CFG))
    # The arc is stroked at radius - stroke/2 so the ink lands on ``radius``.
    r = g.radius - g.stroke / 2.0
    assert f'A {fmt(r)} {fmt(r)} 0 0 1 {fmt(g.cx + r)} {fmt(g.cy)}' in art
    assert f'x2="{fmt(g.needle[0])}" y2="{fmt(g.needle[1])}"' in art


def test_measure_block_ink_never_enters_the_quiet_zone():
    """Every engraved x — bar runs, arc and needle — is outside the white ring."""
    t = CFG.tile
    mx, _my = measure_marker_origin(CFG)
    lo, hi = mx - t.min_quiet_zone, mx + t.marker_size + t.min_quiet_zone
    engrave = laser_measure_body(CFG).split('id="engrave"', 1)[1]
    art = engrave.split("</g>", 1)[1]  # drop the marker group
    for x0, x1 in re.findall(r'<line x1="([-\d.]+)"[^>]*x2="([-\d.]+)"', art):
        assert float(x0) <= lo + 1e-9 or float(x0) >= hi - 1e-9
        assert float(x1) <= lo + 1e-9 or float(x1) >= hi - 1e-9
    g = measure_gauge(measure_glyph_box(CFG))
    assert g.cx + g.radius <= lo + 1e-9  # the whole dial sits left of the zone


def test_measure_block_gauge_sits_on_the_inner_edge_above_the_bar():
    """Mirror of the wire block's ``q``: inner (left) strip, above the line."""
    g = measure_gauge(measure_glyph_box(CFG))
    assert g.cx < CFG.tile.size / 2.0  # left half of the block
    assert g.cy + g.pivot_radius < measure_line_y(CFG) - WIRE_STROKE_MM / 2.0


def test_measure_block_has_no_border_score():
    """A frame score would cross the bar and enter the quiet zone."""
    engrave = laser_measure_body(CFG).split('id="engrave"', 1)[1]
    art = engrave.split('id="marker"', 1)[1].split("</g>", 1)[1]
    assert "<rect" not in art


def test_sheet_nesting_dispatches_the_measure_block():
    """``laser_sheet_svgs`` handles ID 47 exactly like a gate, corner or wire ID."""
    svgs = laser_sheet_svgs(CFG, [10, 0, QUBIT_WIRE_ID, MEASURE_BLOCK_ID], 300.0, 200.0)
    assert len(svgs) == 1
    assert 'id="laser-tile-10"' in svgs[0]
    assert 'id="laser-corner-0"' in svgs[0]
    assert f'id="laser-wire-{QUBIT_WIRE_ID}"' in svgs[0]
    assert f'id="laser-measure-{MEASURE_BLOCK_ID}"' in svgs[0]


def test_single_tile_svg_rejects_the_measure_block():
    with pytest.raises(ValueError):
        laser_tile_body(MEASURE_BLOCK_ID, CFG)


def test_cli_laser_nests_five_measure_blocks_and_documents_them(tmp_path):
    rc = cli.main(["--out", str(tmp_path), "--corners", "laser"])
    assert rc == 0
    one_off = tmp_path / "laser" / "corners" / f"{MEASURE_BLOCK_SLUG}.svg"
    assert one_off.stat().st_size > 500
    sheets = sorted((tmp_path / "laser" / "sheets").glob("*.svg"))
    nested = "".join(p.read_text(encoding="utf-8") for p in sheets)
    # A full set of both families has to be cuttable from the kit sheets.
    assert nested.count(f'id="laser-measure-{MEASURE_BLOCK_ID}"') == MEASURE_BLOCK_COPIES
    assert nested.count(f'id="laser-wire-{QUBIT_WIRE_ID}"') == QUBIT_WIRE_COPIES
    notes = (tmp_path / "laser" / "README.txt").read_text(encoding="utf-8")
    assert "Measurement blocks" in notes
    assert f"{MEASURE_BLOCK_SLUG}.svg" in notes
    assert "OPTIONAL" in notes
    assert "RIGHT edge" in notes


def test_cli_laser_measure_block_is_opt_in(tmp_path):
    rc = cli.main(["--out", str(tmp_path), "laser"])
    assert rc == 0
    sheets = sorted((tmp_path / "laser" / "sheets").glob("*.svg"))
    nested = "".join(p.read_text(encoding="utf-8") for p in sheets)
    assert f'id="laser-measure-{MEASURE_BLOCK_ID}"' not in nested
    notes = (tmp_path / "laser" / "README.txt").read_text(encoding="utf-8")
    assert "Measurement blocks" not in notes
