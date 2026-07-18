"""Debug overlays: draw detection state onto a BGR frame for ``/debug``.

The M1 CLI drew markers + grid inline; that logic now lives here as the single
:func:`annotate_frame` used by both the CLI (``detect --annotated``) and the
live :class:`~qamposer_vision.pipeline.Pipeline` (MJPEG preview).

It draws, on a copy of the frame:

* every detected marker's outline, centre dot and ``id:label`` caption,
* the board mat quad (when a pose is available),
* a highlighted cell for each occupied ``(row, col)``,
* a small stack of warning lines (top-left), and
* the smoothed FPS (top-right).

Pure drawing — no temporal state, no detection. Everything geometric comes from
the supplied :class:`~qamposer_vision.board.BoardResult` / ``BoardConfig``.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import TYPE_CHECKING, Any

import cv2
import numpy as np

from .board import BoardConfig, BoardResult
from .grid import GridConfig
from .markers import CORNER_IDS, MARKER_TABLE

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .detector import DetectedMarker

__all__ = ["annotate_frame"]

_CORNER_COLOR = (0, 200, 255)      # amber (BGR) for board fiducials
_GATE_COLOR = (0, 220, 0)          # green for gate tiles
_QUAD_COLOR = (255, 120, 0)        # blue for the mat outline
_OCCUPIED_COLOR = (0, 180, 255)    # orange fill for occupied cells
_WARN_COLOR = (0, 160, 255)        # orange text for warnings
_FPS_COLOR = (240, 240, 240)       # near-white for the FPS readout


def annotate_frame(
    frame: np.ndarray,
    *,
    markers: Iterable["DetectedMarker"] = (),
    board: BoardResult | None = None,
    board_config: BoardConfig | None = None,
    occupied_cells: Iterable[tuple[int, int]] = (),
    warnings: Sequence[Any] = (),
    fps: float | None = None,
) -> np.ndarray:
    """Return an annotated BGR copy of ``frame``.

    Args:
        frame: source BGR (or grayscale) image; never mutated.
        markers: detected markers to outline (corners + gate tiles).
        board: fitted board pose, or ``None`` when no board was found.
        board_config: physical geometry; loaded from ``assets.toml`` when omitted.
        occupied_cells: ``(row, col)`` cells to highlight as occupied.
        warnings: objects with a ``.message`` (and optional ``.kind``) attribute,
            rendered as a top-left stack.
        fps: smoothed pipeline throughput, drawn top-right when provided.
    """
    if board_config is None:
        board_config = BoardConfig.from_toml()

    canvas = frame.copy()
    if canvas.ndim == 2:
        canvas = cv2.cvtColor(canvas, cv2.COLOR_GRAY2BGR)

    if board is not None:
        _draw_board_quad(canvas, board, board_config)
        _draw_occupied_cells(canvas, board, board_config, occupied_cells)

    for marker in markers:
        _draw_marker(canvas, marker)

    _draw_warnings(canvas, warnings)
    if fps is not None:
        _draw_fps(canvas, fps)

    return canvas


def _draw_board_quad(
    canvas: np.ndarray, board: BoardResult, config: BoardConfig
) -> None:
    quad_mm = np.array(
        [
            [0.0, 0.0],
            [config.mat_width, 0.0],
            [config.mat_width, config.mat_height],
            [0.0, config.mat_height],
        ]
    )
    quad_px = board.board_to_image(quad_mm).astype(np.int32)
    cv2.polylines(
        canvas, [quad_px], isClosed=True, color=_QUAD_COLOR, thickness=2,
        lineType=cv2.LINE_AA,
    )


def _draw_occupied_cells(
    canvas: np.ndarray,
    board: BoardResult,
    config: BoardConfig,
    occupied_cells: Iterable[tuple[int, int]],
) -> None:
    grid = GridConfig.from_board_config(config)
    half = config.cell_size / 2.0
    overlay = canvas.copy()
    drew = False
    for row, col in occupied_cells:
        if not (0 <= row < grid.rows and 0 <= col < grid.cols):
            continue
        cx, cy = grid.cell_center(row, col)
        corners_mm = np.array(
            [
                [cx - half, cy - half],
                [cx + half, cy - half],
                [cx + half, cy + half],
                [cx - half, cy + half],
            ]
        )
        corners_px = board.board_to_image(corners_mm).astype(np.int32)
        cv2.fillConvexPoly(overlay, corners_px, _OCCUPIED_COLOR, lineType=cv2.LINE_AA)
        cv2.polylines(
            canvas, [corners_px], isClosed=True, color=_OCCUPIED_COLOR,
            thickness=2, lineType=cv2.LINE_AA,
        )
        drew = True
    if drew:
        cv2.addWeighted(overlay, 0.25, canvas, 0.75, 0, canvas)


def _draw_marker(canvas: np.ndarray, marker: "DetectedMarker") -> None:
    pts = marker.corners.astype(np.int32)
    is_corner = marker.id in CORNER_IDS
    color = _CORNER_COLOR if is_corner else _GATE_COLOR
    cv2.polylines(canvas, [pts], isClosed=True, color=color, thickness=2,
                  lineType=cv2.LINE_AA)
    cx, cy = int(marker.center[0]), int(marker.center[1])
    cv2.circle(canvas, (cx, cy), 3, color, -1, lineType=cv2.LINE_AA)
    spec = MARKER_TABLE.get(marker.id)
    label = f"{marker.id}:{spec.label}" if spec else str(marker.id)
    cv2.putText(canvas, label, (cx + 6, cy - 6), cv2.FONT_HERSHEY_SIMPLEX,
                0.5, color, 1, lineType=cv2.LINE_AA)


def _draw_warnings(canvas: np.ndarray, warnings: Sequence[Any]) -> None:
    y = 22
    for warning in warnings:
        message = getattr(warning, "message", str(warning))
        kind = getattr(warning, "kind", None)
        text = f"[{kind}] {message}" if kind else str(message)
        cv2.putText(canvas, text, (10, y), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    _WARN_COLOR, 1, lineType=cv2.LINE_AA)
        y += 20


def _draw_fps(canvas: np.ndarray, fps: float) -> None:
    text = f"{fps:5.1f} fps"
    (tw, _), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
    x = max(10, canvas.shape[1] - tw - 12)
    cv2.putText(canvas, text, (x, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                _FPS_COLOR, 2, lineType=cv2.LINE_AA)
