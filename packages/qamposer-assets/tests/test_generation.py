"""End-to-end: the CLI generates the expected PDF set into a fresh directory."""

from __future__ import annotations

import math

import pytest

from qamposer_assets import cli
from qamposer_assets.config import load_config
from qamposer_assets.pdf import available_backend
from qamposer_assets.sheets import FORMAT_GRID, kit_tile_ids

CFG = load_config()
HAVE_PDF = available_backend() is not None


def test_kit_tile_count_matches_assets_toml():
    k = CFG.kit
    # 12 rotation variants (RX/RY/RZ × 4 angles) × rotations_each.
    expected = (
        k.H
        + k.X
        + k.Y
        + k.Z
        + k.S
        + k.T
        + k.CNOT_control
        + k.CNOT_target
        + 12 * k.rotations_each
    )
    ids = kit_tile_ids(CFG)
    assert len(ids) == expected == 44


def test_cli_all_end_to_end(tmp_path):
    rc = cli.main(["--out", str(tmp_path), "--format", "A4", "all"])
    assert rc == (0 if HAVE_PDF else 3)

    suffix = "pdf" if HAVE_PDF else "svg"
    tiles = sorted((tmp_path / "tiles").glob(f"*.{suffix}"))
    board = sorted((tmp_path / "board").glob(f"*.{suffix}"))

    # Booth kit: ceil(44 / 12) = 4 pages; sample: ceil(20 / 12) = 2 pages.
    cols, rows = FORMAT_GRID["A4"]
    per_page = cols * rows
    kit_pages = math.ceil(len(kit_tile_ids(CFG)) / per_page)
    kit_files = [p for p in tiles if p.name.startswith("booth-kit")]
    assert len(kit_files) == kit_pages == 4

    assert (tmp_path / "board" / f"board_full.{suffix}").exists()
    # 720×500 mat over landscape A4 => a multi-page tiled set.
    tiled = [p for p in board if "tiled" in p.name]
    assert len(tiled) >= 4


@pytest.mark.skipif(not HAVE_PDF, reason="no SVG->PDF backend available")
def test_primary_pdfs_are_non_trivial(tmp_path):
    cli.main(["--out", str(tmp_path), "--format", "A4", "all"])
    for name in (
        "tiles/booth-kit_A4-p01.pdf",
        "tiles/sample_A4-p01.pdf",
        "board/board_full.pdf",
    ):
        path = tmp_path / name
        assert path.exists(), name
        assert path.stat().st_size > 10_000, f"{name} is only {path.stat().st_size} bytes"


def test_svg_flag_keeps_intermediate_svg(tmp_path):
    cli.main(["--out", str(tmp_path), "--format", "A4", "--svg", "tiles"])
    assert sorted((tmp_path / "tiles").glob("*.svg"))
