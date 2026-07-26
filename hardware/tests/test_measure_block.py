"""Measurement blocks — one design, printed five times, that ends the wires.

The measurement block (marker ID 47) is the qubit-wire block's mirror image
along the board's *right* edge, and the second member of the board-furniture
family. What it shares with the wire block is exactly what the detector leans
on, so the mirror is pinned here rather than assumed:

* **The marker centre is the point.** The tile's 36 mm marker, centred on both
  axes, so the point the detector reports is the block's centre is the height at
  which the wire ends — and a block turned 180° reports the same point.
* **The bar may not enter the quiet zone.** Same two runs as the wire block,
  same reason, both still touching the block's edge. The inner (left) stub is
  the ink the eye carries back into the row; the outer one keeps the bar
  point-symmetric.
* **The gauge is vector art.** Where the wire block engraves a ``q``, this piece
  engraves a half-dial-and-needle gauge, drawn as shapes and never as a font
  glyph — nothing on a fiducial-bearing piece may depend on a host font (see
  3c1334e). Every glyph assertion below is therefore about *geometry*, and holds
  whatever OpenCASCADE resolves the band font to.

Also pinned: the black-only ink (no filament slot), the cube's side art, the
mono forms, the one-design/five-pieces split between ``generate`` and
``plates``, the whole 14-piece furniture set's totality on the beds, and the
opt-in rule — the measurement block ships under the same ``--corners`` flag as
the corner and wire blocks, because they are one family.
"""

from __future__ import annotations

from collections import Counter

import pytest
from build123d import Align, Box, Mesher, Pos
from qamposer_assets.config import load_config
from qamposer_assets.marker_svg import marker_bit_matrix
from qamposer_assets.measure_block import (
    GAUGE_BOX_HEIGHT_MM,
    GAUGE_EDGE_MARGIN_MM,
    MEASURE_BLOCK_COPIES,
    MEASURE_BLOCK_ID,
    MEASURE_BLOCK_SLUG,
    WIRE_STROKE_MM,
    measure_block_spec,
    measure_gauge,
    measure_glyph_box,
    measure_line_y,
    measure_marker_origin,
    measure_segments,
)
from qamposer_assets.qubit_wire_block import (
    QUBIT_WIRE_COPIES,
    QUBIT_WIRE_ID,
    QUBIT_WIRE_SLUG,
    qubit_wire_line_y,
    qubit_wire_marker_origin,
    qubit_wire_segments,
)
from qamposer_vision.markers import MARKER_TABLE, RESERVED_IDS

from qamposer_hardware.build import (
    build_measure_block,
    build_mono_raised,
    build_mono_recessed,
)
from qamposer_hardware.export import (
    export_corner_batches,
    furniture_ids,
    tile_slug,
    write_corners_md,
)
from qamposer_hardware.face import (
    corner_block_ids,
    corner_face_layout,
    face_layout,
    measure_face_layout,
    measure_gauge_3d,
)
from qamposer_hardware.pack import Bed
from qamposer_hardware.params import HardwareParams

BED = Bed(250.0, 220.0)
SPACING = 8.0
TILE_H = 6.0
CUBE_H = 60.0
PARAMS = HardwareParams()

#: The CLI's shipped wipe-tower cap. Spelled out here so a change to the default
#: fails visibly rather than silently reshuffling the beds.
CAP = 8

#: The whole shipped furniture family, one entry per physical piece.
FURNITURE_TOTAL = 4 + QUBIT_WIRE_COPIES + MEASURE_BLOCK_COPIES


@pytest.fixture(scope="module")
def config():
    return load_config()


@pytest.fixture(scope="module")
def block(config):
    """The measurement block at tile height, built once."""
    return build_measure_block(config, variant="tile", height=TILE_H, params=PARAMS)


@pytest.fixture(scope="module")
def cube_block(config):
    """The measurement block at cube height — the variant that carries side art."""
    return build_measure_block(config, variant="cube", height=CUBE_H, params=PARAMS)


# --------------------------------------------------------------------------- #
# Identity: marker 47, one design, neither a gate nor a corner
# --------------------------------------------------------------------------- #


