"""Frame sources — pluggable providers of BGR camera frames for the pipeline.

Every source satisfies the :class:`FrameSource` protocol: a non-blocking
:meth:`~FrameSource.read` returning the latest BGR frame (or ``None`` when none
is ready yet), an :attr:`~FrameSource.fps_hint`, a human ``describe()`` and a
``close()``. The pipeline polls ``read()`` in its worker loop and sleeps briefly
whenever it gets ``None``.

Implementations:

* :class:`Cv2CaptureSource` — USB / Mac / Continuity cameras via ``cv2.VideoCapture``.
* :class:`Picamera2Source` — Raspberry Pi CSI cameras via ``picamera2`` (lazy
  import; libcamera CSI cams are invisible to ``cv2.VideoCapture``).
* :class:`PushFrameSource` — a thread-safe single-slot sink fed JPEG bytes by the
  phone-capture WebSocket (``/ws/frames``); most-recent-wins, no queue.
* :class:`ReplaySource` — plays a directory of numbered image files at a fixed
  rate for CI and ``make demo`` (no camera needed).

Each concrete source also carries a ``source_kind`` class attribute
(``"camera" | "push" | "replay"``) that the pipeline copies into
``CircuitEvent.source`` (see ``docs/protocol.md``).
"""

from __future__ import annotations

import re
import threading
from pathlib import Path
from time import monotonic
from typing import Protocol, runtime_checkable

import cv2
import numpy as np

__all__ = [
    "FrameSource",
    "Cv2CaptureSource",
    "Picamera2Source",
    "PushFrameSource",
    "ReplaySource",
    "list_cameras",
]


@runtime_checkable
class FrameSource(Protocol):
    """A provider of BGR frames polled by the pipeline worker loop."""

    #: Best-effort nominal frame rate, or ``None`` when unknown.
    fps_hint: float | None

    def read(self) -> np.ndarray | None:
        """Return the latest BGR frame, or ``None`` if none is ready yet."""
        ...

    def describe(self) -> str:
        """Return a short human-readable label for logs / status."""
        ...

    def close(self) -> None:
        """Release any underlying resources; safe to call more than once."""
        ...


class Cv2CaptureSource:
    """A ``cv2.VideoCapture`` webcam wrapper (USB / Mac / Continuity Camera)."""

    source_kind = "camera"

    def __init__(self, index: int = 0, width: int = 1280, height: int = 720) -> None:
        self.index = index
        self.width = width
        self.height = height
        self._capture = cv2.VideoCapture(index)
        if self._capture is not None and self._capture.isOpened():
            self._capture.set(cv2.CAP_PROP_FRAME_WIDTH, width)
            self._capture.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        reported = self._capture.get(cv2.CAP_PROP_FPS) if self._capture else 0.0
        self.fps_hint: float | None = float(reported) if reported and reported > 0 else None

    def is_opened(self) -> bool:
        return self._capture is not None and self._capture.isOpened()

    def read(self) -> np.ndarray | None:
        if self._capture is None or not self._capture.isOpened():
            return None
        ok, frame = self._capture.read()
        if not ok or frame is None:
            return None
        return frame

    def describe(self) -> str:
        state = "open" if self.is_opened() else "unavailable"
        return f"cv2 camera #{self.index} ({self.width}x{self.height}, {state})"

    def close(self) -> None:
        if self._capture is not None:
            self._capture.release()
            self._capture = None


def list_cameras(max_probe: int = 8) -> list[int]:
    """Probe indices ``0..max_probe-1`` and return those that open.

    Probes quietly (OpenCV chatter on missing devices is suppressed by opening
    then immediately releasing each candidate); returns the openable indices.
    """
    available: list[int] = []
    for index in range(max_probe):
        capture = cv2.VideoCapture(index)
        try:
            if capture is not None and capture.isOpened():
                available.append(index)
        finally:
            if capture is not None:
                capture.release()
    return available


