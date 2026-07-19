"""The booth-staff cheat-sheet: one A4 page, key content present, non-trivial PDF."""

from __future__ import annotations

import pytest

from qamposer_assets import cli
from qamposer_assets.cheatsheet import ENTANGIBLE_URL, cheatsheet_svg, cheatsheet_svgs
from qamposer_assets.config import load_config
from qamposer_assets.pdf import available_backend

CFG = load_config()
HAVE_PDF = available_backend() is not None


def test_cheatsheet_is_a_single_a4_page():
    svgs = cheatsheet_svgs(CFG)
    assert len(svgs) == 1
    svg = svgs[0]
    # A4 portrait, millimetre user units.
    assert 'width="210mm"' in svg
    assert 'height="297mm"' in svg


def test_cheatsheet_carries_the_reference_content():
    svg = cheatsheet_svg(CFG)
    for needle in (
        "Entangible",
        "make demo",
        "qamposer-physical run",
        "/debug",
        "/?kiosk",
        "CNOT",
        "TROUBLESHOOTING",
        "Show Details",  # iPhone cert tap-through
    ):
        assert needle in svg, needle


def test_cheatsheet_embeds_the_entangible_qr():
    # The live QR encodes entangible.org and draws as many module rects.
    svg = cheatsheet_svg(CFG)
    assert ENTANGIBLE_URL == "https://entangible.org"
    assert svg.count("<rect") > 100  # QR modules + cards


def test_cli_cheatsheet_writes_one_file(tmp_path):
    rc = cli.main(["--out", str(tmp_path), "cheatsheet"])
    assert rc == (0 if HAVE_PDF else 3)
    suffix = "pdf" if HAVE_PDF else "svg"
    files = sorted((tmp_path / "cheatsheet").glob(f"*.{suffix}"))
    assert len(files) == 1
    assert files[0].name == f"cheatsheet.{suffix}"


def test_cli_all_includes_the_cheatsheet(tmp_path):
    rc = cli.main(["--out", str(tmp_path), "all"])
    assert rc == (0 if HAVE_PDF else 3)
    suffix = "pdf" if HAVE_PDF else "svg"
    assert (tmp_path / "cheatsheet" / f"cheatsheet.{suffix}").exists()


@pytest.mark.skipif(not HAVE_PDF, reason="no SVG->PDF backend available")
def test_cheatsheet_pdf_is_non_trivial(tmp_path):
    cli.main(["--out", str(tmp_path), "cheatsheet"])
    pdf = tmp_path / "cheatsheet" / "cheatsheet.pdf"
    assert pdf.exists()
    assert pdf.stat().st_size > 10_000, f"cheatsheet.pdf is only {pdf.stat().st_size} bytes"
