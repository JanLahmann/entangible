"""Qubit-wire blocks — one design, printed five times, that sets the qubit count.

The wire block (marker ID 46) is the third kind of piece in the kit: not a gate,
not a corner, but board *furniture*. Up to five **identical** blocks sit along
the board's left edge and each declares one qubit wire at its own height, so the
signal is the block's *position* and the set's *count* — never the marker, which
is the same on all five.

That makes two things design-time invariants rather than cosmetics, and both are
pinned here:

* **The marker centre is the wire.** The marker is the tile's 36 mm marker,
  centred on both axes, so the point the detector reports is the block's centre
  is the declared wire's height. Centre the block on a row and the wire is on
  the row; turn the block 180° and it declares the same wire.
* **The wire line may not enter the quiet zone.** A 36 mm marker plus
  ``tile.min_quiet_zone`` leaves only a 6 mm strip at each edge, so an unbroken
  full-width line at mid-height is impossible: the line is drawn in the two runs
  the quiet zone leaves free and passes *behind* the marker, exactly as a
  circuit-diagram wire passes behind a gate box. Both stubs still touch the
  block's edge — that is the ink the eye carries on into the row.

Also pinned: the black-only ink (no filament slot), the cube's side art, the mono
forms, the one-design/five-pieces split between ``generate`` and ``plates``, and
the opt-in rule — the wire block ships under the same ``--corners`` flag as the
corner blocks, because they are one board-furniture family.
"""

from __future__ import annotations

from collections import Counter

import pytest
from build123d import Align, Box, Mesher, Pos
from qamposer_assets.config import load_config
from qamposer_assets.marker_svg import marker_bit_matrix
from qamposer_assets.qubit_wire_block import (
    QUBIT_WIRE_COPIES,
    QUBIT_WIRE_ID,
    QUBIT_WIRE_LABEL,
    QUBIT_WIRE_SLUG,
    WIRE_STROKE_MM,
    qubit_wire_glyph_box,
    qubit_wire_line_y,
    qubit_wire_marker_origin,
    qubit_wire_segments,
    qubit_wire_spec,
)
from qamposer_vision.markers import MARKER_TABLE, RESERVED_IDS

from qamposer_hardware.build import (
    build_mono_raised,
    build_mono_recessed,
    build_qubit_wire_block,
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
    qubit_wire_face_layout,
)
from qamposer_hardware.pack import Bed
from qamposer_hardware.params import HardwareParams

BED = Bed(250.0, 220.0)
SPACING = 8.0
TILE_H = 6.0
CUBE_H = 60.0
PARAMS = HardwareParams()

#: The CLI's shipped wipe-tower cap — the reason nine furniture blocks become
#: two beds. Spelled out here so a change to the default fails visibly.
CAP = 8


@pytest.fixture(scope="module")
def config():
    return load_config()


@pytest.fixture(scope="module")
def block(config):
    """The wire block at tile height, built once."""
    return build_qubit_wire_block(
        config, variant="tile", height=TILE_H, params=PARAMS
    )


@pytest.fixture(scope="module")
def cube_block(config):
    """The wire block at cube height — the variant that carries side art."""
    return build_qubit_wire_block(
        config, variant="cube", height=CUBE_H, params=PARAMS
    )


# --------------------------------------------------------------------------- #
# Identity: marker 46, one design, neither a gate nor a corner
# --------------------------------------------------------------------------- #


def test_the_block_is_marker_46_and_the_id_is_claimed():
    """46 — the ID reserved for it, and *not* one of the still-free 47-49."""
    assert QUBIT_WIRE_ID == 46
    assert QUBIT_WIRE_ID not in RESERVED_IDS
    # No gate and no corner may ever claim it.
    spec = MARKER_TABLE.get(QUBIT_WIRE_ID)
    assert spec is None or spec.kind not in ("gate", "corner")


def test_bit_pattern_is_the_dictionary_matrix_for_46(config, block):
    """Module-for-module the OpenCV matrix for ID 46 — no other ID's pattern."""
    matrix = marker_bit_matrix(QUBIT_WIRE_ID, config.aruco_dictionary)
    got = {(m.row, m.col): m.bit for m in block.layout.modules}
    assert len(got) == len(matrix) * len(matrix[0])
    for r, row in enumerate(matrix):
        for c, bit in enumerate(row):
            assert got[(r, c)] == bit, f"module ({r},{c})"
    assert block.layout.black_cells
    # ... and it really is a *different* marker from every corner block's.
    for mid in corner_block_ids():
        assert marker_bit_matrix(mid, config.aruco_dictionary) != matrix


def test_the_spec_is_board_furniture_not_a_gate_or_a_corner():
    spec = qubit_wire_spec()
    assert spec.kind not in ("gate", "corner")
    assert spec.parameter is None and spec.dial_axis is None


