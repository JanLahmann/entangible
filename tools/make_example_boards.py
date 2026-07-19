"""Generate example board images for on-screen testing.

Renders the real board mat + tiles (same SVG pipeline as the printed kit) into
PNGs that can be shown fullscreen on a monitor and pointed at with a camera —
a printer-free way to exercise the whole detection pipeline (the camera role,
the pocket app, or `qamposer-vision detect`). Flip between images to simulate
placing/moving tiles.

Run from the repo root (Pillow is only needed by this tool):

    uv run --with pillow python tools/make_example_boards.py

Output: examples/test-boards/*.png (committed to the repo — regenerate after
changing assets.toml, tile design, or the marker table).
"""
from __future__ import annotations

import io
from pathlib import Path

from qamposer_assets.pdf import _prime_library_path

_prime_library_path()
import cairosvg  # noqa: E402
from PIL import Image  # noqa: E402

from qamposer_assets import board_svg, load_config, tile_svg  # noqa: E402

SCALE = 3.0  # px per mm → 2160x1500 for the 720x500 mat

# Marker ids (see docs/marker-ids.md): 10-13 H/X/Y/Z, 14 ●, 15 ⊕,
# 20-23 RX(π/4, π/2, π, -π/2), 24-27 RY, 28-31 RZ, 40 S, 41 T,
# 42/43/44 RX/RY/RZ dials, 45 SWAP ×. A placement is (id, row, col) or (id, row, col, rot)
# — the optional 4th element is the tile's clockwise 90° turn (0-3), which for a
# dial selects the angle ROTATION_ANGLES[rot].
SCENARIOS: dict[str, tuple[str, list[tuple[int, ...]]]] = {
    "01-empty": ("Empty board — corners only; expect an empty circuit", []),
    "02-single-h": ("H on q0 — superposition", [(10, 0, 0)]),
    "03-bell": (
        "Bell pair — H then CNOT; expect the entanglement celebration",
        [(10, 0, 0), (14, 0, 1), (15, 1, 1)],
    ),
    "04-ghz3": (
        "GHZ-3 — CNOT chain; repeated ●/⊕ ids exercise spatial dedupe",
        [(10, 0, 0), (14, 0, 1), (15, 1, 1), (14, 1, 2), (15, 2, 2)],
    ),
    "05-ghz5": (
        "GHZ-5 — full-height CNOT staircase, golf hole 5",
        [(10, 0, 0), (14, 0, 1), (15, 1, 1), (14, 1, 2), (15, 2, 2),
         (14, 2, 3), (15, 3, 3), (14, 3, 4), (15, 4, 4)],
    ),
    "06-all-families": (
        "Every gate family incl. S/T and rotations",
        [(10, 0, 0), (11, 1, 0), (12, 2, 0), (13, 3, 0),
         (40, 0, 1), (21, 1, 1), (41, 2, 1), (30, 3, 1),
         (14, 0, 2), (15, 1, 2)],
    ),
    "07-uniform-32": (
        "H on all five qubits — 32 equally likely outcomes (histogram stress)",
        [(10, q, 0) for q in range(5)],
    ),
    "08-lone-control": (
        "Warning case — a ● with no ⊕ partner; expect a friendly warning, no CNOT",
        [(10, 0, 0), (14, 1, 1)],
    ),
    "09-dials": (
        "Dial tiles — RX/RY/RZ dials turned to r=0/1/2 → RX(π/4), RY(π/2), RZ(π)",
        [(42, 0, 0, 0), (43, 1, 1, 1), (44, 2, 2, 2)],
    ),
    "10-swap": (
        "SWAP — H on q0 then two × tiles in a column swap q0/q1 (emitted as 3 CNOTs)",
        [(10, 0, 0), (45, 0, 1), (45, 1, 1)],
    ),
}


def rasterize(svg: str, w_mm: float, h_mm: float) -> Image.Image:
    png = cairosvg.svg2png(
        bytestring=svg.encode(),
        output_width=int(w_mm * SCALE),
        output_height=int(h_mm * SCALE),
    )
    return Image.open(io.BytesIO(png)).convert("RGB")


def main() -> None:
    cfg = load_config()
    b = cfg.board
    out_dir = Path(__file__).resolve().parent.parent / "examples" / "test-boards"
    out_dir.mkdir(parents=True, exist_ok=True)

    readme = [
        "# Test boards — on-screen detection testing without a printer",
        "",
        "Open an image fullscreen on a monitor (high brightness, avoid glare)",
        "and point a camera at it from ~30–60 cm with all four corner markers",
        "in frame: a phone in the camera role, the pocket app",
        "(https://entangible.org), or `uv run qamposer-vision detect --image`.",
        "Flip between images to simulate placing and moving tiles.",
        "",
        "Regenerate: `uv run --with pillow python tools/make_example_boards.py`",
        "",
    ]
    for name, (desc, placements) in SCENARIOS.items():
        mat = rasterize(board_svg(cfg), b.mat_width, b.mat_height)
        for placement in placements:
            marker_id, row, col = placement[0], placement[1], placement[2]
            rotation = placement[3] if len(placement) > 3 else 0
            tile = rasterize(tile_svg(marker_id, cfg), cfg.tile.size, cfg.tile.size)
            if rotation % 4:
                # PIL rotates counter-clockwise; a tile turn is clockwise.
                tile = tile.rotate(-90 * (rotation % 4), expand=False)
            cx = b.grid_offset_x + col * b.pitch + b.cell_size / 2
            cy = b.grid_offset_y + row * b.pitch + b.cell_size / 2
            mat.paste(tile, (int(cx * SCALE - tile.width / 2), int(cy * SCALE - tile.height / 2)))
        path = out_dir / f"{name}.png"
        mat.save(path, optimize=True)
        readme.append(f"- **{name}.png** — {desc}")
        print(f"{path.name}: {path.stat().st_size // 1024} KB")

    (out_dir / "README.md").write_text("\n".join(readme) + "\n")
    print(f"{len(SCENARIOS)} boards + README -> {out_dir}")


if __name__ == "__main__":
    main()