def test_the_block_is_marker_47_and_the_id_is_claimed():
    """47 — the ID reserved for it, and *not* one of the still-free 48-49."""
    assert MEASURE_BLOCK_ID == 47
    assert MEASURE_BLOCK_ID not in RESERVED_IDS
    assert RESERVED_IDS == range(48, 50)
    # No gate and no corner may ever claim it.
    spec = MARKER_TABLE.get(MEASURE_BLOCK_ID)
    assert spec is None or spec.kind not in ("gate", "corner")


def test_bit_pattern_is_the_dictionary_matrix_for_47(config, block):
    """Module-for-module the OpenCV matrix for ID 47 — no other ID's pattern."""
    matrix = marker_bit_matrix(MEASURE_BLOCK_ID, config.aruco_dictionary)
    got = {(m.row, m.col): m.bit for m in block.layout.modules}
    assert len(got) == len(matrix) * len(matrix[0])
    for r, row in enumerate(matrix):
        for c, bit in enumerate(row):
            assert got[(r, c)] == bit, f"module ({r},{c})"
    assert block.layout.black_cells
    # ... and it really is a *different* marker from the wire block's and from
    # every corner block's: the two furniture families must never be confused.
    assert marker_bit_matrix(QUBIT_WIRE_ID, config.aruco_dictionary) != matrix
    for mid in corner_block_ids():
        assert marker_bit_matrix(mid, config.aruco_dictionary) != matrix


def test_the_spec_is_board_furniture_not_a_gate_or_a_corner():
    spec = measure_block_spec()
    assert spec.kind not in ("gate", "corner")
    assert spec.parameter is None and spec.dial_axis is None


def test_slug_is_its_own_design(block, config):
    """Its own filename — never the wire block's, which shares the plate."""
    assert tile_slug(block.layout.spec) == MEASURE_BLOCK_SLUG == "qmeasure"
    assert MEASURE_BLOCK_SLUG != QUBIT_WIRE_SLUG


def test_an_unknown_furniture_family_has_no_slug():
    """A third block must claim a filename, not land on another family's."""
    from qamposer_vision.markers import GateSpec

    with pytest.raises(ValueError):
        tile_slug(GateSpec(kind="qthing", gate="QTHING", label="?"))  # type: ignore[arg-type]


def test_gate_and_corner_layouts_both_reject_the_measure_block(config):
    """It has neither a gate face nor a corner face — asking must fail loudly."""
    with pytest.raises(ValueError):
        face_layout(MEASURE_BLOCK_ID, config)
    with pytest.raises(ValueError):
        corner_face_layout(MEASURE_BLOCK_ID, config)


def test_the_cli_never_offers_it_as_a_gate():
    from qamposer_hardware.cli import _all_gate_ids

    assert MEASURE_BLOCK_ID not in _all_gate_ids()


# --------------------------------------------------------------------------- #
# The marker centre IS the wire end: centred marker, tile size, mid-height bar
# --------------------------------------------------------------------------- #


def test_marker_is_the_tiles_marker_centred_on_both_axes(config, block):
    """36 mm (``tile.marker_size``) — never the corner block's 40 mm — centred."""
    t = config.tile
    assert t.marker_size != config.board.corner_marker_size  # guard the premise
    n = len(marker_bit_matrix(MEASURE_BLOCK_ID, config.aruco_dictionary))
    assert block.layout.module_size * n == pytest.approx(t.marker_size)

    mx, my = measure_marker_origin(config)
    assert mx == pytest.approx((t.size - t.marker_size) / 2.0)
    assert my == pytest.approx(mx)  # centred on *both* axes, unlike a gate tile
    assert mx + t.marker_size / 2.0 == pytest.approx(t.size / 2.0)


def test_marker_centre_equals_the_wire_height(config, block):
    """The point the detector reports is the height at which the wire ends."""
    centre = config.tile.size / 2.0
    assert measure_line_y(config) == pytest.approx(centre)
    xs = [m.rect.cx for m in block.layout.modules]
    ys = [m.rect.cy for m in block.layout.modules]
    assert (min(xs) + max(xs)) / 2.0 == pytest.approx(centre)
    assert (min(ys) + max(ys)) / 2.0 == pytest.approx(centre)
    for wr in block.layout.wires:
        assert wr.cy == pytest.approx(centre)


