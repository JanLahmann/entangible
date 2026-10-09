"""Geometry of a **measurement block** — the right-edge end of a qubit wire.

The measurement block (ArUco ID
:data:`~qamposer_vision.markers.MEASURE_BLOCK_ID`, 47) is the mirror image of
the qubit-wire block (:mod:`~qamposer_assets.qubit_wire_block`, ID 46), and it
is board furniture for exactly the same reason: it is neither a gate nor a
corner. Up to five **identical** blocks sit along the board's **right** edge,
between the ``UR`` and ``LR`` corner blocks, so a table laid out with both
families reads like a circuit diagram — state prep on the left, measurement on
the right.

Unlike the wire block, a measurement block is a pure **refinement**: it never
creates a wire. A wire exists iff its left (ID 46) block exists; a right block
only says where that wire *ends*, which lets the detector run the wire as the
segment through both block centres instead of a horizontal line (see
``docs/marker-ids.md``). So the kit still ships ONE design, printed three to
five times — and printing none costs nothing.

Face design (and why it mirrors the wire block)
-----------------------------------------------
Everything the wire block's face does for the same reason, mirrored left/right:

* the marker is the standard tile marker (``tile.marker_size``, 36 mm) centred
  on **both** axes, so the marker's centre *is* the block's centre *is* the
  height at which the wire ends. That is the whole convention the detector
  leans on, and it makes the block 180°-safe: turn it end for end and it still
  reports the same point.
* ``tile.min_quiet_zone`` (6 mm) leaves only a 6 mm strip along each edge, so a
  full-width line at mid-height is geometrically impossible. The wire is drawn
  in the two runs the quiet zone leaves free (:func:`measure_segments`) and
  passes *behind* the marker. Both runs still touch the block's edge — the ink
  at the **inner** (left) edge is what the eye carries back into the row, and
  the identical run on the outer edge keeps the bar point-symmetric so a
  180°-turned block still looks right.
* where the wire block engraves a small ``q``, this one engraves a **measurement
  gauge** — a half-dial arc with a needle, the glyph the editor's measure box
  uses (:func:`measure_gauge`). It sits in the strip along the block's **inner**
  (left) edge, just above the wire, facing the board the wire comes from, the
  same way the wire block's ``q`` faces the board.

Gauge size (#108)
-----------------
The free strips are only 6 mm deep (``tile.min_quiet_zone``), less the 1 mm
edge margin: 5 mm. An upright half dial is twice as wide as it is tall, so in
the *vertical* inner-edge strip it was capped at 5 mm across. The inner gauge is
therefore turned a quarter turn — its crown points at the inner edge
(:data:`INNER_GAUGE_FACING`, ``"left"``), reading upright from the board side
the wire arrives from — so the strip's *length* carries the dial's ``2r`` and
its 5 mm depth only the ``r`` (plus the pivot dot behind it): ``r ≈ 4.03 mm``,
an 8.1 mm dial instead of 5 mm. A second, **upright** gauge of the same size
sits centred in the 6 mm strip along the block's **top** edge
(:func:`measure_top_glyph_box`), where the same 5 mm depth now limits the
upright dial's height — the same box turned a quarter turn. Neither enters the
quiet zone: both boxes stop exactly at its boundary.

The gauge is drawn as **vector art**, never a font glyph: no code point for a
meter renders reliably across the print, laser and OpenCASCADE font stacks, and
a silently substituted glyph on a fiducial-bearing piece is not a risk worth
taking (the same rule ``symbols.py`` applies to ``●``/``⊕``/``×``).

Like the corner and wire blocks, a measurement block carries **no gate colour**:
every mark on it is the marker black already on the plate, so it never adds a
filament slot.

Coordinates here are **SVG** face coordinates (origin top-left, y down, mm) —
the same frame :mod:`~qamposer_assets.tile_face`,
:mod:`~qamposer_assets.corner_block` and
:mod:`~qamposer_assets.qubit_wire_block` use.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from qamposer_vision.markers import MARKER_TABLE, MEASURE_BLOCK_ID, GateSpec

from .config import AssetsConfig
from .qubit_wire_block import WIRE_STROKE_MM

__all__ = [
    "MEASURE_BLOCK_ID",
    "MEASURE_BLOCK_SLUG",
    "MEASURE_BLOCK_LABEL",
    "MEASURE_BLOCK_KIND",
    "MEASURE_BLOCK_COPIES",
    "WIRE_STROKE_MM",
    "GAUGE_EDGE_MARGIN_MM",
    "GAUGE_WIRE_GAP_MM",
    "GAUGE_BOX_HEIGHT_MM",
    "GAUGE_TOP_BOX_WIDTH_MM",
    "INNER_GAUGE_FACING",
    "TOP_GAUGE_FACING",
    "GAUGE_STROKE_FRACTION",
    "GAUGE_NEEDLE_ANGLE_DEG",
    "GAUGE_NEEDLE_FRACTION",
    "GAUGE_PIVOT_FRACTION",
    "Gauge",
    "measure_block_spec",
    "measure_marker_origin",
    "measure_line_y",
    "measure_segments",
    "measure_glyph_box",
    "measure_top_glyph_box",
    "measure_gauge",
    "measure_inner_gauge",
    "measure_top_gauge",
]

#: Filename / plate identifier of the one printed design.
MEASURE_BLOCK_SLUG = "qmeasure"

#: Human-facing name of the engraved glyph. Deliberately **not** a character to
#: render: the gauge is vector art (:func:`measure_gauge`), and this string only
#: ever appears in prose (shop notes, ``corners.md``, SVG ``<title>``).
MEASURE_BLOCK_LABEL = "measure"

#: :attr:`GateSpec.kind` of the measurement block. Neither ``"gate"`` nor
#: ``"corner"``: board furniture. Used only for the local fallback spec — if
#: :data:`~qamposer_vision.markers.MARKER_TABLE` ever grows an entry for
#: :data:`MEASURE_BLOCK_ID`, :func:`measure_block_spec` prefers it.
MEASURE_BLOCK_KIND = "measure"

#: How many identical blocks the kit ships: one per row of the board's default
#: ``[board] rows`` (5), matching the wire blocks they pair with. Print as many
#: as you have wire blocks — or none at all; they are optional.
MEASURE_BLOCK_COPIES = 5

#: Clear space kept between the gauge glyph box and the block's inner edge (mm).
GAUGE_EDGE_MARGIN_MM = 1.0

#: Blank gap between the top of the wire line and the bottom of the gauge box (mm).
GAUGE_WIRE_GAP_MM = 1.5

#: Height of the inner-edge gauge glyph box (mm) — the same 10 mm as the wire
#: block's ``q`` box, so the two boxes stay exact mirrors. The inner gauge lies
#: on its side (:data:`INNER_GAUGE_FACING`), so this height carries the dial's
#: ``2r``; the 5 mm box *width* (the 6 mm edge strip less the edge margin) still
#: sets the size, via ``r + pivot`` — see :func:`measure_gauge`.
GAUGE_BOX_HEIGHT_MM = 10.0

#: Width of the top-edge gauge glyph box (mm): the inner box turned a quarter
#: turn, so the upright top gauge comes out exactly as large as the inner one.
GAUGE_TOP_BOX_WIDTH_MM = GAUGE_BOX_HEIGHT_MM

#: Direction the inner-edge gauge's crown points (SVG face frame): at the
#: block's inner edge, so the dial reads upright from the board side the wire
#: comes from — and the 5 mm strip depth limits ``r``, not ``2r``.
INNER_GAUGE_FACING = "left"

#: Direction the top-edge gauge's crown points: up, at the block's top edge.
TOP_GAUGE_FACING = "up"

#: Unit vector from the pivot to the crown, per facing, in SVG coords (y down).
_FACING_AXES: dict[str, tuple[float, float]] = {
    "up": (0.0, -1.0),
    "down": (0.0, 1.0),
    "left": (-1.0, 0.0),
    "right": (1.0, 0.0),
}

#: Gauge stroke as a fraction of the glyph's full width (``2 * radius``), the
#: same way :data:`~qamposer_assets.symbols.CROSS_STROKE_FRACTION` is defined.
#: Bolder than the target cross: the gauge is the smallest mark on the kit and
#: still has to survive a laser raster and a 0.4 mm nozzle.
GAUGE_STROKE_FRACTION = 0.16

#: Needle angle above the horizontal (degrees), measured counter-clockwise from
#: the dial's ``+x`` axis — a meter caught mid-reading, which reads as "gauge"
#: far faster than a needle standing straight up.
GAUGE_NEEDLE_ANGLE_DEG = 60.0

#: Needle length as a fraction of the dial radius. Just short of the arc, so the
#: tip never merges with the dial into one blob at 5 mm.
GAUGE_NEEDLE_FRACTION = 0.95

#: Radius of the needle's pivot dot as a fraction of the stroke width. Gives the
#: needle a solid root instead of a hairline meeting a hairline.
GAUGE_PIVOT_FRACTION = 0.75

#: The pivot dot's radius as a fraction of the dial radius (stroke is
#: ``GAUGE_STROKE_FRACTION · 2r``): how far ink reaches *behind* the pivot, so
#: the glyph's extent along its axis is ``(1 + this) · r``.
_PIVOT_OVER_RADIUS = GAUGE_PIVOT_FRACTION * GAUGE_STROKE_FRACTION * 2.0


@dataclass(frozen=True, slots=True)
class Gauge:
    """A measurement-gauge glyph, resolved to millimetres in one frame.

    Renderer-neutral on purpose: the laser SVG, the printed face and the 3D
    inlay all consume *these* numbers, so the three can never draw a different
    gauge. Coordinates follow whichever frame the caller passed the box in —
    :func:`measure_gauge` is given an SVG box (y down) and returns SVG values;
    the hardware side flips ``cy`` and ``needle`` once, on the way into the 3D
    face frame.

    Attributes:
        cx, cy: the dial's pivot — the centre of the arc's open side.
        radius: the arc's **outer** ink radius, so the dial spans exactly
            ``radius`` either side of the pivot across its axis and ``radius``
            from the pivot to the arc's crown. A stroked renderer draws the
            path at ``radius - stroke/2``.
        stroke: line thickness of both the arc and the needle.
        needle: ``(x, y)`` of the needle's tip.
        pivot_radius: radius of the filled dot at the needle's root. The only
            ink on the far side of the pivot from the dial, and the reason the
            glyph's full extent along the dial axis is ``radius +
            pivot_radius`` rather than ``radius``.
        axis: unit vector from the pivot to the crown, in the same frame as
            the coordinates — ``(0, -1)`` for an upright dial in SVG coords,
            ``(0, 1)`` for the same dial in the 3D (y-up) frame.
    """

    cx: float
    cy: float
    radius: float
    stroke: float
    needle: tuple[float, float]
    pivot_radius: float
    axis: tuple[float, float]

    @property
    def width(self) -> float:
        """Extent of the dial *across* its axis (``2 * radius``)."""
        return 2.0 * self.radius

    @property
    def height(self) -> float:
        """Extent of the dial *along* its axis (``radius`` — a *half* dial).

        The pivot dot adds :attr:`pivot_radius` behind the flat side; the glyph
        boxes (:func:`measure_glyph_box`, :func:`measure_top_glyph_box`) are
        sized to leave room for both.
        """
        return self.radius

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        """``(x0, y0, x1, y1)`` of all the glyph's ink, in its own frame.

        The dial's ``2r`` across the axis, and ``-pivot_radius … radius`` along
        it (the pivot dot behind the flat side, the crown in front); the needle
        and its round cap stay inside both.
        """
        ux, uy = self.axis
        px, py = -uy, ux  # across the axis (either sense: the box is symmetric)
        xs, ys = [], []
        for a in (-self.pivot_radius, self.radius):
            for b in (-self.radius, self.radius):
                xs.append(self.cx + a * ux + b * px)
                ys.append(self.cy + a * uy + b * py)
        return (min(xs), min(ys), max(xs), max(ys))


def measure_block_spec() -> GateSpec:
    """The measurement block's :class:`~qamposer_vision.markers.GateSpec`.

    Prefers :data:`~qamposer_vision.markers.MARKER_TABLE`'s own entry so the
    print can never describe the piece differently from the detector; falls back
    to a local spec while the table has none (ID 47 carries no ``GateSpec`` by
    design — see ``docs/marker-ids.md``). A table entry is only accepted if it
    agrees that the block is neither a gate nor a corner.
    """
    spec = MARKER_TABLE.get(MEASURE_BLOCK_ID)
    if spec is not None and spec.kind not in ("gate", "corner"):
        return spec
    return GateSpec(
        kind=MEASURE_BLOCK_KIND,  # type: ignore[arg-type]
        gate="QMEASURE",
        label="Measurement",
        role="measure",
    )


def measure_marker_origin(cfg: AssetsConfig) -> tuple[float, float]:
    """Top-left (x, y) of the marker in the block's SVG frame — centred.

    Centred on both axes, so the marker centre is the block centre and the wire
    the block terminates ends at the block's own mid-height. Identical to
    :func:`~qamposer_assets.qubit_wire_block.qubit_wire_marker_origin` — that
    the two families share one convention is the point, not a coincidence.
    """
    m = (cfg.tile.size - cfg.tile.marker_size) / 2.0
    return (m, m)


def measure_line_y(cfg: AssetsConfig) -> float:
    """SVG ``y`` of the wire line's centre-line — the block's mid-height."""
    return cfg.tile.size / 2.0


def measure_segments(cfg: AssetsConfig) -> tuple[tuple[float, float], ...]:
    """The wire line's drawable ``(x0, x1)`` runs, inner (left) run first.

    One full-width line at mid-height would cross the marker, so the line is cut
    where ``tile.min_quiet_zone`` begins and picked up again where it ends: an
    inner stub from the block's left edge — where the circuit arrives — to the
    quiet zone, and an outer stub from the quiet zone to the right edge. The
    inner stub is the one that matters visually; the outer one keeps the bar
    point-symmetric, so a block turned 180° still looks like a wire.

    Raises ``ValueError`` if the marker geometry ever stops leaving room for a
    visible stub.
    """
    t = cfg.tile
    mx, _my = measure_marker_origin(cfg)
    inner_end = mx - t.min_quiet_zone
    outer_start = mx + t.marker_size + t.min_quiet_zone
    if inner_end <= 1.0 or outer_start >= t.size - 1.0:
        raise ValueError(
            f"measurement block: no room for a wire stub outside the "
            f"{t.min_quiet_zone:g} mm quiet zone "
            f"({inner_end:g} mm inner / {t.size - outer_start:g} mm outer)"
        )
    return ((0.0, inner_end), (outer_start, t.size))


def measure_glyph_box(cfg: AssetsConfig) -> tuple[float, float, float, float]:
    """The inner-edge gauge glyph box ``(x, y, w, h)`` on the face, SVG coords.

    In the strip along the block's **inner** (left) edge, one full quiet zone
    clear of the marker, sitting just above the wire line — the mirror of the
    wire block's ``q`` box, and for the mirror reason: the mark faces the board
    the wire comes from. The gauge in it lies on its side
    (:data:`INNER_GAUGE_FACING`). Raises ``ValueError`` if the geometry leaves
    no legal room.
    """
    (_x0, inner_end), (_outer_start, _x1) = measure_segments(cfg)
    x = GAUGE_EDGE_MARGIN_MM
    w = inner_end - x
    y1 = measure_line_y(cfg) - WIRE_STROKE_MM / 2.0 - GAUGE_WIRE_GAP_MM
    y0 = y1 - GAUGE_BOX_HEIGHT_MM
    if w <= 1.0 or y0 < 0.0:
        raise ValueError(
            f"measurement block: no room for the gauge glyph "
            f"({w:g} × {GAUGE_BOX_HEIGHT_MM:g} mm at y={y0:g})"
        )
    return (x, y0, w, GAUGE_BOX_HEIGHT_MM)


def measure_top_glyph_box(cfg: AssetsConfig) -> tuple[float, float, float, float]:
    """The top-edge gauge glyph box ``(x, y, w, h)`` on the face, SVG coords.

    Centred in the strip along the block's **top** edge: from
    :data:`GAUGE_EDGE_MARGIN_MM` below the edge down to — never into — the
    marker's quiet zone, :data:`GAUGE_TOP_BOX_WIDTH_MM` wide. The inner box
    turned a quarter turn, so the upright gauge in it is the inner gauge's size.
    The wire line is at mid-height, far below. Raises ``ValueError`` if the
    geometry leaves no legal room.
    """
    t = cfg.tile
    _mx, my = measure_marker_origin(cfg)
    y0 = GAUGE_EDGE_MARGIN_MM
    h = my - t.min_quiet_zone - y0
    w = GAUGE_TOP_BOX_WIDTH_MM
    x = (t.size - w) / 2.0
    if h <= 1.0 or x < 0.0:
        raise ValueError(
            f"measurement block: no room for the top gauge glyph "
            f"({w:g} × {h:g} mm above the {t.min_quiet_zone:g} mm quiet zone)"
        )
    return (x, y0, w, h)


def measure_gauge(
    box: tuple[float, float, float, float], *, facing: str = "up"
) -> Gauge:
    """Fit the measurement gauge into ``box`` = ``(x, y, w, h)``, SVG coords.

    The glyph is a half dial whose crown points ``facing`` (``"up"`` — flat
    side down — ``"down"``, ``"left"`` or ``"right"``). Its ink spans ``2r``
    across that axis and ``(1 + p) · r`` along it — the crown in front, the
    pivot dot (``p · r``, ``p`` = :data:`_PIVOT_OVER_RADIUS`) behind. It is
    scaled to the largest ``r`` that fits the box that way round, the whole ink
    extent centred in the box, then the needle is swung out of the pivot at
    :data:`GAUGE_NEEDLE_ANGLE_DEG` from the flat side (to the dial's right, as
    seen with the crown up).

    Raises ``ValueError`` for a degenerate box or an unknown facing, so a
    geometry change can never silently produce an invisible gauge.
    """
    x, y, w, h = box
    if w <= 0.0 or h <= 0.0:
        raise ValueError(f"measurement gauge: degenerate box {box!r}")
    try:
        ux, uy = _FACING_AXES[facing]
    except KeyError:
        raise ValueError(f"measurement gauge: unknown facing {facing!r}") from None
    along, across = (h, w) if ux == 0.0 else (w, h)
    radius = min(across / 2.0, along / (1.0 + _PIVOT_OVER_RADIUS))
    if radius <= 0.0:
        raise ValueError(f"measurement gauge: no room in box {box!r}")
    # Centre the ink's extent along the axis: from -p·r (behind) to +r (crown),
    # so the pivot sits (r - p·r)/2 behind the box centre. Across, centred.
    shift = radius * (1.0 - _PIVOT_OVER_RADIUS) / 2.0
    cx = x + w / 2.0 - ux * shift
    cy = y + h / 2.0 - uy * shift
    stroke = GAUGE_STROKE_FRACTION * 2.0 * radius
    # The dial's "right" (seen crown-up), in SVG coords: (-uy, ux).
    px, py = -uy, ux
    theta = math.radians(GAUGE_NEEDLE_ANGLE_DEG)
    length = GAUGE_NEEDLE_FRACTION * radius
    c, s = math.cos(theta), math.sin(theta)
    needle = (cx + length * (c * px + s * ux), cy + length * (c * py + s * uy))
    return Gauge(
        cx=cx,
        cy=cy,
        radius=radius,
        stroke=stroke,
        needle=needle,
        pivot_radius=_PIVOT_OVER_RADIUS * radius,
        axis=(ux, uy),
    )


def measure_inner_gauge(cfg: AssetsConfig) -> Gauge:
    """The inner-edge gauge (on its side, crown at the inner edge), SVG coords."""
    return measure_gauge(measure_glyph_box(cfg), facing=INNER_GAUGE_FACING)


def measure_top_gauge(cfg: AssetsConfig) -> Gauge:
    """The upright top-edge gauge, SVG coords."""
    return measure_gauge(measure_top_glyph_box(cfg), facing=TOP_GAUGE_FACING)
