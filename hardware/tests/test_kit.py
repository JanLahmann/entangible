"""One shared quantity set drives every kit (#110a).

``generate`` writes one file per tile *design*; every bed route of ``plates`` —
the coloured filament plates, ``--bw`` and ``--mono`` — and the paper booth kit
(``assets.toml`` ``[kit]``) instead print the same fixed, playable set: 32
pieces of 11 designs (:data:`KIT_BEDS`). This suite pins that totality for the
routes ``test_bw.py`` does not already cover:

* the **coloured** beds: the exact multiset of every bed, the plate each bed
  belongs to, and its filament palette — with at most **2 accents** per plate
  (white + black + 2 = 4 filaments, so a 4-slot AMS loads every plate);
* the **mono** beds: the exact multiset of every bed, per form;
* the **paper** kit: ``kit_tile_ids`` is the shared set, piece for piece;
* the grouping knob (``--max-accents``), and the plates.md text that documents
  the set and the slot count.

The bed pins swap the OpenCASCADE tile build for one small box per colour part:
what is pinned here is *which* piece lands on *which* bed with *which* palette,
and the whole export path below the build (grouping, packing, the 3MF writer and
its project part) still runs for real. Real tile geometry on a full kit bed is
``test_bw.py``'s ``bw_kit``; real coloured palettes are ``test_batches.py``'s.
"""

from __future__ import annotations

from collections import Counter
from types import SimpleNamespace

import prusa3mf
import pytest
from build123d import Box, Pos
from qamposer_assets.config import load_config
from qamposer_assets.sheets import kit_tile_ids
from qamposer_vision.markers import MARKER_TABLE

from qamposer_hardware import export
from qamposer_hardware.export import (
    DEFAULT_MAX_ACCENTS,
    MAX_ACCENTS_CHOICES,
    MONO_FORMS,
    export_mono_batches,
    export_single_batches,
    kit_quantities,
    kit_single_ids,
    single_plate_groups,
    tile_slug,
    write_double_plates_md,
    write_mono_batch_md,
    write_mono_md,
    write_plates_md,
)
from qamposer_hardware.pack import FOOTPRINT, Bed, plan_batches
from qamposer_hardware.params import DOUBLE_FACED_KIT, HardwareParams

BED = Bed(250.0, 220.0)  # Prusa Core One default → 3 x 3
SPACING = 8.0
TILE_H = 6.0
PARAMS = HardwareParams()

WHITE, BLACK = ("white", "#ffffff"), ("black", "#000000")
CYAN, MAGENTA, BLUE, RED = "#33b1ff", "#9f1853", "#002d9c", "#fa4d56"

#: The shared set, written out rather than read from ``KIT_BEDS`` so these
#: assertions are not tautologies.
KIT = {
    "h": 5, "x": 5, "cnot-control": 4, "swap": 4,
    "y": 2, "z": 2, "s": 2, "t": 2, "rx": 2, "ry": 2, "rz": 2,
}

#: The coloured kit as it must come off the beds at the defaults (cap 8, ≤2
#: accents): ``(file, plate accents, exact multiset)``. Plate 1 is cyan +
#: magenta (14 pieces → 8 + 6); plate 2 is blue + red (18 → 8 + 8 + 2). SWAP is
#: in the blue CNOT family, so it rides plate 2 with X, the controls and H.
EXPECTED_COLOUR_BEDS = [
    ("plate1-batch1.3mf", [CYAN, MAGENTA], {"z": 2, "s": 2, "t": 2, "rz": 2}),
    ("plate1-batch2.3mf", [CYAN, MAGENTA], {"y": 2, "rx": 2, "ry": 2}),
    ("plate2-batch1.3mf", [BLUE, RED], {"cnot-control": 4, "x": 4}),
    ("plate2-batch2.3mf", [BLUE, RED], {"x": 1, "swap": 4, "h": 3}),
    ("plate2-batch3.3mf", [BLUE, RED], {"h": 2}),
]

#: The mono kit per form: the flat packing of KIT_BEDS, bed for bed.
EXPECTED_MONO_BEDS = [
    {"h": 5, "x": 3},
    {"x": 2, "cnot-control": 4, "swap": 2},
    {"y": 2, "z": 2, "s": 2, "t": 2},
    {"rx": 2, "ry": 2, "rz": 2, "swap": 2},
]


@pytest.fixture(scope="module")
def config():
    return load_config()


def _slugs(ids) -> Counter:
    return Counter(tile_slug(MARKER_TABLE[m]) for m in ids)


def _box(z: float) -> object:
    """A 10 mm block inside the footprint — cheap to mesh, never empty."""
    return Pos(FOOTPRINT / 2.0, FOOTPRINT / 2.0, z) * Box(10.0, 10.0, 1.0)


