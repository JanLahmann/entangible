"""Grid mapping tests: cell centres, row window, column clustering (#109)."""

from __future__ import annotations

import itertools
import math

import pytest

from qamposer_vision.board import BoardConfig
from qamposer_vision.grid import (
    COLUMN_GAP_MM,
    GridConfig,
    GridMapper,
    cluster_columns,
    round_half_up,
)


@pytest.fixture(scope="module")
def grid_config() -> GridConfig:
    return GridConfig.from_board_config(BoardConfig.from_toml())


def _cols(xs: list[float], cfg: GridConfig) -> list[int]:
    return cluster_columns(xs, cfg.pitch, cfg.first_center_x)


def test_cell_center_layout(grid_config: GridConfig) -> None:
    # col 0, row 0 centre = offset + half cell.
    cx, cy = grid_config.cell_center(0, 0)
    assert cx == grid_config.grid_offset_x + grid_config.cell_size / 2.0
    assert cx == grid_config.first_center_x
    assert cy == grid_config.grid_offset_y + grid_config.cell_size / 2.0
    # Adjacent column centre differs by exactly one pitch.
    cx1, _ = grid_config.cell_center(0, 1)
    assert cx1 - cx == grid_config.pitch


# ---------------------------------------------------------------------------
# round_half_up — the shared rounding rule (JS Math.round semantics)
# ---------------------------------------------------------------------------


def test_round_half_up_rounds_every_half_up() -> None:
    # Python's round() would give 0, 2, 2, -2 for the halves; Math.round gives
    # these. The full set of halves in [-3, 3] is checked, not a sample.
    halves = [k + 0.5 for k in range(-3, 3)]
    assert [round_half_up(v) for v in halves] == [-2, -1, 0, 1, 2, 3]
    assert [round_half_up(v) for v in (-0.49, 0.0, 0.49, 1.49, 1.51)] == [0, 0, 0, 1, 2]


# ---------------------------------------------------------------------------
# cluster_columns
# ---------------------------------------------------------------------------


def test_cluster_columns_empty() -> None:
    assert cluster_columns([], 70.0, 111.0) == []


def test_cluster_columns_single_tile_takes_its_lattice_column(
    grid_config: GridConfig,
) -> None:
    for col in range(grid_config.cols):
        cx, _ = grid_config.cell_center(0, col)
        assert _cols([cx], grid_config) == [col]


def test_cluster_columns_pair_within_gap_is_one_column(grid_config: GridConfig) -> None:
    cx, _ = grid_config.cell_center(0, 2)
    # A hand-misaligned CNOT pair: up to the full gap apart, still one column.
    for dx in (0.0, 5.0, 17.5, COLUMN_GAP_MM):
        assert _cols([cx, cx + dx], grid_config) == [2, 2]
    # Just over the gap: two columns.
    assert _cols([cx, cx + COLUMN_GAP_MM + 0.1], grid_config) == [2, 3]


def test_cluster_columns_spacing_follows_the_pitch(grid_config: GridConfig) -> None:
    x0 = grid_config.first_center_x
    # 40 mm apart is past the gap but under a pitch: still the NEXT column.
    assert _cols([x0, x0 + 40.0], grid_config) == [0, 1]
    # 140 mm = two pitches: one empty column is kept between them.
    assert _cols([x0, x0 + 140.0], grid_config) == [0, 2]
    # Input order is preserved in the output.
    assert _cols([x0 + 140.0, x0], grid_config) == [2, 0]


def test_cluster_columns_single_linkage_chains(grid_config: GridConfig) -> None:
    # Each neighbour within the gap → one column, even though the ends are
    # 90 mm (more than a pitch) apart. Single linkage, by design.
    x0 = grid_config.first_center_x
    xs = [x0 + 60.0, x0 - 30.0, x0, x0 + 30.0]
    assert _cols(xs, grid_config) == [0, 0, 0, 0]
    # The chain's centroid (x0 + 15) anchors the next cluster's step.
    assert _cols(xs + [x0 + 15.0 + 140.0], grid_config) == [0, 0, 0, 0, 2]


def test_cluster_columns_left_of_grid_clamps_to_zero(grid_config: GridConfig) -> None:
    x0 = grid_config.first_center_x
    for x in (x0 - 35.1, x0 - 70.0, x0 - 200.0, -50.0):
        assert _cols([x], grid_config) == [0]
    # The clamp applies to the first column only; the rest keep their spacing.
    assert _cols([x0 - 70.0, x0, x0 + 70.0], grid_config) == [0, 1, 2]


def test_cluster_columns_reproduces_the_lattice_for_every_subset(
    grid_config: GridConfig,
) -> None:
    """Totality: every non-empty subset of the mat's columns, every row mix.

    Tiles exactly at lattice cell centres must get exactly their lattice
    column — that is what keeps the mat-scene golden fixtures byte-identical.
    """
    cols = range(grid_config.cols)
    subsets = 0
    for size in range(1, grid_config.cols + 1):
        for subset in itertools.combinations(cols, size):
            # Two rows per column in the column's own order → duplicates of an
            # x must land together.
            xs, want = [], []
            for col in subset:
                for row in (0, grid_config.rows - 1):
                    xs.append(grid_config.cell_center(row, col)[0])
                    want.append(col)
            assert _cols(xs, grid_config) == want, subset
            subsets += 1
    assert subsets == 2 ** grid_config.cols - 1


