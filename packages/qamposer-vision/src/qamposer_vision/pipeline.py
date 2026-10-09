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
* Booth resilience: a board out of sight is HELD for
  :data:`BOARD_LOSS_GRACE_S` before the circuit is cleared, and a camera that
  stops delivering frames for :data:`CAMERA_STALL_S` is reported lost
  (``fps=0``, ``camera_lost=True``) and reopened with capped backoff.
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
    on_board,
)
from .board_model import (
    DEFAULT_BOARD_LAYOUT,
    BoardModel,
    build_board_model,
    mat_board_model,
)
from .circuit_builder import (
    BuildWarning,
    TilePlacement,
    build_circuit,
    stray_furniture_warnings,
    stray_tiles_warning,
)
from .detector import ArucoDetector
from .grid import GridConfig, GridMapper, cluster_columns, round_half_up
from .markers import CORNER_IDS, MARKER_TABLE, MEASURE_BLOCK_ID, QUBIT_WIRE_ID
from .qasm import circuit_to_qasm
from .sources import FrameSource
from .stabilizer import Tile, TileStabilizer
from .wires import (
    MeasurePairing,
    MeasureStabilizer,
    WireStabilizer,
    measure_points,
    pair_measures,
    pair_tolerance,
    stray_furniture,
    wire_points,
)

__all__ = [
    "BOARD_LOSS_GRACE_S",
    "CAMERA_REOPEN_INITIAL_S",
    "CAMERA_REOPEN_MAX_S",
    "CAMERA_STALL_S",
    "X_BUCKET_MM",
    "off_grid_warning",
    "MarkerObs",
    "CircuitEvent",
    "DetectionEvent",
    "Pipeline",
    "x_bucket",
]

logger = logging.getLogger("qamposer_vision.pipeline")

#: Seconds the worker sleeps when the source has no frame ready.
_IDLE_SLEEP = 0.005
#: EMA smoothing factor for the reported FPS.
_FPS_ALPHA = 0.3

#: Seconds the board (>= 3 corner blocks) may be continuously out of sight
#: before the circuit is cleared. Until then the pipeline HOLDS the last stable
#: board — circuit, tiles and lattice untouched, ``board_found`` false — so a
#: visitor leaning over the table cannot wipe the circuit (and with it the
#: achievements, celebrations and golf strokes downstream). Measured on the
#: frame timestamps, never in frames: "12 frames" was 0.4 s at 30 fps and 2.4 s
#: at 5 fps. Mirrors ``BOARD_LOSS_GRACE_S`` in ``pocket-app/src/vision/pipeline.ts``.
BOARD_LOSS_GRACE_S = 2.0

#: Seconds a live camera source (``source_kind == "camera"``) may go without
#: delivering a frame before it is reported lost: one ``DetectionEvent`` with
#: ``fps=0`` and ``camera_lost=True``, then reopen attempts. Replay / push
#: sources are exempt — a replay loops by design and a phone stopping its
#: stream is the phone's status to report.
CAMERA_STALL_S = 2.0
#: Reopen backoff for a lost camera: the first retry follows this long after
#: the first attempt, each later one doubles, capped at
#: :data:`CAMERA_REOPEN_MAX_S` — forever, because booths run unattended.
CAMERA_REOPEN_INITIAL_S = 1.0
CAMERA_REOPEN_MAX_S = 10.0
#: How often the watchdog thread checks for a stall. It exists so the lost
#: report goes out on time even while the worker is stuck inside a blocking
#: ``read()`` (a frozen V4L2 device can block for ~10 s before it fails).
_WATCHDOG_INTERVAL = 0.25

#: Smallest fraction of the estimated board width a wire's measured left→right
#: run may cover before it is called out (#97). Wire and measurement blocks sit
#: on opposite EDGES of the board, so a run much shorter than the board means
#: the blocks are somewhere they should not be — but where exactly along each
#: edge is the user's business, hence a loose bound rather than a tight one.
SPAN_MIN_FRACTION = 0.5

