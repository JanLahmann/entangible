"""Board detection: homography from the four corner markers.

The board mat carries four ArUco fiducials (IDs 0-3 = TL/TR/BR/BL, see
:mod:`.markers`). Each fiducial is a known square in *board-mm* coordinates
whose origin is the mat's top-left corner. Detecting the markers in an image
gives up to 16 point correspondences (4 corners x 4 markers) from which we fit
a projective homography mapping **image px -> board mm**.

Everything geometric is read from ``assets.toml`` (the single source of truth
shared with the print side); nothing is hardcoded here.

Since task #94 the four fiducials no longer have to sit at the printed mat's
spacing: corner *blocks* may be laid out on any table, spanning an arbitrary
rectangle. :func:`estimate_board_rect` recovers that rectangle (the printed
40 mm marker gives the absolute scale), and :func:`fit_board` accepts it so the
homography is fitted against the geometry that is actually on the table. A
rectangle within :data:`MAT_RECT_TOLERANCE` of the mat's is treated as the mat,
so the classic path is bit-for-bit unchanged.

Milestone M1 scope (static images): pure functions, no state.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, replace
from pathlib import Path

import cv2
import numpy as np

from .detector import DetectedMarker
from .markers import CORNER_IDS, CORNER_ROLES, quadrant_rotation

__all__ = [
    "BoardConfig",
    "BoardRect",
    "BoardResult",
    "MAT_RECT_TOLERANCE",
    "MIN_CORNERS_FOR_BOARD",
    "RectEstimate",
    "center_span",
    "corner_inset",
    "default_assets_path",
    "estimate_board_rect",
    "fit_board",
    "is_mat_rect",
    "mat_rect",
    "rect_from_center_span",
    "with_rect",
]

#: A homography needs >= 4 point pairs. Each corner marker contributes 4 points,
#: so any 3 of the 4 corners (12 points) is enough; we still degrade to 3.
MIN_CORNERS_FOR_BOARD = 3

#: Relative tolerance within which an estimated rectangle counts as "the mat"
#: (task #94). Inside it the detector keeps the mat geometry verbatim, so a
#: real mat -- and corner blocks laid out at mat spacing -- behave exactly as
#: before. It doubles as the hysteresis band of the pipeline's sticky rectangle:
#: a new estimate has to differ by more than this to replace the current one.
MAT_RECT_TOLERANCE = 0.05

#: Refinement passes in :func:`estimate_board_rect`. With four corners the very
#: first pass is already exact (see the docstring); the extra passes only clean
#: up detector noise and the 3-corner case.
RECT_ESTIMATE_ITERATIONS = 3


@dataclass(frozen=True, slots=True)
class BoardRect:
    """The outer rectangle the four corner markers span, in board mm.

    Measured the same way the mat is: ``width``/``height`` include the
    ``corner_margin`` inset on both sides, so a mat-spaced layout reports
    exactly ``(mat_width, mat_height)`` and the board-mm origin stays the
    board's top-left corner.
    """

    width: float
    height: float


@dataclass(frozen=True, slots=True)
class RectEstimate:
    """Outcome of :func:`estimate_board_rect` for one frame."""

    rect: BoardRect
    #: RMS reprojection error (mm) of the corner correspondences under ``rect``.
    rms: float
    #: Corner marker IDs the estimate used, canonical (TL, TR, BR, BL) order.
    corner_ids: tuple[int, ...]


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
    #: The board rectangle this pose was fitted against (task #94). ``None``
    #: means the printed mat's own extents were used.
    rect: BoardRect | None = None

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


# ---------------------------------------------------------------------------
# Variable corner placement (task #94)
# ---------------------------------------------------------------------------


def corner_inset(config: BoardConfig) -> float:
    """Distance from a board edge to a corner marker's *centre*, in mm."""
    return config.corner_margin + config.corner_marker_size / 2.0


def mat_rect(config: BoardConfig) -> BoardRect:
    """The printed mat's rectangle — the classic geometry and the initial guess."""
    return BoardRect(config.mat_width, config.mat_height)


def center_span(config: BoardConfig, rect: BoardRect) -> tuple[float, float]:
    """Centre-to-centre spacing of opposite corner markers for ``rect`` (mm)."""
    inset = 2.0 * corner_inset(config)
    return rect.width - inset, rect.height - inset


def rect_from_center_span(
    config: BoardConfig, span_x: float, span_y: float
) -> BoardRect:
    """Inverse of :func:`center_span`."""
    inset = 2.0 * corner_inset(config)
    return BoardRect(span_x + inset, span_y + inset)


def with_rect(config: BoardConfig, rect: BoardRect) -> BoardConfig:
    """A copy of ``config`` whose mat extents are ``rect``.

    Everything downstream (``corner_marker_square``, the annotated board quad)
    reads the mat extents, so resizing them is all it takes to describe a board
    of corner blocks that spans a different rectangle.
    """
    return replace(config, mat_width=rect.width, mat_height=rect.height)


def is_mat_rect(
    config: BoardConfig, rect: BoardRect, tolerance: float = MAT_RECT_TOLERANCE
) -> bool:
    """Is ``rect`` the printed mat, within ``tolerance`` (relative, per axis)?"""
    return (
        abs(rect.width - config.mat_width) <= tolerance * config.mat_width
        and abs(rect.height - config.mat_height) <= tolerance * config.mat_height
    )


