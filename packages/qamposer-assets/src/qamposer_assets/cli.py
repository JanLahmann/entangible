"""``qamposer-assets`` — generate printable tiles and board mats as PDFs.

Subcommands:

* ``tiles`` — tile cut-sheets (booth kit + one-of-everything) for a paper format.
* ``board`` — the board mat: full single page **and** the tiled multi-page set.
* ``cheatsheet`` — the one-page booth-staff quick reference (A4).
* ``laser`` — laser-cutter export: red-cut / black-engrave SVGs nested onto a
  laser bed (``--bed WxH``), plus one SVG per gate and a shop README.
* ``all``   — everything above **except** ``laser`` (laser writes SVG-only).

SVG is the source of truth; PDFs are rendered via :mod:`cairosvg` (falling back
to ``svglib``/``reportlab``). If no PDF backend is available the SVGs are still
written and the process exits non-zero with a hint.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Iterable
from pathlib import Path

from .board import board_svg, board_tiled_svgs
from .cheatsheet import cheatsheet_svgs
from .config import AssetsConfig, load_config
from .laser import (
    DEFAULT_BED,
    DEFAULT_KERF_MM,
    DEFAULT_MARGIN_MM,
    DEFAULT_SPACING_MM,
    laser_bed_grid,
    laser_notes_text,
    laser_sheet_svgs,
    laser_tile_svg,
)
from .pdf import BackendUnavailable, available_backend, svg_to_pdf
from .sheets import kit_sheet_svgs, kit_tile_ids, sample_sheet_svgs, tile_sheet_svgs
from .tile_face import gate_marker_ids
from .paper import PAGE_SIZES

__all__ = ["main", "build_parser"]

_DEFAULT_OUT = Path("out/assets")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="qamposer-assets",
        description="Generate Entangible printable assets (tiles + board mat).",
    )
    parser.add_argument(
        "--format",
        choices=sorted(PAGE_SIZES),
        default="A4",
        help="paper format for cut-sheets and the tiled board (default: A4).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=_DEFAULT_OUT,
        help=f"output directory (default: {_DEFAULT_OUT}).",
    )
    parser.add_argument(
        "--svg",
        action="store_true",
        help="also keep the intermediate SVG next to each PDF.",
    )
    parser.add_argument(
        "--assets-toml",
        type=Path,
        default=None,
        help="explicit path to assets.toml (default: auto-locate).",
    )
    laser_group = parser.add_argument_group("laser options (command: laser)")
    laser_group.add_argument(
        "--bed",
        type=_parse_bed,
        default=DEFAULT_BED,
        metavar="WxH",
        help=(
            "laser bed size in mm for the 'laser' command "
            f"(default: {int(DEFAULT_BED[0])}x{int(DEFAULT_BED[1])})."
        ),
    )
    laser_group.add_argument(
        "--spacing",
        type=float,
        default=DEFAULT_SPACING_MM,
        help=f"mm gap between nested tiles (default: {DEFAULT_SPACING_MM}).",
    )
    laser_group.add_argument(
        "--kerf",
        type=float,
        default=DEFAULT_KERF_MM,
        help=(
            "mm laser kerf; outsets each cut outline by kerf/2 "
            f"(default: {DEFAULT_KERF_MM} = nominal, shop applies its offset)."
        ),
    )
    parser.add_argument(
        "command",
        choices=("tiles", "board", "cheatsheet", "laser", "all"),
        help="what to generate.",
    )
    return parser


def _parse_bed(value: str) -> tuple[float, float]:
    """Parse a ``WxH`` millimetre bed spec, e.g. ``300x200`` → (300.0, 200.0)."""
    parts = value.lower().replace("×", "x").split("x")
    if len(parts) != 2:
        raise argparse.ArgumentTypeError(
            f"bed must be 'WxH' in mm (e.g. 300x200), got {value!r}"
        )
    try:
        w, h = float(parts[0]), float(parts[1])
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"bed dimensions must be numbers, got {value!r}"
        ) from exc
    if w <= 0 or h <= 0:
        raise argparse.ArgumentTypeError(f"bed dimensions must be positive, got {value!r}")
    return (w, h)


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------


class _Writer:
    """Writes SVG pages to PDF (and optionally SVG), tracking what it produced."""

    def __init__(self, out_dir: Path, *, keep_svg: bool, svg_only: bool) -> None:
        self.out_dir = out_dir
        self.keep_svg = keep_svg
        self.svg_only = svg_only
        self.written: list[Path] = []

    def _write_svg(self, svg: str, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(svg, encoding="utf-8")
        self.written.append(path)

    def emit(self, svgs: Iterable[str], subdir: str, stem: str) -> None:
        """Render an ordered list of pages to ``<out>/<subdir>/<stem>-pNN``."""
        pages = list(svgs)
        multi = len(pages) > 1
        for i, svg in enumerate(pages, start=1):
            name = f"{stem}-p{i:02d}" if multi else stem
            base = self.out_dir / subdir / name
            if self.keep_svg or self.svg_only:
                self._write_svg(svg, base.with_suffix(".svg"))
            if not self.svg_only:
                pdf_path = base.with_suffix(".pdf")
                svg_to_pdf(svg, pdf_path)
                self.written.append(pdf_path)


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def _do_tiles(cfg: AssetsConfig, writer: _Writer, fmt: str) -> None:
    writer.emit(kit_sheet_svgs(cfg, fmt), "tiles", f"booth-kit_{fmt}")
    writer.emit(sample_sheet_svgs(cfg, fmt), "tiles", f"sample_{fmt}")


def _do_board(cfg: AssetsConfig, writer: _Writer, fmt: str) -> None:
    writer.emit([board_svg(cfg)], "board", "board_full")
    writer.emit(board_tiled_svgs(cfg, fmt), "board", f"board_{fmt}_tiled")


def _do_cheatsheet(cfg: AssetsConfig, writer: _Writer) -> None:
    writer.emit(cheatsheet_svgs(cfg), "cheatsheet", "cheatsheet")


def generate_laser(
    cfg: AssetsConfig,
    out_dir: Path,
    bed: tuple[float, float],
    *,
    spacing: float,
    kerf: float,
) -> list[Path]:
    """Write the laser export (SVG-only): nested sheets, per-gate tiles, README.

    Laser output is always SVG (never PDF): laser shops import vector SVG, and
    the red/black stroke convention must survive verbatim.
    """
    bed_w, bed_h = bed
    written: list[Path] = []

    def _write(svg_or_text: str, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(svg_or_text, encoding="utf-8")
        written.append(path)

    # --- Nested kit sheets ---------------------------------------------------
    cols, rows = laser_bed_grid(cfg, bed_w, bed_h, spacing=spacing)
    sheets = laser_sheet_svgs(
        cfg, kit_tile_ids(cfg), bed_w, bed_h, spacing=spacing, kerf=kerf
    )
    stem = f"kit-bed{int(bed_w)}x{int(bed_h)}"
    multi = len(sheets) > 1
    for i, svg in enumerate(sheets, start=1):
        name = f"{stem}-p{i:02d}" if multi else stem
        _write(svg, out_dir / "laser" / "sheets" / f"{name}.svg")

    # --- One SVG per gate for one-off cuts -----------------------------------
    for marker_id in gate_marker_ids():
        _write(
            laser_tile_svg(marker_id, cfg, kerf=kerf),
            out_dir / "laser" / "tiles" / f"tile-{marker_id}.svg",
        )

    # --- Shop README ---------------------------------------------------------
    _write(
        laser_notes_text(
            bed_w=bed_w,
            bed_h=bed_h,
            spacing=spacing,
            margin=DEFAULT_MARGIN_MM,
            kerf=kerf,
            cols=cols,
            rows=rows,
        ),
        out_dir / "laser" / "README.txt",
    )
    return written


def generate(
    command: str,
    cfg: AssetsConfig,
    out_dir: Path,
    fmt: str,
    *,
    keep_svg: bool,
    svg_only: bool,
) -> list[Path]:
    """Run ``command`` and return the list of written files."""
    writer = _Writer(out_dir, keep_svg=keep_svg, svg_only=svg_only)
    if command in ("tiles", "all"):
        _do_tiles(cfg, writer, fmt)
    if command in ("board", "all"):
        _do_board(cfg, writer, fmt)
    if command in ("cheatsheet", "all"):
        _do_cheatsheet(cfg, writer)
    return writer.written


def _report(written: list[Path], out_dir: Path, kind: str) -> None:
    for path in written:
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        print(f"  {path}  ({size:,} bytes)")
    print(f"Wrote {len(written)} {kind} to {out_dir}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cfg = load_config(args.assets_toml)

    if args.command == "laser":
        # Laser export is SVG-only; no PDF backend involved.
        written = generate_laser(
            cfg, args.out, args.bed, spacing=args.spacing, kerf=args.kerf
        )
        _report(written, args.out, "laser SVG file(s)")
        return 0

    backend = available_backend()
    svg_only = backend is None
    if svg_only:
        print(
            "warning: no SVG->PDF backend found (cairosvg/libcairo or "
            "svglib+reportlab). Writing SVG files only.\n"
            "  Fix: `brew install cairo` / `apt install libcairo2`, or "
            "`uv pip install 'qamposer-assets[fallback]'`.",
            file=sys.stderr,
        )
    else:
        print(f"Using SVG->PDF backend: {backend}", file=sys.stderr)

    try:
        written = generate(
            args.command,
            cfg,
            args.out,
            args.format,
            keep_svg=args.svg,
            svg_only=svg_only,
        )
    except BackendUnavailable as exc:  # pragma: no cover - defensive
        print(f"error: {exc}", file=sys.stderr)
        return 2

    _report(written, args.out, "file(s)")
    return 3 if svg_only else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