def test_the_two_families_share_one_convention(config):
    """Marker origin and bar height are identical to the wire block's.

    That is the whole point of the pair: a left and a right block at the same
    height put their *marker centres* — and therefore their bars — on exactly
    the same line, so the printed ink lines up across the table and the detector
    can pair them by y.
    """
    assert measure_marker_origin(config) == qubit_wire_marker_origin(config)
    assert measure_line_y(config) == qubit_wire_line_y(config)
    # The bar runs are the same two runs, just named from the other edge.
    assert measure_segments(config) == qubit_wire_segments(config)


def test_bar_runs_reach_both_edges_and_clear_the_quiet_zone(config):
    """Two runs: block edge → quiet zone, quiet zone → block edge."""
    t = config.tile
    mx, _my = measure_marker_origin(config)
    (inner, outer) = measure_segments(config)
    assert inner[0] == pytest.approx(0.0)  # touches the inner (left) edge
    assert outer[1] == pytest.approx(t.size)  # touches the outer (right) edge
    assert inner[1] == pytest.approx(mx - t.min_quiet_zone)
    assert outer[0] == pytest.approx(mx + t.marker_size + t.min_quiet_zone)
    assert inner[1] - inner[0] == pytest.approx(t.min_quiet_zone)
    assert outer[1] - outer[0] == pytest.approx(t.min_quiet_zone)
    assert inner[1] < outer[0]  # a single unbroken line would be illegal


def test_a_180_degree_turn_reports_the_same_point(config, block):
    """Placement is forgiving by construction: the bar is point-symmetric.

    Rotating the block about its own centre maps the marker (centred) and the
    bar runs (mirrored pair at mid-height) onto themselves, so the point it
    reports is unchanged. Only the gauge moves — a reading aid, not a fiducial.
    """
    size = config.tile.size
    runs = {(round(w.x0, 6), round(w.x1, 6), round(w.cy, 6)) for w in block.layout.wires}
    turned = {
        (round(size - x1, 6), round(size - x0, 6), round(size - cy, 6))
        for x0, x1, cy in runs
    }
    assert turned == runs


# --------------------------------------------------------------------------- #
# The gauge: vector geometry, mirrored to the inner edge, inside the face
# --------------------------------------------------------------------------- #


def test_the_gauge_box_is_the_wire_blocks_glyph_box_mirrored(config):
    """The gauge sits on the block's INNER (left) edge, above the bar."""
    t = config.tile
    gx, gy, gw, gh = measure_glyph_box(config)
    (inner, _outer) = measure_segments(config)
    assert gx == pytest.approx(GAUGE_EDGE_MARGIN_MM)  # off the left edge
    assert gx + gw == pytest.approx(inner[1])  # up to, never into, the zone
    assert gy >= 0.0
    assert gy + gh < measure_line_y(config) - WIRE_STROKE_MM / 2.0  # above the bar
    assert gw > 1.0 and gh == pytest.approx(GAUGE_BOX_HEIGHT_MM)
    # The mirror of the wire block's box: same size, opposite side.
    from qamposer_assets.qubit_wire_block import qubit_wire_glyph_box

    qx, _qy, qw, _qh = qubit_wire_glyph_box(config)
    assert gw == pytest.approx(qw)
    assert gx + gw == pytest.approx(t.size - qx)


def test_the_gauge_is_a_half_dial_with_a_needle(config):
    """Pure geometry — no font anywhere near this glyph."""
    box = measure_glyph_box(config)
    g = measure_gauge(box)
    x, y, w, h = box
    # Fitted to the box's tighter axis; here (a 6 mm edge strip) the width.
    assert g.radius == pytest.approx(min(w / 2.0, h))
    assert g.width == pytest.approx(2.0 * g.radius)
    assert g.height == pytest.approx(g.radius)
    assert 0.0 < g.stroke < g.radius
    assert 0.0 < g.pivot_radius < g.radius
    # The needle leaves the pivot up and to the right (SVG y grows downward),
    # and stops short of the arc so tip and dial never merge into a blob.
    nx, ny = g.needle
    assert nx > g.cx and ny < g.cy
    assert ((nx - g.cx) ** 2 + (ny - g.cy) ** 2) ** 0.5 < g.radius
    # All ink stays inside the box: dial across and up, pivot dot just below.
    assert g.cx - g.radius >= x - 1e-9
    assert g.cx + g.radius <= x + w + 1e-9
    assert g.cy - g.radius >= y - 1e-9
    assert g.cy + g.pivot_radius <= y + h + 1e-9


