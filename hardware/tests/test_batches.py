"""Bed-ready batch packing + multi-piece coloured 3MF round-trip.

Two layers of test:

* **Pure packing math** (:mod:`qamposer_hardware.pack`) — capacity, splitting,
  spacing, centring, no-overlap and in-bounds — with no build123d/slicing.
* **Batch 3MF** — build a small single and double batch, write the multi-object
  coloured 3MF, read it back and assert object count + per-object colours
  survive the round-trip (like the per-piece colour check), and that placed
  pieces are disjoint and inside the bed.
"""

from __future__ import annotations

import pytest
from build123d import Mesher
from qamposer_assets.config import load_config

from qamposer_hardware.build import build_double_tile, build_tile
from qamposer_hardware.face import double_color_name
from qamposer_hardware.export import (
    _double_piece,
    _export_batches,
    _single_piece,
    _write_batch_3mf,
    export_double_tile_3mf,
    export_tile_3mf,
    single_plate_groups,
)
from qamposer_hardware.pack import (
    EDGE_MARGIN,
    FOOTPRINT,
    Bed,
    bed_capacity,
    pack_positions,
    parse_bed,
    plan_batches,
)
from qamposer_hardware.params import HardwareParams

BED = Bed(250.0, 220.0)  # Prusa Core One default
SPACING = 8.0
PITCH = FOOTPRINT + SPACING  # 68 mm


# --------------------------------------------------------------------------- #
# Pure packing math
# --------------------------------------------------------------------------- #


def test_parse_bed():
    assert parse_bed("250x220") == Bed(250.0, 220.0)
    assert parse_bed("300X300") == Bed(300.0, 300.0)
    for bad in ("250", "250x", "axb", "0x220", "250x-5"):
        with pytest.raises(ValueError):
            parse_bed(bad)


def test_capacity_default_bed_is_3x3():
    assert bed_capacity(BED, FOOTPRINT, SPACING) == (3, 3)
    # exactly-fits and one-short boundaries: 3 pieces need the 5 mm edge margin
    # + 3*60 + 2*8 = 201 mm.
    assert bed_capacity(Bed(201.0, 201.0), FOOTPRINT, SPACING) == (3, 3)
    assert bed_capacity(Bed(200.9, 200.9), FOOTPRINT, SPACING) == (2, 2)


def test_capacity_scales_with_bed():
    assert bed_capacity(Bed(65.0, 65.0), FOOTPRINT, SPACING) == (1, 1)
    assert bed_capacity(Bed(64.0, 500.0), FOOTPRINT, SPACING) == (0, 7)


def test_plan_batches_splits_by_capacity():
    # 9 per bed → 9, 10, 20 split as expected.
    assert [len(b) for b in plan_batches(9, BED, FOOTPRINT, SPACING)] == [9]
    assert [len(b) for b in plan_batches(10, BED, FOOTPRINT, SPACING)] == [9, 1]
    assert [len(b) for b in plan_batches(20, BED, FOOTPRINT, SPACING)] == [9, 9, 2]
    assert plan_batches(0, BED, FOOTPRINT, SPACING) == []


def test_plan_batches_rejects_too_small_bed():
    with pytest.raises(ValueError):
        plan_batches(1, Bed(50.0, 50.0), FOOTPRINT, SPACING)


def test_pack_rejects_overfull():
    with pytest.raises(ValueError):
        pack_positions(10, BED, FOOTPRINT, SPACING)  # cap is 9


def _bbox(cx: float, cy: float) -> tuple[float, float, float, float]:
    h = FOOTPRINT / 2.0
    return (cx - h, cy - h, cx + h, cy + h)


def _disjoint(a, b) -> bool:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    eps = 1e-9
    return ax1 <= bx0 + eps or bx1 <= ax0 + eps or ay1 <= by0 + eps or by1 <= ay0 + eps


@pytest.mark.parametrize("count", [1, 2, 3, 4, 5, 7, 9])
def test_no_overlaps_and_in_bounds(count):
    positions = pack_positions(count, BED, FOOTPRINT, SPACING)
    assert len(positions) == count
    boxes = [_bbox(cx, cy) for cx, cy in positions]
    # pairwise disjoint footprints
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            assert _disjoint(boxes[i], boxes[j]), f"{count}: piece {i}/{j} overlap"
    # every footprint fully inside the bed
    for x0, y0, x1, y1 in boxes:
        assert x0 >= -1e-9 and y0 >= -1e-9
        assert x1 <= BED.width + 1e-9 and y1 <= BED.height + 1e-9


def test_spacing_is_exact_between_neighbours():
    pos = pack_positions(9, BED, FOOTPRINT, SPACING)
    # row 0 = indices 0,1,2 → adjacent x gap == pitch; column gap (0 vs 3) == pitch
    assert pos[1][0] - pos[0][0] == pytest.approx(PITCH)
    assert pos[2][0] - pos[1][0] == pytest.approx(PITCH)
    assert pos[3][1] - pos[0][1] == pytest.approx(PITCH)  # row 1 rearwards of row 0


