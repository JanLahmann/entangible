"""Board homography tests: fit quality and graceful degradation to 3 corners."""

from __future__ import annotations

import numpy as np
import pytest

from qamposer_vision.board import BoardConfig, fit_board
from qamposer_vision.detector import ArucoDetector

from tests.utils.render_board import (
    SCENARIOS_BY_NAME,
    RenderOptions,
    render_board,
)


@pytest.fixture(scope="module")
def config() -> BoardConfig:
    return BoardConfig.from_toml()


@pytest.fixture(scope="module")
def detector() -> ArucoDetector:
    return ArucoDetector()


def test_board_config_matches_assets(config: BoardConfig) -> None:
    assert config.rows == 5
    assert config.cols == 8
    assert config.pitch == 70.0
    assert config.cell_size == 62.0
    assert config.corner_marker_size == 40.0


def test_corner_squares_span_the_mat(config: BoardConfig) -> None:
    tl = config.corner_marker_square(0)
    br = config.corner_marker_square(2)
    # TL marker's top-left corner sits at the margin inset.
    assert tl[0].tolist() == [config.corner_margin, config.corner_margin]
    # BR marker's bottom-right corner sits margin-inset from the far edges.
    assert br[2].tolist() == [
        config.mat_width - config.corner_margin,
        config.mat_height - config.corner_margin,
    ]


def test_homography_reprojection_flat(config: BoardConfig, detector: ArucoDetector) -> None:
    img = render_board((), config, RenderOptions())
    board = fit_board(detector.detect(img), config)
    assert board is not None
    assert board.corner_ids == (0, 1, 2, 3)
    assert board.reprojection_error < 1.0


def test_homography_reprojection_warped(config: BoardConfig, detector: ArucoDetector) -> None:
    img = render_board(
        (), config, RenderOptions(warp=0.15, blur_sigma=0.6, noise_sigma=2.0, seed=3)
    )
    board = fit_board(detector.detect(img), config)
    assert board is not None
    assert board.reprojection_error < 1.0


def test_center_maps_to_expected_mm(config: BoardConfig, detector: ArucoDetector) -> None:
    # A single H at cell (0,0): its detected centre should map near the cell centre.
    sc = SCENARIOS_BY_NAME["single_h"]
    img = render_board(sc.placements, config, RenderOptions())
    markers = detector.detect(img)
    board = fit_board(markers, config)
    assert board is not None
    gate = next(m for m in markers if m.id == 30)  # H
    xy = board.image_to_board(gate.center)[0]
    expected_x = config.grid_offset_x + config.cell_size / 2.0
    expected_y = config.grid_offset_y + config.cell_size / 2.0
    assert abs(xy[0] - expected_x) < 1.0
    assert abs(xy[1] - expected_y) < 1.0


def test_three_corners_still_fits(config: BoardConfig, detector: ArucoDetector) -> None:
    img = render_board((), config, RenderOptions(corners=(0, 1, 3)))
    board = fit_board(detector.detect(img), config)
    assert board is not None
    assert board.corner_ids == (0, 1, 3)
    assert board.reprojection_error < 1.0


def test_two_corners_returns_none(config: BoardConfig, detector: ArucoDetector) -> None:
    img = render_board((), config, RenderOptions(corners=(0, 2)))
    assert fit_board(detector.detect(img), config) is None


def test_no_corners_returns_none(config: BoardConfig) -> None:
    assert fit_board([], config) is None


def test_image_board_roundtrip(config: BoardConfig, detector: ArucoDetector) -> None:
    img = render_board((), config, RenderOptions())
    board = fit_board(detector.detect(img), config)
    assert board is not None
    pts_mm = np.array([[100.0, 120.0], [300.0, 250.0]])
    back = board.image_to_board(board.board_to_image(pts_mm))
    assert np.allclose(back, pts_mm, atol=0.1)