def test_the_3d_gauge_is_the_svg_gauge_flipped_once(config):
    """One flip, in one place: the dial opens upward on the printed piece."""
    size = config.tile.size
    svg = measure_gauge(measure_glyph_box(config))
    d3 = measure_gauge_3d(config)
    assert d3.cx == pytest.approx(svg.cx)
    assert d3.cy == pytest.approx(size - svg.cy)
    assert d3.radius == pytest.approx(svg.radius)
    assert d3.stroke == pytest.approx(svg.stroke)
    assert d3.pivot_radius == pytest.approx(svg.pivot_radius)
    assert d3.needle[0] == pytest.approx(svg.needle[0])
    assert d3.needle[1] == pytest.approx(size - svg.needle[1])
    # In the 3D frame (y up) the needle rises above the pivot.
    assert d3.needle[1] > d3.cy


def test_no_ink_at_all_inside_the_markers_quiet_zone(config, block):
    """Totality, in solids: neither the bar nor the gauge enters the zone.

    Checked on the built accent rather than on the coordinates it came from, so
    a future glyph or bar change that spills over is caught even if the numbers
    still look right.
    """
    t = config.tile
    mx, my = measure_marker_origin(config)
    qz = t.min_quiet_zone
    side = t.marker_size + 2.0 * qz
    zone = Pos(mx + t.marker_size / 2.0, my + t.marker_size / 2.0, TILE_H / 2.0) * Box(
        side, side, 2.0 * TILE_H, align=(Align.CENTER,) * 3
    )
    assert (block.accent & zone).volume == pytest.approx(0.0, abs=1e-6)


# --------------------------------------------------------------------------- #
# The built face: a bar that reaches both edges, plus a gauge
# --------------------------------------------------------------------------- #


def test_accent_spans_the_full_width_at_mid_height(config, block):
    """The bar really is drawn edge to edge (font-independent: it is a bar)."""
    size = config.tile.size
    bb = block.accent.bounding_box()
    assert bb.min.X == pytest.approx(0.0, abs=1e-6)
    assert bb.max.X == pytest.approx(size, abs=1e-6)
    assert bb.min.Z == pytest.approx(TILE_H - PARAMS.face_depth, abs=1e-6)
    assert bb.max.Z == pytest.approx(TILE_H, abs=1e-6)
    for x in (0.5, size - 0.5):
        probe = Pos(x, size / 2.0, TILE_H - PARAMS.face_depth / 2.0) * Box(
            0.4, 0.4, 0.4, align=(Align.CENTER,) * 3
        )
        assert (block.accent & probe).volume > 1e-6, f"no bar ink at x={x}"


def test_the_accent_carries_the_gauge_as_well_as_the_bar(config, block):
    """Ink beyond the two bars, boxed by the band, and above the bar.

    Unlike the wire block's ``q`` this glyph is vector art, so its extent *is*
    portable and is asserted exactly: the dial's crown sits ``radius`` above the
    pivot, and nothing reaches past it.
    """
    bars = sum(w.area for w in block.layout.wires) * PARAMS.face_depth
    assert block.accent.volume > bars * 1.2
    assert block.layout.label == ""  # no text on this piece at all
    band = block.layout.band
    gauge = measure_gauge_3d(config)
    glyph = block.accent - Pos(
        config.tile.size / 2.0, measure_line_y(config), TILE_H - PARAMS.face_depth
    ) * Box(
        3.0 * config.tile.size,
        WIRE_STROKE_MM + 0.2,
        2.0 * PARAMS.face_depth,
        align=(Align.CENTER, Align.CENTER, Align.MIN),
    )
    gb = glyph.bounding_box()
    assert gb.min.X >= band.x0 - 1e-6 and gb.max.X <= band.x1 + 1e-6
    assert gb.min.Y >= band.y0 - 1e-6 and gb.max.Y <= band.y1 + 1e-6
    # The dial spans its full width and reaches its crown — a half dial, drawn.
    assert gb.min.X == pytest.approx(gauge.cx - gauge.radius, abs=1e-5)
    assert gb.max.X == pytest.approx(gauge.cx + gauge.radius, abs=1e-5)
    assert gb.max.Y == pytest.approx(gauge.cy + gauge.radius, abs=1e-5)
    # ... and every bit of it is above the bar, never crossing it.
    assert gb.min.Y > measure_line_y(config) + WIRE_STROKE_MM / 2.0 - 1e-6


