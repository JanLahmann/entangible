"""Tests for the frame sources — PushFrameSource semantics and ReplaySource."""

from __future__ import annotations

import threading
import time
from pathlib import Path

import cv2
import numpy as np
import pytest

from qamposer_vision.sources import PushFrameSource, ReplaySource


def _encode(value: int, size: int = 16) -> bytes:
    """A solid-gray JPEG whose brightness encodes ``value`` (0-255)."""
    img = np.full((size, size, 3), value, dtype=np.uint8)
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


def _mean(frame: np.ndarray) -> float:
    return float(frame.mean())


# ---------------------------------------------------------------------------
# PushFrameSource
# ---------------------------------------------------------------------------


def test_push_read_returns_frame_once_then_none() -> None:
    src = PushFrameSource()
    assert src.read() is None  # nothing pushed yet

    assert src.push(_encode(200)) is True
    frame = src.read()
    assert frame is not None
    assert frame.shape == (16, 16, 3)
    assert _mean(frame) == pytest.approx(200, abs=6)

    # Consumed: a second read without a new push yields None.
    assert src.read() is None


def test_push_is_most_recent_wins() -> None:
    src = PushFrameSource()
    src.push(_encode(40))
    src.push(_encode(210))  # supersedes the un-read frame, no queue
    frame = src.read()
    assert frame is not None
    assert _mean(frame) == pytest.approx(210, abs=6)
    assert src.read() is None


def test_push_rejects_bad_jpeg() -> None:
    src = PushFrameSource()
    assert src.push(b"definitely not a jpeg") is False
    assert src.read() is None


def test_push_close_clears_slot() -> None:
    src = PushFrameSource()
    src.push(_encode(100))
    src.close()
    assert src.read() is None


def test_push_thread_safe_latest_wins() -> None:
    src = PushFrameSource()
    n = 200
    errors: list[Exception] = []

    def producer() -> None:
        try:
            for i in range(n):
                src.push(_encode(i % 256))
        except Exception as exc:  # pragma: no cover - failure path
            errors.append(exc)

    seen: list[float] = []

    def consumer() -> None:
        try:
            for _ in range(n * 2):
                frame = src.read()
                if frame is not None:
                    seen.append(_mean(frame))
        except Exception as exc:  # pragma: no cover - failure path
            errors.append(exc)

    t_prod = threading.Thread(target=producer)
    t_cons = threading.Thread(target=consumer)
    t_prod.start()
    t_cons.start()
    t_prod.join()
    t_cons.join()

    assert not errors  # no races / exceptions under concurrent push+read
    # After the producer finishes, the final push must be readable as the latest.
    final = src.read()
    if final is not None:  # a fresh frame may still be pending
        assert _mean(final) == pytest.approx((n - 1) % 256, abs=6)


# ---------------------------------------------------------------------------
# ReplaySource
# ---------------------------------------------------------------------------


def _write_frames(tmp: Path, values: list[int]) -> None:
    for i, value in enumerate(values):
        img = np.full((12, 12, 3), value, dtype=np.uint8)
        cv2.imwrite(str(tmp / f"frame_{i:04d}.png"), img)


def test_replay_plays_frames_in_order(tmp_path: Path) -> None:
    values = [10, 60, 110, 160, 210]
    _write_frames(tmp_path, values)
    src = ReplaySource(tmp_path, fps=1000.0, loop=False)
    assert src.frame_count == 5

    got: list[float] = []
    # High fps -> every frame due almost immediately; poll past None gaps.
    deadline = time.monotonic() + 2.0
    while len(got) < 5 and time.monotonic() < deadline:
        frame = src.read()
        if frame is not None:
            got.append(_mean(frame))
    assert [round(v) for v in got] == values


def test_replay_no_loop_exhausts(tmp_path: Path) -> None:
    _write_frames(tmp_path, [10, 20, 30])
    src = ReplaySource(tmp_path, fps=1000.0, loop=False)

    collected = 0
    deadline = time.monotonic() + 2.0
    while not src.exhausted and time.monotonic() < deadline:
        if src.read() is not None:
            collected += 1
    assert collected == 3
    assert src.exhausted is True
    assert src.read() is None  # stays exhausted forever


def test_replay_loops(tmp_path: Path) -> None:
    _write_frames(tmp_path, [10, 250])
    src = ReplaySource(tmp_path, fps=1000.0, loop=True)

    got: list[float] = []
    deadline = time.monotonic() + 2.0
    while len(got) < 5 and time.monotonic() < deadline:
        frame = src.read()
        if frame is not None:
            got.append(round(_mean(frame)))
    # Wraps: 10, 250, 10, 250, 10
    assert got == [10, 250, 10, 250, 10]
    assert src.exhausted is False


def test_replay_paces_by_clock(tmp_path: Path) -> None:
    _write_frames(tmp_path, [10, 20, 30])
    src = ReplaySource(tmp_path, fps=50.0, loop=False)  # 20 ms interval

    first = src.read()
    assert first is not None            # first frame due immediately
    assert src.read() is None           # next not due yet
    time.sleep(0.03)                    # wait past the 20 ms interval
    second = src.read()
    assert second is not None
    assert round(_mean(second)) == 20


def test_replay_empty_directory_returns_none(tmp_path: Path) -> None:
    src = ReplaySource(tmp_path, fps=10.0, loop=True)
    assert src.frame_count == 0
    assert src.read() is None
