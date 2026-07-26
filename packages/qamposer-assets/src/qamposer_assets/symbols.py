"""Vector gate glyphs and text helpers.

CNOT control (``●``) and target (``⊕``) are drawn as **vector shapes** rather
than font glyphs — font fallbacks for these code points are unreliable and
would break silently in print. Everything else (gate letters, rotation labels)
is rendered as ``<text>`` using the configured font stack, which *does* fall
back safely (cairo substitutes a sans-serif if IBM Plex Sans is absent).
"""

from __future__ import annotations

from .svgbase import esc, fmt

__all__ = [
    "control_dot",
    "target_cross",
    "swap_cross",
    "ket_zero",
    "measure_gauge",
    "text",
    "CROSS_STROKE_FRACTION",
]

#: Target-cross / circle stroke as a fraction of the glyph height (spec: 12 %).
CROSS_STROKE_FRACTION = 0.12


def control_dot(cx: float, cy: float, radius: float, *, fill: str) -> str:
    """Filled control dot ``●`` centred at (cx, cy)."""
    return (
        f'<circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(radius)}" '
        f'fill="{fill}" />'
    )


def target_cross(
    cx: float,
    cy: float,
    radius: float,
    *,
    color: str,
    stroke: float | None = None,
) -> str:
    """Target glyph ``⊕``: an open circle with a centred cross.

    ``stroke`` defaults to 12 % of the glyph height (``2 * radius``).
    """
    if stroke is None:
        stroke = CROSS_STROKE_FRACTION * (2.0 * radius)
    circle = (
        f'<circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(radius)}" '
        f'fill="none" stroke="{color}" stroke-width="{fmt(stroke)}" />'
    )
    horiz = (
        f'<line x1="{fmt(cx - radius)}" y1="{fmt(cy)}" '
        f'x2="{fmt(cx + radius)}" y2="{fmt(cy)}" '
        f'stroke="{color}" stroke-width="{fmt(stroke)}" stroke-linecap="butt" />'
    )
    vert = (
        f'<line x1="{fmt(cx)}" y1="{fmt(cy - radius)}" '
        f'x2="{fmt(cx)}" y2="{fmt(cy + radius)}" '
        f'stroke="{color}" stroke-width="{fmt(stroke)}" stroke-linecap="butt" />'
    )
    return circle + horiz + vert


def swap_cross(
    cx: float,
    cy: float,
    radius: float,
    *,
    color: str,
    stroke: float | None = None,
) -> str:
    """SWAP glyph ``×``: two thick, round-capped diagonal strokes.

    Drawn as vector shapes (like ``●``/``⊕``) rather than a font glyph so it can
    never tofu in print. Spans a ``2*radius`` box centred on (cx, cy).
    ``stroke`` defaults to 18 % of the glyph height (``2 * radius``) — a touch
    heavier than the target cross so the ``×`` reads clearly at tile scale.
    """
    if stroke is None:
        stroke = 0.18 * (2.0 * radius)
    diag_a = (
        f'<line x1="{fmt(cx - radius)}" y1="{fmt(cy - radius)}" '
        f'x2="{fmt(cx + radius)}" y2="{fmt(cy + radius)}" '
        f'stroke="{color}" stroke-width="{fmt(stroke)}" stroke-linecap="round" />'
    )
    diag_b = (
        f'<line x1="{fmt(cx - radius)}" y1="{fmt(cy + radius)}" '
        f'x2="{fmt(cx + radius)}" y2="{fmt(cy - radius)}" '
        f'stroke="{color}" stroke-width="{fmt(stroke)}" stroke-linecap="round" />'
    )
    return diag_a + diag_b