def test_the_gauge_is_hollow_where_a_dial_is_hollow(config, block):
    """A probe at the dial's own centre finds no ink — it is an arc, not a disc."""
    gauge = measure_gauge_3d(config)
    probe = Pos(
        gauge.cx,
        gauge.cy + gauge.radius / 2.0,
        TILE_H - PARAMS.face_depth / 2.0,
    ) * Box(0.3, 0.3, 0.3, align=(Align.CENTER,) * 3)
    assert (block.accent & probe).volume == pytest.approx(0.0, abs=1e-9)


def test_block_is_a_single_watertight_body(block):
    assert block.body.is_valid and block.body.is_manifold
    bb = block.body.bounding_box()
    assert bb.size.X == pytest.approx(60.0, abs=1e-5)
    assert bb.size.Y == pytest.approx(60.0, abs=1e-5)
    assert bb.max.Z == pytest.approx(TILE_H, abs=1e-5)
    assert (block.marker & block.accent).volume == pytest.approx(0.0, abs=1e-9)
    assert (block.body & block.marker).volume == pytest.approx(0.0, abs=1e-6)
    assert (block.body & block.accent).volume == pytest.approx(0.0, abs=1e-6)


def test_the_block_has_no_notches_and_no_gate_colour(block):
    """Board furniture: no tactile angle notches, and the ink is marker black."""
    assert block.layout.notch_count == 0 and block.layout.notches == ()
    assert block.layout.accent_hex == "#000000"
    assert block.layout.accent_name == "black"


# --------------------------------------------------------------------------- #
# Side faces (cube height) — the gauge reads from any seat
# --------------------------------------------------------------------------- #


def test_flat_block_has_no_side_art(block):
    assert block.side_labels == []


def test_cube_repeats_the_bar_and_gauge_on_all_four_sides(cube_block):
    labels = cube_block.side_labels
    assert [sl.face for sl in labels] == ["front", "right", "back", "left"]
    assert {sl.role for sl in labels} == {
        "side-front",
        "side-right",
        "side-back",
        "side-left",
    }
    assert {sl.hex for sl in labels} == {"#000000"}
    assert {sl.color_name for sl in labels} == {"black"}
    for sl in labels:
        assert sl.solid.volume > 1.0  # a real inlay, not an empty boolean


def test_side_bar_sits_at_mid_height_and_spans_the_flat_face(config, cube_block):
    """Exact Z, exact width — and the gauge above it, inside the top margin."""
    size = config.tile.size
    flat = size - 2.0 * config.tile.corner_radius
    for sl in cube_block.side_labels:
        bb = sl.solid.bounding_box()
        assert bb.min.Z == pytest.approx(CUBE_H / 2.0 - WIRE_STROKE_MM / 2.0, abs=1e-6)
        assert bb.max.Z <= CUBE_H - PARAMS.side_label_margin + 1e-6
        assert bb.max.Z > CUBE_H / 2.0 + WIRE_STROKE_MM  # the gauge is above it
        span = max(bb.size.X, bb.size.Y)  # the in-face axis, whichever it is
        assert span == pytest.approx(flat, abs=1e-6)


def test_the_side_gauge_is_far_bigger_than_the_top_face_one(config, cube_block):
    """The seat-height face is where the gauge earns its keep.

    The top face has only the 6 mm edge strip the quiet zone leaves; a side face
    has the whole flat width, and the gauge is *scaled* rather than re-typeset,
    so it may use it.
    """
    top = measure_gauge_3d(config)
    label = cube_block.side_labels[0]
    bb = label.solid.bounding_box()
    gauge_height = bb.max.Z - (CUBE_H / 2.0 + WIRE_STROKE_MM / 2.0)
    assert gauge_height > 2.0 * top.radius


def test_cube_body_stays_watertight_after_pocketing(cube_block):
    assert cube_block.body.is_valid and cube_block.body.is_manifold
    for sl in cube_block.side_labels:
        assert (cube_block.body & sl.solid).volume == pytest.approx(0.0, abs=1e-6)


# --------------------------------------------------------------------------- #
# Mono forms
# --------------------------------------------------------------------------- #


