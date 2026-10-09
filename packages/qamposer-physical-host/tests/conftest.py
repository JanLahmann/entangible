"""Shared test fakes for the host suite.

These implement just the surface of the ``docs/protocol.md`` in-process
contract that the host consumes, so the tests never depend on the real vision
package being importable.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest


@pytest.fixture(autouse=True)
def _isolated_cert_dir(tmp_path_factory, monkeypatch):
    """Point the operator-token / cert dir at a throwaway path per test.

    ``create_app`` generates the operator token under ``config.cert_dir`` on
    startup; without this the suite would write a token file into the developer's
    real ``~/.qamposer-physical/certs``. Setting ``QAMPOSER_CERT_DIR`` keeps every
    ``HostConfig.from_env(...)`` in the suite isolated and reproducible.
    """
    cert_dir = tmp_path_factory.mktemp("certs")
    monkeypatch.setenv("QAMPOSER_CERT_DIR", str(cert_dir))
    return cert_dir


def operator_hello(app) -> dict:
    """A ``hello`` payload that authenticates as operator for ``app``'s token."""
    return {"type": "hello", "role": "operator", "key": app.state.operator_token}


def frames_url(app, path: str = "/ws/frames") -> str:
    """``/ws/frames`` URL carrying ``app``'s operator token as ``?key=``."""
    sep = "&" if "?" in path else "?"
    return f"{path}{sep}key={app.state.operator_token}"


def authenticate_operator(ws, app) -> None:
    """Send an operator ``hello`` on ``ws`` and consume the ``hello_ack``."""
    ws.send_json(operator_hello(app))
    ack = ws.receive_json()
    assert ack == {"type": "hello_ack", "role": "operator"}


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
class FakeKindWarning:
    """The REAL pipeline shape: ``BuildWarning`` names its discriminant ``kind``."""

    kind: str
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
    camera_lost: bool = False


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
