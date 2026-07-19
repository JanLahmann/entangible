"""Isometric vector renderings of the Entangible gate cubes (task #39).

Reuses the REAL 2D tile-face SVGs from qamposer-assets — marker bit matrices,
gate colours, frames, label bands — projected onto the top faces of 60 mm
cubes, with flat-shaded sides and the mat SVG as the ground plane. No OpenGL,
no mesh pipeline: pure SVG affine transforms, so print/vision/render can never
drift and the output is crisp at any size.

Outputs (checked in):
    examples/renders/cube-family.svg/.png   - the gate-cube family, staggered
    examples/renders/bell-on-mat.svg/.png   - H + CNOT pair on the board mat

Regenerate:  uv run python tools/render_cube_art.py
"""

from __future__ import annotations

import math
from pathlib import Path

from qamposer_assets.pdf import _prime_library_path

_prime_library_path()  # locate Homebrew libcairo before importing cairosvg
import cairosvg  # noqa: E402

from qamposer_assets.config import AssetsConfig, load_config
from qamposer_assets.board import board_body
from qamposer_assets.tile_face import tile_body
from qamposer_vision.markers import MARKER_TABLE

OUT_DIR = Path(__file__).resolve().parent.parent / "examples" / "renders"

COS30 = math.cos(math.pi / 6)
SIN30 = 0.5
CUBE_H = 60.0  # cube height (mm) — matches the hardware `cube` variant
FACE_T = 0.8  # coloured top-face thickness (mm) — the MMU colour layer
# Cool light greys for the white cube body, tinted toward the app palette.
SIDE_RIGHT = "#e9ebf0"
SIDE_FRONT = "#d8dbe2"


def proj(x: float, y: float, z: float) -> tuple[float, float]:
    """Isometric screen projection (x right-down, y left-down, z up)."""
    return ((x - y) * COS30, (x + y) * SIN30 - z)


def fmt(v: float) -> str:
    return f"{v:.2f}".rstrip("0").rstrip(".")


def iso_group(x0: float, y0: float, z: float, inner: str) -> str:
    """Wrap `inner` (a top-down mm drawing) into the iso plane at height z."""
    e, f = proj(x0, y0, z)
    m = f"matrix({COS30:.5f} {SIN30} {-COS30:.5f} {SIN30} {fmt(e)} {fmt(f)})"
    return f'<g transform="{m}">{inner}</g>'


def poly(pts: list[tuple[float, float]], fill: str, opacity: float | None = None) -> str:
    p = " ".join(f"{fmt(x)},{fmt(y)}" for x, y in pts)
    op = f' fill-opacity="{opacity}"' if opacity is not None else ""
    return f'<polygon points="{p}" fill="{fill}"{op}/>'


def shade(hex_color: str, factor: float) -> str:
    """Darken a #rrggbb colour by `factor` (0..1)."""
    r, g, b = (int(hex_color[i : i + 2], 16) for i in (1, 3, 5))
    return f"#{int(r * factor):02x}{int(g * factor):02x}{int(b * factor):02x}"


def cube(cfg: AssetsConfig, marker_id: int, x0: float, y0: float, shadow: bool = True) -> str:
    """One gate cube with its real face art on top, back-to-front paintable."""
    s = cfg.tile.size
    spec = MARKER_TABLE[marker_id]
    color = cfg.colors.for_gate(spec.gate)
    parts: list[str] = []

    if shadow:
        # Soft contact shadow: the footprint nudged +x/+y projects straight
        # down in screen space, so only a sliver shows below the front edges.
        parts.append(
            poly(
                [
                    proj(x0 + 4, y0 + 4, 0),
                    proj(x0 + s + 4, y0 + 4, 0),
                    proj(x0 + s + 4, y0 + s + 4, 0),
                    proj(x0 + 4, y0 + s + 4, 0),
                ],
                "#0f1117",
                opacity=0.12,
            )
        )

    # Body sides (white), then the thin coloured face-layer strip on top.
    body_top = CUBE_H - FACE_T
    parts.append(
        poly(
            [
                proj(x0 + s, y0, body_top),
                proj(x0 + s, y0 + s, body_top),
                proj(x0 + s, y0 + s, 0),
                proj(x0 + s, y0, 0),
            ],
            SIDE_RIGHT,
        )
    )
    parts.append(
        poly(
            [
                proj(x0, y0 + s, body_top),
                proj(x0 + s, y0 + s, body_top),
                proj(x0 + s, y0 + s, 0),
                proj(x0, y0 + s, 0),
            ],
            SIDE_FRONT,
        )
    )
    parts.append(
        poly(
            [
                proj(x0 + s, y0, CUBE_H),
                proj(x0 + s, y0 + s, CUBE_H),
                proj(x0 + s, y0 + s, body_top),
                proj(x0 + s, y0, body_top),
            ],
            shade(color, 0.85),
        )
    )
    parts.append(
        poly(
            [
                proj(x0, y0 + s, CUBE_H),
                proj(x0 + s, y0 + s, CUBE_H),
                proj(x0 + s, y0 + s, body_top),
                proj(x0, y0 + s, body_top),
            ],
            shade(color, 0.7),
        )
    )

    # Top face: the genuine 2D tile artwork, projected.
    parts.append(iso_group(x0, y0, CUBE_H, tile_body(marker_id, cfg)))
    return "".join(parts)


