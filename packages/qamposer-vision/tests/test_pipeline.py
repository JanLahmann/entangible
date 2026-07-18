"""End-to-end pipeline test over the generated bell-sequence replay fixture."""

from __future__ import annotations

import threading
import time
import warnings

import pytest

from qamposer_vision.pipeline import CircuitEvent, DetectionEvent, Pipeline
from qamposer_vision.sources import ReplaySource

from tests.utils.make_recording import OUTPUT_DIR, make_recording


@pytest.fixture(scope="module")
def recording_dir():
    # PNG frames are gitignored; (re)generate them deterministically for the test.
    make_recording(OUTPUT_DIR)
    return OUTPUT_DIR


def _gate_types(circuit: dict) -> list[str]:
    return [g["type"] for g in circuit["gates"]]


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
