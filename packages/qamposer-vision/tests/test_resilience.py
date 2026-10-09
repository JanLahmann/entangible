"""Booth resilience: the board-loss grace and the camera-stall watchdog.

Board loss is mirrored 1:1 in ``pocket-app/tests/boardLoss.test.ts`` — same
constants, same scripted sequences, same frame rates. The camera watchdog is
host-only (the browser owns the pocket camera), so it has no TS twin.
"""

from __future__ import annotations

import threading
import time

import numpy as np
import pytest

from qamposer_vision import pipeline as pipeline_mod
from qamposer_vision import sources as sources_mod
from qamposer_vision.board import BoardConfig
from qamposer_vision.detector import ArucoDetector
from qamposer_vision.pipeline import (
    BOARD_LOSS_GRACE_S,
    CAMERA_REOPEN_INITIAL_S,
    CAMERA_REOPEN_MAX_S,
    CAMERA_STALL_S,
    CircuitEvent,
    DetectionEvent,
    Pipeline,
)
from qamposer_vision.sources import Cv2CaptureSource, PushFrameSource

from tests.utils.render_board import RenderOptions, render_board


def test_constants_are_the_documented_ones() -> None:
    # Pinned: the TS twin asserts the same numbers (boardLoss.test.ts).
    assert BOARD_LOSS_GRACE_S == 2.0
    assert CAMERA_STALL_S == 2.0
    assert (CAMERA_REOPEN_INITIAL_S, CAMERA_REOPEN_MAX_S) == (1.0, 10.0)


# ---------------------------------------------------------------------------
# Board loss — HOLD for BOARD_LOSS_GRACE_S, then clear exactly once
# ---------------------------------------------------------------------------

_BELL = ((30, 0, 0), (17, 0, 1), (15, 1, 1))


class _ScriptedDetector:
    """Detect each distinct frame once (rendered stills are deterministic)."""

    def __init__(self) -> None:
        self._real = ArucoDetector()
        self._cache: dict[int, list] = {}

    def detect(self, frame):
        key = id(frame)
        if key not in self._cache:
            self._cache[key] = self._real.detect(frame)
        return self._cache[key]


@pytest.fixture(scope="module")
def frames():
    config = BoardConfig.from_toml()
    bell = render_board(_BELL, config, RenderOptions(px_per_mm=2.0))
    # The same tiles, but a visitor's arm hides three corner blocks: < 3
    # corners, so no board can be fitted.
    occluded = render_board(_BELL, config, RenderOptions(px_per_mm=2.0, corners=(0,)))
    return config, bell, occluded


class _Run:
    """Drive one pipeline through a scripted, timestamped frame sequence."""

    def __init__(self, config, fps: float) -> None:
        self.fps = fps
        self.i = 0  # frame index; t = i / fps (no accumulated float drift)
        self.circuits: list[tuple[float, CircuitEvent]] = []
        self.detections: list[DetectionEvent] = []
        self.source = PushFrameSource()
        self.pipeline = Pipeline(
            self.source,
            board_config=config,
            on_circuit=lambda e: self.circuits.append((self.now, e)),
            on_detection=self.detections.append,
        )
        self.pipeline._detector = _ScriptedDetector()  # type: ignore[assignment]

    @property
    def now(self) -> float:
        return self.i / self.fps

    def feed(self, frame) -> None:
        self.pipeline._process_frame(frame, self.source, self.now)
        self.i += 1

    def feed_for(self, frame, seconds: float) -> float:
        """Feed ``frame`` at the run's rate while elapsed < ``seconds``.

        Returns the timestamp of the first frame fed.
        """
        start = self.now
        while self.now - start < seconds:
            self.feed(frame)
        return start


def _gates(evt: CircuitEvent) -> list[tuple[str, int]]:
    return sorted((g["type"], g["position"]) for g in evt.circuit["gates"])


@pytest.mark.parametrize("fps", [4.0, 30.0, 128.0])
def test_brief_board_loss_holds_the_circuit(frames, fps: float) -> None:
    """Bell stable → 1.9 s with < 3 corners → board back: nothing happens.

    At 30 fps that is 57 frames — the old 12-frame rule wiped the circuit
    after 0.4 s. No circuit event, no re-emission, the stable set untouched.
    """
    config, bell, occluded = frames
    run = _Run(config, fps)
    for _ in range(10):
        run.feed(bell)
    assert [_gates(e) for _t, e in run.circuits] == [[], [("CNOT", 1), ("H", 0)]]
    settled = run.pipeline._stabilizer.stable
    rows_before = run.detections[-1].rows
    n_circuits, n_det = len(run.circuits), len(run.detections)

    run.feed_for(occluded, 1.9)
    held = run.detections[n_det:]
    assert held and all(not d.board_found for d in held)
    assert all(d.corners < 3 for d in held)
    # The last board's lattice is held too (no qubit-count flicker).
    assert {d.rows for d in held} == {rows_before}
    assert run.pipeline._stabilizer.stable == settled

    for _ in range(10):
        run.feed(bell)
    assert len(run.circuits) == n_circuits  # no change, no re-emission
    assert run.pipeline._stabilizer.stable == settled
    assert run.detections[-1].board_found


