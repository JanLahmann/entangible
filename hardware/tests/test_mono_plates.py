"""Bed-ready **mono** plates — the no-MMU kit, one set of beds per form.

``plates --mono`` is the missing half of #45: the single-colour forms existed
only as per-gate STLs, so a user without an MMU had to nest their own beds. Here
they come out bed-ready, with the one rule that makes them printable in bulk:

* **the two forms never share a bed.** A recessed bed is "print in one filament,
  then paint"; a raised bed is "one filament swap at the accent layer height".
  Mixing them would make neither recipe true of the plate.

The suite pins totality (every piece of the kit on the recessed beds exactly
once, and again on the raised beds), the per-bed cap, the form separation, the
opt-in corner blocks, and the provenance stamps on both the 3MFs and the notes —
including the swap Z the raised beds are printed at.
"""

from __future__ import annotations

import re
import zipfile

import pytest
from build123d import Mesher
from qamposer_assets.config import load_config

from qamposer_hardware.export import (
    MONO_FORMS,
    export_mono_batches,
    provenance,
    write_mono_batch_md,
    write_mono_md,
)
from qamposer_hardware.pack import EDGE_MARGIN, FOOTPRINT, Bed, bed_capacity
from qamposer_hardware.params import HardwareParams

BED = Bed(250.0, 220.0)  # Prusa Core One default → 3 x 3
TINY = Bed(65.0, 145.0)  # 1 col x 2 rows = 2 pieces per bed
SPACING = 8.0
TILE_H = 6.0
DOUBLE_H = 8.0
PARAMS = HardwareParams()

#: Four gate tiles, enough to exercise splitting without building the whole kit.
IDS = [10, 11, 12, 13]  # H, X, Y, Z

STAMP_RE = re.compile(
    r"^> Generated from `(?:[0-9a-f]{7,40}|unknown)` on \d{4}-\d{2}-\d{2} — "
    r"regenerate with the matching checkout before printing\.$",
    re.MULTILINE,
)


@pytest.fixture(scope="module")
def config():
    return load_config()