def test_grid_anchored_front_left():
    # Corner anchoring consolidates free bed area at the rear/right (wipe tower).
    pos = pack_positions(9, BED, FOOTPRINT, SPACING)
    xs = [p[0] for p in pos]
    ys = [p[1] for p in pos]
    assert min(xs) == pytest.approx(EDGE_MARGIN + FOOTPRINT / 2)
    assert min(ys) == pytest.approx(EDGE_MARGIN + FOOTPRINT / 2)


def test_single_piece_anchored():
    (cx, cy), = pack_positions(1, BED, FOOTPRINT, SPACING)
    assert cx == pytest.approx(EDGE_MARGIN + FOOTPRINT / 2)
    assert cy == pytest.approx(EDGE_MARGIN + FOOTPRINT / 2)


def test_every_row_left_aligned():
    # 7 pieces = rows [3, 3, 1]; the lone rear-row piece sits under column 0.
    pos = pack_positions(7, BED, FOOTPRINT, SPACING)
    assert pos[6][0] == pytest.approx(pos[0][0])
    assert pos[6][1] == pytest.approx(pos[0][1] + 2 * PITCH)


def test_plan_batches_max_per_bed_cap():
    # Wipe-tower cap: 8 per bed on a 3x3 bed → 20 pieces split 8, 8, 4.
    batches = plan_batches(20, BED, FOOTPRINT, SPACING, max_per_bed=8)
    assert [len(b) for b in batches] == [8, 8, 4]
    # The freed cell is the rear-right grid cell: no piece occupies it.
    first = batches[0]
    rear_right = (EDGE_MARGIN + FOOTPRINT / 2 + 2 * PITCH,) * 2
    assert all((cx, cy) != rear_right for cx, cy in first)
    # A cap at/above capacity changes nothing.
    assert [len(b) for b in plan_batches(10, BED, FOOTPRINT, SPACING, max_per_bed=9)] == [9, 1]
    with pytest.raises(ValueError):
        plan_batches(1, BED, FOOTPRINT, SPACING, max_per_bed=0)


# --------------------------------------------------------------------------- #
# Batch 3MF: object count + colour round-trip, placement disjoint & in bounds
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def config():
    return load_config()


@pytest.fixture(scope="module")
def single_pieces(config):
    """Build H (red) and X (dark blue) single tiles once, reused across tests."""
    params = HardwareParams()
    return [_single_piece(m, config, "tile", 6.0, params) for m in (30, 35)]


@pytest.fixture(scope="module")
def double_pieces(config):
    """CNOT (same-family, 3 parts) and H|X (cross-family, 4 parts), built once."""
    params = HardwareParams()
    return [
        _double_piece(17, 15, config, "tile", 8.0, params),  # both dark blue
        _double_piece(30, 35, config, "tile", 8.0, params),  # red | dark blue
    ]


def _read_colored(path) -> list[tuple[str, str]]:
    """Read back a 3MF → ``[(label, '#rrggbb'), ...]`` for every object.

    ``Mesher.add_shape`` writes **one 3MF object per solid**, so a colour part
    made of several islands (a caption counter, a double piece's two markers, a
    two-glyph cube side label) becomes several objects — every one of which must
    carry a colour. An un-coloured object would print on slot 1 (white); the
    caller asserts none exists.
    """
    out = []
    for s in Mesher().read(str(path)):
        assert s.color is not None, f"un-coloured object {s.label!r} in {path.name}"
        r, g, b, _a = tuple(s.color)
        hexc = "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))
        out.append((s.label, hexc))
    return out


def test_single_batch_roundtrip(single_pieces, tmp_path):
    """A 2-tile single batch → 6 coloured objects, colours survive round-trip."""
    positions = pack_positions(len(single_pieces), BED, FOOTPRINT, SPACING)
    path = tmp_path / "plate1-batch1.3mf"
    n_obj = _write_batch_3mf(single_pieces, positions, path)

    assert n_obj == 6  # 2 tiles x (body, marker, accent)
    back = _read_colored(path)
    assert len(back) == 6  # object count round-trips
    hexes = {h for _lbl, h in back}
    assert "#ffffff" in hexes and "#000000" in hexes  # white body, black marker
    assert "#fa4d56" in hexes  # H = red
    assert "#002d9c" in hexes  # X = dark blue
    # Each colour object's label carries its own tile slug (not merged).
    assert {lbl.split("-")[0] for lbl, _h in back} == {"h", "x"}


