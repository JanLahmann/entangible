"""Black + white kit (#103) — the coloured geometry on exactly two filaments.

The b/w route is a **palette** change, never a geometry one: every accent (the
frame, the band, a cube's side letters, both faces of a double piece) is mapped
onto the marker's black, and the white body keeps slot 1. So the file a slicer
opens has two base materials and nothing else, and the band caption — cut out of
the accent and left standing in the body — turns from white-on-colour into
white-out-of-black without a single solid moving.

What this suite pins:

* the palette of a ``-bw`` 3MF is **exactly** ``{#ffffff, #000000}`` (the
  totality assertion: not "contains black", but "contains nothing else");
* the solids are the coloured piece's, unchanged, and the caption really does
  stand in white inside a now-black band;
* **totality of the file set** — every gate of a ``--bw`` run has a ``-bw``
  sibling, and board furniture has none (it is already white + black, so a
  duplicate would be the same solid under a second name);
* the b/w **beds are a fixed quantity set** (#106), not one of every design:
  the exact multiset of every bed is pinned here, duplicates included, and so is
  what the set deliberately leaves out (the ⊕ target tile, the twelve
  fixed-angle rotations);
* the beds respect the cap, are stamped with their provenance, and plates.md
  gains its b/w section — including the quantity table and the rationale that
  says why a design is missing.
"""

from __future__ import annotations

import re
import zipfile
from collections import Counter

import prusa3mf
import pytest
from build123d import Box, Mesher, Pos
from qamposer_assets.config import load_config

from qamposer_hardware.build import build_double_tile, build_tile
from qamposer_hardware.export import (
    BW_BEDS,
    bw_kit_quantities,
    bw_part_color,
    bw_single_ids,
    export_bw_batches,
    export_double_tile_bw_3mf,
    export_tile_3mf,
    export_tile_bw_3mf,
    provenance,
    single_plate_groups,
    write_bw_batch_md,
    write_bw_md,
    write_plates_md,
)
from qamposer_hardware.face import FACE_DEPTH
from qamposer_hardware.pack import FOOTPRINT, Bed, bed_capacity
from qamposer_hardware.params import HardwareParams

BED = Bed(250.0, 220.0)  # Prusa Core One default → 3 x 3
TINY = Bed(65.0, 145.0)  # 1 col x 2 rows = 2 pieces per bed
SPACING = 8.0
TILE_H = 6.0
DOUBLE_H = 8.0
PARAMS = HardwareParams()

#: Four gate tiles across four accent families, enough to exercise the mapping
#: without building the whole kit.
IDS = [30, 35, 12, 13]  # H, X, Y, Z

STAMP_RE = re.compile(
    r"^> Generated from `(?:[0-9a-f]{7,40}|unknown)` on \d{4}-\d{2}-\d{2} — "
    r"regenerate with the matching checkout before printing\.$",
    re.MULTILINE,
)


@pytest.fixture(scope="module")
def config():
    return load_config()


