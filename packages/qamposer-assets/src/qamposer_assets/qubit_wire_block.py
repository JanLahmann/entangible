"""Geometry of a **qubit-wire block** — board furniture that declares one wire.

The wire block (ArUco ID :data:`~qamposer_vision.markers.QUBIT_WIRE_ID`, 46) is
not a gate and not a corner: it is a *third* kind of piece, board furniture. Up
to five **identical** blocks sit along the board's left edge, between the ``UL``
and ``LL`` corner blocks; each one declares a qubit wire at its own vertical
position (sorted top→bottom, top block = ``q1``). Because every block carries
the same marker ID, the *instance count* is the signal — so the kit prints ONE
design and you print it three to five times. No blocks at all = the classic five
wires.

Face design (and why it is what it is)
--------------------------------------
The block must read as a wire from across a table and it must not cost a
detection, and those two goals fight over the same 60 mm square:

* the marker is the standard tile marker (``tile.marker_size``, 36 mm) and here
  it is centred on **both** axes, so the marker's centre *is* the block's
  centre. That matters: the detector reports a marker centre, and the wire this
  block declares is at exactly that height. Centre the block on the row and the
  wire is on the row — no offset to remember, and a block turned 180° still
  declares the same wire.
* ``tile.min_quiet_zone`` (6 mm) then claims everything within 6 mm of the
  marker, which leaves only a 6 mm strip along each of the four edges. A full
  width, unbroken line at mid-height is therefore **geometrically impossible**
  on any face carrying a 36 mm marker — so the wire is drawn the way a circuit
  diagram draws a wire that meets a gate box: it enters the block's outer edge,
  passes *behind* the marker, and leaves at the inner edge (see
  :func:`qubit_wire_segments`). The ink that matters — the two ends, exactly at
  mid-height, exactly at the block's edges — is what the eye continues into the
  neighbouring row.
* a small ``q`` sits in the strip along the block's **inner** (right) edge, just
  above the wire, the way a qubit label sits by its wire on a circuit diagram
  (:func:`qubit_wire_glyph_box`).

Like the corner blocks, a wire block carries **no gate colour**: every mark on
it is the marker black already on the plate, so it never adds a filament slot.

Coordinates here are **SVG** face coordinates (origin top-left, y down, mm) —
the same frame :mod:`~qamposer_assets.tile_face` and
:mod:`~qamposer_assets.corner_block` use.
"""

from __future__ import annotations

from qamposer_vision.markers import MARKER_TABLE, QUBIT_WIRE_ID, GateSpec

from .config import AssetsConfig

__all__ = [
    "QUBIT_WIRE_ID",
    "QUBIT_WIRE_SLUG",
    "QUBIT_WIRE_LABEL",
    "QUBIT_WIRE_KIND",
    "QUBIT_WIRE_COPIES",
    "WIRE_STROKE_MM",
    "GLYPH_EDGE_MARGIN_MM",
    "GLYPH_WIRE_GAP_MM",
    "GLYPH_BOX_HEIGHT_MM",
    "qubit_wire_spec",
    "qubit_wire_marker_origin",
    "qubit_wire_line_y",
    "qubit_wire_segments",
    "qubit_wire_glyph_box",
]

#: Filename / plate identifier of the one printed design.
QUBIT_WIRE_SLUG = "qwire"

#: The glyph engraved beside the wire — a bare ``q``, as on a circuit diagram.
QUBIT_WIRE_LABEL = "q"

#: :attr:`GateSpec.kind` of the wire block. Neither ``"gate"`` nor ``"corner"``:
#: board furniture. Used only for the local fallback spec — if
#: :data:`~qamposer_vision.markers.MARKER_TABLE` ever grows an entry for
#: :data:`QUBIT_WIRE_ID`, :func:`qubit_wire_spec` prefers it.
QUBIT_WIRE_KIND = "wire"

#: How many identical blocks the kit ships: one per row of the board's default
#: ``[board] rows`` (5), which is also the largest circuit the physical board
#: plays. Print three to five of them; five is the full set.
QUBIT_WIRE_COPIES = 5

#: Wire-line thickness (mm). Deliberately bolder than the mat's 1.2 mm printed
#: wire: the marker's quiet zone cuts the line down to a 6 mm stub at each edge,
#: and a stub has to be thick enough to read as a wire end from a seat away (it
#: is also a comfortable four extrusion widths on a 0.4 mm nozzle).
WIRE_STROKE_MM = 2.0