def wrap_svg(inner: str, bounds: tuple[float, float, float, float], pad: float) -> str:
    x0, y0, x1, y1 = bounds
    w, h = x1 - x0 + 2 * pad, y1 - y0 + 2 * pad
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{fmt(x0 - pad)} {fmt(y0 - pad)} {fmt(w)} {fmt(h)}">'
        f"<!-- generated by tools/render_cube_art.py — do not edit -->{inner}</svg>"
    )


def bounds_of(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def footprint_points(x0: float, y0: float, s: float) -> list[tuple[float, float]]:
    """Projected extremes of a cube (all 8 corners)."""
    pts = []
    for dx in (0.0, s):
        for dy in (0.0, s):
            for z in (0.0, CUBE_H):
                pts.append(proj(x0 + dx, y0 + dy, z))
    return pts


def find_gate(gate: str, parameter: float | None = None, role: str | None = None) -> int:
    """Marker id for a gate (optionally a rotation angle or CNOT role)."""
    for mid, spec in sorted(MARKER_TABLE.items()):
        if spec.kind != "gate" or spec.gate != gate:
            continue
        if role is not None and spec.role != role:
            continue
        if parameter is not None and (
            spec.parameter is None or abs(spec.parameter - parameter) > 1e-9
        ):
            continue
        return mid
    raise KeyError(f"no marker for {gate} {parameter} {role}")


def render_family(cfg: AssetsConfig) -> None:
    s = cfg.tile.size
    gap = 24.0
    pitch = s + gap
    back = [find_gate("H"), find_gate("X"), find_gate("Y"), find_gate("Z")]
    front = [
        find_gate("CNOT", role="control"),
        find_gate("CNOT", role="target"),
        find_gate("RX", math.pi / 2),
        find_gate("S"),
        find_gate("T"),
    ]
    placed: list[tuple[int, float, float]] = []
    for i, mid in enumerate(back):
        placed.append((mid, (i + 0.5) * pitch, 0.0))
    for i, mid in enumerate(front):
        placed.append((mid, i * pitch, pitch))

    placed.sort(key=lambda t: t[1] + t[2])  # back-to-front
    inner = "".join(cube(cfg, mid, x, y, shadow=False) for mid, x, y in placed)
    pts: list[tuple[float, float]] = []
    for _, x, y in placed:
        pts.extend(footprint_points(x, y, s))
    svg = wrap_svg(inner, bounds_of(pts), pad=10)
    write(svg, "cube-family", width_px=2000)


def render_bell_on_mat(cfg: AssetsConfig) -> None:
    b = cfg.board
    s = cfg.tile.size
    inset = (b.cell_size - s) / 2.0
    mat = iso_group(0, 0, 0, board_body(cfg))

    cubes: list[tuple[int, float, float]] = []
    for mid, row, col in (
        (find_gate("H"), 0, 0),
        (find_gate("CNOT", role="control"), 0, 1),
        (find_gate("CNOT", role="target"), 1, 1),
    ):
        ox, oy = b.cell_origin(row, col)
        cubes.append((mid, ox + inset, oy + inset))
    cubes.sort(key=lambda t: t[1] + t[2])
    inner = mat + "".join(cube(cfg, mid, x, y) for mid, x, y in cubes)

    pts = [
        proj(0, 0, 0),
        proj(b.mat_width, 0, 0),
        proj(0, b.mat_height, 0),
        proj(b.mat_width, b.mat_height, 0),
    ]
    for _, x, y in cubes:
        pts.extend(footprint_points(x, y, s))
    svg = wrap_svg(inner, bounds_of(pts), pad=12)
    write(svg, "bell-on-mat", width_px=2600)


def write(svg: str, stem: str, width_px: int) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"{stem}.svg").write_text(svg)
    cairosvg.svg2png(
        bytestring=svg.encode(), write_to=str(OUT_DIR / f"{stem}.png"), output_width=width_px
    )
    print(f"wrote {OUT_DIR / stem}.svg/.png")


def main() -> None:
    cfg = load_config()
    render_family(cfg)
    render_bell_on_mat(cfg)


if __name__ == "__main__":
    main()
