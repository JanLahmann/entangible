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
    "measure_gauge",
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

#: Height of the gauge glyph box (mm). The gauge is a wide, shallow shape (a
#: half dial is ``2r`` × ``r``), so in practice it is the box's *width* — the
#: 6 mm edge strip the quiet zone leaves — that sets the size.
GAUGE_BOX_HEIGHT_MM = 6.0

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
            ``cx ± radius`` and ``radius`` from the pivot to the arc's crown.
            A stroked renderer draws the path at ``radius - stroke/2``.
        stroke: line thickness of both the arc and the needle.
        needle: ``(x, y)`` of the needle's tip.
        pivot_radius: radius of the filled dot at the needle's root. The only
            ink on the far side of the pivot from the dial, and the reason the
            glyph's full extent is ``radius + pivot_radius`` across the dial
            axis rather than ``radius``.
    """

    cx: float
    cy: float
    radius: float
    stroke: float
    needle: tuple[float, float]
    pivot_radius: float

    @property
    def width(self) -> float:
        """Full width of the dial's bounding box (``2 * radius``)."""
        return 2.0 * self.radius

    @property
    def height(self) -> float:
        """Height of the dial's bounding box (``radius`` — it is a *half* dial).

        The pivot dot adds :attr:`pivot_radius` below the flat side; the glyph
        box (:func:`measure_glyph_box`) is sized to leave room for both.
        """
        return self.radius


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
    """The gauge glyph box ``(x, y, w, h)`` on the block's face, SVG coords.

    In the strip along the block's **inner** (left) edge, one full quiet zone
    clear of the marker, sitting just above the wire line — the mirror of the
    wire block's ``q`` box, and for the mirror reason: the mark faces the board
    the wire comes from. Raises ``ValueError`` if the geometry leaves no legal
    room.
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


def measure_gauge(box: tuple[float, float, float, float]) -> Gauge:
    """Fit the measurement gauge into ``box`` = ``(x, y, w, h)``, SVG coords.

    The glyph is a half dial: a ``2r`` × ``r`` bounding box whose flat side is
    the bottom. It is scaled to the largest ``r`` that fits (``min(w/2, h)`` —
    in the shipped geometry the 6 mm edge strip means the *width* always wins)
    and centred in the box, then the needle is swung out of the pivot at
    :data:`GAUGE_NEEDLE_ANGLE_DEG` above the horizontal.

    Raises ``ValueError`` for a degenerate box, so a geometry change can never
    silently produce an invisible gauge.
    """
    x, y, w, h = box
    if w <= 0.0 or h <= 0.0:
        raise ValueError(f"measurement gauge: degenerate box {box!r}")
    radius = min(w / 2.0, h)
    if radius <= 0.0:
        raise ValueError(f"measurement gauge: no room in box {box!r}")
    cx = x + w / 2.0
    # Vertically centre the 2r × r bounding box, then put the pivot on its
    # bottom edge (SVG y grows downward, so the dial opens *up*).
    cy = y + h / 2.0 + radius / 2.0
    stroke = GAUGE_STROKE_FRACTION * 2.0 * radius
    theta = math.radians(GAUGE_NEEDLE_ANGLE_DEG)
    length = GAUGE_NEEDLE_FRACTION * radius
    needle = (cx + length * math.cos(theta), cy - length * math.sin(theta))
    return Gauge(
        cx=cx,
        cy=cy,
        radius=radius,
        stroke=stroke,
        needle=needle,
        pivot_radius=GAUGE_PIVOT_FRACTION * stroke,
    )