def test_mono_forms_exist_for_a_measure_block(block):
    rec = build_mono_recessed(block, PARAMS)
    rai = build_mono_raised(block, PARAMS)
    for solid in (rec, rai):
        assert len(solid.solids()) == 1 and solid.is_valid and solid.is_manifold
    assert rec.bounding_box().max.Z == pytest.approx(TILE_H, abs=1e-6)
    assert rai.bounding_box().max.Z == pytest.approx(
        TILE_H + PARAMS.mono_raise_height, abs=1e-6
    )

    def present(solid, x, y, z, s=0.4):
        inter = solid & Pos(x, y, z) * Box(s, s, s, align=(Align.CENTER,) * 3)
        return inter is not None and inter.volume > 1e-6

    # A black marker module is a well in one form and stands proud in the other.
    black = next(c for c in block.layout.modules if c.bit == 1)
    d = PARAMS.mono_pocket_depth
    assert not present(rec, black.rect.cx, black.rect.cy, TILE_H - d / 2)
    assert present(rai, black.rect.cx, black.rect.cy, TILE_H + PARAMS.mono_raise_height / 2)

    # ... and so is the bar itself, at the block's inner edge.
    bar = block.layout.wires[0]
    assert not present(rec, bar.cx, bar.cy, TILE_H - d / 2)
    assert present(rai, bar.cx, bar.cy, TILE_H + PARAMS.mono_raise_height / 2)


def test_mono_cube_sinks_the_side_bar_as_a_paint_well(cube_block):
    """A pen can colour a vertical face; a filament swap cannot — so both mono
    forms cut the side art as wells, and the well is the bar + gauge."""
    for solid in (
        build_mono_recessed(cube_block, PARAMS),
        build_mono_raised(cube_block, PARAMS),
    ):
        assert solid.is_valid and solid.is_manifold
        probe = Pos(30.0, 0.25, CUBE_H / 2.0) * Box(
            2.0, 0.5, WIRE_STROKE_MM * 0.5, align=(Align.CENTER,) * 3
        )
        assert (solid & probe).volume == pytest.approx(0.0, abs=1e-6)


# --------------------------------------------------------------------------- #
# One design, five pieces: generate vs plates
# --------------------------------------------------------------------------- #


def test_generate_emits_the_measure_block_once(tmp_path):
    """``generate`` is a *design* catalogue: one measurement block, not five."""
    from qamposer_hardware.cli import main

    rc = main(
        ["generate", "--variant", "tile", "--gates", "H", "--corners",
         "--out", str(tmp_path)]
    )
    assert rc == 0
    vdir = tmp_path / "tile"
    names = sorted(p.name for p in vdir.iterdir())
    expected = {
        f"{MEASURE_BLOCK_SLUG}-body-white.stl",
        f"{MEASURE_BLOCK_SLUG}-marker-black.stl",
        f"{MEASURE_BLOCK_SLUG}-accent-black.stl",
        f"{MEASURE_BLOCK_SLUG}.3mf",
    }
    assert expected <= set(names), f"missing: {expected - set(names)}"
    assert (vdir / f"{MEASURE_BLOCK_SLUG}.3mf").stat().st_size > 10_000
    # Exactly one design: no numbered copies (qmeasure-2.3mf and friends).
    assert [
        n for n in names if n.endswith(".3mf") and n.startswith(MEASURE_BLOCK_SLUG)
    ] == [f"{MEASURE_BLOCK_SLUG}.3mf"]
    # ... and the wire block is still there beside it: one flag, one family.
    assert f"{QUBIT_WIRE_SLUG}.3mf" in names


def test_generate_without_corners_has_no_measure_block(tmp_path):
    """Opt-in: the measurement block ships under ``--corners``, never implicitly."""
    from qamposer_hardware.cli import main

    assert main(["generate", "--variant", "tile", "--gates", "H", "--out", str(tmp_path)]) == 0
    names = {p.name for p in (tmp_path / "tile").iterdir()}
    assert not [n for n in names if n.startswith(MEASURE_BLOCK_SLUG)]


def test_furniture_ids_are_corners_plus_five_wires_plus_five_measures():
    """Totality of the shipped family, one entry per physical piece."""
    ids = furniture_ids()
    assert len(ids) == FURNITURE_TOTAL == 14
    counts = Counter(ids)
    assert counts[QUBIT_WIRE_ID] == QUBIT_WIRE_COPIES == 5
    assert counts[MEASURE_BLOCK_ID] == MEASURE_BLOCK_COPIES == 5
    assert [i for i in ids if i not in (QUBIT_WIRE_ID, MEASURE_BLOCK_ID)] == (
        corner_block_ids()
    )
    # Nothing else sneaks in.
    assert set(counts) == set(corner_block_ids()) | {QUBIT_WIRE_ID, MEASURE_BLOCK_ID}