def _fake_single_piece(mid, config, variant, height, params, *, bw=False):
    """The piece :func:`export._single_piece` would build, minus the CAD.

    Same slug, same colour parts in the same order — white body, black marker,
    the gate's accent — so the palette and slot checks stay meaningful.
    """
    spec = MARKER_TABLE[mid]
    slug = tile_slug(spec)
    roles = (("body", "#ffffff"), ("marker", "#000000"),
             ("accent", config.colors.for_gate(spec.gate)))
    parts = [
        export._ColoredPart(hexc, f"{slug}-{role}", _box(0.5 + i))
        for i, (role, hexc) in enumerate(roles)
    ]
    return export._Piece(slug, parts)


def _fake_build_tile(mid, config, *, variant, height, params, magnets=False):
    return SimpleNamespace(layout=SimpleNamespace(spec=MARKER_TABLE[mid]))


def _fake_mono_forms(parts, params):
    return {"recessed": _box(3.0), "raised": _box(3.4)}


# --------------------------------------------------------------------------- #
# The set itself, and the paper kit
# --------------------------------------------------------------------------- #


def test_the_shared_set():
    assert dict(kit_quantities()) == KIT
    assert _slugs(kit_single_ids()) == Counter(KIT)
    assert len(kit_single_ids()) == 32


def test_paper_kit_is_the_shared_set_exactly(config):
    """Totality across packages: the booth cut-sheets print the 3D kit's pieces.

    Not "about 32 tiles" — the same marker IDs, each the same number of times,
    so a ⊕ or a fixed-angle rotation creeping back into ``[kit]`` fails here.
    """
    paper = kit_tile_ids(config)
    assert sorted(paper) == sorted(kit_single_ids())
    assert _slugs(paper) == Counter(KIT)
    k = config.kit
    assert (k.CNOT_target, k.rotations_each) == (0, 0)


# --------------------------------------------------------------------------- #
# Filament-plate grouping (pure logic)
# --------------------------------------------------------------------------- #


def test_default_cap_is_two_accents_four_filaments(config):
    assert DEFAULT_MAX_ACCENTS == 2
    for ids in (None, kit_single_ids()):
        groups = single_plate_groups(config, ids)
        assert [g["accents"] for g in groups] == [[CYAN, MAGENTA], [BLUE, RED]]
        for g in groups:
            assert 2 + len(g["accents"]) <= 4  # white + black + accents


def test_kit_groups_expand_quantities(config):
    """Every physical piece is on exactly one plate — duplicates included."""
    groups = single_plate_groups(config, kit_single_ids())
    assert _slugs(m for g in groups for m in g["pieces"]) == Counter(KIT)
    swap = next(m for m in kit_single_ids() if tile_slug(MARKER_TABLE[m]) == "swap")
    (home,) = [g for g in groups if swap in g["pieces"]]
    assert config.colors.for_gate("SWAP") == BLUE and BLUE in home["accents"]


@pytest.mark.parametrize(
    "max_accents, accents, jobs",
    [
        (1, [[CYAN], [MAGENTA], [BLUE], [RED]], [1, 1, 2, 1]),
        (2, [[CYAN, MAGENTA], [BLUE, RED]], [2, 3]),
        (3, [[CYAN, MAGENTA, BLUE], [RED]], [4, 1]),
    ],
)
def test_max_accents_regroups_the_same_pieces(config, max_accents, accents, jobs):
    groups = single_plate_groups(config, kit_single_ids(), max_accents=max_accents)
    assert [g["accents"] for g in groups] == accents
    assert _slugs(m for g in groups for m in g["pieces"]) == Counter(KIT)
    per_plate = [
        len(plan_batches(len(g["pieces"]), BED, FOOTPRINT, SPACING, max_per_bed=8))
        for g in groups
    ]
    assert per_plate == jobs


def test_grouping_rejects_bad_input(config):
    for bad in (0, 4):
        assert bad not in MAX_ACCENTS_CHOICES
        with pytest.raises(ValueError):
            single_plate_groups(config, max_accents=bad)
    with pytest.raises(ValueError):
        single_plate_groups(config, [30, 0])  # a corner block is no gate tile


# --------------------------------------------------------------------------- #
# The coloured beds: exact multisets, ≤4 filament slots each
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def colour_kit(config, tmp_path_factory):
    """The default coloured run: no ``ids``, default bed, cap and accents."""
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(export, "_single_piece", _fake_single_piece)
        return export_single_batches(
            config,
            variant="tile",
            height=TILE_H,
            bed=BED,
            spacing=SPACING,
            out_dir=tmp_path_factory.mktemp("colour-kit"),
            params=PARAMS,
            max_per_bed=8,
        )


def test_colour_beds_are_the_shared_set_bed_by_bed(colour_kit):
    """Totality, bed by bed: file, plate and exact multiset — duplicates included."""
    assert [
        (i.path.name, dict(Counter(i.slugs))) for i in colour_kit
    ] == [(name, beds) for name, _acc, beds in EXPECTED_COLOUR_BEDS]
    assert Counter(s for i in colour_kit for s in i.slugs) == Counter(KIT)
    for info in colour_kit:
        assert info.path.exists()
        assert len(info.slugs) <= 8


