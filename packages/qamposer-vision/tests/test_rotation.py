"""Rotation recovery: a marker turned r×45° reads back as r, in the board frame,
flat and warped — the foundation of the dial tiles.

Renders a single dial marker at each of the **eight** 45° rotations (via
``render_board``, which physically turns the pasted marker — odd steps by a real
45° warp), then checks:

* :meth:`BoardResult.marker_rotation` — the board-frame octant via the
  homography — matches on BOTH a flat and a warped (angled-camera) render for
  all eight positions, which is the value that selects a dial's angle; and
* :attr:`DetectedMarker.rotation` — the coarse image-frame quadrant — is the
  matching ``r // 2`` on a flat, camera-square render at the four quarter-turn
  positions (it is a 90° index by construction and cannot resolve an odd
  octant, which is exactly why the board frame carries the finer value).
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
#: Every dial position — swept in full, never sampled.
OCTANTS = tuple(range(8))


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
@pytest.mark.parametrize("rotation", [0, 2, 4, 6])
def test_image_rotation_flat(dial_id, rotation, config, detector) -> None:
    # Flat, camera-square render: the image-frame quadrant is the quarter-turn
    # half of the octant. Only the even octants ARE quarter turns.
    img = render_board(((dial_id, 0, 0, rotation),), config, RenderOptions())
    marker, _ = _dial_marker(img, config, detector, dial_id)
    assert marker.rotation == rotation // 2


@pytest.mark.parametrize("dial_id", DIAL_IDS)
@pytest.mark.parametrize("rotation", OCTANTS)
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
    # where the image-frame rotation would be unreliable. All eight positions.
    img = render_board(((dial_id, 0, 0, rotation),), config, options)
    marker, board = _dial_marker(img, config, detector, dial_id)
    assert board.marker_rotation(marker) == rotation


@pytest.mark.parametrize("dial_id", DIAL_IDS)
@pytest.mark.parametrize("rotation", OCTANTS)
def test_board_frame_rotation_selects_the_dial_angle(
    dial_id, rotation, config, detector
) -> None:
    # The recovered octant indexes DIAL_ANGLES, i.e. the angle IS the physical
    # turn — including r=0, whose identity gate is emitted rather than dropped.
    from qamposer_vision.cli import detect_circuit
    from qamposer_vision.markers import DIAL_ANGLES, MARKER_TABLE

    img = render_board(((dial_id, 0, 0, rotation),), config, RenderOptions())
    result = detect_circuit(img, config, detector=detector)
    (gate,) = result.circuit["gates"]
    assert gate["type"] == MARKER_TABLE[dial_id].dial_axis
    assert gate["parameter"] == pytest.approx(DIAL_ANGLES[rotation])
