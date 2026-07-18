"""Shared test fakes for the host suite.

These implement just the surface of the ``docs/protocol.md`` in-process
contract that the host consumes, so the tests never depend on the real vision
package being importable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class FakeMarker:
    id: int
    row: int | None = None
    col: int | None = None
    off_grid: bool = False


@dataclass
class FakeWarning:
    code: str
    message: str
    row: int | None = None
    col: int | None = None


@dataclass
class FakeCircuitEvent:
    circuit: dict
    qasm: str = "OPENQASM 2.0;\n"
    source: str = "replay"


@dataclass
class FakeDetectionEvent:
    fps: float = 12.0
    board_found: bool = True
    corners: int = 4
    reprojection_error_mm: float | None = 0.05
    markers: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


class FakeWSClient:
    """A stand-in for a FastAPI WebSocket: collects sent JSON payloads."""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.closed = False

    async def send_json(self, obj: Any) -> None:
        self.sent.append(obj)

    def types(self) -> list[str]:
        return [m.get("type") for m in self.sent]


class FakePipeline:
    """Records ``swap_source`` calls; no real vision work."""

    def __init__(self) -> None:
        self.swapped: list[Any] = []
        self.started = False
        self.stopped = False

    def start(self) -> None:
        self.started = True

    def stop(self) -> None:
        self.stopped = True

    def swap_source(self, source: Any) -> None:
        self.swapped.append(source)

    def latest_annotated(self):
        return None
