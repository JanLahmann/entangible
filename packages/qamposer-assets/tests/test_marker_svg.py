"""The vector marker bit matrix is byte-identical to cv2.aruco's own render."""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from qamposer_assets.marker_svg import (
    marker_bit_matrix,
    marker_group,
    marker_module_count,
)
from qamposer_vision.markers import ARUCO_DICT_NAME, MARKER_TABLE


def _reference_matrix(marker_id: int) -> list[list[int]]:
    dictionary = cv2.aruco.getPredefinedDictionary(
        getattr(cv2.aruco, ARUCO_DICT_NAME)
    )
    modules = int(dictionary.markerSize) + 2
    img = cv2.aruco.generateImageMarker(dictionary, marker_id, modules)
    # cv2: 0 = black module, 255 = white. Ours: 1 = black.
    return [[1 if int(px) == 0 else 0 for px in row] for row in np.asarray(img)]


@pytest.mark.parametrize("marker_id", [0, 1, 2, 3, 30, 17, 15, 21, 31])
def test_matrix_matches_opencv(marker_id):
    ours = [list(row) for row in marker_bit_matrix(marker_id, ARUCO_DICT_NAME)]
    assert ours == _reference_matrix(marker_id)


def test_module_count():
    assert marker_module_count(ARUCO_DICT_NAME) == 6  # 4 data bits + 1 border each side


def test_black_border_present():
    # Every module on the outermost ring must be black (the ArUco border).
    matrix = marker_bit_matrix(10, ARUCO_DICT_NAME)
    n = len(matrix)
    top, bottom = matrix[0], matrix[-1]
    assert all(v == 1 for v in top)
    assert all(v == 1 for v in bottom)
    assert all(matrix[r][0] == 1 and matrix[r][-1] == 1 for r in range(n))


def test_marker_group_is_vector_rects():
    svg = marker_group(10, 0.0, 0.0, 36.0, dictionary=ARUCO_DICT_NAME)
    assert '<g id="marker"' in svg
    assert "<rect" in svg
    assert "#000000" in svg  # black modules
    assert "<image" not in svg  # never a raster


def test_every_marker_id_renders():
    for marker_id in MARKER_TABLE:
        matrix = marker_bit_matrix(marker_id, ARUCO_DICT_NAME)
        assert len(matrix) == marker_module_count(ARUCO_DICT_NAME)
