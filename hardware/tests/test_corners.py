"""Board-corner blocks — the printed mat's four corners, as printable pieces.

A block is only useful if it is a *literal crop of the mat's corner*: same
marker, same size, same inset, same **rotation**. The board homography is fitted
from each marker's four corner points, so a block that is off by a 90° turn does
not merely look wrong — it skews the whole board transform and every tile lands
in the wrong cell. These are therefore design-time convention tests: they pin the
block against the detector's own geometry (``BoardConfig.corner_marker_square``),
against the shared TS ``geometry.json``, and against the mat SVG's marker
artwork, so a change to any one of them fails here rather than on a table.

Also pinned: the two orientation cues on the face (an off-centre marker and an
upright inner-edge label), the quiet zone the label must stay out of, the fact
that a corner block adds **no filament slot** (its ink is the marker black), the
mono forms, and the opt-in rule — corner blocks appear in a kit only when they
are asked for.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from build123d import Mesher
from qamposer_assets.config import load_config
from qamposer_assets.corner_block import (
    CORNER_BLOCK_LABELS,
    corner_block_crop_origin,
    corner_block_ids,
    corner_block_label,
    corner_block_label_strip,
    corner_block_marker_origin,
)
from qamposer_assets.marker_svg import marker_bit_matrix, marker_group
from qamposer_vision.board import BoardConfig
from qamposer_vision.markers import CORNER_IDS, MARKER_TABLE

from qamposer_hardware.build import (
    build_corner_block,
    build_mono_raised,
    build_mono_recessed,
)
from qamposer_hardware.export import (
    export_corner_batches,
    single_plate_groups,
    tile_slug,
    write_corners_md,
)
from qamposer_hardware.face import corner_face_layout
from qamposer_hardware.pack import Bed
from qamposer_hardware.params import HardwareParams

BED = Bed(250.0, 220.0)
SPACING = 8.0
TILE_H = 6.0
CUBE_H = 60.0
PARAMS = HardwareParams()

#: Jan's naming, spelled out here rather than imported, so a silent edit to the
#: mapping in the source fails this test instead of passing vacuously.
EXPECTED_LABELS = {0: "UL", 1: "UR", 2: "LR", 3: "LL"}

#: The TS side of the geometry contract (pocket-app reads this file).
_GEOMETRY_JSON = (
    Path(__file__).resolve().parents[2]
    / "pocket-app"
    / "src"
    / "vision"
    / "geometry.json"
)


@pytest.fixture(scope="module")
def config():
    return load_config()


@pytest.fixture(scope="module")
def blocks(config):
    """All four corner blocks at tile height, built once."""
    return {
        mid: build_corner_block(mid, config, variant="tile", height=TILE_H, params=PARAMS)
        for mid in corner_block_ids()
    }


@pytest.fixture(scope="module")
def cube_block(config):
    """The UL block at cube height — the variant that carries side letters."""
    return build_corner_block(0, config, variant="cube", height=CUBE_H, params=PARAMS)


# --------------------------------------------------------------------------- #
# Identity: four blocks, the right IDs, the right labels
# --------------------------------------------------------------------------- #


def test_four_blocks_with_the_board_corner_ids():
    assert corner_block_ids() == [0, 1, 2, 3]
    assert set(corner_block_ids()) == set(CORNER_IDS)
    for mid in corner_block_ids():
        assert MARKER_TABLE[mid].kind == "corner"


def test_labels_are_the_kit_naming_and_map_onto_detector_roles():
    """UL=TL(0), UR=TR(1), LR=BR(2), LL=BL(3) — left side = circuit start."""
    assert CORNER_BLOCK_LABELS == EXPECTED_LABELS
    role_of = {0: "TL", 1: "TR", 2: "BR", 3: "BL"}
    for mid, label in EXPECTED_LABELS.items():
        assert CORNER_IDS[mid] == role_of[mid]
        assert corner_block_label(mid) == label
        # First letter = upper/lower, second = left/right, and that agrees with
        # the detector's own Top/Bottom + Left/Right role name.
        assert label[0] == ("U" if role_of[mid][0] == "T" else "L")
        assert label[1] == role_of[mid][1]


def test_block_slug_uses_the_kit_label(blocks):
    assert {tile_slug(p.layout.spec) for p in blocks.values()} == {
        "ul",
        "ur",
        "lr",
        "ll",
    }


def test_gate_layout_rejects_a_corner_and_vice_versa(config):
    from qamposer_hardware.face import face_layout

    with pytest.raises(ValueError):
        face_layout(0, config)
    with pytest.raises(ValueError):
        corner_face_layout(10, config)


# --------------------------------------------------------------------------- #
# The block IS the mat's corner: size, position, bit pattern, rotation
# --------------------------------------------------------------------------- #


def test_marker_is_the_mats_corner_marker_not_the_tiles(config, blocks):
    """40 mm (board.corner_marker_size), never the 36 mm gate-tile marker."""
    b = config.board
    assert b.corner_marker_size != config.tile.marker_size  # guard the premise
    for mid, parts in blocks.items():
        layout = parts.layout
        n = len(marker_bit_matrix(mid, config.aruco_dictionary))
        assert layout.module_size * n == pytest.approx(b.corner_marker_size)


def test_marker_lands_exactly_where_the_mat_has_it(config):
    """crop origin + marker origin == ``BoardConfig.corner_marker_square``.

    The detector's own source of truth for where a corner marker sits on the
    mat. Place the block's outer corner on the mat's and the marker is, to the
    millimetre, the marker the homography expects.
    """
    board = BoardConfig.from_toml()
    for mid in corner_block_ids():
        cx, cy = corner_block_crop_origin(mid, config)
        mx, my = corner_block_marker_origin(mid, config)
        square = board.corner_marker_square(mid)
        assert (cx + mx, cy + my) == pytest.approx(tuple(square[0]))
        # ... and the far corner too, i.e. the size matches as well.
        size = config.board.corner_marker_size
        assert (cx + mx + size, cy + my + size) == pytest.approx(tuple(square[2]))


def test_marker_inset_matches_the_shared_ts_geometry(config):
    """``geometry.json`` (the TS side) and ``assets.toml`` must not drift."""
    geo = json.loads(_GEOMETRY_JSON.read_text(encoding="utf-8"))["board"]
    assert geo["cornerMarkerSize"] == config.board.corner_marker_size
    assert geo["cornerMargin"] == config.board.corner_margin
    margin = geo["cornerMargin"]
    inner = config.tile.size - margin - geo["cornerMarkerSize"]
    expected = {
        0: (margin, margin),
        1: (inner, margin),
        2: (inner, inner),
        3: (margin, inner),
    }
    for mid, want in expected.items():
        assert corner_block_marker_origin(mid, config) == pytest.approx(want)


def test_bit_pattern_is_the_mats_bit_pattern(config, blocks):
    """Module-for-module identical to the dictionary matrix the mat draws."""
    for mid, parts in blocks.items():
        matrix = marker_bit_matrix(mid, config.aruco_dictionary)
        got = {(m.row, m.col): m.bit for m in parts.layout.modules}
        assert len(got) == len(matrix) * len(matrix[0])
        for r, row in enumerate(matrix):
            for c, bit in enumerate(row):
                assert got[(r, c)] == bit, f"marker {mid} module ({r},{c})"
        # A real marker has black modules (the border alone guarantees it).
        assert parts.layout.black_cells


def test_marker_artwork_equals_the_mats_corner_group(config):
    """The laser block's marker SVG is the mat's, translated by the crop.

    ``board._corners_group`` emits ``marker_group(id, x, y, corner_marker_size)``
    with **no rotation**; the block must emit the byte-identical group at the
    crop-relative position. Comparing the rendered SVG (not just the bit matrix)
    also pins the module *order* and run-length merging, i.e. the artwork.
    """
    from qamposer_assets.board import _corner_positions
    from qamposer_assets.laser import laser_corner_body

    size = config.board.corner_marker_size
    for mid in corner_block_ids():
        mat_x, mat_y = _corner_positions(config)[mid]
        crop_x, crop_y = corner_block_crop_origin(mid, config)
        local_x, local_y = corner_block_marker_origin(mid, config)
        # The mat position really is the crop position plus the local offset.
        assert (crop_x + local_x, crop_y + local_y) == pytest.approx((mat_x, mat_y))
        expected = marker_group(
            mid,
            local_x,
            local_y,
            size,
            dictionary=config.aruco_dictionary,
            group_id="marker",
            with_background=False,
        )
        assert expected in laser_corner_body(mid, config)


def test_marker_rotation_is_canonical_row0_toward_the_board_top(config, blocks):
    """Row 0 of the matrix sits at the largest Y — the mat's "up" — on all four.

    In the 3D face frame ``Y = size − y_svg``, so the SVG's top row (the mat's
    top row, since the mat draws every corner marker unrotated) must be the row
    with the greatest Y. All four blocks share this: they are crops of one mat,
    not four independently-oriented pieces.
    """
    for mid, parts in blocks.items():
        by_row: dict[int, float] = {}
        for cell in parts.layout.modules:
            by_row.setdefault(cell.row, cell.rect.cy)
            assert cell.rect.cy == pytest.approx(by_row[cell.row]), "row not level"
        rows = sorted(by_row)
        ys = [by_row[r] for r in rows]
        assert ys == sorted(ys, reverse=True), f"marker {mid} rows not top-down"


def test_rotating_a_block_would_change_the_marker(config):
    """The orientation cues are not decoration: a 90° turn is a different marker.

    If the bit matrix were 90°-symmetric a misplaced block would be harmless and
    the labels pointless. It is not — so the cues are load-bearing.
    """

    def rot90(matrix):
        n = len(matrix)
        return tuple(
            tuple(matrix[n - 1 - c][r] for c in range(n)) for r in range(n)
        )

    for mid in corner_block_ids():
        matrix = marker_bit_matrix(mid, config.aruco_dictionary)
        turned = matrix
        for _ in range(3):
            turned = rot90(turned)
            assert turned != matrix, f"marker {mid} is rotation-symmetric"


# --------------------------------------------------------------------------- #
# Orientation cues on the face: off-centre marker + upright inner-edge label
# --------------------------------------------------------------------------- #


def test_marker_is_visibly_off_centre_toward_the_outer_corner(config):
    """Outer margins are the mat's ``corner_margin``; the inner ones are larger."""
    b = config.board
    size = config.tile.size
    for mid in corner_block_ids():
        role = CORNER_IDS[mid]
        mx, my = corner_block_marker_origin(mid, config)
        left, top = mx, my
        right = size - mx - b.corner_marker_size
        bottom = size - my - b.corner_marker_size
        outer_x, inner_x = (left, right) if role in ("TL", "BL") else (right, left)
        outer_y, inner_y = (top, bottom) if role in ("TL", "TR") else (bottom, top)
        assert outer_x == pytest.approx(b.corner_margin)
        assert outer_y == pytest.approx(b.corner_margin)
        assert inner_x > outer_x and inner_y > outer_y  # the cue is visible


