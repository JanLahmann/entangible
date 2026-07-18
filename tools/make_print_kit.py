"""Build the single-file, print-ready kit PDF.

Merges the booth-kit tile sheets and the tiled A4 board mat into ONE portrait-A4
PDF (landscape board pages are rotated into portrait frames — an isometric
transform, so 100 % print scale is preserved). The result is a committed
release artifact consumed by the pocket app's guide page and by anyone
printing from GitHub.

Run from the repo root:

    uv run qamposer-assets all --out out/assets      # fresh sources
    uv run --with pypdf python tools/make_print_kit.py

Output: examples/print/entangible-print-kit-A4.pdf
"""
from __future__ import annotations

import glob
from pathlib import Path

from pypdf import PdfReader, PdfWriter, Transformation
from pypdf._page import PageObject

A4_W, A4_H = 595.2755905511812, 841.8897637795277


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    files = sorted(glob.glob(str(root / "out/assets/tiles/booth-kit_A4-p0*.pdf"))) + sorted(
        glob.glob(str(root / "out/assets/board/board_A4_tiled-p0*.pdf"))
    )
    if not files:
        raise SystemExit("no source PDFs — run `uv run qamposer-assets all --out out/assets` first")

    writer = PdfWriter()
    rotated = 0
    for f in files:
        src = PdfReader(f).pages[0]
        if float(src.mediabox.width) > float(src.mediabox.height):
            dest = PageObject.create_blank_page(width=A4_W, height=A4_H)
            # rotate(90): (x, y) -> (-y, x); shift right by the source height.
            dest.merge_transformed_page(
                src, Transformation().rotate(90).translate(tx=float(src.mediabox.height), ty=0)
            )
            writer.add_page(dest)
            rotated += 1
        else:
            writer.add_page(src)

    out = root / "examples" / "print" / "entangible-print-kit-A4.pdf"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "wb") as fh:
        writer.write(fh)
    print(f"{out.relative_to(root)}: {len(files)} pages ({rotated} rotated), {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
