"""End-to-end pipeline tests over the bell-sequence replay recording.

Run on both copies: the full-size PNG fixture generated on demand
(tests/fixtures/recordings, never committed) and the committed demo loop
(examples/recordings, small JPEGs) that installs replay with no generation.
"""

from __future__ import annotations

import threading
import time
import warnings

import pytest

from qamposer_vision.board import BoardConfig, fit_board
from qamposer_vision.detector import ArucoDetector
from qamposer_vision.grid import GridConfig
from qamposer_vision.pipeline import (
    X_BUCKET_MM,
    CircuitEvent,
    DetectionEvent,
    Pipeline,
    x_bucket,
)
from qamposer_vision.sources import PushFrameSource, ReplaySource

from tests.utils.make_recording import EXAMPLE_DIR, OUTPUT_DIR, make_recording
from tests.utils.render_board import RenderOptions, render_board


@pytest.fixture(scope="module", params=["generated", "example"])
def recording_dir(request):
    if request.param == "example":
        # Committed: must work as checked out (an offline install replays it).
        return EXAMPLE_DIR
    # PNG frames are gitignored; (re)generate them deterministically for the test.
    make_recording(OUTPUT_DIR)
    return OUTPUT_DIR


def test_example_recording_is_committed_and_compact() -> None:
    # The documented demo source replay:examples/recordings/bell-sequence:
    # every frame of the sequence, JPEG only, and small enough to commit.
    frames = sorted(EXAMPLE_DIR.iterdir())
    assert [f.name for f in frames] == [f"frame_{i:04d}.jpg" for i in range(48)]
    assert sum(f.stat().st_size for f in frames) < 2_000_000
    assert ReplaySource(EXAMPLE_DIR).frame_count == 48


def _gate_types(circuit: dict) -> list[str]:
    return [g["type"] for g in circuit["gates"]]


def test_pipeline_maps_dial_rotation_into_stability_key() -> None:
    # A dial tile's board-frame rotation must reach the stabilizer observation
    # tuple as (id, row, x_bucket, rot); a plain tile pins rot=0. The x is the
    # absolute 10 mm bucket of the tile centre (#109), not a column.
    config = BoardConfig.from_toml()
    detector = ArucoDetector()
    pipeline = Pipeline(PushFrameSource(), board_config=config)
    bucket = x_bucket(GridConfig.from_board_config(config).cell_center(0, 0)[0])

    for rotation in range(4):
        img = render_board(((42, 0, 0, rotation),), config, RenderOptions())
        markers = detector.detect(img)
        board = fit_board(markers, config)
        observations, _obs, _warn, _stray = pipeline._map_markers(markers, board)
        assert observations == {(42, 0, bucket, rotation)}

    # A non-dial tile always carries rotation 0, whatever way it is turned.
    img = render_board(((30, 0, 0, 2),), config, RenderOptions())
    markers = detector.detect(img)
    board = fit_board(markers, config)
    observations, _obs, _warn, _stray = pipeline._map_markers(markers, board)
    assert observations == {(30, 0, bucket, 0)}


class _ScriptedDetector:
    """Stands in for ArucoDetector: each frame's markers were detected once."""

    def __init__(self, scenes: dict[int, list]) -> None:
        self._scenes = scenes

    def detect(self, frame):
        return self._scenes[id(frame)]


def test_inserting_a_tile_left_of_all_others_never_drops_another() -> None:
    """Insertion invariance (#109): only the new tile's key ever changes.

    A stable Bell pair starts in lattice column 0. Then an X tile is placed
    LEFT of everything — left of the lattice's first column, so it clamps to
    column 0 and every existing gate's circuit column shifts right by one. The
    hand placing it flickers it in and out for a few frames. Because tiles are
    stabilized by absolute x bucket, not by column, no existing tile may leave
    the stable set on any frame, every emitted circuit keeps the whole Bell
    pair, and exactly one new circuit is emitted for the insertion.
    """
    config = BoardConfig.from_toml()
    grid = GridConfig.from_board_config(config)
    detector = ArucoDetector()
    bell = ((30, 0, 0), (17, 0, 1), (15, 1, 1))
    cx0, cy2 = grid.cell_center(2, 0)
    left_x = cx0 - grid.pitch  # one pitch left of column 0's centre
    frame_a = render_board(bell, config, RenderOptions())
    frame_b = render_board(bell, config, RenderOptions(extra_mm=((35, left_x, cy2),)))
    scenes = {id(frame_a): detector.detect(frame_a), id(frame_b): detector.detect(frame_b)}

    events: list[CircuitEvent] = []
    source = PushFrameSource()
    pipeline = Pipeline(source, board_config=config, on_circuit=events.append)
    pipeline._detector = _ScriptedDetector(scenes)  # type: ignore[assignment]

    for _ in range(15):
        pipeline._process_frame(frame_a, source)
    settled = pipeline._stabilizer.stable
    assert len(settled) == 3
    assert {(mid, row) for (mid, row, _b, _r) in settled} == {(30, 0), (17, 0), (15, 1)}
    before = len(events)
    assert _gate_types(events[-1].circuit) == ["H", "CNOT"]

    flicker = [frame_b, frame_a, frame_b, frame_b, frame_a, frame_b, frame_a, frame_b]
    script = flicker + [frame_b] * 20
    for frame in script:
        pipeline._process_frame(frame, source)
        # Every Bell tile keeps its exact key through the whole transition.
        assert settled <= pipeline._stabilizer.stable

    new_events = events[before:]
    assert len(new_events) == 1
    final = new_events[0].circuit
    for evt in events[before - 1 :]:
        gates = {(g["type"], g.get("qubit"), g.get("control"), g.get("target"))
                 for g in evt.circuit["gates"]}
        assert ("H", 0, None, None) in gates
        assert ("CNOT", None, 0, 1) in gates
    # The X took column 0; the Bell pair moved right as a block.
    assert sorted(
        (g["type"], g["position"]) for g in final["gates"]
    ) == [("CNOT", 2), ("H", 1), ("X", 0)]
    # ... and its key is its own absolute bucket (measured x within a bucket).
    ((mid, row, bucket, rot),) = pipeline._stabilizer.stable - settled
    assert (mid, row, rot) == (35, 2, 0)
    assert abs(bucket * X_BUCKET_MM - left_x) <= X_BUCKET_MM