def test_double_batch_roundtrip(double_pieces, tmp_path):
    """A same-family + a cross-family double piece: 3 + 4 parts, 19 objects.

    Objects are counted per *solid*, not per part: the CNOT piece is 1 body +
    2 markers (top/bottom faces) + 11 accent islands (two band rings, the
    ``CONTROL``/``TARGET`` counters and the four quadrants inside the ``⊕``) =
    14; ``h+x`` is 1 + 2 + 1 + 1 = 5. Every one of the 19 must be coloured.
    """
    cnot, hx = double_pieces
    assert len(cnot.parts) == 3 and len(hx.parts) == 4
    cnot_solids = sum(len(p.solid.solids()) for p in cnot.parts)
    hx_solids = sum(len(p.solid.solids()) for p in hx.parts)
    assert (cnot_solids, hx_solids) == (14, 5)
    positions = pack_positions(len(double_pieces), BED, FOOTPRINT, SPACING)
    path = tmp_path / "plate1-batch1.3mf"
    n_obj = _write_batch_3mf(list(double_pieces), positions, path)

    assert n_obj == 19
    back = _read_colored(path)  # asserts every object carries a colour
    assert len(back) == 19  # object count round-trips
    hexes = {h for _lbl, h in back}
    assert hexes == {"#ffffff", "#000000", "#002d9c", "#fa4d56"}


def test_batch_pieces_disjoint_in_3mf(single_pieces, tmp_path):
    """Read back a 2-piece batch and confirm the two pieces' meshes are inside the
    bed and split into two X clusters, one per tile, a pitch apart."""
    positions = pack_positions(2, BED, FOOTPRINT, SPACING)
    path = tmp_path / "b.3mf"
    _write_batch_3mf(single_pieces, positions, path)

    shapes = [s for s in Mesher().read(str(path)) if s.color is not None]
    for s in shapes:
        bb = s.bounding_box()
        assert bb.min.X >= -1e-6 and bb.max.X <= BED.width + 1e-6
        assert bb.min.Y >= -1e-6 and bb.max.Y <= BED.height + 1e-6
    centres = sorted({round(s.bounding_box().center().X, 1) for s in shapes})
    assert len(centres) == 2
    assert centres[1] - centres[0] == pytest.approx(PITCH, abs=0.2)


# --------------------------------------------------------------------------- #
# Plate grouping + end-to-end batch-file writing
# --------------------------------------------------------------------------- #


def test_single_plate_groups_membership(config):
    """Groups mirror the plates.md rule: ≤3 accents each; every gate tile placed."""
    groups = single_plate_groups(config)
    all_pieces = [m for g in groups for m in g["pieces"]]
    assert len(all_pieces) == len(set(all_pieces))  # no dup
    for g in groups:
        assert len(g["accents"]) <= 3


def test_export_batches_splits_and_names(config, tmp_path):
    """The driver splits an oversized plate into numbered plateN-batchM.3mf files.

    Uses a tiny 1x2 bed and a 4-tile plate 1 + 2-tile plate 2 so splitting is
    exercised while only 6 tiles are built (fast).
    """
    params = HardwareParams()
    tiny = Bed(65.0, 145.0)  # 1 col x 2 rows = 2 pieces per bed
    infos = _export_batches(
        lambda mid: _single_piece(mid, config, "tile", 6.0, params),
        [[30, 35, 12, 13], [40, 41]],  # plate1: 4 tiles → 2 batches; plate2: 1 batch
        tiny,
        SPACING,
        tmp_path,
    )
    names = [i.path.name for i in infos]
    assert names == [
        "plate1-batch1.3mf",
        "plate1-batch2.3mf",
        "plate2-batch1.3mf",
    ]
    assert [len(i.slugs) for i in infos] == [2, 2, 2]
    for info in infos:
        assert info.path.exists()
        assert info.object_count == 3 * len(info.slugs)
        assert info.cols == 1 and info.rows == 2


# --------------------------------------------------------------------------- #
# Shared base-material palette: one group per 3MF, canonical slot order
# --------------------------------------------------------------------------- #


def _palette(path) -> list[tuple[str, str]]:
    """Read a 3MF's *one* shared base-material group → ``[(name, '#rrggbb'), ...]``.

    lib3mf assigns property ids 1, 2, 3… in add order, so this list is the
    filament-slot order PrusaSlicer sees. Asserts every coloured object points at
    the same group (the whole point of the fix): a single group id, or the test
    fails here rather than silently reading one of several groups.
    """
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
        hexc = "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))
        out.append((group.GetName(pid), hexc))
    return out


def _assert_canonical(palette, accent_hexes):
    """White at slot 1, black at slot 2, then ``accent_hexes`` in order; ≤5 total."""
    assert len(palette) <= 5
    assert palette[0] == ("white", "#ffffff")
    assert palette[1] == ("black", "#000000")
    assert [h for _n, h in palette[2:]] == accent_hexes