@pytest.fixture(scope="module")
def single_infos(config, tmp_path_factory):
    """Four single-faced tiles packed onto the default bed, both forms."""
    out = tmp_path_factory.mktemp("mono-single")
    infos = export_mono_batches(
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


# --------------------------------------------------------------------------- #
# Totality + form separation
# --------------------------------------------------------------------------- #


def test_every_piece_appears_exactly_once_per_form(single_infos):
    _out, infos = single_infos
    assert {i.form for i in infos} == set(MONO_FORMS)
    for form in MONO_FORMS:
        placed = [s for i in infos if i.form == form for s in i.slugs]
        assert sorted(placed) == ["h", "x", "y", "z"], form
        assert len(placed) == len(set(placed)), f"{form}: a piece was placed twice"


def test_the_two_forms_never_share_a_bed(single_infos):
    _out, infos = single_infos
    for info in infos:
        assert info.path.name == f"mono-{info.form}-batch{info.batch}.3mf"
        assert info.form in info.path.stem
    # One bed each here (4 pieces, 9 per bed), and they are different files.
    paths = {i.path for i in infos}
    assert len(paths) == len(infos) == 2


def test_files_exist_and_are_non_trivial(single_infos):
    _out, infos = single_infos
    for info in infos:
        assert info.path.exists()
        assert info.path.stat().st_size > 10_000, info.path.name


def test_pieces_are_placed_corner_anchored_inside_the_bed(single_infos):
    _out, infos = single_infos
    cols, rows = bed_capacity(BED, FOOTPRINT, SPACING)
    for info in infos:
        assert (info.cols, info.rows) == (cols, rows)
        assert len(info.positions) == len(info.slugs)
        xs = [p[0] for p in info.positions]
        ys = [p[1] for p in info.positions]
        assert min(xs) == pytest.approx(EDGE_MARGIN + FOOTPRINT / 2)
        assert min(ys) == pytest.approx(EDGE_MARGIN + FOOTPRINT / 2)
        for cx, cy in info.positions:
            assert cx - FOOTPRINT / 2 >= -1e-9 and cy - FOOTPRINT / 2 >= -1e-9
            assert cx + FOOTPRINT / 2 <= BED.width + 1e-9
            assert cy + FOOTPRINT / 2 <= BED.height + 1e-9


def test_mono_pieces_are_one_uncoloured_solid_each(single_infos):
    """A mono piece is a single merged solid and carries no filament colour.

    Inventing a colour would put a misleading slot assignment in the slicer —
    the whole point of the form is that it prints on one filament (plus, for the
    raised form, one swap).
    """
    _out, infos = single_infos
    for info in infos:
        shapes = Mesher().read(str(info.path))
        assert len(shapes) == len(info.slugs) == info.object_count
        assert [s.label for s in shapes] == info.slugs
        assert all(s.color is None for s in shapes)


def test_raised_bed_is_taller_than_the_recessed_one(single_infos):
    """The raised form's art stands proud, so its bed is ``mono_raise_height``
    taller — the swap Z documented in the notes is exactly the body height."""
    _out, infos = single_infos
    by_form = {i.form: i for i in infos}
    tops = {}
    for form, info in by_form.items():
        shapes = Mesher().read(str(info.path))
        tops[form] = max(s.bounding_box().max.Z for s in shapes)
    assert tops["recessed"] == pytest.approx(TILE_H, abs=1e-3)
    assert tops["raised"] == pytest.approx(TILE_H + PARAMS.mono_raise_height, abs=1e-3)


# --------------------------------------------------------------------------- #
# Splitting + cap
# --------------------------------------------------------------------------- #


def test_split_across_beds_keeps_totality_per_form(config, tmp_path):
    """A 2-per-bed bed splits four tiles into two beds — per form, still once each."""
    infos = export_mono_batches(
        config,
        faces="single",
        variant="tile",
        height=TILE_H,
        bed=TINY,
        spacing=SPACING,
        out_dir=tmp_path,
        params=PARAMS,
        ids=IDS,
    )
    assert [i.path.name for i in infos] == [
        "mono-recessed-batch1.3mf",
        "mono-recessed-batch2.3mf",
        "mono-raised-batch1.3mf",
        "mono-raised-batch2.3mf",
    ]
    for form in MONO_FORMS:
        placed = [s for i in infos if i.form == form for s in i.slugs]
        assert sorted(placed) == ["h", "x", "y", "z"]
    assert [len(i.slugs) for i in infos] == [2, 2, 2, 2]


def test_cap_is_respected(config, tmp_path):
    """``max_per_bed`` caps every mono bed just as it caps a coloured plate."""
    infos = export_mono_batches(
        config,
        faces="single",
        variant="tile",
        height=TILE_H,
        bed=BED,
        spacing=SPACING,
        out_dir=tmp_path,
        params=PARAMS,
        ids=IDS,
        max_per_bed=3,
    )
    for info in infos:
        assert len(info.slugs) <= 3
    assert [len(i.slugs) for i in infos] == [3, 1, 3, 1]
    for form in MONO_FORMS:
        assert sorted(s for i in infos if i.form == form for s in i.slugs) == [
            "h",
            "x",
            "y",
            "z",
        ]


# --------------------------------------------------------------------------- #
# Double kit + opt-in corner blocks
# --------------------------------------------------------------------------- #


def test_double_kit_expands_quantities_per_form(config, tmp_path):
    """A ``qty`` of n puts n physical copies on the beds — per form."""
    kit = [(10, 11, 2), (14, 15, 1)]
    infos = export_mono_batches(
        config,
        faces="double",
        variant="tile",
        height=DOUBLE_H,
        bed=BED,
        spacing=SPACING,
        out_dir=tmp_path,
        params=PARAMS,
        kit=kit,
    )
    for form in MONO_FORMS:
        placed = sorted(s for i in infos if i.form == form for s in i.slugs)
        assert placed == ["cnot-ctrl+cnot-tgt", "h+x", "h+x"]


def test_corner_blocks_are_opt_in(config, tmp_path):
    without = export_mono_batches(
        config, faces="single", variant="tile", height=TILE_H, bed=BED,
        spacing=SPACING, out_dir=tmp_path / "a", params=PARAMS, ids=[10],
    )
    assert sorted(s for i in without if i.form == "recessed" for s in i.slugs) == ["h"]

    with_corners = export_mono_batches(
        config, faces="single", variant="tile", height=TILE_H, bed=BED,
        spacing=SPACING, out_dir=tmp_path / "b", params=PARAMS, ids=[10],
        corners=True,
    )
    for form in MONO_FORMS:
        placed = sorted(s for i in with_corners if i.form == form for s in i.slugs)
        assert placed == ["h", "ll", "lr", "ul", "ur"]


# --------------------------------------------------------------------------- #
# Provenance + notes
# --------------------------------------------------------------------------- #


def _model_xml(path) -> str:
    with zipfile.ZipFile(path) as zf:
        return zf.read("3D/3dmodel.model").decode("utf-8")


def test_mono_batch_3mfs_are_stamped(single_infos):
    _out, infos = single_infos
    commit, _, date = provenance().partition(" · ")
    for info in infos:
        xml = _model_xml(info.path)
        title = re.search(r'<metadata name="Title">([^<]*)</metadata>', xml)
        desc = re.search(r'<metadata name="Description">([^<]*)</metadata>', xml)
        assert title and desc, info.path.name
        assert title.group(1) == f"{info.path.stem} — Entangible {commit}"
        assert desc.group(1) == f"Generated from {commit} on {date}"


def test_mono_md_gains_a_print_jobs_section_with_the_swap_height(
    single_infos, tmp_path
):
    """The raised beds' single filament swap sits at the accent layer height."""
    _out, infos = single_infos
    mono_md = write_mono_md(tmp_path, faces="single", height=TILE_H, params=PARAMS)
    write_mono_batch_md(
        mono_md,
        infos,
        bed=BED,
        spacing=SPACING,
        faces="single",
        height=TILE_H,
        params=PARAMS,
    )
    text = mono_md.read_text(encoding="utf-8")
    assert "## Print jobs (mono)" in text
    assert f"Z = {TILE_H:.3f} mm" in text  # the swap height, spelled out
    assert "never share a bed" in text
    for info in infos:
        assert f"`{info.path.name}`" in text
    # The base writer already stamped it; appending must not add a second.
    assert len(STAMP_RE.findall(text)) == 1
    lines = text.splitlines()
    assert lines[0].startswith("# ") and STAMP_RE.match(lines[2])


def test_double_notes_quote_the_second_swap(config, tmp_path):
    infos = export_mono_batches(
        config, faces="double", variant="tile", height=DOUBLE_H, bed=BED,
        spacing=SPACING, out_dir=tmp_path, params=PARAMS, kit=[(10, 11, 1)],
    )
    mono_md = write_mono_md(tmp_path, faces="double", height=DOUBLE_H, params=PARAMS)
    write_mono_batch_md(
        mono_md, infos, bed=BED, spacing=SPACING, faces="double",
        height=DOUBLE_H, params=PARAMS,
    )
    text = mono_md.read_text(encoding="utf-8")
    r = PARAMS.mono_raise_height
    assert f"Z = {r + DOUBLE_H:.3f} mm" in text
    assert f"{r:.3f} mm" in text
    assert len(STAMP_RE.findall(text)) == 1