#: Clear space kept between the ``q`` glyph box and the block's outer edge (mm).
GLYPH_EDGE_MARGIN_MM = 1.0

#: Blank gap between the top of the wire line and the bottom of the glyph box (mm).
GLYPH_WIRE_GAP_MM = 1.5

#: Height of the ``q`` glyph box (mm) — a generous box; the glyph is fitted into
#: it and is in practice limited by the box's *width* (the 6 mm edge strip).
GLYPH_BOX_HEIGHT_MM = 10.0


def qubit_wire_spec() -> GateSpec:
    """The wire block's :class:`~qamposer_vision.markers.GateSpec`.

    Prefers :data:`~qamposer_vision.markers.MARKER_TABLE`'s own entry so the
    print can never describe the piece differently from the detector; falls back
    to a local spec while the table has none (ID 46 is currently *reserved* —
    see ``docs/marker-ids.md``). A table entry is only accepted if it agrees
    that the block is neither a gate nor a corner.
    """
    spec = MARKER_TABLE.get(QUBIT_WIRE_ID)
    if spec is not None and spec.kind not in ("gate", "corner"):
        return spec
    return GateSpec(
        kind=QUBIT_WIRE_KIND,  # type: ignore[arg-type]
        gate="QWIRE",
        label="Qubit wire",
        role="wire",
    )


def qubit_wire_marker_origin(cfg: AssetsConfig) -> tuple[float, float]:
    """Top-left (x, y) of the marker in the block's SVG frame — centred.

    Centred on both axes, so the marker centre is the block centre and the wire
    the block declares sits at the block's own mid-height.
    """
    m = (cfg.tile.size - cfg.tile.marker_size) / 2.0
    return (m, m)


def qubit_wire_line_y(cfg: AssetsConfig) -> float:
    """SVG ``y`` of the wire line's centre-line — the block's mid-height."""
    return cfg.tile.size / 2.0


def qubit_wire_segments(cfg: AssetsConfig) -> tuple[tuple[float, float], ...]:
    """The wire line's drawable ``(x0, x1)`` runs, outer run first.

    One full-width line at mid-height would cross the marker, so the line is cut
    where ``tile.min_quiet_zone`` begins and picked up again where it ends: an
    outer stub from the block's left edge to the quiet zone, and an inner stub
    from the quiet zone to the right edge. Both touch the block's edge exactly,
    which is the point — that is where the eye carries the wire on into the row.

    Raises ``ValueError`` if the marker geometry ever stops leaving room for a
    visible stub.
    """
    t = cfg.tile
    mx, _my = qubit_wire_marker_origin(cfg)
    left_end = mx - t.min_quiet_zone
    right_start = mx + t.marker_size + t.min_quiet_zone
    if left_end <= 1.0 or right_start >= t.size - 1.0:
        raise ValueError(
            f"qubit-wire block: no room for a wire stub outside the "
            f"{t.min_quiet_zone:g} mm quiet zone "
            f"({left_end:g} mm outer / {t.size - right_start:g} mm inner)"
        )
    return ((0.0, left_end), (right_start, t.size))


def qubit_wire_glyph_box(cfg: AssetsConfig) -> tuple[float, float, float, float]:
    """The ``q`` glyph box ``(x, y, w, h)`` on the block's face, SVG coords.

    In the strip along the block's **inner** (right) edge, one full quiet zone
    clear of the marker, sitting just above the wire line — a qubit label beside
    its wire. Raises ``ValueError`` if the geometry leaves no legal room.
    """
    t = cfg.tile
    (_left, _left_end), (x0, _right_end) = qubit_wire_segments(cfg)
    w = t.size - x0 - GLYPH_EDGE_MARGIN_MM
    y1 = qubit_wire_line_y(cfg) - WIRE_STROKE_MM / 2.0 - GLYPH_WIRE_GAP_MM
    y0 = y1 - GLYPH_BOX_HEIGHT_MM
    if w <= 1.0 or y0 < 0.0:
        raise ValueError(
            f"qubit-wire block: no room for the '{QUBIT_WIRE_LABEL}' glyph "
            f"({w:g} × {GLYPH_BOX_HEIGHT_MM:g} mm at y={y0:g})"
        )
    return (x0, y0, w, GLYPH_BOX_HEIGHT_MM)