def ket_zero(x_left: float, cy: float, cap: float, *, color: str) -> tuple[str, float]:
    """Vector ``|0⟩`` glyph (bar, zero, angle bracket) of height ``cap``.

    Drawn as shapes because U+27E9 has no glyph in many fonts and tofus in
    print. Returns ``(svg, width)``; the glyph spans ``x_left … x_left+width``
    and is vertically centred on ``cy``.
    """
    s = 0.09 * cap
    half = cap / 2.0
    gap = 0.30 * cap
    rx, ry = 0.30 * cap, 0.48 * cap

    bar_x = x_left + s / 2.0
    bar = (
        f'<line x1="{fmt(bar_x)}" y1="{fmt(cy - half)}" '
        f'x2="{fmt(bar_x)}" y2="{fmt(cy + half)}" '
        f'stroke="{color}" stroke-width="{fmt(s)}" stroke-linecap="round" />'
    )
    zero_cx = bar_x + s / 2.0 + gap + rx
    zero = (
        f'<ellipse cx="{fmt(zero_cx)}" cy="{fmt(cy)}" rx="{fmt(rx)}" ry="{fmt(ry)}" '
        f'fill="none" stroke="{color}" stroke-width="{fmt(s)}" />'
    )
    chev_x = zero_cx + rx + gap
    chev_w = 0.38 * cap
    chevron = (
        f'<polyline points="{fmt(chev_x)},{fmt(cy - half)} '
        f'{fmt(chev_x + chev_w)},{fmt(cy)} {fmt(chev_x)},{fmt(cy + half)}" '
        f'fill="none" stroke="{color}" stroke-width="{fmt(s)}" '
        f'stroke-linecap="round" stroke-linejoin="round" />'
    )
    width = (chev_x + chev_w + s / 2.0) - x_left
    return bar + zero + chevron, width


def measure_gauge(
    cx: float,
    cy: float,
    radius: float,
    *,
    color: str,
    stroke: float,
    needle: tuple[float, float],
    pivot_radius: float,
) -> str:
    """Measurement-gauge glyph: a half-dial arc, a needle and its pivot dot.

    The glyph of a measurement box on a circuit diagram, drawn as **vector**
    shapes for the same reason ``●``/``⊕``/``×`` are: no meter code point
    renders reliably across the print, laser and OpenCASCADE font stacks, and a
    tofu on a fiducial-bearing piece would ship silently.

    ``radius`` is the arc's **outer** ink radius, so the glyph spans exactly
    ``cx ± radius`` and ``cy - radius … cy`` (SVG ``y`` grows downward, so the
    dial opens *upward*); the stroked path is therefore drawn at
    ``radius - stroke/2``. The needle runs from the pivot to ``needle``. Every
    dimension is resolved by
    :func:`qamposer_assets.measure_block.measure_gauge`, so the printed, laser
    and 3D gauges are the same glyph.
    """
    nx, ny = needle
    r = radius - stroke / 2.0
    arc = (
        f'<path d="M {fmt(cx - r)} {fmt(cy)} '
        f"A {fmt(r)} {fmt(r)} 0 0 1 {fmt(cx + r)} {fmt(cy)}\" "
        f'fill="none" stroke="{color}" stroke-width="{fmt(stroke)}" '
        f'stroke-linecap="butt" />'
    )
    hand = (
        f'<line x1="{fmt(cx)}" y1="{fmt(cy)}" x2="{fmt(nx)}" y2="{fmt(ny)}" '
        f'stroke="{color}" stroke-width="{fmt(stroke)}" stroke-linecap="round" />'
    )
    pivot = (
        f'<circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(pivot_radius)}" '
        f'fill="{color}" />'
    )
    return arc + hand + pivot


def text(
    x: float,
    y: float,
    content: str,
    *,
    size: float,
    color: str,
    family: str,
    weight: str = "bold",
    anchor: str = "middle",
    baseline: str = "central",
    letter_spacing: float | None = None,
) -> str:
    """A ``<text>`` element (font-size in mm user units)."""
    spacing = (
        f' letter-spacing="{fmt(letter_spacing)}"'
        if letter_spacing is not None
        else ""
    )
    return (
        f'<text x="{fmt(x)}" y="{fmt(y)}" '
        f'font-family="{esc(family)}" font-size="{fmt(size)}" '
        f'font-weight="{weight}" fill="{color}" '
        f'text-anchor="{anchor}" dominant-baseline="{baseline}"{spacing}>'
        f"{esc(content)}</text>"
    )