@pytest.mark.parametrize("fps", [4.0, 30.0, 128.0])
def test_board_gone_past_the_grace_clears_once(frames, fps: float) -> None:
    """Bell stable → 2.1 s with < 3 corners ⇒ cleared at the 2.0 s mark."""
    config, bell, occluded = frames
    run = _Run(config, fps)
    for _ in range(10):
        run.feed(bell)
    n_circuits = len(run.circuits)

    first_missing = run.feed_for(occluded, 2.1)
    assert len(run.circuits) == n_circuits + 1  # exactly one clear
    t_clear, cleared = run.circuits[-1]
    assert cleared.circuit["gates"] == []
    elapsed = t_clear - first_missing
    assert BOARD_LOSS_GRACE_S <= elapsed < BOARD_LOSS_GRACE_S + 1.0 / fps + 1e-9
    assert run.pipeline._stabilizer.stable == frozenset()

    # Back with the same tiles: re-appears through the normal debounce.
    for _ in range(10):
        run.feed(bell)
    assert len(run.circuits) == n_circuits + 2
    assert _gates(run.circuits[-1][1]) == [("CNOT", 1), ("H", 0)]


def test_flicker_restarts_the_grace_clock(frames) -> None:
    # 1.5 s gone, one frame of board, 1.5 s gone again: never 2 s continuous.
    config, bell, occluded = frames
    run = _Run(config, 30.0)
    for _ in range(10):
        run.feed(bell)
    n = len(run.circuits)
    run.feed_for(occluded, 1.5)
    run.feed(bell)
    run.feed_for(occluded, 1.5)
    for _ in range(5):
        run.feed(bell)
    assert len(run.circuits) == n


def test_empty_board_lost_emits_nothing(frames) -> None:
    # Nothing to clear → the expiry must not invent a change.
    config, _bell, _occluded = frames
    empty = render_board((), config, RenderOptions(px_per_mm=2.0))
    gone = render_board((), config, RenderOptions(px_per_mm=2.0, corners=(0,)))
    run = _Run(config, 30.0)
    for _ in range(10):
        run.feed(empty)
    n = len(run.circuits)
    run.feed_for(gone, 3.0)
    assert len(run.circuits) == n


# ---------------------------------------------------------------------------
# Camera stall — report lost (fps 0), reopen with capped backoff, recover
# ---------------------------------------------------------------------------


class _DeadCamera:
    """A camera-kind source that never delivers; records reopen attempts."""

    source_kind = "camera"
    fps_hint = None

    def __init__(self) -> None:
        self.reopens: list[float] = []
        self.clock = 0.0

    def read(self):
        return None

    def reopen(self) -> bool:
        self.reopens.append(self.clock)
        return False

    def describe(self) -> str:
        return "dead test camera"

    def close(self) -> None:
        pass


def _idle(p: Pipeline, src: _DeadCamera, t0: float, t1: float, step: float = 0.0625):
    # A binary-exact step, so scheduled retry times are hit to the bit.
    k = 0
    while t0 + k * step <= t1:
        src.clock = t0 + k * step
        p._on_no_frame(src, src.clock)
        k += 1


def test_stall_reports_once_then_reopens_with_capped_backoff() -> None:
    events: list[DetectionEvent] = []
    src = _DeadCamera()
    p = Pipeline(src, on_detection=events.append)
    p._reset_stall(100.0)

    _idle(p, src, 100.0, 101.9375)
    assert events == [] and src.reopens == []  # within the 2 s budget

    _idle(p, src, 102.0, 160.0)
    assert len(events) == 1  # one report per outage, not one per poll
    lost = events[0]
    assert lost.camera_lost and lost.fps == 0.0 and not lost.board_found
    assert p.camera_lost
    # First attempt at the moment the stall is flagged, then 1, 2, 4, 8, 10, 10…
    gaps = np.diff(src.reopens)
    assert src.reopens[0] == 102.0625
    assert list(gaps[:7]) == [1.0, 2.0, 4.0, 8.0, 10.0, 10.0, 10.0]

    # A frame arrives: the flag clears, and the next detection says so.
    p._on_frame_arrived(160.0)
    assert not p.camera_lost
    # A second outage starts the backoff over at 1 s.
    src.reopens.clear()
    _idle(p, src, 160.0, 166.0)
    assert len(events) == 2 and events[1].camera_lost
    assert list(np.diff(src.reopens)) == [1.0, 2.0]