def test_label_strip_is_on_the_inner_edge_and_clears_the_quiet_zone(config):
    """No ink within ``tile.min_quiet_zone`` of the marker, on any side."""
    b = config.board
    t = config.tile
    for mid in corner_block_ids():
        role = CORNER_IDS[mid]
        mx, my = corner_block_marker_origin(mid, config)
        sx, sy, sw, sh = corner_block_label_strip(mid, config)
        assert sh > 1.0
        # Fully inside the face.
        assert sx >= 0 and sy >= 0 and sx + sw <= t.size and sy + sh <= t.size
        # Clear of the marker's quiet zone, on the board-inward side.
        if role in ("TL", "TR"):  # upper block → strip below the marker
            assert sy >= my + b.corner_marker_size + t.min_quiet_zone - 1e-9
            assert sy + sh > my  # it really is the lower edge
        else:  # lower block → strip above the marker
            assert sy + sh <= my - t.min_quiet_zone + 1e-9
            assert sy < my


def test_label_text_is_the_block_label(config, blocks):
    for mid, parts in blocks.items():
        assert parts.layout.label == EXPECTED_LABELS[mid]
        assert parts.layout.side_label == EXPECTED_LABELS[mid]


def test_label_solid_sits_in_the_strip_and_in_the_top_colour_layer(blocks):
    """The engraved label is exactly the strip's slot in the top face layer."""
    for mid, parts in blocks.items():
        band = parts.layout.band
        bb = parts.accent.bounding_box()
        assert bb.min.X >= band.x0 - 1e-6 and bb.max.X <= band.x1 + 1e-6
        assert bb.min.Y >= band.y0 - 1e-6 and bb.max.Y <= band.y1 + 1e-6
        assert bb.min.Z == pytest.approx(TILE_H - PARAMS.face_depth, abs=1e-6)
        assert bb.max.Z == pytest.approx(TILE_H, abs=1e-6)