@pytest.fixture(scope="module")
def furniture_infos(config, tmp_path_factory):
    """The shipped furniture plate: 14 blocks under the CLI's 8-piece bed cap."""
    out = tmp_path_factory.mktemp("furniture-measure")
    return export_corner_batches(
        config,
        variant="tile",
        height=TILE_H,
        bed=BED,
        spacing=SPACING,
        out_dir=out,
        params=PARAMS,
        max_per_bed=CAP,
    )


def test_plates_place_every_furniture_piece_exactly_once(furniture_infos):
    """Totality on the beds: 4 corners + 5 wire + 5 measurement blocks, all placed."""
    placed = [s for i in furniture_infos for s in i.slugs]
    assert Counter(placed) == Counter(
        {
            "ul": 1,
            "ur": 1,
            "lr": 1,
            "ll": 1,
            QUBIT_WIRE_SLUG: QUBIT_WIRE_COPIES,
            MEASURE_BLOCK_SLUG: MEASURE_BLOCK_COPIES,
        }
    )
    assert len(placed) == FURNITURE_TOTAL
    for info in furniture_infos:
        assert info.path.exists() and info.path.stat().st_size > 10_000
        assert len(info.positions) == len(info.slugs)


def test_fourteen_blocks_split_across_two_beds_under_the_wipe_tower_cap(
    furniture_infos,
):
    """14 > the 8-piece cap, so the family becomes batch1 (8) + batch2 (6)."""
    assert [i.path.name for i in furniture_infos] == [
        "corners-batch1.3mf",
        "corners-batch2.3mf",
    ]
    assert [len(i.slugs) for i in furniture_infos] == [CAP, FURNITURE_TOTAL - CAP]
    # Every piece keeps its own bed slot: no two pieces on one position.
    for info in furniture_infos:
        assert len(set(info.positions)) == len(info.positions)


def test_the_furniture_plate_still_needs_only_white_and_black(furniture_infos):
    """Adding the measurement blocks must not add a filament slot to the plate."""
    for info in furniture_infos:
        mesher = Mesher()
        mesher.read(str(info.path))
        group_ids = set()
        for mesh in mesher.meshes:
            gid, _pid, has = mesh.GetObjectLevelProperty()
            if has:
                group_ids.add(gid)
        assert len(group_ids) == 1
        group = mesher.model.GetBaseMaterialGroupByID(group_ids.pop())
        names = [group.GetName(pid) for pid in group.GetAllPropertyIDs()]
        assert names == ["white", "black"]


# --------------------------------------------------------------------------- #
# corners.md documents the measurement blocks
# --------------------------------------------------------------------------- #


def test_corners_md_documents_the_measure_blocks(config, tmp_path):
    path = write_corners_md(config, tmp_path)
    text = path.read_text(encoding="utf-8")
    assert "Measurement blocks" in text
    assert f"`{MEASURE_BLOCK_SLUG}`" in text
    assert f"marker ID {MEASURE_BLOCK_ID}" in text
    # Where they go, that they are optional, and that they never make a wire.
    assert "right edge" in text and "`UR`" in text and "`LR`" in text
    assert "optional" in text.lower()
    assert "ignored" in text
    assert f"{config.board.pitch:g} mm" in text  # the row pitch, quoted from toml
    # The other two families are still there — one file covers the whole set.
    assert "Qubit-wire blocks" in text
    for label in ("UL", "UR", "LL", "LR"):
        assert label in text


def test_the_furniture_face_layouts_are_all_distinct(config):
    """Three families, three faces — no accidental copy of another's geometry."""
    m = measure_face_layout(config)
    assert m.marker_id == MEASURE_BLOCK_ID
    assert m.gauge is not None
    assert m.wires  # it does carry a bar

    from qamposer_hardware.face import qubit_wire_face_layout

    w = qubit_wire_face_layout(config)
    assert w.marker_id == QUBIT_WIRE_ID
    assert w.gauge is None  # only the measurement block has one
    assert w.label == "q" and m.label == ""

    for mid in corner_block_ids():
        c = corner_face_layout(mid, config)
        assert c.gauge is None and c.wires == ()