def test_replay_and_push_sources_are_exempt() -> None:
    events: list[DetectionEvent] = []
    src = PushFrameSource()
    p = Pipeline(src, on_detection=events.append)
    p._reset_stall(0.0)
    for k in range(400):
        p._on_no_frame(src, k * 0.1)
    assert events == [] and not p.camera_lost


class _FakeCapture:
    """Stands in for ``cv2.VideoCapture``; a shared switch kills / revives it."""

    instances: list["_FakeCapture"] = []
    alive = threading.Event()
    block = threading.Event()  # when set, read() hangs like a frozen driver
    release_block = threading.Event()

    def __init__(self, index) -> None:
        self.index = index
        self.released = False
        self.props: dict[int, float] = {}
        _FakeCapture.instances.append(self)

    def isOpened(self) -> bool:  # noqa: N802 - cv2 API
        return not self.released

    def set(self, prop, value) -> bool:
        self.props[prop] = value
        return True

    def get(self, prop) -> float:
        return 0.0

    def read(self):
        if _FakeCapture.block.is_set():
            _FakeCapture.release_block.wait(5.0)
            return False, None
        time.sleep(0.005)
        if _FakeCapture.alive.is_set():
            return True, np.full((48, 64, 3), 255, dtype=np.uint8)
        return False, None

    def release(self) -> None:
        self.released = True


@pytest.fixture
def fake_cv2(monkeypatch):
    _FakeCapture.instances = []
    _FakeCapture.alive.set()
    _FakeCapture.block.clear()
    _FakeCapture.release_block.clear()
    monkeypatch.setattr(sources_mod.cv2, "VideoCapture", _FakeCapture)
    # Shrink the clocks so the threaded tests run in well under a second.
    monkeypatch.setattr(pipeline_mod, "CAMERA_STALL_S", 0.3)
    monkeypatch.setattr(pipeline_mod, "CAMERA_REOPEN_INITIAL_S", 0.1)
    monkeypatch.setattr(pipeline_mod, "_WATCHDOG_INTERVAL", 0.05)
    yield _FakeCapture
    _FakeCapture.release_block.set()


def test_cv2_source_reopen_releases_and_reopens(fake_cv2) -> None:
    src = Cv2CaptureSource(3, width=640, height=480)
    first = fake_cv2.instances[-1]
    assert src.reopen() is True
    second = fake_cv2.instances[-1]
    assert first.released and second is not first and second.index == 3
    assert set(second.props.values()) == {640, 480}


def _wait_for(pred, timeout: float = 5.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if pred():
            return True
        time.sleep(0.01)
    return False


def test_unplugged_camera_is_reported_reopened_and_recovers(fake_cv2) -> None:
    events: list[DetectionEvent] = []
    lock = threading.Lock()

    def on_detection(e: DetectionEvent) -> None:
        with lock:
            events.append(e)

    def snapshot() -> list[DetectionEvent]:
        with lock:
            return list(events)

    p = Pipeline(Cv2CaptureSource(0), on_detection=on_detection)
    p.start()
    try:
        assert _wait_for(lambda: any(e.fps > 0 for e in snapshot()))
        fake_cv2.alive.clear()  # unplug
        assert _wait_for(lambda: any(e.camera_lost for e in snapshot()))
        lost = next(e for e in snapshot() if e.camera_lost)
        assert lost.fps == 0.0
        # The worker retries: new VideoCapture objects keep being opened.
        assert _wait_for(lambda: len(fake_cv2.instances) >= 3)
        fake_cv2.alive.set()  # plug back in
        assert _wait_for(lambda: not p.camera_lost)
        assert _wait_for(
            lambda: any(
                not e.camera_lost and e.fps > 0
                for e in snapshot()[snapshot().index(lost) + 1 :]
            )
        )
    finally:
        p.stop()
    assert not any(
        t.name in ("qamposer-pipeline", "qamposer-camera-watchdog")
        for t in threading.enumerate()
    )


def test_watchdog_reports_while_read_is_blocked(fake_cv2) -> None:
    # A frozen driver: read() hangs. The worker is stuck inside it, so only the
    # watchdog thread can say so — and it must, within the stall budget.
    events: list[DetectionEvent] = []
    p = Pipeline(Cv2CaptureSource(0), on_detection=events.append)
    p.start()
    try:
        assert _wait_for(lambda: len(events) > 0)
        fake_cv2.block.set()
        assert _wait_for(lambda: any(e.camera_lost for e in events), timeout=3.0)
    finally:
        fake_cv2.release_block.set()
        fake_cv2.block.clear()
        p.stop()
