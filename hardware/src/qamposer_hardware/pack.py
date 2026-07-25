"""Bed packing math for multi-piece print plates — pure, no build123d.

A *filament plate* (the ``plates.md`` grouping) can hold more pieces than fit on
one physical print bed, so it is split into numbered **batches**, each a grid of
60 x 60 mm pieces (plus inter-piece ``spacing``) anchored in the bed's
front-left corner. Anchoring (rather than centring) consolidates every unused
square millimetre into one connected region at the rear/right of the bed —
where PrusaSlicer parks the MMU wipe tower. ``plan_batches`` can additionally
cap pieces per bed (``max_per_bed``) to guarantee tower space on a bed the grid
would otherwise fill. This module is deliberately geometry-only so the packing
invariants (capacity, splitting, anchoring, no overlap, in-bounds) can be
tested without slicing or building solids.

Bed coordinates: origin at the front-left corner ``(0, 0)``, ``x`` right, ``y``
towards the rear; a piece is described by its **centre** point. Pieces are laid
**row-major** starting at the front-left, rows filling front to rear, every row
left-aligned.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import floor

__all__ = [
    "EDGE_MARGIN",
    "FOOTPRINT",
    "Bed",
    "parse_bed",
    "bed_capacity",
    "pack_positions",
    "plan_batches",
]

#: Piece edge length (mm). The tiles/cubes are 60 x 60 mm in footprint
#: (``assets.toml`` tile size); every variant shares this footprint.
FOOTPRINT = 60.0

#: Grid inset from the front-left bed corner (mm) — keeps skirt/brim lines on
#: the bed instead of flush against the printable-area edge.
EDGE_MARGIN = 5.0


@dataclass(frozen=True, slots=True)
class Bed:
    """A rectangular print bed (mm)."""

    width: float
    height: float


def parse_bed(text: str) -> Bed:
    """Parse a ``"WIDTHxHEIGHT"`` string (e.g. ``"250x220"``) into a :class:`Bed`."""
    parts = text.lower().replace(" ", "").split("x")
    if len(parts) != 2:
        raise ValueError(f"bed must look like '250x220', got {text!r}")
    try:
        w, h = float(parts[0]), float(parts[1])
    except ValueError as exc:
        raise ValueError(f"bed must look like '250x220', got {text!r}") from exc
    if w <= 0 or h <= 0:
        raise ValueError(f"bed dimensions must be positive, got {text!r}")
    return Bed(w, h)


def bed_capacity(
    bed: Bed, footprint: float = FOOTPRINT, spacing: float = 8.0
) -> tuple[int, int]:
    """``(cols, rows)`` of 60 mm pieces that fit on ``bed`` with ``spacing`` gaps.

    ``n`` pieces in a line occupy ``EDGE_MARGIN + n*footprint + (n-1)*spacing``
    mm from the anchored edge, so the count is
    ``floor((extent - EDGE_MARGIN + spacing) / (footprint + spacing))``.
    """
    pitch = footprint + spacing
    cols = int(floor((bed.width - EDGE_MARGIN + spacing) / pitch))
    rows = int(floor((bed.height - EDGE_MARGIN + spacing) / pitch))
    return max(cols, 0), max(rows, 0)


def pack_positions(
    count: int, bed: Bed, footprint: float = FOOTPRINT, spacing: float = 8.0
) -> list[tuple[float, float]]:
    """Centre points for ``count`` pieces on one bed, row-major, corner-anchored.

    The grid anchors at the front-left corner (:data:`EDGE_MARGIN` inset); rows
    fill front to rear and every row is left-aligned, so the unused bed area is
    one connected region at the rear/right — wipe-tower space. Raises
    ``ValueError`` if ``count`` exceeds the bed capacity.
    """
    cols, rows = bed_capacity(bed, footprint, spacing)
    per_bed = cols * rows
    if count < 0:
        raise ValueError(f"count must be ≥ 0, got {count}")
    if count > per_bed:
        raise ValueError(
            f"{count} pieces exceed bed capacity {per_bed} ({cols}x{rows})"
        )
    if count == 0:
        return []

    pitch = footprint + spacing
    positions: list[tuple[float, float]] = []
    for i in range(count):
        r, c = divmod(i, cols)
        cx = EDGE_MARGIN + footprint / 2.0 + c * pitch
        cy = EDGE_MARGIN + footprint / 2.0 + r * pitch
        positions.append((cx, cy))
    return positions


def plan_batches(
    count: int,
    bed: Bed,
    footprint: float = FOOTPRINT,
    spacing: float = 8.0,
    *,
    max_per_bed: int | None = None,
) -> list[list[tuple[float, float]]]:
    """Split ``count`` pieces into per-bed batches of centre-point lists.

    Each batch holds up to ``cols*rows`` pieces — or ``max_per_bed``, if given
    and smaller; capping keeps whole grid cells free for the MMU wipe tower
    even on a bed the grid would fill. The last batch may be partial. Raises
    ``ValueError`` if not even a single piece fits on the bed, or if
    ``max_per_bed`` is < 1.
    """
    cols, rows = bed_capacity(bed, footprint, spacing)
    per_bed = cols * rows
    if per_bed <= 0:
        raise ValueError(
            f"bed {bed.width:g}x{bed.height:g} mm cannot fit a {footprint:g} mm piece"
        )
    if max_per_bed is not None:
        if max_per_bed < 1:
            raise ValueError(f"max_per_bed must be ≥ 1, got {max_per_bed}")
        per_bed = min(per_bed, max_per_bed)
    batches: list[list[tuple[float, float]]] = []
    remaining = count
    while remaining > 0:
        n = min(per_bed, remaining)
        batches.append(pack_positions(n, bed, footprint, spacing))
        remaining -= n
    return batches
