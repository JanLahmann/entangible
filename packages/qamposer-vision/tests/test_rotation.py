"""Rotation recovery: a marker turned r×90° reads back as r, in image *and*
board frames, flat and warped — the foundation of the dial tiles.

Renders a single dial marker at each of the four rotations (via
``render_board``, which physically turns the pasted marker), then checks:

* :attr:`DetectedMarker.rotation` — the image-frame quadrant — matches on a
  flat, camera-square render, and
* :meth:`BoardResult.marker_rotation` — the board-frame quadrant via the
  homography — matches on BOTH a flat and a warped (angled-camera) render,
  which is the value that selects a dial's angle.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from qamposer_vision.board import BoardConfig, fit_board
from qamposer_vision.detector import ArucoDetector

_REPO_ROOT = Path(__file__).resolve().parents[3]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from tests.utils.render_board import RenderOptions, render_board  # noqa: E402

DIAL_IDS = (42, 43, 44)


@pytest.fixture(scope="module")
def config() -> BoardConfig:
    return BoardConfig.from_toml()


@pytest.fixture(scope="module")
def detector() -> ArucoDetector:
    return ArucoDetector()


def _dial_marker(img, config, detector, dial_id: int):
    markers = detector.detect(img)
    board = fit_board(markers, config)
    assert board is not None
    marker = next(m for m in markers if m.id == dial_id)
    return marker, board


@pytest.mark.parametrize("dial_id", DIAL_IDS)
@pytest.mark.parametrize("rotation", [0, 1, 2, 3])
def test_image_rotation_flat(dial_id, rotation, config, detector) -> None:
    # Flat, camera-square render: the image-frame rotation equals the turn.
    img = render_board(((dial_id, 0, 0, rotation),), config, RenderOptions())
    marker, _ = _dial_marker(img, config, detector, dial_id)
    assert marker.rotation == rotation


@pytest.mark.parametrize("dial_id", DIAL_IDS)
@pytest.mark.parametrize("rotation", [0, 1, 2, 3])
@pytest.mark.parametrize(
    "options",
    [
        RenderOptions(),
        RenderOptions(warp=0.15, blur_sigma=0.6, noise_sigma=2.0, seed=11),
    ],
    ids=["flat", "warped"],
)
def test_board_frame_rotation(dial_id, rotation, options, config, detector) -> None:
    # Board-frame rotation via the homography is correct even under a warp,
    # where the image-frame rotation would be unreliable.
    img = render_board(((dial_id, 0, 0, rotation),), config, options)
    marker, board = _dial_marker(img, config, detector, dial_id)
    assert board.marker_rotation(marker) == rotation
