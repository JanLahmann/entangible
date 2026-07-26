"""Grid mapping: board-mm coordinates -> ``(row, col)`` cells.

The mat is a ``rows x cols`` lattice of cells whose centres are laid out from
``grid_offset_{x,y}`` at a fixed ``pitch`` (all in board mm, from
``assets.toml``). A tile is assigned to a cell only when its marker centre
falls inside that cell's acceptance window; anything landing in the gutter
between cells, or off the board entirely, is **rejected** rather than misfiled
(design.md: "Cell mapping rejects off-grid tiles instead of misfiling").
"""

from __future__ import annotations

from dataclasses import dataclass

from .board import BoardConfig

__all__ = ["GridConfig", "GridMapper"]


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

    def cell_center(self, row: int, col: int) -> tuple[float, float]:
        """Board-mm coordinates of the centre of cell ``(row, col)``."""
        cx = self.grid_offset_x + self.cell_size / 2.0 + self.pitch * col
        if self.wire_ys is not None:
            return cx, self.wire_y_at(row, cx)
        cy = self.grid_offset_y + self.y_cell / 2.0 + self.y_pitch * row
        return cx, cy


class GridMapper:
    """Maps board-mm points to cells with a tolerant, gutter-rejecting window.

    ``tolerance`` scales the half-cell acceptance window on each axis. With the
    default of ``1.0`` a marker is accepted only if it lands within the cell's
    own footprint (``+/- cell_size/2`` of the centre); the ``pitch - cell_size``
    gutter between cells is a dead zone, so off-grid tiles are rejected.
    """

    def __init__(self, config: GridConfig, tolerance: float = 1.0) -> None:
        self.config = config
        self.tolerance = tolerance

    def assign(self, x_mm: float, y_mm: float) -> tuple[int, int] | None:
        """Return the ``(row, col)`` a board-mm point belongs to, or ``None``.

        ``None`` means the point is outside the lattice or lies in the gutter
        beyond the tolerance window — an off-grid tile that must be rejected.
        """
        cfg = self.config
        half_window = (cfg.cell_size / 2.0) * self.tolerance
        half_window_y = (cfg.y_cell / 2.0) * self.tolerance

        # Nearest column by the lattice spacing.
        col = round((x_mm - (cfg.grid_offset_x + cfg.cell_size / 2.0)) / cfg.pitch)
        # Nearest row: an explicit wire when qubit-wire blocks declare them
        # (#95), else the y lattice. "Nearest" is measured to the wire AT THIS
        # TILE'S x, so a wire tilted by its measurement block (#97) is followed
        # rather than judged by where it started.
        if cfg.wire_ys is not None:
            if not cfg.wire_ys:
                return None
            row = min(
                range(len(cfg.wire_ys)),
                key=lambda i: abs(y_mm - cfg.wire_y_at(i, x_mm)),
            )
        else:
            row = round((y_mm - (cfg.grid_offset_y + cfg.y_cell / 2.0)) / cfg.y_pitch)
        if not (0 <= col < cfg.cols and 0 <= row < cfg.rows):
            return None

        cx, cy = cfg.cell_center(row, col)
        if abs(x_mm - cx) <= half_window and abs(y_mm - cy) <= half_window_y:
            return int(row), int(col)
        return None