#: Width (board mm) of the absolute x buckets a tile is stabilized under (#109).
#:
#: Columns are clustered from the tiles' actual x positions, so a column index
#: is a property of the whole board, not of one tile — inserting a tile left of
#: all others renumbers every column to its right. Had the stabilizer keyed
#: tiles by that per-frame column, one inserted tile would change EVERY key at
#: once and flap the whole board through the hysteresis (each tile "leaving"
#: under its old column while it "appears" under its new one). Keys must be
#: insertion-invariant, so a tile is keyed by ``round(x / X_BUCKET_MM)`` — an
#: absolute position that no other tile can move — and columns are clustered
#: only from the STABLE set, at emission. 10 mm is far below the 30 mm cluster
#: gap (:data:`~.grid.COLUMN_GAP_MM`), so bucketing never merges or splits a
#: column; it only absorbs sub-bucket jitter.
X_BUCKET_MM = 10.0


def x_bucket(x_mm: float) -> int:
    """The absolute x bucket of a tile centre — its stability-key x (#109)."""
    return round_half_up(x_mm / X_BUCKET_MM)


def off_grid_warning(marker_id: int, x_mm: float, y_mm: float) -> BuildWarning:
    """The ``off_grid`` warning for a tile on the board but on no row.

    Since #109 only the row can miss: columns are clustered from wherever the
    tiles lie, so "off grid" now means between two qubit wires / lattice rows.
    Shared by the live pipeline and the static ``detect`` CLI.
    """
    return BuildWarning(
        kind="off_grid",
        message=(
            f"Tile marker {marker_id} ({MARKER_TABLE[marker_id].label}) at board "
            f"({x_mm:.0f}, {y_mm:.0f}) mm is on the board but on no qubit "
            "wire; excluded."
        ),
        marker_ids=(marker_id,),
    )


