"""Provenance stamps: every generated artifact names the checkout that built it.

A print file found on disk is otherwise undatable — a 3MF sliced a week after it
was generated may predate a geometry or palette fix, and looks identical to a
fresh one. Every generated ``.md`` carries a stamp line under its H1 and every
3MF carries ``Title``/``Description`` model metadata, both naming the commit and
the generation date.

The commit hash is *not* pinned here (it changes with every commit); the tests
assert the stamp's **shape** and that it appears exactly once per document.
"""

from __future__ import annotations

import re
import zipfile

import pytest
from qamposer_assets.config import load_config

from qamposer_hardware.build import build_double_tile, build_tile
from qamposer_hardware.export import (
    BatchInfo,
    _single_piece,
    _write_batch_3mf,
    export_double_tile_3mf,
    export_tile_3mf,
    provenance,
    write_batch_plates_md,
    write_double_plates_md,
    write_mono_md,
    write_plates_md,
)
from qamposer_hardware.pack import FOOTPRINT, Bed, pack_positions
from qamposer_hardware.params import HardwareParams

BED = Bed(250.0, 220.0)
SPACING = 8.0

#: ``a7611f0 · 2026-07-25`` — short hash (or ``unknown``) · ISO date.
PROVENANCE_RE = re.compile(r"^(?:[0-9a-f]{7,40}|unknown) · \d{4}-\d{2}-\d{2}$")

#: The md stamp line, e.g. ``> Generated from `a7611f0` on 2026-07-25 — …``.
STAMP_RE = re.compile(
    r"^> Generated from `(?:[0-9a-f]{7,40}|unknown)` on \d{4}-\d{2}-\d{2} — "
    r"regenerate with the matching checkout before printing\.$",
    re.MULTILINE,
)

DOUBLE_KIT = [(10, 11, 2), (12, None, 1)]


@pytest.fixture(scope="module")
def config():
    return load_config()


# --------------------------------------------------------------------------- #
# provenance()
# --------------------------------------------------------------------------- #


def test_provenance_shape():
    """In this repo (a real git checkout) the stamp is ``<short-hash> · <date>``."""
    text = provenance()
    assert PROVENANCE_RE.match(text), text
    assert not text.startswith("unknown"), "should resolve HEAD inside the repo"


def test_provenance_is_cached():
    """One generator run must stamp every output identically (incl. over midnight)."""
    assert provenance() is provenance()


# --------------------------------------------------------------------------- #
# Markdown writers — exactly one stamp, immediately under the H1
# --------------------------------------------------------------------------- #


def _assert_single_stamp_under_h1(text: str) -> None:
    assert len(STAMP_RE.findall(text)) == 1, "expected exactly one stamp line"
    lines = text.splitlines()
    assert lines[0].startswith("# ")
    assert STAMP_RE.match(lines[2]), f"stamp not under the H1: {lines[:4]}"


def test_plates_md_stamped(config, tmp_path):
    _assert_single_stamp_under_h1(
        write_plates_md(config, tmp_path).read_text(encoding="utf-8")
    )


def test_double_plates_md_stamped(config, tmp_path):
    _assert_single_stamp_under_h1(
        write_double_plates_md(config, DOUBLE_KIT, tmp_path).read_text(encoding="utf-8")
    )


@pytest.mark.parametrize("faces", ["single", "double"])
def test_mono_md_stamped(faces, tmp_path):
    _assert_single_stamp_under_h1(
        write_mono_md(tmp_path, faces=faces, height=6.0).read_text(encoding="utf-8")
    )


def test_batch_append_does_not_duplicate_stamp(config, tmp_path):
    """``write_batch_plates_md`` appends to an already-stamped base — no 2nd stamp."""
    base = write_plates_md(config, tmp_path)
    infos = [
        BatchInfo(
            plate=1,
            batch=1,
            path=tmp_path / "plate1-batch1.3mf",
            slugs=["h", "x"],
            positions=[(35.0, 35.0), (103.0, 35.0)],
            object_count=6,
            cols=3,
            rows=3,
        )
    ]
    write_batch_plates_md(
        base, infos, bed=BED, spacing=SPACING, faces="single", variant="tile"
    )
    text = base.read_text(encoding="utf-8")
    assert "## Print jobs" in text  # the append really happened
    _assert_single_stamp_under_h1(text)


# --------------------------------------------------------------------------- #
# 3MF model metadata
# --------------------------------------------------------------------------- #


def _model_xml(path) -> str:
    """The 3MF's model part as text — cheap, no mesh parsing."""
    with zipfile.ZipFile(path) as zf:
        return zf.read("3D/3dmodel.model").decode("utf-8")


def _assert_stamped_3mf(path, stem: str) -> None:
    xml = _model_xml(path)
    title = re.search(r'<metadata name="Title">([^<]*)</metadata>', xml)
    desc = re.search(r'<metadata name="Description">([^<]*)</metadata>', xml)
    assert title and desc, f"no Title/Description metadata in {path.name}"
    commit, _, date = provenance().partition(" · ")
    assert title.group(1) == f"{stem} — Entangible {commit}"
    assert desc.group(1) == f"Generated from {commit} on {date}"


def test_tile_3mf_stamped(config, tmp_path):
    parts = build_tile(10, config, variant="tile", height=6.0, params=HardwareParams())
    path = export_tile_3mf(parts, tmp_path)
    assert path is not None
    _assert_stamped_3mf(path, "h")


def test_double_tile_3mf_stamped(config, tmp_path):
    parts = build_double_tile(
        10, 11, config, variant="tile", height=8.0, params=HardwareParams()
    )
    path = export_double_tile_3mf(parts, tmp_path)
    assert path is not None
    _assert_stamped_3mf(path, "h+x")


def test_batch_3mf_stamped(config, tmp_path):
    """A batch 3MF is titled by its filename stem, e.g. ``plate1-batch1``."""
    pieces = [_single_piece(10, config, "tile", 6.0, HardwareParams())]
    positions = pack_positions(len(pieces), BED, FOOTPRINT, SPACING)
    path = tmp_path / "plate1-batch1.3mf"
    _write_batch_3mf(pieces, positions, path)
    _assert_stamped_3mf(path, "plate1-batch1")
