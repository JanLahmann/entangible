"""Compose one 60×60 mm gate tile SVG from a marker ID.

Layout follows ``docs/assets-design.md`` and every number comes from
``assets.toml`` via :mod:`config`. The SVG carries three semantic groups so M6
can extrude STLs from the same faces:

* ``#outline`` — tile edge, coloured frame and the white marker field.
* ``#marker``  — the vector ArUco module rects.
* ``#symbol``  — the label band's text and CNOT glyphs.

Gate colours are the frame *and* the bottom label band (same colour), so the
object in a visitor's hand matches the gate on screen.
"""

from __future__ import annotations

from qamposer_vision.markers import (
    MARKER_TABLE,
    ROTATION_ANGLES,
    GateSpec,
    pretty_angle,
)

from .config import AssetsConfig
from .marker_svg import marker_group
from .svgbase import esc, fmt, rect, svg_document
from .symbols import control_dot, target_cross, text

__all__ = [
    "gate_marker_ids",
    "tile_label",
    "tile_body",
    "tile_svg",
]

# Cap height ≈ 0.72 · em for IBM Plex Sans / Helvetica; invert to get font-size.
_CAP_TO_EM = 1.0 / 0.72
# Thin space between a rotation gate and its angle, e.g. "RX␉π/2".
_THIN_SPACE = " "


def gate_marker_ids() -> list[int]:
    """Sorted marker IDs of every printable gate tile (``kind == 'gate'``)."""
    return sorted(mid for mid, spec in MARKER_TABLE.items() if spec.kind == "gate")


def tile_label(spec: GateSpec) -> str:
    """The band caption for a gate.

    * single-qubit: the gate letter (``H``/``X``/``Y``/``Z``)
    * rotation: gate + thin space + pretty angle (``RX π/2``, ``RY -π/2``)
    * dial: ``RX dial`` / ``RY dial`` / ``RZ dial`` (the angle is set by rotation)
    * CNOT: ``CONTROL`` / ``TARGET`` (the ●/⊕ glyph is drawn separately)
    """
    if spec.dial_axis is not None:
        return f"{spec.dial_axis} dial"
    if spec.gate == "CNOT":
        return "CONTROL" if spec.role == "control" else "TARGET"
    if spec.param_label is not None:
        return f"{spec.gate}{_THIN_SPACE}{spec.param_label}"
    return spec.gate


def _fit_font(content: str, max_width: float, base_size: float) -> float:
    """Shrink ``base_size`` so ``content`` fits within ``max_width`` (mm)."""
    # Bold sans-serif average advance ≈ 0.62 em; keep a small safety margin.
    est = len(content) * base_size * 0.62
    if est > max_width and est > 0:
        return base_size * (max_width / est)
    return base_size


def tile_body(marker_id: int, config: AssetsConfig) -> str:
    """Inner SVG (the three groups) for the tile, without a root ``<svg>``.

    Usable both standalone (see :func:`tile_svg`) and embedded in a cut-sheet
    under a ``<g transform="translate(...)">``.
    """
    spec = MARKER_TABLE[marker_id]
    if spec.kind != "gate":
        raise ValueError(f"marker {marker_id} is not a gate tile ({spec.label})")

    if spec.dial_axis is not None:
        return _dial_body(marker_id, spec, config)

    t = config.tile
    color = config.colors.for_gate(spec.gate)
    inner_radius = max(t.corner_radius - t.frame_width, 0.0)
    font_family = config.typography.font_family

    # --- #outline: coloured tile + white marker field -----------------------
    field_h = t.band_top - t.frame_width
    outline = (
        '<g id="outline">'
        + rect(0, 0, t.size, t.size, fill=color, rx=t.corner_radius)
        + rect(
            t.frame_width,
            t.frame_width,
            t.size - 2 * t.frame_width,
            field_h,
            fill="#ffffff",
            rx=inner_radius,
        )
        + "</g>"
    )

    # --- #marker: vector ArUco ---------------------------------------------
    marker = marker_group(
        marker_id,
        t.marker_x,
        t.marker_y,
        t.marker_size,
        dictionary=config.aruco_dictionary,
        group_id="marker",
        with_background=False,  # field is already pure white
    )

    # --- #symbol: band caption ---------------------------------------------
    band_cy = t.band_top + t.band_height / 2.0
    symbol = _render_symbol(spec, config, band_cy, color, font_family)

    return f'<g id="tile-{marker_id}">{outline}{marker}{symbol}</g>'


def _render_symbol(
    spec: GateSpec,
    config: AssetsConfig,
    band_cy: float,
    color: str,
    font_family: str,
) -> str:
    t = config.tile
    base_font = config.typography.band_cap_height * _CAP_TO_EM
    label = tile_label(spec)

    if spec.gate == "CNOT":
        # Glyph on the left, small-caps word to its right.
        glyph_r = t.band_height * 0.30
        glyph_cx = t.size * 0.26  # keep clear air between glyph and word
        word = "CONTROL" if spec.role == "control" else "TARGET"
        word_font = _fit_font(word, t.size * 0.46, base_font * 0.72)
        word_x = t.size * 0.60
        if spec.role == "control":
            glyph = control_dot(glyph_cx, band_cy, glyph_r, fill="#ffffff")
        else:
            glyph = target_cross(glyph_cx, band_cy, glyph_r, color="#ffffff")
        caption = text(
            word_x,
            band_cy,
            word,
            size=word_font,
            color="#ffffff",
            family=font_family,
            letter_spacing=word_font * 0.06,
        )
        return f'<g id="symbol">{glyph}{caption}</g>'

    max_w = t.size - 2 * t.frame_width - 3.0
    font = _fit_font(label, max_w, base_font)
    caption = text(
        t.size / 2.0,
        band_cy,
        label,
        size=font,
        color="#ffffff",
        family=font_family,
    )
    return f'<g id="symbol">{caption}</g>'