def test_every_colour_bed_needs_at_most_four_filaments(colour_kit):
    """White, black and the plate's ≤2 accents — the whole palette, in slot order.

    Totality on the shipped bytes: the 3MF's material list is exactly the four
    slots, and no part points past slot 4.
    """
    for info, (_name, accents, _beds) in zip(colour_kit, EXPECTED_COLOUR_BEDS):
        model = prusa3mf.read(info.path)
        assert model.has_config, info.path.name
        assert [h for _n, h in model.materials] == [WHITE[1], BLACK[1], *accents]
        assert model.materials[:2] == [WHITE, BLACK]
        assert len(model.materials) <= 4
        assert model.extruders() <= {1, 2, 3, 4}, (info.path.name, model.extruders())
        # one object per physical piece, duplicates too
        assert [o.name for o in model.objects] == info.slugs


# --------------------------------------------------------------------------- #
# The mono beds: exact multisets per form
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def mono_kit(config, tmp_path_factory):
    """The default single-faced mono run: no ``ids``, default bed and cap."""
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(export, "build_tile", _fake_build_tile)
        mp.setattr(export, "_mono_forms", _fake_mono_forms)
        return export_mono_batches(
            config,
            faces="single",
            variant="tile",
            height=TILE_H,
            bed=BED,
            spacing=SPACING,
            out_dir=tmp_path_factory.mktemp("mono-kit"),
            params=PARAMS,
            max_per_bed=8,
        )


def test_mono_beds_are_the_shared_set_bed_by_bed(mono_kit):
    for form in MONO_FORMS:
        beds = [i for i in mono_kit if i.form == form]
        assert [i.path.name for i in beds] == [
            f"mono-{form}-batch{n}.3mf" for n in range(1, 5)
        ]
        assert [dict(Counter(i.slugs)) for i in beds] == EXPECTED_MONO_BEDS, form
        assert Counter(s for i in beds for s in i.slugs) == Counter(KIT)
        for info in beds:
            assert len(prusa3mf.read(info.path).objects) == len(info.slugs)


def test_mono_md_says_the_beds_are_the_kit(mono_kit, tmp_path):
    mono_md = write_mono_md(tmp_path, faces="single", height=TILE_H, params=PARAMS)
    write_mono_batch_md(
        mono_md, mono_kit, bed=BED, spacing=SPACING, faces="single",
        height=TILE_H, params=PARAMS, max_per_bed=8,
    )
    text = mono_md.read_text(encoding="utf-8")
    assert "**fixed quantity set** — 32 pieces of 11 designs" in text
    assert "`h` ×5, `x` ×3" in text  # duplicates counted, not repeated


# --------------------------------------------------------------------------- #
# plates.md + CLI
# --------------------------------------------------------------------------- #


def test_plates_md_documents_the_kit_and_the_slot_count(config, tmp_path):
    text = write_plates_md(config, tmp_path, kit=True).read_text(encoding="utf-8")
    assert "**32 pieces of 11 designs**" in text
    assert "at most **4 filaments** per plate" in text
    assert "**4-slot** Bambu AMS" in text
    assert text.count("## Plate ") == 2
    # Quantities on the plate lists, the SWAP count unambiguous.
    assert "Z ×2, S ×2, T ×2, RZ dial ×2" in text
    assert "CNOT control ● ×4, X ×5, SWAP ×4" in text
    assert "H ×5" in text
    # No dropped design on any plate.
    assert "⊕" not in text.split("## Plate 1")[1]


def test_generate_plates_md_still_lists_every_design(config, tmp_path):
    """``generate`` keeps one of every design — only the accent cap moved."""
    text = write_plates_md(config, tmp_path).read_text(encoding="utf-8")
    assert "## What is on the beds" not in text
    assert "CNOT target ⊕" in text and "RX(π/4)" in text
    assert text.count("## Plate ") == 2


def test_three_accents_is_an_mmu_only_layout(config, tmp_path):
    text = write_plates_md(config, tmp_path, kit=True, max_accents=3).read_text(
        encoding="utf-8"
    )
    assert "at most **5 filaments** per plate" in text
    assert "**5-slot** Prusa Core One MMU" in text


def test_double_plates_md_says_it_needs_five_slots(config, tmp_path):
    text = write_double_plates_md(config, DOUBLE_FACED_KIT, tmp_path).read_text(
        encoding="utf-8"
    )
    assert "**5 filament slots**" in text and "4-slot AMS cannot" in text


def test_cli_max_accents_choices():
    from qamposer_hardware.cli import main

    with pytest.raises(SystemExit) as exc:
        main(["plates", "--max-accents", "4"])
    assert exc.value.code == 2  # argparse: not one of 1|2|3


def test_cli_double_kit_rejects_a_lower_accent_cap(tmp_path):
    """Refused before anything is built — the double kit needs its 3 accents."""
    from qamposer_hardware.cli import main

    with pytest.raises(SystemExit, match="single-faced kit only"):
        main(["plates", "--faces", "double", "--max-accents", "2",
              "--out", str(tmp_path)])
    assert not list(tmp_path.iterdir())