def _palette(path) -> list[tuple[str, str]]:
    """The 3MF's one shared base-material group as ``[(name, '#rrggbb'), ...]``.

    Slot order is add order, so this list *is* the filament-slot list a slicer
    shows. Asserts a single shared group, like the coloured batch tests do.
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
        out.append((group.GetName(pid), "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))))
    return out


def _parts(path) -> list[tuple[str, str]]:
    """``(part name, '#rrggbb')`` per colour part of every piece in the file.

    A piece is one object whose parts are triangle ranges, so this is the list
    the slicer's part tree shows — and the colour comes off the triangles
    themselves, so a part whose triangles were left unassigned cannot pass.
    """
    return prusa3mf.read(path).part_colors()


# --------------------------------------------------------------------------- #
# The palette: exactly two filaments, in the canonical slots
# --------------------------------------------------------------------------- #


def test_bw_part_color_collapses_everything_but_the_body():
    """The one rule the whole route rests on."""
    assert bw_part_color("body") == ("#ffffff", "white")
    for role in ("marker", "accent", "side-front", "side-left", "side-right"):
        assert bw_part_color(role) == ("#000000", "black"), role


@pytest.mark.parametrize("mid", IDS)
def test_bw_3mf_palette_is_exactly_white_and_black(config, tmp_path, mid):
    """Totality, not membership: no accent survives anywhere in the file."""
    parts = build_tile(mid, config, variant="tile", height=TILE_H, params=PARAMS)
    path = export_tile_bw_3mf(parts, tmp_path)
    assert path is not None and path.name.endswith("-bw.3mf")

    assert _palette(path) == [("white", "#ffffff"), ("black", "#000000")]
    assert {h for _lbl, h in _parts(path)} == {"#ffffff", "#000000"}


def test_cube_side_letters_are_black_too(config, tmp_path):
    """A cube carries its gate name on four vertical faces — in the accent.

    That is the one part of the kit where the accent is most of the visible
    piece, so it is also where a leaked accent would be most obvious.
    """
    parts = build_tile(30, config, variant="cube", height=60.0, params=PARAMS)
    path = export_tile_bw_3mf(parts, tmp_path)
    parts_read = _parts(path)
    sides = [(lbl, h) for lbl, h in parts_read if "-side-" in lbl]
    assert len(sides) == 4, parts_read
    assert {h for _lbl, h in sides} == {"#000000"}
    assert _palette(path) == [("white", "#ffffff"), ("black", "#000000")]


def test_cross_family_double_piece_needs_no_third_filament(config, tmp_path):
    """H|X has one accent per face — four filaments coloured, two here."""
    parts = build_double_tile(30, 35, config, variant="tile", height=DOUBLE_H, params=PARAMS)
    path = export_double_tile_bw_3mf(parts, tmp_path)
    assert path is not None and path.name == "h+x-bw.3mf"
    assert _palette(path) == [("white", "#ffffff"), ("black", "#000000")]
    assert {h for _lbl, h in _parts(path)} == {"#ffffff", "#000000"}


def test_object_labels_name_the_colour_they_actually_print(config, tmp_path):
    """No object may still claim `red` while printing black — the slicer's
    object list is the only place a user checks the mapping."""
    parts = build_tile(30, config, variant="tile", height=TILE_H, params=PARAMS)
    path = export_tile_bw_3mf(parts, tmp_path)
    assert sorted(lbl for lbl, _h in _parts(path)) == [
        "h-accent-black",
        "h-body-white",
        "h-marker-black",
    ]


# --------------------------------------------------------------------------- #
# Same geometry, and the caption still reads
# --------------------------------------------------------------------------- #


def test_bw_is_a_palette_change_only(config, tmp_path):
    """The coloured 3MF and its b/w twin hold the *identical* mesh, part for part.

    Not "the same volume to nine digits": the same vertices and the same
    triangles in the same order, split into parts at the same triangle indices.
    Only the palette and the part names' colour suffix may differ.
    """
    parts = build_tile(30, config, variant="tile", height=TILE_H, params=PARAMS)
    colored = export_tile_3mf(parts, tmp_path)
    bw = export_tile_bw_3mf(parts, tmp_path)

    a, b = prusa3mf.read(colored), prusa3mf.read(bw)
    assert len(a.objects) == len(b.objects) == 1
    assert a.objects[0].vertices == b.objects[0].vertices
    assert a.objects[0].triangles == b.objects[0].triangles
    va, vb = a.objects[0].volumes, b.objects[0].volumes
    assert len(va) == len(vb) == 3
    for x, y in zip(va, vb):
        assert (x.first, x.last) == (y.first, y.last)
        assert x.name.rsplit("-", 1)[0] == y.name.rsplit("-", 1)[0]


def test_band_caption_reads_white_out_of_black(config):
    """The caption is body geometry standing inside the band, not accent geometry.

    Probe the band's own volume in the top colour layer: some of it must be
    **body** (the glyphs) and the accent must fall short of filling the band. In
    the coloured kit that is white-on-colour; mapping the accent to black makes
    it white-out-of-black, which is why no glyph part has to be invented.
    """
    parts = build_tile(30, config, variant="tile", height=TILE_H, params=PARAMS)
    band = parts.layout.band
    probe = Pos(band.cx, band.cy, TILE_H - FACE_DEPTH / 2.0) * Box(
        band.w, band.h, FACE_DEPTH
    )
    body_in_band = (parts.body & probe).volume
    accent_in_band = (parts.accent & probe).volume
    full_band = band.w * band.h * FACE_DEPTH

    assert body_in_band > 1.0, "no white standing in the band — caption lost"
    assert accent_in_band < full_band, "the accent fills the band — no cutout"
    # The caption is what the accent gives up, so the two roughly close the band.
    assert body_in_band + accent_in_band <= full_band + 1e-6


# --------------------------------------------------------------------------- #
# Totality of the emitted file set (CLI)
# --------------------------------------------------------------------------- #


def test_cli_every_gate_has_a_bw_sibling(tmp_path):
    """Every coloured piece file of a ``--bw`` run has its ``-bw`` twin."""
    from qamposer_hardware.cli import main

    assert main(
        ["generate", "--variant", "tile", "--gates", "H,X,S", "--bw",
         "--out", str(tmp_path)]
    ) == 0
    vdir = tmp_path / "tile"
    names = {p.name for p in vdir.iterdir()}
    colored = {n for n in names if n.endswith(".3mf") and not n.endswith("-bw.3mf")}
    bw = {n for n in names if n.endswith("-bw.3mf")}
    assert colored, names
    assert bw == {n[: -len(".3mf")] + "-bw.3mf" for n in colored}
    # The per-part STLs are shared, never duplicated per palette.
    assert not [n for n in names if n.endswith(".stl") and "-bw-" in n]


def test_cli_bw_is_opt_in(tmp_path):
    from qamposer_hardware.cli import main

    assert main(
        ["generate", "--variant", "tile", "--gates", "H", "--out", str(tmp_path)]
    ) == 0
    names = {p.name for p in (tmp_path / "tile").iterdir()}
    assert not [n for n in names if "-bw" in n]
    assert "Black + white" not in (tmp_path / "tile" / "plates.md").read_text(
        encoding="utf-8"
    )


def test_cli_furniture_is_not_duplicated(tmp_path):
    """Board furniture is already white + black — no ``-bw`` twin, and plates.md
    says why rather than shipping the same solid under a second name."""
    from qamposer_hardware.cli import main

    assert main(
        ["generate", "--variant", "tile", "--gates", "H", "--bw", "--corners",
         "--out", str(tmp_path)]
    ) == 0
    vdir = tmp_path / "tile"
    names = {p.name for p in vdir.iterdir()}
    assert {"ul.3mf", "ur.3mf", "ll.3mf", "lr.3mf", "qwire.3mf", "qmeasure.3mf"} <= names
    assert {n for n in names if n.endswith("-bw.3mf")} == {"h-bw.3mf"}
    text = (vdir / "plates.md").read_text(encoding="utf-8")
    assert "Board furniture is **not** duplicated here" in text


def test_cli_double_emits_bw_pieces(tmp_path):
    from qamposer_hardware.cli import main

    assert main(
        ["generate", "--faces", "double", "--variant", "tile", "--gates", "S",
         "--bw", "--out", str(tmp_path)]
    ) == 0
    names = {p.name for p in (tmp_path / "tile-double").iterdir()}
    assert "s+t.3mf" in names and "s+t-bw.3mf" in names


# --------------------------------------------------------------------------- #
# Beds: one flat packing, every piece exactly once
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def bw_infos(config, tmp_path_factory):
    out = tmp_path_factory.mktemp("bw-single")
    infos = export_bw_batches(
        config,
        faces="single",
        variant="tile",
        height=TILE_H,
        bed=BED,
        spacing=SPACING,
        out_dir=out,
        params=PARAMS,
        ids=IDS,
    )
    return out, infos


def test_bw_beds_place_every_requested_member(bw_infos):
    """An explicit ``ids`` list is placed verbatim — one bed piece per entry."""
    _out, infos = bw_infos
    placed = [s for i in infos for s in i.slugs]
    assert sorted(placed) == ["h", "x", "y", "z"]
    assert len(placed) == len(set(placed)), "a piece was placed twice"
    assert [i.path.name for i in infos] == ["bw-batch1.3mf"]
    for info in infos:
        assert info.path.exists() and info.path.stat().st_size > 10_000


def test_bw_beds_are_two_filaments_end_to_end(bw_infos):
    """A whole bed of four different gate families still opens as two filaments."""
    _out, infos = bw_infos
    for info in infos:
        assert _palette(info.path) == [("white", "#ffffff"), ("black", "#000000")]
        parts_read = _parts(info.path)
        assert len(parts_read) == info.object_count
        assert {h for _lbl, h in parts_read} == {"#ffffff", "#000000"}
        # one object per piece, not one per solid — the slot-cycling bug
        assert len(prusa3mf.read(info.path).objects) == len(info.slugs)


def test_bw_beds_are_corner_anchored_inside_the_bed(bw_infos):
    _out, infos = bw_infos
    cols, rows = bed_capacity(BED, FOOTPRINT, SPACING)
    for info in infos:
        assert (info.cols, info.rows) == (cols, rows)
        assert len(info.positions) == len(info.slugs)
        for cx, cy in info.positions:
            assert cx - FOOTPRINT / 2 >= -1e-9 and cy - FOOTPRINT / 2 >= -1e-9
            assert cx + FOOTPRINT / 2 <= BED.width + 1e-9
            assert cy + FOOTPRINT / 2 <= BED.height + 1e-9


def test_bw_beds_split_and_respect_the_cap(config, tmp_path):
    infos = export_bw_batches(
        config, faces="single", variant="tile", height=TILE_H, bed=BED,
        spacing=SPACING, out_dir=tmp_path, params=PARAMS, ids=IDS, max_per_bed=3,
    )
    assert [i.path.name for i in infos] == ["bw-batch1.3mf", "bw-batch2.3mf"]
    assert [len(i.slugs) for i in infos] == [3, 1]
    assert sorted(s for i in infos for s in i.slugs) == ["h", "x", "y", "z"]


def test_bw_beds_split_by_bed_capacity_alone(config, tmp_path):
    infos = export_bw_batches(
        config, faces="single", variant="tile", height=TILE_H, bed=TINY,
        spacing=SPACING, out_dir=tmp_path, params=PARAMS, ids=IDS,
    )
    assert [len(i.slugs) for i in infos] == [2, 2]
    assert sorted(s for i in infos for s in i.slugs) == ["h", "x", "y", "z"]


def test_bw_beds_expand_double_quantities(config, tmp_path):
    infos = export_bw_batches(
        config, faces="double", variant="tile", height=DOUBLE_H, bed=BED,
        spacing=SPACING, out_dir=tmp_path, params=PARAMS, kit=[(30, 35, 2), (17, 15, 1)],
    )
    assert sorted(s for i in infos for s in i.slugs) == [
        "cnot-ctrl+cnot-tgt",
        "h+x",
        "h+x",
    ]
    for info in infos:
        assert _palette(info.path) == [("white", "#ffffff"), ("black", "#000000")]


def test_bw_needs_fewer_beds_than_the_coloured_plates(config, tmp_path):
    """The packing claim the route is sold on, over the same pieces.

    A coloured *filament* plate is packed on its own, so a plate holding a
    single leftover tile still costs a whole print job. With two filaments there
    are no plates to round up to, so **the same pieces** need fewer beds. Stated
    over the coloured kit's own piece count, which is what "the same pieces"
    means — the b/w beds ship a different (fixed) quantity set, and that is a
    separate decision from the packing.
    """
    from qamposer_hardware.pack import plan_batches

    groups = single_plate_groups(config)
    cap = 8
    colored_jobs = sum(
        len(plan_batches(len(g["pieces"]), BED, FOOTPRINT, SPACING, max_per_bed=cap))
        for g in groups
    )
    total = sum(len(g["pieces"]) for g in groups)
    flat_jobs = len(plan_batches(total, BED, FOOTPRINT, SPACING, max_per_bed=cap))
    assert flat_jobs < colored_jobs
    # And the flat packing is the tightest a cap of 8 allows.
    assert flat_jobs == -(-total // cap)


# --------------------------------------------------------------------------- #
# The fixed quantity set (#106): which pieces, how many, on which bed
# --------------------------------------------------------------------------- #

#: The kit as it must come off the beds — written out here rather than read from
#: :data:`BW_BEDS` so this is an assertion and not a tautology. One entry per
#: bed, in bed order; a bed is the exact multiset of slugs printed on it.
EXPECTED_BEDS = [
    {"h": 5, "x": 3},
    {"x": 2, "cnot-control": 4, "swap": 2},
    {"y": 2, "z": 2, "s": 2, "t": 2},
    {"rx": 2, "ry": 2, "rz": 2, "swap": 2},
]

#: Designs the set deliberately drops: the ⊕ target tile (a CNOT is a generic
#: control plus the target gate in the same column, #51) and every fixed-angle
#: rotation (the dial tiles cover all angles).
EXCLUDED_SLUGS = {"cnot-target"} | {
    f"{axis}-{angle}"
    for axis in ("rx", "ry", "rz")
    for angle in ("pi4", "pi2", "pi", "negpi2")
}


@pytest.fixture(scope="module")
def bw_kit(config, tmp_path_factory):
    """The real default b/w run: no ``ids``, default bed, default 8-piece cap."""
    out = tmp_path_factory.mktemp("bw-kit")
    infos = export_bw_batches(
        config,
        faces="single",
        variant="tile",
        height=TILE_H,
        bed=BED,
        spacing=SPACING,
        out_dir=out,
        params=PARAMS,
        max_per_bed=8,
    )
    return infos


def test_bw_beds_are_the_fixed_quantity_set(bw_kit):
    """Totality, bed by bed: exactly these slugs, in exactly these quantities.

    Not "contains an H" and not "32 pieces somewhere" — every bed's full
    multiset, so an extra tile, a missing duplicate or a piece that drifted to
    the neighbouring bed all fail here.
    """
    assert [i.path.name for i in bw_kit] == [
        "bw-batch1.3mf",
        "bw-batch2.3mf",
        "bw-batch3.3mf",
        "bw-batch4.3mf",
    ]
    assert [dict(Counter(i.slugs)) for i in bw_kit] == EXPECTED_BEDS
    assert sum(len(i.slugs) for i in bw_kit) == 32
    for info in bw_kit:
        assert len(info.slugs) == 8, info.path.name  # the wipe-tower cap, exactly
        assert info.path.exists() and info.path.stat().st_size > 10_000


def test_bw_kit_leaves_out_the_target_and_fixed_angle_tiles(bw_kit):
    """The other half of totality: what is *not* on any bed, and why.

    The ⊕ target tile and the twelve fixed-angle rotations are covered by the
    generic control + the three dial tiles, so they must not appear anywhere.
    """
    placed = {s for i in bw_kit for s in i.slugs}
    assert placed & EXCLUDED_SLUGS == set()
    assert placed == {
        "h", "x", "y", "z", "s", "t", "swap", "cnot-control", "rx", "ry", "rz",
    }


def test_bw_kit_quantities_agree_with_the_beds(bw_kit):
    """The table plates.md prints is the beds, summed — never a second source."""
    assert dict(bw_kit_quantities()) == dict(Counter(s for i in bw_kit for s in i.slugs))
    assert dict(bw_kit_quantities()) == {
        "h": 5, "x": 5, "cnot-control": 4, "swap": 4,
        "y": 2, "z": 2, "s": 2, "t": 2, "rx": 2, "ry": 2, "rz": 2,
    }
    assert len(bw_single_ids()) == 32
    assert len(BW_BEDS) == len(EXPECTED_BEDS)


def test_bw_kit_beds_are_two_slot_prusa_projects(bw_kit):
    """Duplicates must not cost the file its PrusaSlicer project or its palette.

    Five copies of ``h`` on one bed are five objects, each with its own parts on
    slot 1/2 — the file a slicer opens is still a two-filament project.
    """
    for info in bw_kit:
        model = prusa3mf.read(info.path)
        assert model.has_config, info.path.name
        assert model.materials == [("white", "#ffffff"), ("black", "#000000")]
        assert model.extruders() <= {1, 2}, (info.path.name, model.extruders())
        assert len(model.objects) == len(info.slugs)  # one object per copy
        assert [o.name for o in model.objects] == info.slugs
        assert sum(len(o.volumes) for o in model.objects) == info.object_count


# --------------------------------------------------------------------------- #
# Provenance + the plates.md section
# --------------------------------------------------------------------------- #


def _model_xml(path) -> str:
    with zipfile.ZipFile(path) as zf:
        return zf.read("3D/3dmodel.model").decode("utf-8")


def test_bw_files_are_stamped(bw_infos, config, tmp_path):
    commit, _, date = provenance().partition(" · ")
    _out, infos = bw_infos
    parts = build_tile(30, config, variant="tile", height=TILE_H, params=PARAMS)
    piece = export_tile_bw_3mf(parts, tmp_path)
    for path in [i.path for i in infos] + [piece]:
        xml = _model_xml(path)
        title = re.search(r'<metadata name="Title">([^<]*)</metadata>', xml)
        desc = re.search(r'<metadata name="Description">([^<]*)</metadata>', xml)
        assert title and desc, path.name
        assert title.group(1) == f"{path.stem} — Entangible {commit}"
        assert desc.group(1) == f"Generated from {commit} on {date}"


def test_plates_md_gains_a_black_and_white_section(bw_infos, config, tmp_path):
    _out, infos = bw_infos
    base = write_plates_md(config, tmp_path)
    write_bw_batch_md(
        base, infos, bed=BED, spacing=SPACING, faces="single", variant="tile",
        max_per_bed=8, colored_jobs=4,
    )
    text = base.read_text(encoding="utf-8")
    assert "## Black + white kit — two filaments" in text
    assert "#ffffff" in text and "#000000" in text
    assert "white-out-of-black" in text  # the caption trade-off is spelled out
    assert "Two material slots is the whole requirement" in text
    assert "mono.md" in text  # single-filament printers are sent elsewhere
    assert "Board furniture is **not** duplicated here" in text
    for info in infos:
        assert f"`{info.path.name}`" in text
    # The "fewer print jobs" claim carries the run's own numbers.
    assert f"**4** batch files; these 4 pieces take only **{len(infos)}**" in text
    # The base writer already stamped it; appending must not add a second.
    assert len(STAMP_RE.findall(text)) == 1


def test_plates_md_documents_the_fixed_quantity_set(bw_infos, config, tmp_path):
    """The b/w section must say *which* pieces and *why* — not just how they pack.

    A reader who prints these beds gets no ⊕ tile and no fixed-angle rotations;
    plates.md is the only place that explains that this is a decision.
    """
    _out, infos = bw_infos
    base = write_plates_md(config, tmp_path)
    write_bw_batch_md(
        base, infos, bed=BED, spacing=SPACING, faces="single", variant="tile",
        max_per_bed=8, colored_jobs=4,
    )
    text = base.read_text(encoding="utf-8")

    assert "### What is on the beds" in text
    assert "**32 pieces of 11 designs**" in text
    # Every quantity is in the table, as a row, with its slug.
    for slug, qty in bw_kit_quantities():
        assert f"| `{slug}` | {qty} |" in text, slug
    # And the three design calls are spelled out.
    assert "No `cnot-target` (⊕)" in text
    assert "No fixed-angle rotation tiles" in text
    assert "SWAP only works in pairs" in text
    assert "GHZ-5" in text and "Cascade" in text
    # Nothing in the b/w section may still claim it holds one of every design.
    section = text.split("## Black + white kit")[1]
    assert "exactly once" not in section
    for slug in EXCLUDED_SLUGS - {"cnot-target"}:
        assert f"| `{slug}` |" not in section, slug


def test_plates_md_counts_duplicates_instead_of_repeating_them(config, tmp_path):
    """A bed listing `h` five times is unreadable — the section counts them."""
    infos = export_bw_batches(
        config, faces="single", variant="tile", height=TILE_H, bed=BED,
        spacing=SPACING, out_dir=tmp_path, params=PARAMS, ids=[30, 30, 30, 35],
    )
    base = write_plates_md(config, tmp_path)
    write_bw_batch_md(
        base, infos, bed=BED, spacing=SPACING, faces="single", variant="tile",
        max_per_bed=8,
    )
    text = base.read_text(encoding="utf-8")
    assert "4 piece(s)" in text
    assert "`h` ×3, `x`" in text
    assert "`h`, `h`, `h`" not in text


def test_generate_bw_section_documents_the_piece_files(config, tmp_path):
    base = write_plates_md(config, tmp_path)
    write_bw_md(base, faces="single")
    text = base.read_text(encoding="utf-8")
    assert "## Black + white kit — two filaments" in text
    assert "`<piece>-bw.3mf`" in text
    assert "plates --bw" in text
    assert len(STAMP_RE.findall(text)) == 1