def _rotated_text(
    cx: float, cy: float, content: str, *, size: float, color: str, family: str, theta: float
) -> str:
    """A centred ``<text>`` optionally spun ``theta`` degrees about (cx, cy)."""
    label = text(cx, cy, content, size=size, color=color, family=family)
    if theta == 0:
        return label
    return f'<g transform="rotate({fmt(theta)} {fmt(cx)} {fmt(cy)})">{label}</g>'


def _dial_body(marker_id: int, spec: GateSpec, config: AssetsConfig) -> str:
    """Inner SVG for a dial tile (IDs 42/43/44).

    The dial's orientation on the board selects the angle: the printed edge that
    ends up at board-top when the tile is turned clockwise by ``r`` 90° steps
    carries the label ``ROTATION_ANGLES[r]`` and is oriented so it reads upright
    at exactly that rotation. Concretely — with edges indexed by that ``r``:

    * ``r=0`` printed **top** edge → ``π/4``  (drawn upright)
    * ``r=1`` printed **left** edge → ``π/2`` (drawn turned 90° CCW)
    * ``r=2`` printed **bottom** edge → ``π`` (drawn upside down)
    * ``r=3`` printed **right** edge → ``−π/2`` (drawn turned 90° CW)

    Each label is drawn spun ``θ = −90·r`` degrees so that after the physical
    tile is turned clockwise by ``r·90°`` the label sits upright at board-top —
    the exact ``r`` the detector recovers (see ``markers.quadrant_rotation`` and
    ``board.BoardResult.marker_rotation``), which the render→detect tests pin.
    A small ▲ marks the canonical top edge (``r=0``); the axis name sits in the
    bottom band.
    """
    t = config.tile
    color = config.colors.for_gate(spec.gate)
    inner_radius = max(t.corner_radius - t.frame_width, 0.0)
    font_family = config.typography.font_family
    s = t.size
    axis = spec.dial_axis or spec.gate

    # --- #outline: full coloured frame + white square marker field ----------
    outline = (
        '<g id="outline">'
        + rect(0, 0, s, s, fill=color, rx=t.corner_radius)
        + rect(
            t.frame_width,
            t.frame_width,
            s - 2 * t.frame_width,
            s - 2 * t.frame_width,
            fill="#ffffff",
            rx=inner_radius,
        )
        + "</g>"
    )

    # --- #marker: centred ArUco (a dial is turned about its own centre) ------
    ms = t.marker_size
    marker = marker_group(
        marker_id,
        (s - ms) / 2.0,
        (s - ms) / 2.0,
        ms,
        dictionary=config.aruco_dictionary,
        group_id="marker",
        with_background=False,
    )

    # --- #symbol: the four edge angle labels, pointer, and axis name --------
    label_font = 4.0
    inset = 8.0
    cx = cy = s / 2.0
    # (edge midpoint x, y, rotation index r for that edge)
    edges = (
        (cx, inset, 0),          # top   → r=0
        (inset, cy, 1),          # left  → r=1
        (cx, s - inset, 2),      # bottom→ r=2
        (s - inset, cy, 3),      # right → r=3
    )
    parts: list[str] = ['<g id="symbol">']
    for lx, ly, r in edges:
        theta = ((-90 * r) + 180) % 360 - 180  # normalise to (-180, 180]
        parts.append(
            _rotated_text(
                lx,
                ly,
                pretty_angle(ROTATION_ANGLES[r]),
                size=label_font,
                color=color,
                family=font_family,
                theta=theta,
            )
        )
    # ▲ pointer marking the canonical (r=0) top edge, inside the frame.
    apex_y = t.frame_width + 0.9
    base_y = apex_y + 2.2
    parts.append(
        f'<polygon points="{fmt(cx)},{fmt(apex_y)} '
        f'{fmt(cx - 1.7)},{fmt(base_y)} {fmt(cx + 1.7)},{fmt(base_y)}" '
        f'fill="{color}" />'
    )
    # Axis name in the bottom band (e.g. "RX dial").
    parts.append(
        text(
            cx,
            s - t.frame_width - 1.6,
            f"{axis} dial",
            size=2.4,
            color=color,
            family=font_family,
        )
    )
    parts.append("</g>")
    symbol = "".join(parts)

    return f'<g id="tile-{marker_id}">{outline}{marker}{symbol}</g>'


def tile_svg(marker_id: int, config: AssetsConfig) -> str:
    """A standalone tile SVG document."""
    spec = MARKER_TABLE[marker_id]
    body = tile_body(marker_id, config)
    return svg_document(
        config.tile.size, config.tile.size, body, title=f"Tile {esc(spec.label)}"
    )
