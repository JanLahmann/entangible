"""ArucoDetector — per-frame ``DICT_4X4_50`` detection with subpixel refinement.

Pure, stateless wrapper around ``cv2.aruco``: given one BGR or grayscale image
it returns every ArUco marker it can see as a :class:`DetectedMarker`
(id + four image-px corners + centre). No temporal state lives here — the
stabilizer (M2) is a separate layer.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .markers import ARUCO_DICT_NAME, quadrant_rotation

__all__ = ["DetectedMarker", "ArucoDetector"]


@dataclass(frozen=True, slots=True)
class DetectedMarker:
    """A single ArUco marker found in one frame.

    Attributes:
        id: The decoded ArUco marker ID.
        corners: ``(4, 2)`` float array of image-px corner coordinates, in the
            ArUco canonical order (top-left, top-right, bottom-right,
            bottom-left of the marker **as printed**). ``cv2.aruco`` orders the
            corners by the decoded bit pattern, not by image position, so
            ``corners[0]`` is always the marker's printed top-left corner
            wherever the tile is physically turned — the corner order itself
            encodes the rotation.
        center: ``(2,)`` float array — the marker centroid in image px.
        rotation: The marker's rotation in the **image** frame as a clockwise
            90° step index (0-3), derived from ``corners[0]`` relative to
            ``center`` via :func:`~qamposer_vision.markers.quadrant_rotation`.
            This is the camera-frame turn; the *board*-frame rotation used to
            pick a dial angle is computed from the homography by
            :meth:`~qamposer_vision.board.BoardResult.marker_rotation` (a
            straight image rotation only equals the board rotation when the
            camera is square to the mat).
    """

    id: int
    corners: np.ndarray
    center: np.ndarray
    rotation: int = 0


def _aruco_dictionary() -> cv2.aruco.Dictionary:
    dict_id = getattr(cv2.aruco, ARUCO_DICT_NAME)
    return cv2.aruco.getPredefinedDictionary(dict_id)


class ArucoDetector:
    """Stateless per-frame ArUco detector with subpixel corner refinement."""

    def __init__(self) -> None:
        self._dictionary = _aruco_dictionary()
        params = cv2.aruco.DetectorParameters()
        # Subpixel refinement → sub-pixel accurate corners for a tight homography.
        params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        self._params = params
        self._detector = cv2.aruco.ArucoDetector(self._dictionary, self._params)

    def detect(self, image: np.ndarray) -> list[DetectedMarker]:
        """Detect all markers in a BGR or grayscale image.

        Returns markers sorted by ID for deterministic downstream ordering.
        """
        if image is None:  # defensive: cv2.imread returns None for bad paths
            raise ValueError("detect() received None instead of an image")
        if image.ndim == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image
        corners, ids, _rejected = self._detector.detectMarkers(gray)
        results: list[DetectedMarker] = []
        if ids is None:
            return results
        for marker_corners, marker_id in zip(corners, ids.flatten()):
            pts = np.asarray(marker_corners, dtype=np.float64).reshape(4, 2)
            center = pts.mean(axis=0)
            # corners[0] is the printed top-left; its quadrant about the centre
            # gives the image-frame clockwise 90° rotation of the marker.
            offset = pts[0] - center
            rotation = quadrant_rotation(float(offset[0]), float(offset[1]))
            results.append(
                DetectedMarker(
                    id=int(marker_id),
                    corners=pts,
                    center=center,
                    rotation=rotation,
                )
            )
        results.sort(key=lambda m: m.id)
        return results