def test_slug_is_the_one_design(block):
    assert tile_slug(block.layout.spec) == QUBIT_WIRE_SLUG == "qwire"


def test_gate_and_corner_layouts_both_reject_the_wire_block(config):
    """It has neither a gate face nor a corner face — asking must fail loudly."""
    with pytest.raises(ValueError):
        face_layout(QUBIT_WIRE_ID, config)
    with pytest.raises(ValueError):
        corner_face_layout(QUBIT_WIRE_ID, config)


def test_the_cli_never_offers_it_as_a_gate():
    from qamposer_hardware.cli import _all_gate_ids

    assert QUBIT_WIRE_ID not in _all_gate_ids()


# --------------------------------------------------------------------------- #
# The marker centre IS the wire: centred marker, tile size, mid-height line
# --------------------------------------------------------------------------- #


def test_marker_is_the_tiles_marker_centred_on_both_axes(config, block):
    """36 mm (``tile.marker_size``) — never the corner block's 40 mm — centred."""
    t = config.tile
    assert t.marker_size != config.board.corner_marker_size  # guard the premise
    n = len(marker_bit_matrix(QUBIT_WIRE_ID, config.aruco_dictionary))
    assert block.layout.module_size * n == pytest.approx(t.marker_size)

    mx, my = qubit_wire_marker_origin(config)
    assert mx == pytest.approx((t.size - t.marker_size) / 2.0)
    assert my == pytest.approx(mx)  # centred on *both* axes, unlike a gate tile
    # Every margin equal: the marker centre is the block centre.
    assert mx + t.marker_size / 2.0 == pytest.approx(t.size / 2.0)


def test_marker_centre_equals_the_wire_height(config, block):
    """The point the detector reports is the height of the declared wire."""
    centre = config.tile.size / 2.0
    assert qubit_wire_line_y(config) == pytest.approx(centre)
    xs = [m.rect.cx for m in block.layout.modules]
    ys = [m.rect.cy for m in block.layout.modules]
    assert (min(xs) + max(xs)) / 2.0 == pytest.approx(centre)
    assert (min(ys) + max(ys)) / 2.0 == pytest.approx(centre)
    for wr in block.layout.wires:
        assert wr.cy == pytest.approx(centre)


def test_wire_runs_reach_both_edges_and_clear_the_quiet_zone(config):
    """Two runs: block edge → quiet zone, quiet zone → block edge."""
    t = config.tile
    mx, _my = qubit_wire_marker_origin(config)
    (outer, inner) = qubit_wire_segments(config)
    assert outer[0] == pytest.approx(0.0)  # touches the outer edge
    assert inner[1] == pytest.approx(t.size)  # touches the inner edge
    assert outer[1] == pytest.approx(mx - t.min_quiet_zone)
    assert inner[0] == pytest.approx(mx + t.marker_size + t.min_quiet_zone)
    # Both stubs are real ink, not a rounding artefact.
    assert outer[1] - outer[0] == pytest.approx(t.min_quiet_zone)
    assert inner[1] - inner[0] == pytest.approx(t.min_quiet_zone)
    # A single unbroken line would be illegal — that is *why* there are two.
    assert outer[1] < inner[0]


def test_a_180_degree_turn_declares_the_same_wire(config, block):
    """Placement is forgiving by construction: the art is point-symmetric.

    A corner block turned 90° skews the whole board; a wire block has no such
    trap. Rotating it about its own centre maps the marker (centred) and the
    wire runs (mirrored pair at mid-height) onto themselves, so the height it
    declares is unchanged. Only the ``q`` moves — a reading aid, not a fiducial.
    """
    size = config.tile.size
    runs = {(round(w.x0, 6), round(w.x1, 6), round(w.cy, 6)) for w in block.layout.wires}
    turned = {
        (round(size - x1, 6), round(size - x0, 6), round(size - cy, 6))
        for x0, x1, cy in runs
    }
    assert turned == runs


def test_the_glyph_sits_in_the_inner_strip_beside_the_wire(config):
    """The ``q`` is on the inner (right) edge, above the wire, inside the face."""
    t = config.tile
    gx, gy, gw, gh = qubit_wire_glyph_box(config)
    (_outer, inner) = qubit_wire_segments(config)
    assert gx == pytest.approx(inner[0])  # the inner strip, i.e. right of the marker
    assert gx + gw <= t.size  # inside the block
    assert gy >= 0.0
    assert gy + gh < qubit_wire_line_y(config) - WIRE_STROKE_MM / 2.0  # above the line
    assert gw > 1.0 and gh > 1.0