class Picamera2Source:
    """Raspberry Pi CSI camera via ``picamera2`` (lazy, optional dependency)."""

    source_kind = "camera"

    def __init__(self, width: int = 1280, height: int = 720) -> None:
        self.width = width
        self.height = height
        self.fps_hint: float | None = None
        try:
            from picamera2 import Picamera2  # type: ignore[import-not-found]
        except ImportError as exc:  # pragma: no cover - exercised only off-Pi
            raise RuntimeError(
                "picamera2 is not installed. It ships with Raspberry Pi OS "
                "(Bookworm) — install with `sudo apt install -y python3-picamera2` "
                "and create the venv with `--system-site-packages`. Picamera2 is "
                "only needed for Pi CSI cameras; use Cv2CaptureSource on macOS/USB."
            ) from exc

        self._picam = Picamera2()
        config = self._picam.create_preview_configuration(
            main={"size": (width, height), "format": "RGB888"}
        )
        self._picam.configure(config)
        self._picam.start()

    def read(self) -> np.ndarray | None:
        if self._picam is None:
            return None
        rgb = self._picam.capture_array()
        if rgb is None:
            return None
        # picamera2 RGB888 -> OpenCV BGR
        return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)

    def describe(self) -> str:
        return f"picamera2 CSI ({self.width}x{self.height})"

    def close(self) -> None:
        if self._picam is not None:
            try:
                self._picam.stop()
            finally:
                self._picam.close()
            self._picam = None


class PushFrameSource:
    """A thread-safe single latest-frame slot fed JPEG bytes (phone capture).

    ``push()`` decodes and stores the most recent frame, dropping any earlier
    un-read one (most-recent-wins, no queue). ``read()`` returns that frame
    exactly once, then ``None`` until a newer frame is pushed.
    """

    source_kind = "push"
    fps_hint: float | None = None

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._frame: np.ndarray | None = None
        self._fresh = False

    def push(self, jpeg_bytes: bytes) -> bool:
        """Decode and store a JPEG frame. Returns ``False`` on a bad JPEG."""
        buffer = np.frombuffer(jpeg_bytes, dtype=np.uint8)
        frame = cv2.imdecode(buffer, cv2.IMREAD_COLOR)
        if frame is None:
            return False
        with self._lock:
            self._frame = frame
            self._fresh = True
        return True

    def read(self) -> np.ndarray | None:
        with self._lock:
            if self._fresh:
                self._fresh = False
                return self._frame
            return None

    def describe(self) -> str:
        return "push frames (phone /ws/frames)"

    def close(self) -> None:
        with self._lock:
            self._frame = None
            self._fresh = False


def _frame_number_key(path: Path) -> tuple[int, str]:
    """Sort key: trailing integer in the stem, falling back to the name."""
    digits = re.findall(r"\d+", path.stem)
    return (int(digits[-1]) if digits else -1, path.name)


class ReplaySource:
    """Play a directory of numbered image files at a fixed rate.

    Files matching ``frame_*.png`` / ``frame_*.jpg`` are played in numeric
    order. :meth:`read` paces itself against a monotonic clock: it returns
    ``None`` until the next frame is due, so the pipeline consumes frames at
    ``fps`` regardless of how fast it polls. With ``loop=True`` it wraps forever;
    with ``loop=False`` it plays once and then returns ``None`` indefinitely
    (see :attr:`exhausted`).
    """

    source_kind = "replay"

    def __init__(
        self, directory: str | Path, fps: float = 10.0, loop: bool = True
    ) -> None:
        self.directory = Path(directory)
        self.fps_hint: float | None = float(fps) if fps > 0 else None
        self._interval = 1.0 / fps if fps > 0 else 0.0
        self._loop = loop
        self._files = self._discover_files()
        self._index = 0
        self._next_time: float | None = None
        self._exhausted = False

    def _discover_files(self) -> list[Path]:
        patterns = ("frame_*.png", "frame_*.jpg", "frame_*.jpeg")
        found: list[Path] = []
        for pattern in patterns:
            found.extend(self.directory.glob(pattern))
        return sorted(found, key=_frame_number_key)

    @property
    def exhausted(self) -> bool:
        """True once a non-looping source has played all its frames."""
        return self._exhausted

    @property
    def frame_count(self) -> int:
        return len(self._files)

    def read(self) -> np.ndarray | None:
        if not self._files:
            return None
        now = monotonic()
        if self._next_time is not None and now < self._next_time:
            return None
        if self._index >= len(self._files):
            if self._loop:
                self._index = 0
            else:
                self._exhausted = True
                return None
        path = self._files[self._index]
        self._index += 1
        self._next_time = now + self._interval
        return cv2.imread(str(path))

    def describe(self) -> str:
        return (
            f"replay {self.directory} "
            f"({len(self._files)} frames @ {self.fps_hint or 0:.0f}fps"
            f"{', loop' if self._loop else ''})"
        )

    def close(self) -> None:
        # Nothing to release; kept for protocol conformance.
        return None