def test_cluster_columns_matches_lattice_under_small_jitter(
    grid_config: GridConfig,
) -> None:
    # A real detection is never exact: ±10 mm on every tile of a full row
    # (all 2^8 sign patterns) still lands every tile in its lattice column.
    centres = [grid_config.cell_center(0, c)[0] for c in range(grid_config.cols)]
    for signs in itertools.product((-10.0, 10.0), repeat=len(centres)):
        xs = [x + s for x, s in zip(centres, signs)]
        assert _cols(xs, grid_config) == list(range(grid_config.cols))


# ---------------------------------------------------------------------------
# GridMapper.assign_row
# ---------------------------------------------------------------------------


def test_exact_centres_assign_their_row(grid_config: GridConfig) -> None:
    mapper = GridMapper(grid_config)
    for row in range(grid_config.rows):
        for col in range(grid_config.cols):
            cx, cy = grid_config.cell_center(row, col)
            assert mapper.assign_row(cx, cy) == row


def test_assign_row_ignores_x_entirely(grid_config: GridConfig) -> None:
    """No x window anywhere (#109): the old gutter and off-lattice x are fine."""
    mapper = GridMapper(grid_config)
    _cx, cy = grid_config.cell_center(2, 3)
    for x in (-50.0, 0.0, 111.0 + 35.0, 145.0, 10_000.0):
        assert mapper.assign_row(x, cy) == 2


def test_small_y_offset_within_window(grid_config: GridConfig) -> None:
    mapper = GridMapper(grid_config)
    cx, cy = grid_config.cell_center(2, 3)
    half = grid_config.y_cell / 2.0
    assert mapper.assign_row(cx, cy - 20.0) == 2
    assert mapper.assign_row(cx, cy + half) == 2
    assert mapper.assign_row(cx, cy - half) == 2


def test_between_rows_is_rejected(grid_config: GridConfig) -> None:
    mapper = GridMapper(grid_config)
    cx, cy = grid_config.cell_center(1, 1)
    # In the pitch-vs-cell gap between rows → rejected, not misfiled.
    off = grid_config.y_cell / 2.0 + 2.0
    assert mapper.assign_row(cx, cy + off) is None
    assert mapper.assign_row(cx, cy - off) is None


def test_outside_the_rows_is_rejected(grid_config: GridConfig) -> None:
    mapper = GridMapper(grid_config)
    cx, cy0 = grid_config.cell_center(0, 0)
    _cx, cy_last = grid_config.cell_center(grid_config.rows - 1, 0)
    assert mapper.assign_row(cx, cy0 - grid_config.y_pitch) is None
    assert mapper.assign_row(cx, cy_last + grid_config.y_pitch) is None
    assert mapper.assign_row(cx, -50.0) is None
    assert mapper.assign_row(cx, 100000.0) is None


def test_tolerance_scales_the_row_window(grid_config: GridConfig) -> None:
    cx, cy = grid_config.cell_center(0, 0)
    dy = grid_config.y_cell / 2.0 + 2.0  # just outside the cell footprint
    strict = GridMapper(grid_config, tolerance=1.0)
    loose = GridMapper(grid_config, tolerance=1.3)
    assert strict.assign_row(cx, cy + dy) is None
    assert loose.assign_row(cx, cy + dy) == 0


def test_assign_row_on_wires(grid_config: GridConfig) -> None:
    from dataclasses import replace

    wired = replace(grid_config, rows=3, wire_ys=(120.0, 240.0, 360.0))
    mapper = GridMapper(wired)
    half = wired.y_cell / 2.0
    for row, wy in enumerate(wired.wire_ys or ()):
        assert mapper.assign_row(500.0, wy) == row
        assert mapper.assign_row(500.0, wy + half) == row
        assert mapper.assign_row(500.0, wy - half) == row
        assert mapper.assign_row(500.0, wy - half - 0.5) is None
    # The middle of a 120 mm gap is on no wire.
    assert mapper.assign_row(500.0, 180.0) is None
    # An empty wire set has no rows at all.
    assert GridMapper(replace(grid_config, wire_ys=())).assign_row(500.0, 120.0) is None


def test_assign_row_follows_a_tilted_wire_at_the_tiles_x(
    grid_config: GridConfig,
) -> None:
    from dataclasses import replace

    tilted = replace(
        grid_config,
        rows=2,
        wire_ys=(150.0, 250.0),
        wire_spans=((30.0, 150.0, 700.0, 230.0), None),
    )
    mapper = GridMapper(tilted)
    for x in (30.0, 200.0, 450.0, 700.0):
        assert mapper.assign_row(x, tilted.wire_y_at(0, x)) == 0
    assert math.isclose(tilted.wire_y_at(0, 700.0), 230.0)
    # At the far end wire 0 sits 20 mm from wire 1 — still nearest-wins.
    assert mapper.assign_row(700.0, 250.0) == 1
