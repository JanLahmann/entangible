"""Every coloured 3MF we emit opens as a ready-made PrusaSlicer project.

The bug this file locks down: PrusaSlicer does **not** read a generic 3MF's
``<basematerials>`` when it assigns filaments. It cycles its loaded filaments
over the objects instead, so a batch of 168 one-solid objects came out on
extruders 1, 2, 3, 4, 5, 1, 2, … — the file was correct 3MF and still unusable.
The fix has two halves and both are asserted here, on the shipped bytes:

* **one object per piece**, its colour parts as consecutive triangle ranges;
* ``Metadata/Slic3r_PE_model.config``, where each range carries the filament
  slot its colour holds in the palette (white = 1, black = 2, accents 3+).

Coverage is the whole emitted matrix — single/double faces × tile/cube, per
piece coloured + b/w, coloured batches, b/w batches, corner batches — with a
two-gate kit per cell so the sweep is a sweep rather than a single sample. The
mono beds are deliberately absent: a mono piece is one uncoloured solid printed
on one filament, so it has no parts to assign and ships no project part.

``test_prusaslicer_round_trip`` is the acceptance test: it hands the file to the
real PrusaSlicer CLI, re-exports it and reads the extruder back out of
*PrusaSlicer's own* project part. Skipped where the CLI is absent (CI).
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import prusa3mf
import pytest
from qamposer_assets.config import load_config

from qamposer_hardware.export import (
    _double_piece,
    _single_piece,
    _write_batch_3mf,
    export_corner_batches,
    export_bw_batches,
    export_double_tile_3mf,
    export_double_tile_bw_3mf,
    export_tile_3mf,
    export_tile_bw_3mf,
)
from qamposer_hardware.build import build_double_tile, build_tile
from qamposer_hardware.face import accent_color_name, double_color_name
from qamposer_hardware.pack import Bed, pack_positions, FOOTPRINT
from qamposer_hardware.params import HardwareParams

BED = Bed(250.0, 220.0)
SPACING = 8.0
PARAMS = HardwareParams()

#: H (red) and X (dark blue) — two gates, two accents, one plate.
SINGLE_IDS = [30, 35]
SINGLE_ACCENTS = ["#fa4d56", "#002d9c"]
#: A cross-family flip piece (H|X) and a same-family one (Y|Y is not a kit
#: member, so Y alone: ``b=None`` is the "same face twice" form).
DOUBLE_KIT = [(30, 35), (12, None)]
DOUBLE_ACCENTS = ["#fa4d56", "#002d9c", "#9f1853"]

#: variant, faces, piece height — the four shapes of kit we emit 3MFs for.
MATRIX = [
    ("tile", "single", 6.0),
    ("cube", "single", 60.0),
    ("tile", "double", 8.0),
    ("cube", "double", 60.0),
]

PRUSASLICER = Path(
    "/Applications/Original Prusa Drivers/PrusaSlicer.app/Contents/MacOS/PrusaSlicer"
)


@dataclass(slots=True)
class Emitted:
    """Every 3MF one cell of the matrix writes, split by what it must contain."""

    variant: str
    faces: str
    colored: list[Path]  # per-piece + batch files, white/black/accents
    bw: list[Path]  # per-piece + batch files, white/black only
    corners: list[Path]  # board furniture, white/black only
    accents: list[str]  # the plate's accent slot order (3, 4, 5)

    @property
    def two_slot(self) -> list[Path]:
        return self.bw + self.corners

    @property
    def all(self) -> list[Path]:
        return self.colored + self.bw + self.corners


@pytest.fixture(scope="module")
def config():
    return load_config()


@pytest.fixture(scope="module", params=MATRIX, ids=[f"{f}-{v}" for v, f, _h in MATRIX])
def emitted(request, config, tmp_path_factory) -> Emitted:
    """Write one cell of the matrix: per-piece, batch, b/w and corner 3MFs."""
    variant, faces, height = request.param
    out = tmp_path_factory.mktemp(f"{faces}-{variant}")
    colored: list[Path] = []
    bw: list[Path] = []

    if faces == "single":
        accents = SINGLE_ACCENTS
        for mid in SINGLE_IDS:
            parts = build_tile(mid, config, variant=variant, height=height, params=PARAMS)
            colored.append(export_tile_3mf(parts, out))
            bw.append(export_tile_bw_3mf(parts, out))
        pieces = [_single_piece(m, config, variant, height, PARAMS) for m in SINGLE_IDS]
    else:
        accents = DOUBLE_ACCENTS
        for a, b in DOUBLE_KIT:
            parts = build_double_tile(
                a, b, config, variant=variant, height=height, params=PARAMS
            )
            colored.append(export_double_tile_3mf(parts, out))
            bw.append(export_double_tile_bw_3mf(parts, out))
        pieces = [
            _double_piece(a, b, config, variant, height, PARAMS) for a, b in DOUBLE_KIT
        ]

    positions = pack_positions(len(pieces), BED, FOOTPRINT, SPACING)
    batch = out / "plate1-batch1.3mf"
    _write_batch_3mf(
        pieces,
        positions,
        batch,
        accents=accents,
        name_accent=double_color_name if faces == "double" else accent_color_name,
    )
    colored.append(batch)

    bw_infos = export_bw_batches(
        config,
        faces=faces,
        variant=variant,
        height=height,
        bed=BED,
        spacing=SPACING,
        out_dir=out,
        params=PARAMS,
        ids=SINGLE_IDS if faces == "single" else None,
        kit=None if faces == "single" else [(a, b, 1) for a, b in DOUBLE_KIT],
    )
    bw.extend(info.path for info in bw_infos)

    # Board furniture has no double-faced form: one corner block per variant.
    corner_infos = export_corner_batches(
        config,
        variant=variant,
        height=height,
        bed=BED,
        spacing=SPACING,
        out_dir=out,
        params=PARAMS,
        ids=[0],
    )
    return Emitted(
        variant=variant,
        faces=faces,
        colored=[p for p in colored if p is not None],
        bw=[p for p in bw if p is not None],
        corners=[info.path for info in corner_infos],
        accents=accents,
    )


# --------------------------------------------------------------------------- #
# Structure: one object per piece, parts as triangle ranges
# --------------------------------------------------------------------------- #


def test_every_piece_is_one_object_with_named_parts(emitted):
    """No file may fall back to one object per solid — that *is* the bug.

    Every object carries a project entry, has at least a body and a marker part,
    and every part name is its object's name plus ``-<role>-<colour>``, which is
    the name the slicer's part list shows.
    """
    for path in emitted.all:
        model = prusa3mf.read(path)
        assert model.has_config, f"{path.name} ships no PrusaSlicer project part"
        assert model.objects, f"{path.name} is empty"
        assert len(model.build_items) == len(model.objects)
        assert set(model.build_items) == {o.id for o in model.objects}
        for obj in model.objects:
            assert obj.name, f"{path.name}: unnamed object {obj.id}"
            assert len(obj.volumes) >= 2, f"{path.name}: {obj.name} has {obj.volumes}"
            for vol in obj.volumes:
                assert vol.name.startswith(f"{obj.name}-"), (path.name, vol.name)
                assert vol.name.count("-") >= 2, (path.name, vol.name)


def test_volume_ranges_partition_every_object(emitted):
    """No gap, no overlap, full coverage — a triangle belongs to exactly one part.

    A gap would leave triangles on PrusaSlicer's default filament; an overlap or
    an out-of-range id makes the file unreadable.
    """
    for path in emitted.all:
        model = prusa3mf.read(path)
        for obj in model.objects:
            covered = 0
            expect_first = 0
            for vol in obj.volumes:
                assert vol.first == expect_first, (path.name, obj.name, vol.name)
                assert vol.last >= vol.first, (path.name, obj.name, vol.name)
                expect_first = vol.last + 1
                covered += vol.count
            assert covered == obj.triangle_count, (path.name, obj.name)


def test_every_extruder_is_a_declared_slot(emitted):
    """A part may only point at a filament the file's own palette declares."""
    for path in emitted.all:
        model = prusa3mf.read(path)
        slots = set(range(1, len(model.materials) + 1))
        assert model.extruders() <= slots, (path.name, model.extruders(), slots)
        assert 1 in model.extruders()  # the white body is always slot 1