def test_no_ink_at_all_inside_the_markers_quiet_zone(config, block):
    """Totality, in solids: neither the wire nor the ``q`` enters the zone.

    Checked on the built accent rather than on the coordinates it came from, so
    a future glyph or line change that spills over is caught even if the numbers
    still look right.
    """
    t = config.tile
    mx, my = qubit_wire_marker_origin(config)
    qz = t.min_quiet_zone
    side = t.marker_size + 2.0 * qz
    zone = Pos(mx + t.marker_size / 2.0, my + t.marker_size / 2.0, TILE_H / 2.0) * Box(
        side, side, 2.0 * TILE_H, align=(Align.CENTER,) * 3
    )
    assert (block.accent & zone).volume == pytest.approx(0.0, abs=1e-6)


# --------------------------------------------------------------------------- #
# The built face: a wire that reaches both edges, plus a glyph
# --------------------------------------------------------------------------- #


def test_accent_spans_the_full_width_at_mid_height(config, block):
    """The wire really is drawn edge to edge (font-independent: it is a bar)."""
    size = config.tile.size
    bb = block.accent.bounding_box()
    assert bb.min.X == pytest.approx(0.0, abs=1e-6)
    assert bb.max.X == pytest.approx(size, abs=1e-6)
    assert bb.min.Z == pytest.approx(TILE_H - PARAMS.face_depth, abs=1e-6)
    assert bb.max.Z == pytest.approx(TILE_H, abs=1e-6)
    # A probe at each edge, on the centre line, finds ink.
    for x in (0.5, size - 0.5):
        probe = Pos(x, size / 2.0, TILE_H - PARAMS.face_depth / 2.0) * Box(
            0.4, 0.4, 0.4, align=(Align.CENTER,) * 3
        )
        assert (block.accent & probe).volume > 1e-6, f"no wire ink at x={x}"


def test_the_accent_carries_a_glyph_as_well_as_the_wire(config, block):
    """Accent volume exceeds the two bars, i.e. the ``q`` is really there.

    Deliberately not a glyph-shape assertion: OpenCASCADE resolves the font
    differently on macOS and on a Linux CI runner, so only the *presence* of ink
    beyond the bars and its containment in the band are portable.
    """
    bars = sum(w.area for w in block.layout.wires) * PARAMS.face_depth
    assert block.accent.volume > bars * 1.2
    assert block.layout.label == QUBIT_WIRE_LABEL == "q"
    band = block.layout.band
    glyph = block.accent - Pos(
        config.tile.size / 2.0, qubit_wire_line_y(config), TILE_H - PARAMS.face_depth
    ) * Box(
        3.0 * config.tile.size,
        WIRE_STROKE_MM + 0.2,
        2.0 * PARAMS.face_depth,
        align=(Align.CENTER, Align.CENTER, Align.MIN),
    )
    gb = glyph.bounding_box()
    assert gb.min.X >= band.x0 - 1e-6 and gb.max.X <= band.x1 + 1e-6
    assert gb.min.Y >= band.y0 - 1e-6 and gb.max.Y <= band.y1 + 1e-6


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
# Side faces (cube height) — the wire reads from any seat
# --------------------------------------------------------------------------- #


def test_flat_block_has_no_side_art(block):
    assert block.side_labels == []


def test_cube_repeats_the_wire_on_all_four_sides(cube_block):
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


def test_side_wire_bar_sits_at_mid_height_and_spans_the_flat_face(
    config, cube_block
):
    """The bar is the load-bearing mark: exact Z, exact width, font-independent.

    The ``q`` above it is fitted text, so only its upper bound is asserted (it
    must stay inside ``side_label_margin`` of the top edge whatever the host
    font substitutes).
    """
    size = config.tile.size
    flat = size - 2.0 * config.tile.corner_radius
    for sl in cube_block.side_labels:
        bb = sl.solid.bounding_box()
        assert bb.min.Z == pytest.approx(CUBE_H / 2.0 - WIRE_STROKE_MM / 2.0, abs=1e-6)
        assert bb.max.Z <= CUBE_H - PARAMS.side_label_margin + 1e-6
        assert bb.max.Z > CUBE_H / 2.0 + WIRE_STROKE_MM  # the q is above the bar
        span = max(bb.size.X, bb.size.Y)  # the in-face axis, whichever it is
        assert span == pytest.approx(flat, abs=1e-6)


def test_cube_body_stays_watertight_after_pocketing(cube_block):
    assert cube_block.body.is_valid and cube_block.body.is_manifold
    for sl in cube_block.side_labels:
        assert (cube_block.body & sl.solid).volume == pytest.approx(0.0, abs=1e-6)


# --------------------------------------------------------------------------- #
# Mono forms
# --------------------------------------------------------------------------- #


def test_mono_forms_exist_for_a_wire_block(block):
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

    # ... and so is the wire line itself, at the block's outer edge.
    wire = block.layout.wires[0]
    assert not present(rec, wire.cx, wire.cy, TILE_H - d / 2)
    assert present(rai, wire.cx, wire.cy, TILE_H + PARAMS.mono_raise_height / 2)


