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

import math
from dataclasses import dataclass

from qamposer_vision.markers import (
    DIAL_ANGLES,
    MARKER_TABLE,
    GateSpec,
    pretty_angle,
)

from .config import AssetsConfig
from .marker_svg import marker_group
from .svgbase import esc, fmt, rect, svg_document
from .symbols import control_dot, swap_cross, target_cross, text

__all__ = [
    "DIAL_CORNER_FONT",
    "DIAL_CORNER_INSET",
    "DIAL_EDGE_FONT",
    "DIAL_EDGE_INSET",
    "DialSlot",
    "dial_label_slots",
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
    * SWAP: ``SWAP`` (the ``×`` glyph is drawn separately)
    """
    if spec.dial_axis is not None:
        return f"{spec.dial_axis} dial"
    if spec.gate == "CNOT":
        return "CONTROL" if spec.role == "control" else "TARGET"
    if spec.gate == "SWAP":
        return "SWAP"
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

    if spec.gate == "SWAP":
        # "SWAP ×": the word on the left, the vector × glyph to its right, so the
        # band reads left-to-right like the control/target tiles.
        word = "SWAP"
        word_font = _fit_font(word, t.size * 0.50, base_font * 0.72)
        caption = text(
            t.size * 0.40,
            band_cy,
            word,
            size=word_font,
            color="#ffffff",
            family=font_family,
            letter_spacing=word_font * 0.06,
        )
        glyph = swap_cross(t.size * 0.76, band_cy, t.band_height * 0.30, color="#ffffff")
        return f'<g id="symbol">{caption}{glyph}</g>'

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


# --- Dial label geometry (shared by the print, laser and 3D faces) ----------

#: Font size (mm) of a dial's four **edge-midpoint** angle labels (even ``r``).
DIAL_EDGE_FONT = 4.0
#: Font size (mm) of a dial's four **corner** angle labels (odd ``r``). Smaller
#: than the edge labels: a corner label is spun 45°, so its bounding box eats
#: into the tile diagonal from both ends at once — the longest of them
#: (``-3π/4``) only clears both the frame and the marker field at this size.
DIAL_CORNER_FONT = 3.4
#: Distance (mm) from a tile edge to the centre of an edge-midpoint label.
DIAL_EDGE_INSET = 8.0
#: Distance (mm) from each of the two adjacent edges to a corner label's centre
#: (so the centre sits on the tile diagonal).
DIAL_CORNER_INSET = 9.2


@dataclass(frozen=True, slots=True)
class DialSlot:
    """One angle-label slot on a dial face, in **SVG** tile coords (y down).

    Attributes:
        r: The board-frame rotation index (0-7, clockwise 45° steps) this slot
            belongs to. Turning the tile clockwise by ``r`` steps brings this
            slot to board-top reading upright.
        x, y: The label's centre.
        theta: The SVG spin in degrees (clockwise-positive), normalised to
            ``(-180, 180]`` — always ``-45·r`` modulo a full turn.
        font: Font size (mm) — :data:`DIAL_EDGE_FONT` on edges (even ``r``),
            :data:`DIAL_CORNER_FONT` in corners (odd ``r``).
        text: The pretty angle label, ``pretty_angle(DIAL_ANGLES[r])``.
    """

    r: int
    x: float
    y: float
    theta: float
    font: float
    text: str


def dial_label_slots(size: float) -> tuple[DialSlot, ...]:
    """The eight angle-label slots of a dial face, in ``r`` order (SVG coords).

    A dial reads its angle from *where the tile points*: the label that ends up
    at board-top after turning the tile clockwise by ``r`` 45° steps is
    ``DIAL_ANGLES[r]``. That label therefore sits at printed direction
    ``-90 - 45·r`` degrees from the tile centre, so the eight slots alternate
    around the face:

    * **even** ``r`` — the four edge midpoints: ``r=0`` top (``0``), ``r=2``
      left (``π/2``), ``r=4`` bottom (``π``), ``r=6`` right (``−π/2``);
    * **odd** ``r`` — the four corners, inset diagonally so they stay inside the
      frame and clear of the marker field: ``r=1`` TL (``π/4``), ``r=3`` BL
      (``3π/4``), ``r=5`` BR (``−3π/4``), ``r=7`` TR (``−π/4``).

    Each slot's ``theta`` spins the label by ``-45·r`` so it reads upright at
    exactly its own rotation — the ``r`` the detector recovers via
    :func:`qamposer_vision.markers.octant_rotation` and
    ``board.BoardResult.marker_rotation``.

    Shared by the printed face (:func:`_dial_body`), the laser-cut face
    (``laser._dial_symbol``) and the 3D face (``qamposer_hardware.face``), so
    the three can never drift.
    """
    centre = size / 2.0
    slots: list[DialSlot] = []
    for r, angle in enumerate(DIAL_ANGLES):
        phi = math.radians(-90.0 - 45.0 * r)
        if r % 2 == 0:  # edge midpoint
            radius = centre - DIAL_EDGE_INSET
            font = DIAL_EDGE_FONT
        else:  # corner, on the diagonal
            radius = (centre - DIAL_CORNER_INSET) * math.sqrt(2.0)
            font = DIAL_CORNER_FONT
        slots.append(
            DialSlot(
                r=r,
                x=centre + radius * math.cos(phi),
                y=centre + radius * math.sin(phi),
                theta=((-45.0 * r) + 180.0) % 360.0 - 180.0,
                font=font,
                text=pretty_angle(angle),
            )
        )
    return tuple(slots)


def _dial_body(marker_id: int, spec: GateSpec, config: AssetsConfig) -> str:
    """Inner SVG for a dial tile (IDs 42/43/44).

    The dial's orientation on the board selects the angle: the printed position
    that ends up at board-top when the tile is turned clockwise by ``r`` **45°**
    steps carries the label ``DIAL_ANGLES[r]`` and is oriented so it reads
    upright at exactly that rotation. See :func:`dial_label_slots` for the eight
    positions; a small ▲ marks the canonical top edge (``r=0``, the identity
    ``0``) and the axis name sits in the bottom band.
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

    # --- #symbol: the eight angle labels, pointer, and axis name ------------
    cx = cy = s / 2.0
    parts: list[str] = ['<g id="symbol">']
    for slot in dial_label_slots(s):
        parts.append(
            _rotated_text(
                slot.x,
                slot.y,
                slot.text,
                size=slot.font,
                color=color,
                family=font_family,
                theta=slot.theta,
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
