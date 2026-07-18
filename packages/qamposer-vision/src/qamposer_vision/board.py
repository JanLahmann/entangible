"""Board detection: homography from the four corner markers.

The board mat carries four ArUco fiducials (IDs 0-3 = TL/TR/BR/BL, see
:mod:`.markers`). Each fiducial is a known square in *board-mm* coordinates
whose origin is the mat's top-left corner. Detecting the markers in an image
gives up to 16 point correspondences (4 corners x 4 markers) from which we fit
a projective homography mapping **image px -> board mm**.

Everything geometric is read from ``assets.toml`` (the single source of truth
shared with the print side); nothing is hardcoded here.

Milestone M1 scope (static images): pure functions, no state.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .detector import DetectedMarker
from .markers import CORNER_IDS, CORNER_ROLES, quadrant_rotation

__all__ = [
    "BoardConfig",
    "BoardResult",
    "MIN_CORNERS_FOR_BOARD",
    "default_assets_path",
    "fit_board",
]

#: A homography needs >= 4 point pairs. Each corner marker contributes 4 points,
#: so any 3 of the 4 corners (12 points) is enough; we still degrade to 3.
MIN_CORNERS_FOR_BOARD = 3


def default_assets_path() -> Path:
    """Locate ``assets.toml`` by walking up from this module to the repo root."""
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "assets.toml"
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        f"assets.toml not found in any parent of {here} — "
        "pass an explicit path to BoardConfig.from_toml()."
    )


@dataclass(frozen=True, slots=True)
class BoardConfig:
    """Physical board geometry (millimetres), loaded from ``assets.toml``.

    Origin of the board-mm coordinate system is the mat's top-left corner,
    +x to the right, +y down (image convention).
    """

    rows: int
    cols: int
    pitch: float
    cell_size: float
    mat_width: float
    mat_height: float
    corner_marker_size: float
    corner_margin: float
    grid_offset_x: float
    grid_offset_y: float
    tile_size: float
    tile_marker_size: float

    @classmethod
    def from_toml(cls, path: str | Path | None = None) -> "BoardConfig":
        """Build a config from ``assets.toml`` (default: repo-root discovery)."""
        toml_path = Path(path) if path is not None else default_assets_path()
        with open(toml_path, "rb") as fh:
            data = tomllib.load(fh)
        board = data["board"]
        tile = data["tile"]
        return cls(
            rows=int(board["rows"]),
            cols=int(board["cols"]),
            pitch=float(board["pitch"]),
            cell_size=float(board["cell_size"]),
            mat_width=float(board["mat_width"]),
            mat_height=float(board["mat_height"]),
            corner_marker_size=float(board["corner_marker_size"]),
            corner_margin=float(board["corner_margin"]),
            grid_offset_x=float(board["grid_offset_x"]),
            grid_offset_y=float(board["grid_offset_y"]),
            tile_size=float(tile["size"]),
            tile_marker_size=float(tile["marker_size"]),
        )

    def corner_marker_square(self, marker_id: int) -> np.ndarray:
        """Board-mm coordinates of a corner marker's four corners.

        Returned in the ArUco corner order (marker-canonical TL, TR, BR, BL),
        matching what :class:`~.detector.DetectedMarker` reports for an upright
        marker, so the two can be zipped directly into correspondences.
        """
        role = CORNER_IDS[marker_id]
        size = self.corner_marker_size
        margin = self.corner_margin
        if role == "TL":
            x0, y0 = margin, margin
        elif role == "TR":
            x0, y0 = self.mat_width - margin - size, margin
        elif role == "BR":
            x0, y0 = self.mat_width - margin - size, self.mat_height - margin - size
        elif role == "BL":
            x0, y0 = margin, self.mat_height - margin - size
        else:  # pragma: no cover - CORNER_IDS only holds the four roles
            raise ValueError(f"Unknown corner role {role!r}")
        return np.array(
            [
                [x0, y0],
                [x0 + size, y0],
                [x0 + size, y0 + size],
                [x0, y0 + size],
            ],
            dtype=np.float64,
        )


@dataclass(frozen=True, slots=True)
class BoardResult:
    """Outcome of fitting the board homography for one frame."""

    #: 3x3 homography mapping image px -> board mm.
    homography: np.ndarray
    #: RMS reprojection error of the correspondences, in millimetres.
    reprojection_error: float
    #: Corner marker IDs that were found and used (subset of {0,1,2,3}).
    corner_ids: tuple[int, ...]

    @property
    def corner_roles(self) -> tuple[str, ...]:
        return tuple(CORNER_IDS[i] for i in self.corner_ids)

    def image_to_board(self, points_px: np.ndarray) -> np.ndarray:
        """Map image-px points (N,2) into board-mm coordinates (N,2)."""
        pts = np.asarray(points_px, dtype=np.float64).reshape(-1, 1, 2)
        mapped = cv2.perspectiveTransform(pts, self.homography)
        return mapped.reshape(-1, 2)

    def board_to_image(self, points_mm: np.ndarray) -> np.ndarray:
        """Map board-mm points (N,2) back into image-px coordinates (N,2)."""
        inv = np.linalg.inv(self.homography)
        pts = np.asarray(points_mm, dtype=np.float64).reshape(-1, 1, 2)
        mapped = cv2.perspectiveTransform(pts, inv)
        return mapped.reshape(-1, 2)

    def marker_rotation(self, marker: DetectedMarker) -> int:
        """The marker's rotation in the **board** frame (clockwise 90° steps).

        The marker's four image-px corners are mapped through the homography
        into board mm, then the printed top-left corner (``corners[0]``) is
        classified into a quadrant about the board-mm centroid — so the result
        is measured against the board's own axes, independent of how the camera
        is oriented. This is the ``r`` that selects a dial angle
        (``ROTATION_ANGLES[r]``). See
        :func:`~qamposer_vision.markers.quadrant_rotation`.
        """
        board_corners = self.image_to_board(marker.corners)
        centroid = board_corners.mean(axis=0)
        offset = board_corners[0] - centroid
        return quadrant_rotation(float(offset[0]), float(offset[1]))


def fit_board(
    markers: list[DetectedMarker],
    config: BoardConfig | None = None,
) -> BoardResult | None:
    """Fit an image-px -> board-mm homography from detected corner markers.

    Uses every available corner point (up to 16) with ``findHomography`` +
    RANSAC. Returns ``None`` when fewer than :data:`MIN_CORNERS_FOR_BOARD`
    corner markers are visible (no reliable board pose).
    """
    if config is None:
        config = BoardConfig.from_toml()

    src_px: list[list[float]] = []
    dst_mm: list[list[float]] = []
    found: list[int] = []
    for marker in markers:
        if marker.id not in CORNER_IDS:
            continue
        found.append(marker.id)
        board_corners = config.corner_marker_square(marker.id)
        for px, mm in zip(marker.corners, board_corners):
            src_px.append([float(px[0]), float(px[1])])
            dst_mm.append([float(mm[0]), float(mm[1])])

    if len(found) < MIN_CORNERS_FOR_BOARD:
        return None

    src = np.array(src_px, dtype=np.float64)
    dst = np.array(dst_mm, dtype=np.float64)
    homography, _mask = cv2.findHomography(src, dst, cv2.RANSAC, 3.0)
    if homography is None:  # degenerate configuration
        return None

    # RMS reprojection error, in mm.
    projected = cv2.perspectiveTransform(src.reshape(-1, 1, 2), homography).reshape(-1, 2)
    residuals = np.linalg.norm(projected - dst, axis=1)
    rms = float(np.sqrt(np.mean(residuals**2)))

    # Order corner ids by their canonical role (TL, TR, BR, BL) for stability.
    role_order = {role: idx for idx, role in enumerate(CORNER_ROLES)}
    ordered = tuple(sorted(found, key=lambda i: role_order[CORNER_IDS[i]]))
    return BoardResult(homography=homography, reprojection_error=rms, corner_ids=ordered)
