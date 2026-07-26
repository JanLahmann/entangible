"""Variable corner placement (#94).

Two axes, exercised end to end on synthetic renders: board scale (mat-exact /
1.3x / 2x) and layout (``stretch`` / ``grid``). Plus the unit-level pieces:
rectangle estimation accuracy, the mat tolerance and column/row derivation.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from qamposer_vision.board import (
    MAT_RECT_TOLERANCE,
    BoardConfig,
    BoardRect,
    center_span,
    corner_inset,
    estimate_board_rect,
    fit_board,
    is_mat_rect,
    mat_rect,
    rect_from_center_span,
    with_rect,
)
from qamposer_vision.board_model import (
    MAX_COLUMNS,
    MAX_WIRES,
    build_board_model,
    derive_columns,
    derive_rows,
    mat_board_model,
)
from qamposer_vision.cli import detect_circuit
from qamposer_vision.detector import ArucoDetector
from qamposer_vision.grid import GridConfig

from tests.utils.render_board import SCENARIOS_BY_NAME, RenderOptions, render_board

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "circuits"


@pytest.fixture(scope="module")
def config() -> BoardConfig:
    return BoardConfig.from_toml()


@pytest.fixture(scope="module")
def detector() -> ArucoDetector:
    return ArucoDetector()


# ---------------------------------------------------------------------------
# Rectangle estimation (#94)
# ---------------------------------------------------------------------------

#: (label, scale-x, scale-y, px_per_mm) — mat-exact, 1.3x, 2x, plus one
#: deliberately anisotropic board (wide table, mat-height).
SCALES = [
    ("mat", 1.0, 1.0, 3.0),
    ("1.3x", 1.3, 1.3, 2.4),
    ("2x", 2.0, 2.0, 1.6),
    ("wide", 1.6, 1.0, 2.2),
]


def _rect(config: BoardConfig, sx: float, sy: float) -> BoardRect:
    return BoardRect(config.mat_width * sx, config.mat_height * sy)


@pytest.mark.parametrize("label,sx,sy,ppm", SCALES, ids=[s[0] for s in SCALES])
@pytest.mark.parametrize("warp", [None, 0.12], ids=["flat", "warped"])
def test_rect_estimation_recovers_the_span(
    config: BoardConfig,
    detector: ArucoDetector,
    label: str,
    sx: float,
    sy: float,
    ppm: float,
    warp: float | None,
) -> None:
    rect = _rect(config, sx, sy)
    img = render_board(
        (), config, RenderOptions(rect=(rect.width, rect.height), px_per_mm=ppm, warp=warp)
    )
    estimate = estimate_board_rect(detector.detect(img), config)
    assert estimate is not None
    assert estimate.corner_ids == (0, 1, 2, 3)
    # Sub-percent on both axes: well inside the mat tolerance, so a column
    # count derived from it never wobbles.
    assert abs(estimate.rect.width - rect.width) / rect.width < 0.01
    assert abs(estimate.rect.height - rect.height) / rect.height < 0.01
    # And the pose fitted against it reprojects to well under a millimetre.
    assert estimate.rms < 2.0
    board = fit_board(detector.detect(img), config, estimate.rect)
    assert board is not None
    assert board.reprojection_error < 2.0
    assert board.rect == estimate.rect


def test_rect_estimation_degrades_to_three_corners(
    config: BoardConfig, detector: ArucoDetector
) -> None:
    rect = _rect(config, 1.5, 1.5)
    img = render_board(
        (),
        config,
        RenderOptions(rect=(rect.width, rect.height), px_per_mm=2.0, corners=(0, 1, 3)),
    )
    estimate = estimate_board_rect(detector.detect(img), config)
    assert estimate is not None
    assert estimate.corner_ids == (0, 1, 3)
    assert abs(estimate.rect.width - rect.width) / rect.width < 0.01
    assert abs(estimate.rect.height - rect.height) / rect.height < 0.01


def test_rect_estimation_needs_three_corners(
    config: BoardConfig, detector: ArucoDetector
) -> None:
    img = render_board((), config, RenderOptions(corners=(0, 2)))
    assert estimate_board_rect(detector.detect(img), config) is None
    assert estimate_board_rect([], config) is None


def test_center_span_round_trips(config: BoardConfig) -> None:
    span_x, span_y = center_span(config, mat_rect(config))
    assert span_x == config.mat_width - 2 * corner_inset(config)
    back = rect_from_center_span(config, span_x, span_y)
    assert back == mat_rect(config)


def test_mat_tolerance_band(config: BoardConfig) -> None:
    assert is_mat_rect(config, mat_rect(config))
    inside = BoardRect(
        config.mat_width * (1 + MAT_RECT_TOLERANCE * 0.9),
        config.mat_height * (1 - MAT_RECT_TOLERANCE * 0.9),
    )
    assert is_mat_rect(config, inside)
    outside = BoardRect(config.mat_width * 1.2, config.mat_height)
    assert not is_mat_rect(config, outside)


# ---------------------------------------------------------------------------
# Model derivation (#94)
# ---------------------------------------------------------------------------


def test_mat_rect_yields_the_classic_model(config: BoardConfig) -> None:
    classic = GridConfig.from_board_config(config)
    for layout in ("stretch", "grid"):
        model = build_board_model(config, mat_rect(config), layout)
        assert model.kind == "mat"
        assert model.grid == classic
        # A rectangle inside the tolerance is still the mat, verbatim.
        near = BoardRect(config.mat_width * 1.02, config.mat_height * 0.98)
        assert build_board_model(config, near, layout).grid == classic
    assert build_board_model(config, None, "grid").kind == "mat"


def test_derive_columns_from_width(config: BoardConfig) -> None:
    # The mat's own width must reproduce the mat's column count exactly.
    assert derive_columns(config, config.mat_width) == config.cols
    # One pitch more of table = one more column; just under = still eight.
    assert derive_columns(config, config.mat_width + config.pitch) == config.cols + 1
    assert derive_columns(config, config.mat_width + config.pitch - 1) == config.cols
    # Clamped at both ends.
    assert derive_columns(config, 10.0) == 1
    assert derive_columns(config, 100_000.0) == MAX_COLUMNS


def test_derive_rows_from_height(config: BoardConfig) -> None:
    assert derive_rows(config, config.mat_height) == config.rows
    assert derive_rows(config, config.mat_height - config.pitch) == config.rows - 1
    assert derive_rows(config, 10.0) == 1
    # The simulator caps at five qubits however tall the table is.
    assert derive_rows(config, 100_000.0) == MAX_WIRES


def test_stretch_model_scales_both_axes(config: BoardConfig) -> None:
    rect = BoardRect(config.mat_width * 1.6, config.mat_height * 1.2)
    model = build_board_model(config, rect, "stretch")
    assert model.kind == "stretch"
    assert (model.rows, model.cols) == (config.rows, config.cols)
    assert model.grid.pitch == pytest.approx(config.pitch * 1.6)
    assert model.grid.y_pitch == pytest.approx(config.pitch * 1.2)
    assert model.grid.cell_size == pytest.approx(config.cell_size * 1.6)
    assert model.grid.y_cell == pytest.approx(config.cell_size * 1.2)
    # The far cell centre lands the same fraction into the bigger board.
    cx, cy = model.grid.cell_center(config.rows - 1, config.cols - 1)
    mx, my = GridConfig.from_board_config(config).cell_center(
        config.rows - 1, config.cols - 1
    )
    assert cx == pytest.approx(mx * 1.6)
    assert cy == pytest.approx(my * 1.2)


def test_grid_model_keeps_pitch_and_adds_columns(config: BoardConfig) -> None:
    rect = BoardRect(config.mat_width * 2, config.mat_height)
    model = build_board_model(config, rect, "grid")
    assert model.kind == "grid"
    assert model.grid.pitch == config.pitch
    assert model.grid.cell_size == config.cell_size
    assert model.cols == derive_columns(config, rect.width)
    assert model.cols > config.cols
    assert model.rows == config.rows


def test_unknown_layout_falls_back_to_grid(config: BoardConfig) -> None:
    rect = BoardRect(config.mat_width * 1.5, config.mat_height)
    assert build_board_model(config, rect, "nonsense").kind == "grid"


# ---------------------------------------------------------------------------
# End to end: scale x layout
# ---------------------------------------------------------------------------

E2E_SCALES = [("mat", 1.0, 3.0), ("1.3x", 1.3, 2.4), ("2x", 2.0, 1.6)]


@pytest.mark.parametrize("label,scale,ppm", E2E_SCALES, ids=[s[0] for s in E2E_SCALES])
@pytest.mark.parametrize("layout", ["stretch", "grid"])
def test_end_to_end_scale_layout(
    config: BoardConfig,
    detector: ArucoDetector,
    label: str,
    scale: float,
    ppm: float,
    layout: str,
) -> None:
    rect = _rect(config, scale, scale)
    model = build_board_model(config, rect, layout)

    # A Bell pair on the first two wires, at the first two columns.
    placements = ((10, 0, 0), (14, 0, 1), (15, 1, 1))
    img = render_board(
        placements,
        config,
        RenderOptions(
            rect=(rect.width, rect.height),
            grid=model.grid,
            px_per_mm=ppm,
        ),
    )
    result = detect_circuit(img, config, detector=detector, board_layout=layout)
    assert result.has_board
    assert result.model is not None
    assert result.model.kind == ("mat" if scale == 1.0 else layout)
    assert result.circuit["qubits"] == model.rows
    # Same Bell circuit whatever the board size or layout.
    assert [(g["type"], g["position"]) for g in result.circuit["gates"]] == [
        ("H", 0),
        ("CNOT", 1),
    ]
    assert result.circuit["gates"][1]["control"] == 0
    assert result.circuit["gates"][1]["target"] == 1
    assert result.warnings == []


@pytest.mark.parametrize("layout", ["stretch", "grid"])
def test_mat_board_is_byte_stable_in_both_layouts(
    config: BoardConfig, detector: ArucoDetector, layout: str
) -> None:
    """A real mat detects to the golden circuit whatever the layout switch says."""
    golden = json.loads((FIXTURES / "all_families.json").read_text())
    scenario = SCENARIOS_BY_NAME["all_families"]
    img = render_board(scenario.placements, config, RenderOptions(warp=0.12, seed=5))
    result = detect_circuit(img, config, detector=detector, board_layout=layout)
    assert result.circuit == golden
    assert result.model is not None
    assert result.model.kind == "mat"


def test_grid_layout_uses_the_extra_columns(
    config: BoardConfig, detector: ArucoDetector
) -> None:
    """A double-width table really does gain columns a mat cannot express."""
    rect = BoardRect(config.mat_width * 2, config.mat_height)
    model = build_board_model(config, rect, "grid")
    assert model.cols >= config.cols + 8
    far = model.cols - 1
    img = render_board(
        ((10, 0, 0), (11, 0, far)),
        config,
        RenderOptions(rect=(rect.width, rect.height), grid=model.grid, px_per_mm=1.8),
    )
    result = detect_circuit(img, config, detector=detector, board_layout="grid")
    assert result.model is not None and result.model.cols == model.cols
    assert [(g["type"], g["position"]) for g in result.circuit["gates"]] == [
        ("H", 0),
        ("X", far),
    ]
