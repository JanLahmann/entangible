"""The live detection loop — source → detector → board → grid → stabilizer → circuit.

:class:`Pipeline` runs the whole vision loop on a background worker thread and
emits results via two callbacks, matching the in-process contract in
``docs/protocol.md``:

* :class:`CircuitEvent` on every *stable* circuit change (deep-equality), and
* :class:`DetectionEvent` on every processed frame (the host throttles these to
  5 Hz for ``/ws/state``).

The host bridges the callbacks (invoked on the worker thread) to asyncio with
``loop.call_soon_threadsafe``; the pipeline itself knows nothing about asyncio.

Design notes:

* ``start()`` / ``stop()`` are idempotent (guarded by a live-thread check and a
  ``threading.Event``); ``stop()`` joins within a couple of seconds.
* ``swap_source()`` hot-swaps the camera under a lock and resets the stabilizer
  so a new scene starts clean.
* ``latest_annotated()`` returns the most recent annotated BGR frame for the
  ``/debug`` MJPEG preview.
* The worker never lets an exception escape: it is logged and the loop continues.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from time import monotonic, sleep
from typing import Any, Callable

import numpy as np

from .annotate import annotate_frame
from .board import (
    MAT_RECT_TOLERANCE,
    BoardConfig,
    BoardRect,
    BoardResult,
    estimate_board_rect,
    fit_board,
    mat_rect,
)
from .board_model import (
    DEFAULT_BOARD_LAYOUT,
    BoardModel,
    build_board_model,
    mat_board_model,
)
from .circuit_builder import BuildWarning, TilePlacement, build_circuit
from .detector import ArucoDetector
from .grid import GridMapper
from .markers import CORNER_IDS, MARKER_TABLE
from .qasm import circuit_to_qasm
from .sources import FrameSource
from .stabilizer import Tile, TileStabilizer
from .wires import WireStabilizer, wire_positions

__all__ = ["MarkerObs", "CircuitEvent", "DetectionEvent", "Pipeline"]

logger = logging.getLogger("qamposer_vision.pipeline")

#: Seconds the worker sleeps when the source has no frame ready.
_IDLE_SLEEP = 0.005
#: EMA smoothing factor for the reported FPS.
_FPS_ALPHA = 0.3


@dataclass(frozen=True, slots=True)
class MarkerObs:
    """One detected gate marker as reported in a :class:`DetectionEvent`.

    Corner fiducials (IDs 0-3) are never reported here. On-grid tiles carry
    ``row``/``col``; tiles rejected by grid mapping carry ``off_grid=True`` and
    leave ``row``/``col`` as ``None``. Serialized to the camelCase
    ``{id, row, col}`` / ``{id, offGrid: true}`` shapes by the host.
    """

    id: int
    row: int | None = None
    col: int | None = None
    off_grid: bool = False


@dataclass(frozen=True, slots=True)
class CircuitEvent:
    """Emitted on every stable circuit change. ``seq`` is assigned by the host."""

    circuit: dict[str, Any]
    qasm: str
    source: str


@dataclass(frozen=True, slots=True)
class DetectionEvent:
    """Per-frame diagnostics (host throttles to <=5 Hz)."""

    fps: float
    board_found: bool
    corners: int
    reprojection_error_mm: float | None
    markers: list[MarkerObs] = field(default_factory=list)
    warnings: list[BuildWarning] = field(default_factory=list)
    #: Estimated board rectangle ``(width_mm, height_mm)`` — the corner blocks'
    #: actual span (task #94). ``None`` while no board is found.
    rect_mm: tuple[float, float] | None = None
    #: Which model interpreted the frame: ``"mat"``/``"stretch"``/``"grid"``.
    board_layout: str = "mat"
    #: Active lattice size.
    rows: int = 0
    cols: int = 0
    #: Qubit-wire blocks driving the rows (task #95), or ``None`` when the
    #: model's own rows are used.
    wires: int | None = None


class Pipeline:
    """Threaded vision loop matching the ``docs/protocol.md`` in-process contract."""

    def __init__(
        self,
        source: FrameSource,
        board_config: BoardConfig | None = None,
        on_circuit: Callable[[CircuitEvent], None] | None = None,
        on_detection: Callable[[DetectionEvent], None] | None = None,
        board_layout: str = DEFAULT_BOARD_LAYOUT,
    ) -> None:
        self._board_config = board_config or BoardConfig.from_toml()
        self._on_circuit = on_circuit
        self._on_detection = on_detection
        self._board_layout = board_layout

        self._detector = ArucoDetector()
        self._stabilizer = TileStabilizer()
        self._wire_stabilizer = WireStabilizer()
        # Sticky board rectangle (task #94): starts at the mat and only moves
        # when an estimate differs by more than the mat tolerance, so a real mat
        # stays bit-for-bit classic and a fixed table layout does not re-derive
        # its column count on every frame's measurement noise.
        self._rect: BoardRect = mat_rect(self._board_config)
        self._model: BoardModel = mat_board_model(self._board_config)

        self._lock = threading.Lock()          # guards _source and _annotated
        self._source: FrameSource = source
        self._annotated: np.ndarray | None = None

        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

        # Per-run state (reset in start()).
        self._fps = 0.0
        self._last_frame_time: float | None = None
        self._last_circuit: dict[str, Any] | None = None
        self._structural_warnings: list[BuildWarning] = []
        self._emitted = False

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        """Start the worker thread. Idempotent — a no-op if already running."""
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._fps = 0.0
        self._last_frame_time = None
        self._last_circuit = None
        self._structural_warnings = []
        self._emitted = False
        self._stabilizer.reset()
        self._wire_stabilizer.reset()
        self._rect = mat_rect(self._board_config)
        self._model = mat_board_model(self._board_config)
        self._thread = threading.Thread(
            target=self._run, name="qamposer-pipeline", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        """Signal the worker to stop and join it. Idempotent."""
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=2.0)
            if thread.is_alive():  # pragma: no cover - worker should exit promptly
                logger.warning("pipeline worker did not stop within 2s")
        self._thread = None
        with self._lock:
            source = self._source
        try:
            source.close()
        except Exception:  # pragma: no cover - close is best-effort
            logger.exception("error closing frame source on stop")

    def set_board_layout(self, layout: str) -> None:
        """Choose how a non-mat rectangle becomes a lattice (task #94).

        ``"stretch"`` scales the 5x8 board into the measured rectangle;
        ``"grid"`` (default) keeps the mat's pitch and derives the column count
        from the width. A no-op when unchanged; otherwise the model is rebuilt
        on the next frame. The classic mat is unaffected either way.
        """
        if layout == self._board_layout:
            return
        self._board_layout = layout

    def swap_source(self, source: FrameSource) -> None:
        """Hot-swap the frame source; closes the old one and resets hysteresis."""
        with self._lock:
            old = self._source
            self._source = source
        self._stabilizer.reset()
        self._wire_stabilizer.reset()
        if old is not source:
            try:
                old.close()
            except Exception:  # pragma: no cover - close is best-effort
                logger.exception("error closing previous frame source on swap")

    def latest_annotated(self) -> np.ndarray | None:
        """Return the most recent annotated BGR frame (for ``/debug`` MJPEG)."""
        with self._lock:
            return None if self._annotated is None else self._annotated

    # -- worker ------------------------------------------------------------

    def _run(self) -> None:
        while not self._stop.is_set():
            with self._lock:
                source = self._source
            try:
                frame = source.read()
            except Exception:
                logger.exception("frame source read() failed")
                frame = None
            if frame is None:
                sleep(_IDLE_SLEEP)
                continue
            try:
                self._process_frame(frame, source)
            except Exception:
                logger.exception("pipeline frame processing failed")
                # keep the loop alive; drop this frame

    def _process_frame(self, frame: np.ndarray, source: FrameSource) -> None:
        self._update_fps()

        markers = self._detector.detect(frame)
        corners = sum(1 for m in markers if m.id in CORNER_IDS)

        # 1. What rectangle do the corner blocks actually span? (task #94)
        self._update_rect(markers)
        board = fit_board(markers, self._board_config, self._rect)

        # 2. Qubit-wire blocks, read in the rectangle's own board frame (#95).
        #    The pre-wire model supplies the "left of the grid" threshold; the
        #    stabilized wire set then decides the rows.
        base = build_board_model(self._board_config, self._rect, self._board_layout)
        wire_changed = False
        if board is not None:
            wires = self._wire_stabilizer.update(
                wire_positions(markers, board, base.grid)
            )
            wire_changed = wires.changed
            self._model = build_board_model(
                self._board_config, self._rect, self._board_layout, wires.wires
            )
        else:
            self._model = base

        grid = GridMapper(self._model.grid)
        observations, marker_obs, off_grid_warnings = self._map_markers(
            markers, board, grid
        )

        result = self._stabilizer.update(observations)
        if result.changed or wire_changed or not self._emitted:
            self._rebuild_and_maybe_emit(result.stable, source)

        detection_warnings = self._compose_warnings(off_grid_warnings)
        self._store_annotated(frame, markers, board, result.stable, detection_warnings)

        if self._on_detection is not None:
            self._on_detection(
                DetectionEvent(
                    fps=self._fps,
                    board_found=board is not None,
                    corners=corners,
                    reprojection_error_mm=(
                        board.reprojection_error if board is not None else None
                    ),
                    markers=marker_obs,
                    warnings=detection_warnings,
                    rect_mm=(
                        None
                        if board is None
                        else (self._model.rect.width, self._model.rect.height)
                    ),
                    board_layout=self._model.kind,
                    rows=self._model.rows,
                    cols=self._model.cols,
                    wires=self._model.wire_count,
                )
            )

    # -- helpers -----------------------------------------------------------

    def _update_rect(self, markers: list[Any]) -> None:
        """Move the sticky board rectangle if the frame says it really changed.

        Estimates are noisy at the tenth-of-a-millimetre level, and the derived
        column count is a floor(), so adopting every estimate would let a board
        near a column boundary flip size frame to frame. The current rectangle
        is therefore kept until an estimate differs from it by more than
        :data:`~.board.MAT_RECT_TOLERANCE` on either axis — which also keeps a
        real mat pinned to exactly the mat geometry.
        """
        estimate = estimate_board_rect(markers, self._board_config)
        if estimate is None:
            return
        rect = estimate.rect
        tol = MAT_RECT_TOLERANCE
        if (
            abs(rect.width - self._rect.width) <= tol * self._rect.width
            and abs(rect.height - self._rect.height) <= tol * self._rect.height
        ):
            return
        self._rect = rect

    def _update_fps(self) -> None:
        now = monotonic()
        if self._last_frame_time is not None:
            dt = now - self._last_frame_time
            if dt > 0:
                inst = 1.0 / dt
                self._fps = inst if self._fps == 0.0 else (
                    _FPS_ALPHA * inst + (1.0 - _FPS_ALPHA) * self._fps
                )
        self._last_frame_time = now

    def _map_markers(
        self,
        markers: list[Any],
        board: BoardResult | None,
        grid: GridMapper | None = None,
    ) -> tuple[set[Tile], list[MarkerObs], list[BuildWarning]]:
        if grid is None:
            grid = GridMapper(self._model.grid)
        observations: set[Tile] = set()
        marker_obs: list[MarkerObs] = []
        off_grid_warnings: list[BuildWarning] = []

        for marker in markers:
            if marker.id in CORNER_IDS or marker.id not in MARKER_TABLE:
                continue  # corner fiducial or unknown ID: not a gate tile
            if board is None:
                marker_obs.append(MarkerObs(id=marker.id, off_grid=True))
                continue
            board_xy = board.image_to_board(marker.center)[0]
            cell = grid.assign(float(board_xy[0]), float(board_xy[1]))
            if cell is None:
                marker_obs.append(MarkerObs(id=marker.id, off_grid=True))
                off_grid_warnings.append(
                    BuildWarning(
                        kind="off_grid",
                        message=(
                            f"Tile marker {marker.id} "
                            f"({MARKER_TABLE[marker.id].label}) at board "
                            f"({board_xy[0]:.0f}, {board_xy[1]:.0f}) mm does not "
                            "fall on any cell; excluded."
                        ),
                        marker_ids=(marker.id,),
                    )
                )
                continue
            row, col = cell
            # Dial tiles carry their board-frame rotation in the stability key so
            # turning one in place re-emits; every other tile pins rotation 0.
            spec = MARKER_TABLE[marker.id]
            rot = board.marker_rotation(marker) if spec.dial_axis is not None else 0
            observations.add((marker.id, row, col, rot))
            marker_obs.append(MarkerObs(id=marker.id, row=row, col=col))

        return observations, marker_obs, off_grid_warnings

    def _rebuild_and_maybe_emit(
        self, stable: frozenset[Tile], source: FrameSource
    ) -> None:
        placements = [
            TilePlacement(marker_id=mid, row=row, col=col, rotation=rot)
            for (mid, row, col, rot) in stable
        ]
        # Qubit count follows the active model: the mat's five rows, the rows
        # derived from the board height, or one per qubit-wire block (#95).
        build = build_circuit(placements, self._model.rows)
        self._structural_warnings = build.warnings

        if not self._emitted or build.circuit != self._last_circuit:
            self._last_circuit = build.circuit
            self._emitted = True
            if self._on_circuit is not None:
                self._on_circuit(
                    CircuitEvent(
                        circuit=build.circuit,
                        qasm=circuit_to_qasm(build.circuit),
                        source=getattr(source, "source_kind", "camera"),
                    )
                )

    def _compose_warnings(
        self, off_grid_warnings: list[BuildWarning]
    ) -> list[BuildWarning]:
        combined = list(off_grid_warnings) + list(self._structural_warnings)
        combined.sort(
            key=lambda w: (w.col if w.col is not None else 99, w.row or 0, w.kind)
        )
        return combined

    def _store_annotated(
        self,
        frame: np.ndarray,
        markers: list[Any],
        board: BoardResult | None,
        stable: frozenset[Tile],
        warnings: list[BuildWarning],
    ) -> None:
        occupied = {(row, col) for (_mid, row, col, _rot) in stable}
        annotated = annotate_frame(
            frame,
            markers=markers,
            board=board,
            board_config=self._model.config,
            grid=self._model.grid,
            occupied_cells=occupied,
            warnings=warnings,
            fps=self._fps,
        )
        with self._lock:
            self._annotated = annotated