def test_pipeline_emits_empty_then_h_then_bell(recording_dir) -> None:
    circuit_events: list[CircuitEvent] = []
    detection_events: list[DetectionEvent] = []
    lock = threading.Lock()

    def on_circuit(evt: CircuitEvent) -> None:
        with lock:
            circuit_events.append(evt)

    def on_detection(evt: DetectionEvent) -> None:
        with lock:
            detection_events.append(evt)

    # High fps so the ~48-frame fixture plays quickly; hysteresis is frame-count
    # based, so fast replay still exercises it faithfully.
    source = ReplaySource(recording_dir, fps=400.0, loop=False)
    pipeline = Pipeline(
        source,
        on_circuit=on_circuit,
        on_detection=on_detection,
    )

    t_start = time.monotonic()
    pipeline.start()

    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        if source.exhausted:
            break
        time.sleep(0.01)
    t_exhausted = time.monotonic()
    # Small grace so the last processed frame's callbacks are all in.
    time.sleep(0.05)

    t_stop0 = time.monotonic()
    pipeline.stop()
    stop_duration = time.monotonic() - t_stop0

    with lock:
        circuits = [_gate_types(e.circuit) for e in circuit_events]
        sources = {e.source for e in circuit_events}
        n_detections = len(detection_events)
        max_fps = max((e.fps for e in detection_events), default=0.0)

    # --- circuit sequence: empty -> H -> Bell, and nothing more ---
    assert circuits == [[], ["H"], ["H", "CNOT"]], circuits
    # The 3-frame CNOT occlusion in the final segment must NOT emit a change.
    assert len(circuit_events) == 3
    assert sources == {"replay"}

    # Last emitted circuit is a genuine Bell pair with matching QASM.
    bell = circuit_events[-1]
    assert "cx q[0], q[1];" in bell.qasm
    assert bell.qasm.startswith("OPENQASM 2.0;")

    # --- fps is measured and positive ---
    assert max_fps > 0.0

    # --- stop() joins cleanly and quickly ---
    assert stop_duration < 2.0
    assert not any(t.name == "qamposer-pipeline" for t in threading.enumerate())

    # --- perf note (no hard assert): frames/sec over the fixture ---
    elapsed = max(t_exhausted - t_start, 1e-9)
    measured_fps = n_detections / elapsed
    msg = (
        f"pipeline processed {n_detections} frames in {elapsed:.3f}s "
        f"= {measured_fps:.1f} frames/sec (smoothed report {max_fps:.1f} fps)"
    )
    print("\n" + msg)
    warnings.warn(UserWarning(msg))


def test_pipeline_start_stop_idempotent(recording_dir) -> None:
    source = ReplaySource(recording_dir, fps=200.0, loop=True)
    pipeline = Pipeline(source)

    pipeline.start()
    pipeline.start()  # second start is a no-op, must not spawn a second worker
    workers = [t for t in threading.enumerate() if t.name == "qamposer-pipeline"]
    assert len(workers) == 1

    time.sleep(0.1)
    annotated = pipeline.latest_annotated()
    assert annotated is not None
    assert annotated.ndim == 3  # BGR

    pipeline.stop()
    pipeline.stop()  # idempotent
    assert not any(t.name == "qamposer-pipeline" for t in threading.enumerate())


def test_pipeline_swap_source_is_thread_safe(recording_dir) -> None:
    source_a = ReplaySource(recording_dir, fps=200.0, loop=True)
    pipeline = Pipeline(source_a)
    pipeline.start()
    time.sleep(0.05)

    source_b = ReplaySource(recording_dir, fps=200.0, loop=True)
    pipeline.swap_source(source_b)
    time.sleep(0.05)

    # Still running on exactly one worker after the swap.
    workers = [t for t in threading.enumerate() if t.name == "qamposer-pipeline"]
    assert len(workers) == 1

    pipeline.stop()
    assert not any(t.name == "qamposer-pipeline" for t in threading.enumerate())