def test_triangle_colours_agree_with_the_extruder_slots(emitted):
    """The two views of the same file must not drift apart.

    A slicer that reads base materials (Bambu, Orca, viewers) and PrusaSlicer,
    which reads the project part, have to end up with the same part in the same
    colour — so a part's triangles must all carry the base material whose slot
    number the project part assigns.
    """
    for path in emitted.all:
        model = prusa3mf.read(path)
        for obj in model.objects:
            for vol in obj.volumes:
                indices = set(obj.triangle_material[vol.first : vol.last + 1])
                assert indices == {vol.extruder - 1}, (path.name, vol.name, indices)


# --------------------------------------------------------------------------- #
# Slot numbering: the plates.md table, and nothing else
# --------------------------------------------------------------------------- #


def test_bw_and_corner_files_use_exactly_two_slots(emitted):
    """The two-filament promise, as totality: no third material, no third slot."""
    for path in emitted.two_slot:
        model = prusa3mf.read(path)
        assert model.materials == [("white", "#ffffff"), ("black", "#000000")], path.name
        assert model.extruders() == {1, 2}, (path.name, model.extruders())


def test_colored_files_number_slots_in_plate_order(emitted):
    """White = 1, black = 2, then the plate's accents in plates.md table order."""
    for path in emitted.colored:
        model = prusa3mf.read(path)
        assert model.materials[0] == ("white", "#ffffff"), path.name
        assert model.materials[1] == ("black", "#000000"), path.name
        accents = [hexc for _n, hexc in model.materials[2:]]
        assert accents == [a for a in emitted.accents if a in accents], path.name
        assert len(model.materials) <= 5, path.name  # the MMU3's five slots
        for obj in prusa3mf.read(path).objects:
            for vol in obj.volumes:
                if vol.name.endswith("-white"):
                    assert vol.extruder == 1, (path.name, vol.name)
                elif vol.name.endswith("-black"):
                    assert vol.extruder == 2, (path.name, vol.name)
                else:
                    assert vol.extruder >= 3, (path.name, vol.name)