def test_block_is_a_single_watertight_body(blocks):
    for mid, parts in blocks.items():
        assert parts.body.is_valid and parts.body.is_manifold, mid
        bb = parts.body.bounding_box()
        assert bb.size.X == pytest.approx(60.0, abs=1e-5)
        assert bb.size.Y == pytest.approx(60.0, abs=1e-5)
        assert bb.max.Z == pytest.approx(TILE_H, abs=1e-5)
        # Colour parts never overlap the white body or each other.
        assert (parts.marker & parts.accent).volume == pytest.approx(0.0, abs=1e-9)
        assert (parts.body & parts.marker).volume == pytest.approx(0.0, abs=1e-6)


# --------------------------------------------------------------------------- #
# Side faces (cube height) — the #62 side-letter inlay, in black
# --------------------------------------------------------------------------- #


def test_flat_block_has_no_side_labels(blocks):
    for parts in blocks.values():
        assert parts.side_labels == []


def test_cube_block_carries_the_label_on_all_four_sides(cube_block):
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


def test_cube_block_body_stays_watertight_after_pocketing(cube_block):
    assert cube_block.body.is_valid and cube_block.body.is_manifold
    for sl in cube_block.side_labels:
        assert (cube_block.body & sl.solid).volume == pytest.approx(0.0, abs=1e-6)