def test_mono_cube_sinks_the_side_wire_as_a_paint_well(cube_block):
    """A pen can colour a vertical face; a filament swap cannot — so both mono
    forms cut the side art as wells, and the well is the *wire*, not a gate name."""
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


def test_generate_emits_the_wire_block_once(tmp_path):
    """``generate`` is a *design* catalogue: one wire block, not five copies."""
    from qamposer_hardware.cli import main

    rc = main(
        ["generate", "--variant", "tile", "--gates", "H", "--corners",
         "--out", str(tmp_path)]
    )
    assert rc == 0
    vdir = tmp_path / "tile"
    names = sorted(p.name for p in vdir.iterdir())
    expected = {
        f"{QUBIT_WIRE_SLUG}-body-white.stl",
        f"{QUBIT_WIRE_SLUG}-marker-black.stl",
        f"{QUBIT_WIRE_SLUG}-accent-black.stl",
        f"{QUBIT_WIRE_SLUG}.3mf",
    }
    assert expected <= set(names), f"missing: {expected - set(names)}"
    assert (vdir / f"{QUBIT_WIRE_SLUG}.3mf").stat().st_size > 10_000
    # Exactly one design: no numbered copies (qwire-2.3mf and friends).
    assert [n for n in names if n.endswith(".3mf") and n.startswith(QUBIT_WIRE_SLUG)] == [
        f"{QUBIT_WIRE_SLUG}.3mf"
    ]


def test_generate_without_corners_has_no_wire_block(tmp_path):
    """Opt-in: the wire block ships under ``--corners``, never implicitly."""
    from qamposer_hardware.cli import main

    assert main(["generate", "--variant", "tile", "--gates", "H", "--out", str(tmp_path)]) == 0
    names = {p.name for p in (tmp_path / "tile").iterdir()}
    assert not [n for n in names if n.startswith(QUBIT_WIRE_SLUG)]


def test_furniture_ids_are_four_corners_and_five_wires():
    ids = furniture_ids()
    assert len(ids) == len(corner_block_ids()) + QUBIT_WIRE_COPIES == 9
    assert Counter(ids)[QUBIT_WIRE_ID] == QUBIT_WIRE_COPIES == 5
    assert [i for i in ids if i != QUBIT_WIRE_ID] == corner_block_ids()


@pytest.fixture(scope="module")
def furniture_infos(config, tmp_path_factory):
    """The shipped furniture plate: nine blocks, the CLI's 8-piece bed cap."""
    out = tmp_path_factory.mktemp("furniture")
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


def test_plates_place_five_wire_blocks_exactly_once_each(furniture_infos):
    """Totality on the furniture bed: 4 corners + 5 wire blocks, all placed."""
    placed = [s for i in furniture_infos for s in i.slugs]
    assert Counter(placed) == Counter(
        {"ul": 1, "ur": 1, "lr": 1, "ll": 1, QUBIT_WIRE_SLUG: QUBIT_WIRE_COPIES}
    )
    assert len(placed) == 9
    for info in furniture_infos:
        assert info.path.exists() and info.path.stat().st_size > 10_000
        assert len(info.positions) == len(info.slugs)


def test_nine_blocks_split_across_two_beds_under_the_wipe_tower_cap(furniture_infos):
    """9 > the 8-piece cap, so the family becomes batch1 + batch2 — cleanly."""
    assert [i.path.name for i in furniture_infos] == [
        "corners-batch1.3mf",
        "corners-batch2.3mf",
    ]
    assert [len(i.slugs) for i in furniture_infos] == [CAP, 9 - CAP]
    # Every piece keeps its own bed slot: no two pieces on one position.
    for info in furniture_infos:
        assert len(set(info.positions)) == len(info.positions)


def test_the_furniture_plate_still_needs_only_white_and_black(furniture_infos):
    """Adding the wire blocks must not add a filament slot to the plate."""
    mesher = Mesher()
    mesher.read(str(furniture_infos[0].path))
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
# corners.md documents the wire blocks
# --------------------------------------------------------------------------- #


def test_corners_md_documents_the_wire_blocks(config, tmp_path):
    path = write_corners_md(config, tmp_path)
    text = path.read_text(encoding="utf-8")
    assert "Qubit-wire blocks" in text
    assert f"`{QUBIT_WIRE_SLUG}`" in text
    assert f"marker ID {QUBIT_WIRE_ID}" in text
    # How many to print, where they go, which one is q1, how far apart.
    assert "3-5" in text
    assert "left edge" in text and "`UL`" in text and "`LL`" in text
    assert "q1" in text
    assert f"{config.board.pitch:g} mm" in text  # the row pitch, quoted from toml
    # The corner section is still there — one file covers the whole family.
    for label in ("UL", "UR", "LL", "LR"):
        assert label in text
