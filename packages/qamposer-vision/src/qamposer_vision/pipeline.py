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
from .board import BoardConfig, BoardResult, fit_board
from .circuit_builder import BuildWarning, TilePlacement, build_circuit
from .detector import ArucoDetector
from .grid import GridConfig, GridMapper
from .markers import CORNER_IDS, MARKER_TABLE
from .qasm import circuit_to_qasm
from .sources import FrameSource
from .stabilizer import Tile, TileStabilizer

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


class Pipeline:
    """Threaded vision loop matching the ``docs/protocol.md`` in-process contract."""

    def __init__(
        self,
        source: FrameSource,
        board_config: BoardConfig | None = None,
        on_circuit: Callable[[CircuitEvent], None] | None = None,
        on_detection: Callable[[DetectionEvent], None] | None = None,
    ) -> None:
        self._board_config = board_config or BoardConfig.from_toml()
        self._on_circuit = on_circuit
        self._on_detection = on_detection

        self._detector = ArucoDetector()
        self._grid = GridMapper(GridConfig.from_board_config(self._board_config))
        self._stabilizer = TileStabilizer()

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

    def swap_source(self, source: FrameSource) -> None:
        """Hot-swap the frame source; closes the old one and resets hysteresis."""
        with self._lock:
            old = self._source
            self._source = source
        self._stabilizer.reset()
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
        board = fit_board(markers, self._board_config)
        corners = sum(1 for m in markers if m.id in CORNER_IDS)

        observations, marker_obs, off_grid_warnings = self._map_markers(markers, board)

        result = self._stabilizer.update(observations)
        if result.changed or not self._emitted:
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
                )
            )

    # -- helpers -----------------------------------------------------------

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
        self, markers: list[Any], board: BoardResult | None
    ) -> tuple[set[Tile], list[MarkerObs], list[BuildWarning]]:
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
            cell = self._grid.assign(float(board_xy[0]), float(board_xy[1]))
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
        build = build_circuit(placements, self._board_config.rows)
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
            board_config=self._board_config,
            occupied_cells=occupied,
            warnings=warnings,
            fps=self._fps,
        )
        with self._lock:
            self._annotated = annotated