def _corner_correspondences(
    markers: list[DetectedMarker], config: BoardConfig
) -> tuple[np.ndarray, np.ndarray, list[int]]:
    """Image-px / board-mm point pairs for every detected corner marker."""
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
    src = np.array(src_px, dtype=np.float64).reshape(-1, 2)
    dst = np.array(dst_mm, dtype=np.float64).reshape(-1, 2)
    return src, dst, found


def _marker_extents(mapped: np.ndarray) -> tuple[float, float] | None:
    """Mean horizontal / vertical edge length of mapped marker quads (mm).

    ``mapped`` is ``(4N, 2)`` — four consecutive rows per marker, in the
    detector's corner order. Each edge is classified by whether it runs more
    horizontally or more vertically **in the fitted board frame**, so a corner
    block that was placed a quarter turn off still measures correctly.
    """
    horizontal: list[float] = []
    vertical: list[float] = []
    for base in range(0, len(mapped), 4):
        quad = mapped[base : base + 4]
        for k in range(4):
            delta = quad[(k + 1) % 4] - quad[k]
            length = float(np.hypot(delta[0], delta[1]))
            if abs(delta[0]) >= abs(delta[1]):
                horizontal.append(length)
            else:
                vertical.append(length)
    if not horizontal or not vertical:
        return None
    return float(np.mean(horizontal)), float(np.mean(vertical))


def estimate_board_rect(
    markers: list[DetectedMarker],
    config: BoardConfig | None = None,
    iterations: int = RECT_ESTIMATE_ITERATIONS,
) -> RectEstimate | None:
    """Estimate the rectangle the detected corner markers actually span.

    The corner markers give the rectangle's *shape*; their printed
    ``corner_marker_size`` (40 mm) gives the absolute *scale*. The two are
    separated by a short fixed-point iteration:

    1. fit a homography image-px -> a **model** board of the current estimate
       (initially the mat), using every available corner point;
    2. map the detected marker quads through it and measure their mean
       horizontal / vertical edge length ``(ex, ey)``;
    3. the model is too small on an axis exactly when the marker measures too
       large on it, so scale the centre spacing by ``size/ex`` and ``size/ey``
       and repeat.

    With all four corners visible the composite world -> model map is the
    anisotropic scaling ``diag(span_x/span_x_true, span_y/span_y_true)`` (a
    homography is determined by four correspondences, and that scaling already
    satisfies them), so step 3 lands on the true spacing in ONE pass; the
    remaining passes only average out detector noise. With three corners the
    same iteration converges from the 12 available points.

    Returns ``None`` when fewer than :data:`MIN_CORNERS_FOR_BOARD` corners are
    visible or the fit degenerates.
    """
    if config is None:
        config = BoardConfig.from_toml()

    src, _dst, found = _corner_correspondences(markers, config)
    if len(found) < MIN_CORNERS_FOR_BOARD:
        return None

    span_x, span_y = center_span(config, mat_rect(config))
    size = config.corner_marker_size
    homography: np.ndarray | None = None
    dst = _dst
    for _ in range(max(1, iterations)):
        rect = rect_from_center_span(config, span_x, span_y)
        _src, dst, _found = _corner_correspondences(markers, with_rect(config, rect))
        homography, _mask = cv2.findHomography(src, dst, 0)
        if homography is None:
            return None
        mapped = cv2.perspectiveTransform(src.reshape(-1, 1, 2), homography).reshape(-1, 2)
        extents = _marker_extents(mapped)
        if extents is None:
            return None
        ex, ey = extents
        if ex <= 1e-6 or ey <= 1e-6:
            return None
        span_x *= size / ex
        span_y *= size / ey
        if span_x <= 0.0 or span_y <= 0.0:
            return None

    rect = rect_from_center_span(config, span_x, span_y)
    _src, dst, _found = _corner_correspondences(markers, with_rect(config, rect))
    homography, _mask = cv2.findHomography(src, dst, 0)
    if homography is None:
        return None
    projected = cv2.perspectiveTransform(src.reshape(-1, 1, 2), homography).reshape(-1, 2)
    rms = float(np.sqrt(np.mean(np.sum((projected - dst) ** 2, axis=1))))

    role_order = {role: idx for idx, role in enumerate(CORNER_ROLES)}
    ordered = tuple(sorted(found, key=lambda i: role_order[CORNER_IDS[i]]))
    return RectEstimate(rect=rect, rms=rms, corner_ids=ordered)


def fit_board(
    markers: list[DetectedMarker],
    config: BoardConfig | None = None,
    rect: BoardRect | None = None,
) -> BoardResult | None:
    """Fit an image-px -> board-mm homography from detected corner markers.

    Uses every available corner point (up to 16) with ``findHomography`` +
    RANSAC. Returns ``None`` when fewer than :data:`MIN_CORNERS_FOR_BOARD`
    corner markers are visible (no reliable board pose).

    ``rect`` (task #94) overrides the mat extents the corner squares are taken
    from — pass the output of :func:`estimate_board_rect` to fit against corner
    blocks that span some other rectangle. Omitted (or the mat's own extents)
    reproduces the classic fit exactly.
    """
    if config is None:
        config = BoardConfig.from_toml()
    if rect is not None:
        config = with_rect(config, rect)

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
    return BoardResult(
        homography=homography,
        reprojection_error=rms,
        corner_ids=ordered,
        rect=rect,
    )