# --------------------------------------------------------------------------- #
# Filament slots: a corner block adds geometry, never a colour
# --------------------------------------------------------------------------- #


def _palette(path) -> list[tuple[str, str]]:
    mesher = Mesher()
    mesher.read(str(path))
    group_ids = set()
    for mesh in mesher.meshes:
        gid, _pid, has = mesh.GetObjectLevelProperty()
        if has:
            group_ids.add(gid)
    assert len(group_ids) == 1, f"expected one shared material group, got {group_ids}"
    group = mesher.model.GetBaseMaterialGroupByID(group_ids.pop())
    out = []
    for pid in group.GetAllPropertyIDs():
        r, g, b, _a = mesher.wrapper.ColorToFloatRGBA(group.GetDisplayColor(pid))
        out.append(
            (group.GetName(pid), "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255)))
        )
    return out


def test_block_ink_is_the_marker_black(blocks):
    for parts in blocks.values():
        assert parts.layout.accent_hex == "#000000"
        assert parts.layout.accent_name == "black"


def test_corner_plate_needs_only_white_and_black(config, tmp_path):
    """The furniture plate — corners *and* wire blocks — is two filaments."""
    infos = export_corner_batches(
        config,
        variant="tile",
        height=TILE_H,
        bed=BED,
        spacing=SPACING,
        out_dir=tmp_path,
        params=PARAMS,
        ids=corner_block_ids(),
    )
    assert [i.path.name for i in infos] == ["corners-batch1.3mf"]
    assert _palette(infos[0].path) == [("white", "#ffffff"), ("black", "#000000")]


# --------------------------------------------------------------------------- #
# Mono forms
# --------------------------------------------------------------------------- #


def test_mono_forms_exist_for_a_corner_block(blocks):
    parts = blocks[0]
    rec = build_mono_recessed(parts, PARAMS)
    rai = build_mono_raised(parts, PARAMS)
    for solid in (rec, rai):
        assert len(solid.solids()) == 1 and solid.is_valid and solid.is_manifold
    assert rec.bounding_box().max.Z == pytest.approx(TILE_H, abs=1e-6)
    assert rai.bounding_box().max.Z == pytest.approx(
        TILE_H + PARAMS.mono_raise_height, abs=1e-6
    )
    # A black marker module is a well in one form and stands proud in the other.
    from build123d import Align, Box, Pos

    def present(solid, x, y, z, s=0.4):
        inter = solid & Pos(x, y, z) * Box(s, s, s, align=(Align.CENTER,) * 3)
        return inter is not None and inter.volume > 1e-6

    black = next(c for c in parts.layout.modules if c.bit == 1)
    d = PARAMS.mono_pocket_depth
    assert not present(rec, black.rect.cx, black.rect.cy, TILE_H - d / 2)
    assert present(rai, black.rect.cx, black.rect.cy, TILE_H + PARAMS.mono_raise_height / 2)


# --------------------------------------------------------------------------- #
# Opt-in: corner blocks appear only when asked for
# --------------------------------------------------------------------------- #


def test_corner_batch_totality_every_block_exactly_once(config, tmp_path):
    """Restricted to the corner IDs, each of the four is placed exactly once.

    (The default membership is the whole furniture family — corners *plus* the
    five wire blocks; that totality is asserted in ``test_qubit_wire.py``.)
    """
    infos = export_corner_batches(
        config,
        variant="tile",
        height=TILE_H,
        bed=BED,
        spacing=SPACING,
        out_dir=tmp_path,
        params=PARAMS,
        ids=corner_block_ids(),
    )
    placed = [s for i in infos for s in i.slugs]
    assert sorted(placed) == ["ll", "lr", "ul", "ur"]
    assert len(placed) == len(set(placed)) == 4
    for info in infos:
        assert info.path.exists() and info.path.stat().st_size > 10_000


def test_corner_batches_respect_the_cap(config, tmp_path):
    """A cap of 3 splits the four blocks across two beds, still exactly once."""
    infos = export_corner_batches(
        config,
        variant="tile",
        height=TILE_H,
        bed=BED,
        spacing=SPACING,
        out_dir=tmp_path,
        params=PARAMS,
        max_per_bed=3,
        ids=corner_block_ids(),
    )
    assert [i.path.name for i in infos] == [
        "corners-batch1.3mf",
        "corners-batch2.3mf",
    ]
    assert [len(i.slugs) for i in infos] == [3, 1]
    assert sorted(s for i in infos for s in i.slugs) == ["ll", "lr", "ul", "ur"]


def test_default_gate_plates_contain_no_corner_blocks(config):
    """The gate kit is untouched by the feature: corners are never implicit."""
    pieces = [m for g in single_plate_groups(config) for m in g["pieces"]]
    assert not (set(pieces) & set(corner_block_ids()))


def test_cli_corners_are_opt_in(tmp_path):
    from qamposer_hardware.cli import main

    plain = tmp_path / "plain"
    assert main(["generate", "--variant", "tile", "--gates", "H", "--out", str(plain)]) == 0
    names = {p.name for p in (plain / "tile").iterdir()}
    assert not [n for n in names if n.startswith(("ul", "ur", "ll", "lr", "qwire"))]
    assert "corners.md" not in names


def test_cli_corners_emit_the_block_file_set(tmp_path):
    from qamposer_hardware.cli import main

    rc = main(
        ["generate", "--variant", "tile", "--gates", "H", "--corners",
         "--out", str(tmp_path)]
    )
    assert rc == 0
    vdir = tmp_path / "tile"
    names = {p.name for p in vdir.iterdir()}
    expected = {
        "ul-body-white.stl",
        "ul-marker-black.stl",
        "ul-accent-black.stl",
        "ul.3mf",
        "ur.3mf",
        "lr.3mf",
        "ll.3mf",
        "corners.md",
        # The wire block ships under the same flag (see test_qubit_wire.py).
        "qwire.3mf",
    }
    assert expected <= names, f"missing: {expected - names}"
    for name in ("ul.3mf", "ll.3mf"):
        assert (vdir / name).stat().st_size > 10_000


def test_corners_md_is_stamped_and_documents_placement(config, tmp_path):
    import re

    path = write_corners_md(config, tmp_path)
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    assert lines[0].startswith("# ")
    stamp = re.compile(
        r"^> Generated from `(?:[0-9a-f]{7,40}|unknown)` on \d{4}-\d{2}-\d{2} — "
        r"regenerate with the matching checkout before printing\.$",
        re.MULTILINE,
    )
    assert stamp.match(lines[2]), lines[:4]
    assert len(stamp.findall(text)) == 1
    for label in EXPECTED_LABELS.values():
        assert label in text
    # It must say which way up, and quote the mat's own numbers.
    assert "upright" in text
    assert f"{config.board.corner_margin:g} mm" in text
    assert f"{config.board.mat_width:g} mm" in text
