"""Grid mapping: board-mm coordinates -> ``(row, col)`` cells.

The mat is a ``rows x cols`` lattice of cells whose centres are laid out from
``grid_offset_{x,y}`` at a fixed ``pitch`` (all in board mm, from
``assets.toml``). The two axes are mapped differently (#109):

* **Rows** are a lattice (or wire, #95/#97) question: a tile takes the nearest
  row only when its marker centre lies within half a cell height of it;
  anything between two rows is **rejected** rather than misfiled (design.md:
  "Cell mapping rejects off-grid tiles instead of misfiling" — rows only now).
* **Columns** are derived from the tiles themselves: :func:`cluster_columns`
  groups the tiles' actual x positions (tiles closer than
  :data:`COLUMN_GAP_MM` are one column) and spaces the groups by the pitch. No
  x position is ever rejected, so a tile pushed off its mat cell still lands
  in the column it visibly belongs to.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

from .board import BoardConfig

__all__ = [
    "COLUMN_GAP_MM",
    "GridConfig",
    "GridMapper",
    "cluster_columns",
    "round_half_up",
]

#: Largest x distance (board mm) between neighbouring tile centres that still
#: counts as ONE column (#109): half a 60 mm tile. Centres closer than this would
#: physically overlap, so they cannot be side by side in two columns — and a
#: CNOT pair (● over ⊕) placed by hand slightly out of line stays inside it.
COLUMN_GAP_MM = 30.0


@dataclass(frozen=True, slots=True)
class GridConfig:
    """Lattice geometry needed to place a board-mm point into a cell.

    ``pitch``/``cell_size`` are the x-axis spacing and cell width; ``pitch_y``
    and ``cell_height`` default to them (the square mat lattice) and differ only
    under the ``stretch`` layout, which scales x and y independently (#94).

    ``wire_ys`` (task #95) replaces the y lattice entirely: when qubit-wire
    blocks are on the table, each declares one wire at its own board-mm y and a
    tile takes the row of the NEAREST wire (within half a cell height) instead
    of a lattice row.

    ``wire_spans`` (task #97) refines that further: a wire whose measurement
    block was found runs as the straight SEGMENT through both block centres
    rather than as a horizontal line at ``wire_ys[row]``, so a board whose two
    rows of blocks are slightly out of square gets wires that still follow the
    tiles. It is optional per wire and changes nothing else — the row count and
    ordering still come from ``wire_ys`` alone.
    """

    rows: int
    cols: int
    pitch: float
    cell_size: float
    grid_offset_x: float
    grid_offset_y: float
    #: y pitch; ``None`` = ``pitch`` (isotropic mat lattice).
    pitch_y: float | None = None
    #: cell height; ``None`` = ``cell_size``.
    cell_height: float | None = None
    #: Explicit wire positions (board mm, sorted top-down), or ``None``.
    wire_ys: tuple[float, ...] | None = None
    #: Per-wire segment ``(x_left, y_left, x_right, y_right)`` from a paired
    #: measurement block (#97), ``None`` for a wire that has none. Same length
    #: and order as :attr:`wire_ys` when present.
    wire_spans: tuple[tuple[float, float, float, float] | None, ...] | None = None

    @classmethod
    def from_board_config(cls, config: BoardConfig) -> "GridConfig":
        return cls(
            rows=config.rows,
            cols=config.cols,
            pitch=config.pitch,
            cell_size=config.cell_size,
            grid_offset_x=config.grid_offset_x,
            grid_offset_y=config.grid_offset_y,
        )

    @property
    def y_pitch(self) -> float:
        return self.pitch if self.pitch_y is None else self.pitch_y

    @property
    def y_cell(self) -> float:
        return self.cell_size if self.cell_height is None else self.cell_height

    def wire_y_at(self, row: int, x_mm: float) -> float:
        """Board-mm y of wire ``row`` at board-mm ``x_mm``.

        A wire with a paired measurement block (#97) is the straight line
        through both block centres, so its y depends on where along the board
        you ask; one without stays horizontal at ``wire_ys[row]``, exactly as
        before #97. Only ever called when :attr:`wire_ys` is set.
        """
        assert self.wire_ys is not None
        span = None if self.wire_spans is None else self.wire_spans[row]
        if span is not None:
            x0, y0, x1, y1 = span
            if x1 != x0:
                return y0 + (y1 - y0) * (x_mm - x0) / (x1 - x0)
        return self.wire_ys[row]

    @property
    def first_center_x(self) -> float:
        """Board-mm x of lattice column 0's centre — :func:`cluster_columns`'s anchor."""
        return self.grid_offset_x + self.cell_size / 2.0

    def cell_center(self, row: int, col: int) -> tuple[float, float]:
        """Board-mm coordinates of the centre of cell ``(row, col)``."""
        cx = self.grid_offset_x + self.cell_size / 2.0 + self.pitch * col
        if self.wire_ys is not None:
            return cx, self.wire_y_at(row, cx)
        cy = self.grid_offset_y + self.y_cell / 2.0 + self.y_pitch * row
        return cx, cy


class GridMapper:
    """Maps a board-mm point to its ROW, with a tolerant, gap-rejecting window.

    Only the row is a lattice question any more (#109): columns are not read
    off a fixed x-lattice but clustered from where the tiles actually lie
    (:func:`cluster_columns`), so there is no x-window and no x gutter. On the
    y axis ``tolerance`` scales the half-cell acceptance window: with the
    default of ``1.0`` a marker is accepted only within ``+/- y_cell/2`` of its
    row's wire or lattice line, so a tile between two rows is rejected rather
    than misfiled.
    """

    def __init__(self, config: GridConfig, tolerance: float = 1.0) -> None:
        self.config = config
        self.tolerance = tolerance

    def assign_row(self, x_mm: float, y_mm: float) -> int | None:
        """Return the row a board-mm point belongs to, or ``None``.

        The nearest explicit wire when qubit-wire blocks declare them (#95),
        else the nearest y-lattice row. "Nearest" is measured to the wire AT
        THIS TILE'S x, so a wire tilted by its measurement block (#97) is
        followed rather than judged by where it started — that is the only use
        of ``x_mm``. ``None`` means the point is on no row: between two wires
        or rows beyond the tolerance window, or outside the lattice's rows.
        """
        cfg = self.config
        half_window_y = (cfg.y_cell / 2.0) * self.tolerance
        if cfg.wire_ys is not None:
            if not cfg.wire_ys:
                return None
            row = min(
                range(len(cfg.wire_ys)),
                key=lambda i: abs(y_mm - cfg.wire_y_at(i, x_mm)),
            )
            line_y = cfg.wire_y_at(row, x_mm)
        else:
            row = round_half_up(
                (y_mm - (cfg.grid_offset_y + cfg.y_cell / 2.0)) / cfg.y_pitch
            )
            if not 0 <= row < cfg.rows:
                return None
            line_y = cfg.grid_offset_y + cfg.y_cell / 2.0 + cfg.y_pitch * row
        if abs(y_mm - line_y) <= half_window_y:
            return int(row)
        return None


def round_half_up(value: float) -> int:
    """``floor(value + 0.5)`` — JavaScript ``Math.round`` semantics.

    Python's built-in :func:`round` rounds halves to even, ``Math.round``
    rounds them up; the pocket app mirrors this module exactly, so both sides
    use this one rule and stay numerically identical at the halves.
    """
    return int(math.floor(value + 0.5))


def cluster_columns(
    xs: Sequence[float],
    pitch: float,
    first_center_x: float,
    gap: float = COLUMN_GAP_MM,
) -> list[int]:
    """Column index for each tile x, derived from the tiles themselves (#109).

    Single-linkage 1-D clustering: sort the x positions; wherever two
    neighbours are more than ``gap`` apart a new column starts. Each cluster's
    centroid then gets an index — the first ``max(0, round((x0 -
    first_center_x) / pitch))``, every next one the previous plus ``max(1,
    round(dx / pitch))`` of the centroid step — so the *spacing* still comes
    from the pitch (an empty column between two tiles is kept) while the
    columns themselves follow where the tiles really are.

    Tiles placed exactly at mat lattice cell centres get exactly their lattice
    column indices, for any subset of columns.

    Args:
        xs: board-mm x of each tile, in any order.
        pitch: the lattice's x spacing (board mm).
        first_center_x: x of lattice column 0's centre
            (``grid_offset_x + cell_size / 2``).
        gap: largest neighbour distance still inside one column.

    Returns:
        The column of each input x, in input order.
    """
    if not xs:
        return []
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    clusters: list[list[int]] = [[order[0]]]
    for prev, cur in zip(order, order[1:]):
        if xs[cur] - xs[prev] > gap:
            clusters.append([cur])
        else:
            clusters[-1].append(cur)

    cols = [0] * len(xs)
    prev_centroid = 0.0
    col = 0
    for k, members in enumerate(clusters):
        centroid = sum(xs[i] for i in members) / len(members)
        if k == 0:
            col = max(0, round_half_up((centroid - first_center_x) / pitch))
        else:
            col += max(1, round_half_up((centroid - prev_centroid) / pitch))
        prev_centroid = centroid
        for i in members:
            cols[i] = col
    return cols
