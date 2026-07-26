"""The active board model: how an estimated rectangle becomes a lattice.

Task #94 lets the four corner blocks span *any* rectangle instead of the
printed mat's 720x500 mm. :func:`estimate_board_rect` recovers that rectangle;
this module turns it into the cell lattice the grid mapper works in, under one
of three kinds:

``mat``
    The rectangle is the printed mat's, within
    :data:`~.board.MAT_RECT_TOLERANCE`. The classic geometry is used verbatim
    (same rows/cols/pitch/offsets), so the detector's output is bit-for-bit
    what it was before this feature existed.

``stretch`` (layout A)
    Same 5x8 lattice, scaled proportionally into the estimated rectangle — the
    cells grow. x and y scale independently, so a board that is wider than it
    is tall (relative to the mat) still lands its cells correctly.

``grid`` (layout B, the default)
    The mat's physical pitch (70 mm) and cell size (62 mm) are kept — a printed
    tile always covers exactly one cell — and the *column count* is derived
    from the estimated width instead. A wider table simply means more columns.

On top of either layout, qubit-wire blocks (task #95) may replace the lattice's
rows: when present, each block declares one wire at its own y, so the row count
IS the block count and tiles snap to the nearest wire.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .board import (
    BoardConfig,
    BoardRect,
    is_mat_rect,
    mat_rect,
    with_rect,
)
from .grid import GridConfig

__all__ = [
    "BOARD_LAYOUTS",
    "BoardLayout",
    "BoardModel",
    "DEFAULT_BOARD_LAYOUT",
    "MAX_COLUMNS",
    "MAX_WIRES",
    "build_board_model",
    "derive_columns",
    "derive_rows",
    "mat_board_model",
]

#: The operator-selectable layouts for a non-mat rectangle.
BoardLayout = Literal["stretch", "grid"]
BOARD_LAYOUTS: tuple[str, ...] = ("stretch", "grid")
#: Jan's pick: more columns beats bigger cells.
DEFAULT_BOARD_LAYOUT: BoardLayout = "grid"

#: Column cap in ``grid`` layout. ``@qamposer/react``'s CircuitEditor imposes no
#: hard limit -- it always renders ``MIN_POSITIONS = 20`` columns and grows
#: beyond that with the circuit (``numPositions = max(20, maxGatePos + 3)``) --
#: so 20 is our own sanity cap: the widest board that is guaranteed to be fully
#: visible without the editor having to grow.
MAX_COLUMNS = 20
#: Wire cap. ``@qamposer/react``'s provider defaults to ``maxQubits: 5`` and the
#: physical kit is a 5-qubit board, so five wires is the ceiling everywhere.
MAX_WIRES = 5


def _right_margin(config: BoardConfig) -> float:
    """Mat mm between the last column's right edge and the mat's right edge."""
    return config.mat_width - (
        config.grid_offset_x + config.pitch * (config.cols - 1) + config.cell_size
    )


def _bottom_margin(config: BoardConfig) -> float:
    """Mat mm between the last row's bottom edge and the mat's bottom edge."""
    return config.mat_height - (
        config.grid_offset_y + config.pitch * (config.rows - 1) + config.cell_size
    )


def derive_columns(config: BoardConfig, width: float) -> int:
    """How many mat-pitch columns fit in a board ``width`` mm wide (1..MAX)."""
    usable = width - config.grid_offset_x - _right_margin(config) - config.cell_size
    cols = int(usable // config.pitch) + 1 if usable >= 0 else 1
    return max(1, min(MAX_COLUMNS, cols))


def derive_rows(config: BoardConfig, height: float) -> int:
    """How many mat-pitch rows fit in a board ``height`` mm tall (1..MAX_WIRES)."""
    usable = height - config.grid_offset_y - _bottom_margin(config) - config.cell_size
    rows = int(usable // config.pitch) + 1 if usable >= 0 else 1
    return max(1, min(MAX_WIRES, rows))


@dataclass(frozen=True, slots=True)
class BoardModel:
    """The geometry one frame is interpreted in."""

    #: ``"mat"`` | ``"stretch"`` | ``"grid"`` — which branch produced this model.
    kind: str
    #: The rectangle the corner markers span (mm).
    rect: BoardRect
    #: Board config resized to :attr:`rect` — what the homography is fitted to.
    config: BoardConfig
    #: The cell lattice, in the same board-mm frame.
    grid: GridConfig

    @property
    def rows(self) -> int:
        return self.grid.rows

    @property
    def cols(self) -> int:
        return self.grid.cols

    @property
    def wire_count(self) -> int | None:
        """Number of qubit-wire blocks driving the rows, or ``None`` (lattice)."""
        return None if self.grid.wire_ys is None else len(self.grid.wire_ys)


def _with_wires(
    grid: GridConfig, wire_ys: tuple[float, ...] | None
) -> GridConfig:
    """Replace a lattice's rows with explicit wire positions (task #95)."""
    if not wire_ys:
        return grid
    wires = tuple(sorted(wire_ys))[:MAX_WIRES]
    return GridConfig(
        rows=len(wires),
        cols=grid.cols,
        pitch=grid.pitch,
        cell_size=grid.cell_size,
        grid_offset_x=grid.grid_offset_x,
        grid_offset_y=grid.grid_offset_y,
        pitch_y=grid.pitch_y,
        cell_height=grid.cell_height,
        wire_ys=wires,
    )


def mat_board_model(
    config: BoardConfig, wire_ys: tuple[float, ...] | None = None
) -> BoardModel:
    """The classic mat model (optionally with wire blocks overriding its rows)."""
    return BoardModel(
        kind="mat",
        rect=mat_rect(config),
        config=config,
        grid=_with_wires(GridConfig.from_board_config(config), wire_ys),
    )


def build_board_model(
    config: BoardConfig,
    rect: BoardRect | None = None,
    layout: str = DEFAULT_BOARD_LAYOUT,
    wire_ys: tuple[float, ...] | None = None,
    tolerance: float | None = None,
) -> BoardModel:
    """Build the model for an estimated rectangle under ``layout``.

    ``rect`` of ``None`` — or one within ``tolerance`` of the mat — yields the
    classic mat model. An unknown ``layout`` falls back to
    :data:`DEFAULT_BOARD_LAYOUT`.
    """
    from .board import MAT_RECT_TOLERANCE

    tol = MAT_RECT_TOLERANCE if tolerance is None else tolerance
    if rect is None or is_mat_rect(config, rect, tol):
        return mat_board_model(config, wire_ys)

    sized = with_rect(config, rect)
    if layout == "stretch":
        sx = rect.width / config.mat_width
        sy = rect.height / config.mat_height
        grid = GridConfig(
            rows=config.rows,
            cols=config.cols,
            pitch=config.pitch * sx,
            cell_size=config.cell_size * sx,
            grid_offset_x=config.grid_offset_x * sx,
            grid_offset_y=config.grid_offset_y * sy,
            pitch_y=config.pitch * sy,
            cell_height=config.cell_size * sy,
        )
        kind = "stretch"
    else:
        # ``grid`` (default): mat pitch and cell size, more columns.
        grid = GridConfig(
            rows=derive_rows(config, rect.height),
            cols=derive_columns(config, rect.width),
            pitch=config.pitch,
            cell_size=config.cell_size,
            grid_offset_x=config.grid_offset_x,
            grid_offset_y=config.grid_offset_y,
        )
        kind = "grid"

    return BoardModel(kind=kind, rect=rect, config=sized, grid=_with_wires(grid, wire_ys))