def test_single_tile_3mf_shared_palette(config, tmp_path):
    """A per-piece single 3MF: white, black, then its one accent — one group."""
    parts = build_tile(30, config, variant="tile", height=6.0, params=HardwareParams())
    path = export_tile_3mf(parts, tmp_path)
    _assert_canonical(_palette(path), ["#fa4d56"])  # H = red


def test_double_tile_3mf_shared_palette(config, tmp_path):
    """A per-piece cross-family double 3MF: white, black, then both accents in order."""
    parts = build_double_tile(30, 35, config, variant="tile", height=8.0, params=HardwareParams())
    path = export_double_tile_3mf(parts, tmp_path)
    _assert_canonical(_palette(path), ["#fa4d56", "#002d9c"])  # H=red, X=darkblue


def test_batch_3mf_shared_palette_in_plate_order(single_pieces, tmp_path):
    """A batch 3MF: one shared group, accents in the caller's plate order."""
    positions = pack_positions(len(single_pieces), BED, FOOTPRINT, SPACING)
    path = tmp_path / "plate1-batch1.3mf"
    _write_batch_3mf(single_pieces, positions, path, accents=["#fa4d56", "#002d9c"])
    _assert_canonical(_palette(path), ["#fa4d56", "#002d9c"])


def test_batch_palette_carries_full_plate_and_keeps_slots(config, tmp_path):
    """Every batch of a plate shares the plate's full palette — the slot fix.

    A 3-accent plate (red, blue, magenta) split across a 2-capacity bed: batch 1
    uses red+blue, batch 2 uses only magenta. Both 3MFs must still list all three
    accents in the same slots, so magenta is slot 5 in *both* — the drift the fix
    removes.
    """
    tiny = Bed(65.0, 145.0)  # 1 col x 2 rows = 2 pieces/bed
    accents = ["#fa4d56", "#002d9c", "#9f1853"]
    infos = _export_batches(
        lambda mid: _single_piece(mid, config, "tile", 6.0, HardwareParams()),
        [[30, 35, 12]],  # H(red), X(blue), Y(magenta) → 2 batches
        tiny,
        SPACING,
        tmp_path,
        plate_accents=[accents],
    )
    assert [i.path.name for i in infos] == ["plate1-batch1.3mf", "plate1-batch2.3mf"]
    for info in infos:
        _assert_canonical(_palette(info.path), accents)


def test_cube_batch_keeps_the_tile_palette_and_adds_side_objects(config, tmp_path):
    """Cube side names reuse the gate accent: same slots, four more objects each.

    The 3MF palette (= the filament-slot list PrusaSlicer sees) must be
    *identical* to the flat tiles' — a cube adds geometry, never a filament. Only
    the object count grows, by one per side-label solid.
    """
    params = HardwareParams()
    positions = pack_positions(2, BED, FOOTPRINT, SPACING)
    accents = ["#fa4d56", "#002d9c"]  # H = red, X = dark blue

    tiles = [_single_piece(m, config, "tile", 6.0, params) for m in (30, 35)]
    tile_path = tmp_path / "tiles.3mf"
    tile_n = _write_batch_3mf(tiles, positions, tile_path, accents=accents)

    cubes = [_single_piece(m, config, "cube", 60.0, params) for m in (30, 35)]
    cube_path = tmp_path / "cubes.3mf"
    cube_n = _write_batch_3mf(cubes, positions, cube_path, accents=accents)

    # Same filament slots, in the same order — the whole point of the dedupe.
    assert _palette(cube_path) == _palette(tile_path)
    _assert_canonical(_palette(cube_path), accents)

    # H and X are single-glyph labels → one solid per face → +4 objects per cube.
    assert [len(p.parts) for p in cubes] == [7, 7]  # 3 + four side names
    assert cube_n == tile_n + 2 * 4 == 14
    back = _read_colored(cube_path)  # asserts every object carries a colour
    assert len(back) == cube_n
    assert {lbl for lbl, _h in back} >= {"h-side-front-red", "x-side-left-blue"}
    # every side-name object took its gate's accent hex, never a new colour
    sides = {h for lbl, h in back if "-side-" in lbl}
    assert sides == set(accents)


def test_double_batch_palette_distinguishes_blues(config, double_pieces, tmp_path):
    """A double batch names the two blues apart (darkblue) via double_color_name."""
    positions = pack_positions(len(double_pieces), BED, FOOTPRINT, SPACING)
    path = tmp_path / "plate1-batch1.3mf"
    _write_batch_3mf(
        list(double_pieces),
        positions,
        path,
        accents=["#002d9c", "#fa4d56"],
        name_accent=double_color_name,
    )
    palette = _palette(path)
    _assert_canonical(palette, ["#002d9c", "#fa4d56"])
    assert palette[2][0] == "darkblue"