@dataclass(frozen=True, slots=True)
class MarkerObs:
    """One detected gate marker as reported in a :class:`DetectionEvent`.

    Corner fiducials (IDs 0-3) are never reported here. Tiles on a row carry
    ``row``/``col`` (``col`` clustered from THIS frame's tiles, #109 — display
    only; the circuit's columns come from the stable set); tiles on the board
    but on no row carry ``off_grid=True`` and leave ``row``/``col`` as
    ``None``. Serialized to the camelCase
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
    #: Wires with a paired measurement block (task #97) — a refinement counter,
    #: never a qubit count. ``None`` when no wire blocks drive the rows.
    measures: int | None = None
    #: Measurement blocks that matched no wire and were ignored (task #97).
    unpaired_measures: int = 0
    #: Furniture blocks seen OFF the board and dropped — the spare wire /
    #: measurement blocks lying beside it. Never an error, just a count.
    stray_furniture: int = 0
    #: Gate tiles seen OFF the board and dropped — the unused kit inventory on
    #: the table. Deliberately NOT ``off_grid``: they are not misplaced, they
    #: are simply not in play.
    stray_tiles: int = 0
    #: The camera source delivered no frame for :data:`CAMERA_STALL_S` and is
    #: being reopened (``fps`` is then 0). Cleared by the next real frame.
    camera_lost: bool = False


def _describe(source: FrameSource) -> str:
    try:
        return source.describe()
    except Exception:  # pragma: no cover - describe is best-effort
        return type(source).__name__


def _wire_ends(
    wire_ys: tuple[float, ...] | None,
    observed: list[tuple[float, float]],
    grid: GridConfig,
) -> list[tuple[float, float]]:
    """The wires' LEFT endpoints ``(x, y)`` — block centres where available.

    The wire set is stabilized as y positions alone (#95), which is all the
    qubit count ever needed; the segment a measurement block completes (#97)
    also wants the left block's x. Each stable y therefore takes the x of the
    wire block observed nearest to it on this frame, and falls back to the
    lattice's left edge for a wire whose block is momentarily hidden — a
    fallback that only shifts the segment's origin along its own axis, never its
    height.
    """
    ends: list[tuple[float, float]] = []
    for y in wire_ys or ():
        if observed:
            x, _oy = min(observed, key=lambda p: abs(p[1] - y))
        else:
            x = grid.grid_offset_x
        ends.append((x, y))
    return ends


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
        self._measure_stabilizer = MeasureStabilizer()
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
        self._watchdog: threading.Thread | None = None

        # Per-run state (reset in start()).
        self._fps = 0.0
        self._last_frame_time: float | None = None
        self._last_circuit: dict[str, Any] | None = None
        self._structural_warnings: list[BuildWarning] = []
        self._emitted = False
        # Board-loss grace (BOARD_LOSS_GRACE_S): timestamp of the first frame
        # of the current no-board streak, and whether that streak has already
        # cleared the circuit.
        self._board_missing_since: float | None = None
        self._board_cleared = False
        # Camera stall watchdog (CAMERA_STALL_S). Guarded by _stall_lock: the
        # worker and the watchdog thread both check for a stall.
        self._stall_lock = threading.Lock()
        self._last_frame_at = monotonic()
        self._camera_lost = False
        self._next_reopen_at = 0.0
        self._reopen_delay = CAMERA_REOPEN_INITIAL_S

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
        self._measure_stabilizer.reset()
        self._rect = mat_rect(self._board_config)
        self._model = mat_board_model(self._board_config)
        self._reset_board_loss()
        self._reset_stall(monotonic())
        self._thread = threading.Thread(
            target=self._run, name="qamposer-pipeline", daemon=True
        )
        self._thread.start()
        self._watchdog = threading.Thread(
            target=self._watch, name="qamposer-camera-watchdog", daemon=True
        )
        self._watchdog.start()

    def stop(self) -> None:
        """Signal the worker to stop and join it. Idempotent."""
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=2.0)
            if thread.is_alive():  # pragma: no cover - worker should exit promptly
                logger.warning("pipeline worker did not stop within 2s")
        self._thread = None
        watchdog = self._watchdog
        if watchdog is not None:
            watchdog.join(timeout=2.0)
        self._watchdog = None
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
        self._measure_stabilizer.reset()
        self._reset_board_loss()
        # A new source gets a fresh stall budget; the next frame (or the next
        # stall) re-reports its state.
        self._reset_stall(monotonic())
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
            now = monotonic()
            if frame is None:
                self._on_no_frame(source, now)
                sleep(_IDLE_SLEEP)
                continue
            self._on_frame_arrived(now)
            try:
                self._process_frame(frame, source, now)
            except Exception:
                logger.exception("pipeline frame processing failed")
                # keep the loop alive; drop this frame

    def _watch(self) -> None:
        """Watchdog thread: report a stall even while ``read()`` is blocked."""
        while not self._stop.wait(_WATCHDOG_INTERVAL):
            with self._lock:
                source = self._source
            try:
                self._check_stall(source, monotonic())
            except Exception:  # pragma: no cover - the watchdog must not die
                logger.exception("camera watchdog check failed")

    # -- camera stall (CAMERA_STALL_S) --------------------------------------

    @property
    def camera_lost(self) -> bool:
        """``True`` while the camera is reported lost and being reopened."""
        return self._camera_lost

    def _reset_stall(self, now: float) -> None:
        with self._stall_lock:
            self._last_frame_at = now
            self._camera_lost = False
            self._reopen_delay = CAMERA_REOPEN_INITIAL_S
            self._next_reopen_at = 0.0

    def _on_frame_arrived(self, now: float) -> None:
        """A frame came in: refresh the stall clock and clear a lost camera."""
        with self._stall_lock:
            self._last_frame_at = now
            if not self._camera_lost:
                return
            self._camera_lost = False
            self._reopen_delay = CAMERA_REOPEN_INITIAL_S
            self._next_reopen_at = 0.0
        logger.info("camera recovered; resuming detection")
        # The outage is not evidence about the board: restart its grace clock
        # on the first real frame instead of counting the dead seconds.
        self._reset_board_loss()

    def _on_no_frame(self, source: FrameSource, now: float) -> None:
        """Worker idle step: report a stall, and reopen a lost camera when due."""
        self._check_stall(source, now)
        self._maybe_reopen(source, now)

    def _check_stall(self, source: FrameSource, now: float) -> bool:
        """Flag a camera that delivered no frame for :data:`CAMERA_STALL_S`.

        Emits exactly one lost ``DetectionEvent`` (``fps=0``,
        ``camera_lost=True``) per outage — the host bridges the transition to
        a ``status`` broadcast — and schedules the first reopen immediately.
        Returns ``True`` on the call that flagged the stall.
        """
        if getattr(source, "source_kind", None) != "camera":
            return False
        with self._stall_lock:
            if self._camera_lost or now - self._last_frame_at <= CAMERA_STALL_S:
                return False
            self._camera_lost = True
            self._next_reopen_at = now
            self._reopen_delay = CAMERA_REOPEN_INITIAL_S
            self._fps = 0.0
            self._last_frame_time = None
        logger.warning(
            "camera delivered no frame for %.1fs (%s); reporting lost, reopening",
            now - self._last_frame_at,
            _describe(source),
        )
        self._emit_camera_lost()
        return True

    def _maybe_reopen(self, source: FrameSource, now: float) -> bool:
        """Retry a lost camera on the capped exponential backoff schedule.

        Runs on the worker thread only (never concurrently with ``read()``).
        Returns ``True`` when an attempt was made. Success is NOT judged by
        ``reopen()``'s return value: an opened device that still delivers
        nothing gets retried again — only a real frame clears the flag.
        """
        reopen = getattr(source, "reopen", None)
        if reopen is None:
            return False
        with self._stall_lock:
            if not self._camera_lost or now < self._next_reopen_at:
                return False
            delay = self._reopen_delay
            self._next_reopen_at = now + delay
            self._reopen_delay = min(delay * 2.0, CAMERA_REOPEN_MAX_S)
        try:
            opened = bool(reopen())
        except Exception:
            logger.warning("camera reopen raised", exc_info=True)
            opened = False
        logger.info(
            "camera reopen %s; next attempt in %.0fs if still no frames",
            "opened the device" if opened else "failed",
            delay,
        )
        return True

    def _emit_camera_lost(self) -> None:
        if self._on_detection is None:
            return
        model = self._model
        self._on_detection(
            DetectionEvent(
                fps=0.0,
                board_found=False,
                corners=0,
                reprojection_error_mm=None,
                board_layout=model.kind,
                rows=model.rows,
                cols=model.cols,
                wires=model.wire_count,
                measures=model.measure_count,
                camera_lost=True,
            )
        )

    # -- board loss (BOARD_LOSS_GRACE_S) ------------------------------------

    def _reset_board_loss(self) -> None:
        self._board_missing_since = None
        self._board_cleared = False

    def _board_loss(self, board_found: bool, now: float) -> tuple[bool, bool]:
        """Advance the board-loss clock: ``(hold, clear)`` for this frame.

        ``hold`` — the board is out of sight but for less than
        :data:`BOARD_LOSS_GRACE_S`: keep the last stable board untouched.
        ``clear`` — the grace just ran out on this frame: clear the circuit
        once, exactly as the old frame-count wipe ended up doing. Afterwards a
        still-missing board is processed as before (nothing left to clear).
        """
        if board_found:
            self._reset_board_loss()
            return False, False
        if self._board_missing_since is None:
            self._board_missing_since = now
        if now - self._board_missing_since < BOARD_LOSS_GRACE_S:
            return True, False
        if self._board_cleared:
            return False, False
        self._board_cleared = True
        return False, True

    def _process_frame(
        self, frame: np.ndarray, source: FrameSource, now: float | None = None
    ) -> None:
        """Run one frame through the loop. ``now`` is the frame's monotonic
        timestamp (seconds); tests inject it to script time."""
        if now is None:
            now = monotonic()
        self._update_fps(now)

        markers = self._detector.detect(frame)
        corners = sum(1 for m in markers if m.id in CORNER_IDS)

        # 1. What rectangle do the corner blocks actually span? (task #94)
        self._update_rect(markers)
        board = fit_board(markers, self._board_config, self._rect)
        hold, clear = self._board_loss(board is not None, now)

        # 2. Qubit-wire blocks, read in the rectangle's own board frame (#95),
        #    then measurement blocks refining them (#97). The pre-wire model
        #    supplies the "left of the grid" / "right of the last column"
        #    thresholds; the stabilized wire set decides the rows, and the
        #    stabilized measurement set only tilts wires that have one.
        base = build_board_model(self._board_config, self._rect, self._board_layout)
        wire_changed = False
        furniture_warnings: list[BuildWarning] = []
        strays = 0
        if board is not None:
            wire_obs = wire_points(markers, board, base.grid, base.rect)
            wires = self._wire_stabilizer.update(y for _x, y in wire_obs)
            wire_changed = wires.changed
            measures = self._measure_stabilizer.update(
                measure_points(markers, board, base.grid, base.rect)
            )
            spans, furniture_warnings = self._pair_measures(
                wires.wires, wire_obs, measures.points, base
            )
            stray_blocks = stray_furniture(markers, board, base.rect)
            strays = len(stray_blocks)
            furniture_warnings += stray_furniture_warnings(stray_blocks)
            self._model = build_board_model(
                self._board_config,
                self._rect,
                self._board_layout,
                wires.wires,
                wire_spans=spans,
            )
        elif not hold:
            self._model = base
        # (hold: the last board's model stays, so the lattice and qubit count
        # do not flicker while the board is briefly out of sight)

        grid = GridMapper(self._model.grid)
        rect = base.rect if board is not None else None
        observations, marker_obs, off_grid_warnings, stray_tiles = self._map_markers(
            markers, board, grid, rect
        )
        if stray_tiles:
            off_grid_warnings.append(stray_tiles_warning(stray_tiles))

        if hold:
            # Board out of sight, grace not over: the tile stabilizer is not
            # fed at all, so no tile's absence streak advances and the board
            # comes back exactly as it left.
            stable = self._stabilizer.stable
            changed = False
        else:
            # Grace over: clear the stable set once — what the 12-frame wipe
            # did, now on the clock. A forced rebuild only when there was
            # something to clear, so an already-empty board emits nothing.
            cleared = clear and bool(self._stabilizer.stable)
            if clear:
                self._stabilizer.reset()
            result = self._stabilizer.update(observations)
            stable = result.stable
            changed = result.changed or cleared
        if changed or wire_changed or not self._emitted:
            self._rebuild_and_maybe_emit(stable, source)

        detection_warnings = self._compose_warnings(
            off_grid_warnings + furniture_warnings
        )
        self._store_annotated(frame, markers, board, stable, detection_warnings)

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
                    measures=self._model.measure_count,
                    unpaired_measures=sum(
                        1 for w in furniture_warnings if w.kind == "unpaired_measure"
                    ),
                    stray_furniture=strays,
                    stray_tiles=stray_tiles,
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

    def _pair_measures(
        self,
        wire_ys: tuple[float, ...] | None,
        wire_obs: list[tuple[float, float]],
        measures: tuple[tuple[float, float], ...],
        base: BoardModel,
    ) -> tuple[
        tuple[tuple[float, float, float, float] | None, ...] | None,
        list[BuildWarning],
    ]:
        """Match measurement blocks to wires and report what did not match (#97).

        Returns the per-wire spans for :func:`build_board_model` and the
        warnings the detection message carries. Measurement blocks are a
        refinement: with no wire blocks on the table there is nothing to refine,
        so every right block is simply reported as unpaired and the model is
        untouched.
        """
        if not measures:
            return None, []
        wires = _wire_ends(wire_ys, wire_obs, base.grid)
        pairing = pair_measures(wires, list(measures), pair_tolerance(base.grid))
        warnings = [
            BuildWarning(
                kind="unpaired_measure",
                message=(
                    f"Measurement block at board ({x:.0f}, {y:.0f}) mm has no "
                    "qubit-wire block across from it; ignored (the left side "
                    "sets the wires)."
                ),
                marker_ids=(MEASURE_BLOCK_ID,),
            )
            for x, y in pairing.unpaired
        ]
        if pairing.paired == 0:
            return None, warnings
        warnings += self._span_consistency_warnings(pairing, base)
        return pairing.spans, warnings

    def _span_consistency_warnings(
        self, pairing: MeasurePairing, base: BoardModel
    ) -> list[BuildWarning]:
        """Sanity-check the measured left→right run against the estimated width.

        In ``grid`` layout the *column count* is derived from the rectangle the
        corner blocks span, so the furniture and the corners are two independent
        measurements of one board and it is worth saying when they cannot both
        be true. The bound is deliberately loose — where along each edge the
        blocks sit is up to the user — so only the impossible is flagged: a run
        WIDER than the whole rectangle (the estimate must be wrong), or one
        under :data:`SPAN_MIN_FRACTION` of it (the blocks are bunched somewhere
        in the middle, not on the edges). Warning only: the corners stay
        authoritative, because they are what the homography is fitted to.
        """
        span = pairing.mean_span
        if base.kind != "grid" or span is None:
            return []
        width = base.rect.width
        if SPAN_MIN_FRACTION * width <= span <= width:
            return []
        return [
            BuildWarning(
                kind="measure_span_mismatch",
                message=(
                    f"Measurement blocks sit {span:.0f} mm from the wire blocks, "
                    f"but the corner blocks span only {width:.0f} mm; the "
                    "corners win. Check the blocks are on the board's edges."
                ),
                marker_ids=(QUBIT_WIRE_ID, MEASURE_BLOCK_ID),
            )
        ]

    def _update_fps(self, now: float) -> None:
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
        rect: BoardRect | None = None,
    ) -> tuple[set[Tile], list[MarkerObs], list[BuildWarning], int]:
        """Map gate tiles onto rows + x buckets; also count the ones off the board.

        Each accepted tile is observed as ``(marker_id, row, x_bucket,
        rotation)`` — an absolute x bucket, not a column (see
        :data:`X_BUCKET_MM` for why the key must be insertion-invariant). The
        columns reported in the ``MarkerObs`` debug rows are clustered from
        this frame's accepted tiles alone and are display-only.

        Two different failures, deliberately told apart (#97 follow-up):

        * a tile whose centre is **off the board** (outside ``rect`` by more
          than :data:`~.board.BOARD_MARGIN_MM`) is dropped *silently* — no
          warning, no ``MarkerObs``, nothing in the stabilizer. That is the
          booth case: the unused kit lies on the table right next to the board,
          and it must not spam warnings or wobble the hysteresis. Only the
          count leaves this function.
        * a tile **on the board** that lands on no row (between two wires or
          lattice rows) keeps its ``off_grid`` warning and its debug-table row.
          That one is a real "you misplaced a tile" signal and is worth the
          noise. No x position is rejected: columns are clustered (#109).
        """
        if grid is None:
            grid = GridMapper(self._model.grid)
        observations: set[Tile] = set()
        marker_obs: list[MarkerObs] = []
        off_grid_warnings: list[BuildWarning] = []
        stray_tiles = 0
        # (index into marker_obs, marker id, row, x) of each accepted tile, so
        # the debug rows can get this frame's clustered columns afterwards.
        accepted: list[tuple[int, int, int, float]] = []

        for marker in markers:
            if marker.id in CORNER_IDS or marker.id not in MARKER_TABLE:
                continue  # corner fiducial or unknown ID: not a gate tile
            if board is None:
                marker_obs.append(MarkerObs(id=marker.id, off_grid=True))
                continue
            board_xy = board.image_to_board(marker.center)[0]
            if rect is not None and not on_board(
                float(board_xy[0]), float(board_xy[1]), rect
            ):
                stray_tiles += 1
                continue
            x_mm, y_mm = float(board_xy[0]), float(board_xy[1])
            row = grid.assign_row(x_mm, y_mm)
            if row is None:
                marker_obs.append(MarkerObs(id=marker.id, off_grid=True))
                off_grid_warnings.append(off_grid_warning(marker.id, x_mm, y_mm))
                continue
            # Dial tiles carry their board-frame rotation (0-7, 45° steps) in the
            # stability key so turning one in place re-emits; every other tile
            # pins rotation 0.
            spec = MARKER_TABLE[marker.id]
            rot = board.marker_rotation(marker) if spec.dial_axis is not None else 0
            observations.add((marker.id, row, x_bucket(x_mm), rot))
            accepted.append((len(marker_obs), marker.id, row, x_mm))
            marker_obs.append(MarkerObs(id=marker.id, row=row))

        cfg = grid.config
        cols = cluster_columns(
            [x for _i, _mid, _row, x in accepted], cfg.pitch, cfg.first_center_x
        )
        for (i, mid, row, _x), col in zip(accepted, cols):
            marker_obs[i] = MarkerObs(id=mid, row=row, col=col)

        return observations, marker_obs, off_grid_warnings, stray_tiles

    def _stable_placements(self, stable: frozenset[Tile]) -> list[TilePlacement]:
        """Resolve the stable ``(id, row, x_bucket, rot)`` set into placements.

        Columns are clustered from the stable tiles' bucket centres (#109), so
        they follow the whole stable board and nothing else. Two keys of one
        tile that straddle a bucket boundary land in the same column and
        collapse to one placement, exactly as a single key did before.
        """
        tiles = sorted(stable)
        cfg = self._model.grid
        cols = cluster_columns(
            [bucket * X_BUCKET_MM for (_mid, _row, bucket, _rot) in tiles],
            cfg.pitch,
            cfg.first_center_x,
        )
        unique = {
            (mid, row, col, rot)
            for (mid, row, _bucket, rot), col in zip(tiles, cols)
        }
        return [
            TilePlacement(marker_id=mid, row=row, col=col, rotation=rot)
            for (mid, row, col, rot) in sorted(unique)
        ]

    def _rebuild_and_maybe_emit(
        self, stable: frozenset[Tile], source: FrameSource
    ) -> None:
        placements = self._stable_placements(stable)
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
        occupied = {(p.row, p.col) for p in self._stable_placements(stable)}
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