def test_batch_carries_the_whole_plate_palette(emitted):
    """A batch numbers slots off its *plate*, so a colour keeps its slot per plate.

    The per-piece files are printed on their own and start their accents at slot
    3 whatever the plate holds; a batch declares the plate's full accent list, so
    a piece that uses only the plate's second accent still prints on slot 4.
    """
    batch = prusa3mf.read(emitted.colored[-1])
    assert [hexc for _n, hexc in batch.materials[2:]] == emitted.accents
    for i, hexc in enumerate(emitted.accents):
        assert batch.slot(hexc) == i + 3, (hexc, batch.slot(hexc))


# --------------------------------------------------------------------------- #
# The acceptance test: PrusaSlicer itself
# --------------------------------------------------------------------------- #


def _prusaslicer() -> Path | None:
    if PRUSASLICER.exists():
        return PRUSASLICER
    found = shutil.which("prusa-slicer") or shutil.which("PrusaSlicer")
    return Path(found) if found else None


@pytest.mark.skipif(_prusaslicer() is None, reason="PrusaSlicer CLI not installed")
def test_prusaslicer_round_trip(emitted, tmp_path):
    """Hand the file to PrusaSlicer and read the extruders back out of its export.

    The only check that proves the point end to end: the parts arrive as parts
    of one object and every one of them is on the slot we meant, as *PrusaSlicer*
    understands it — not as our writer claims.
    """
    exe = _prusaslicer()
    samples = [emitted.colored[-1], emitted.bw[-1], emitted.bw[0]] + emitted.corners[:1]
    for path in samples:
        ours = prusa3mf.read(path)
        rt = tmp_path / f"rt-{path.name}"
        done = subprocess.run(
            [str(exe), "--export-3mf", "--dont-arrange", "-o", str(rt), str(path)],
            capture_output=True,
            text=True,
        )
        assert done.returncode == 0, done.stderr or done.stdout
        back = prusa3mf.read(rt)
        assert back.has_config, f"{path.name} lost its project part"
        assert len(back.objects) == len(ours.objects), path.name
        assert sorted(
            (vol.name, vol.extruder) for obj in back.objects for vol in obj.volumes
        ) == sorted(
            (vol.name, vol.extruder) for obj in ours.objects for vol in obj.volumes
        ), path.name
        if path in emitted.two_slot:
            assert back.extruders() == {1, 2}, (path.name, back.extruders())
