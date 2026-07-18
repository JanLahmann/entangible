"""End-to-end phone-capture path (real pipeline, in-process host).

Wires the whole M4 flow without a browser or camera:

1. start the real app on an idle ``replay:none`` source,
2. connect ``/ws/state`` and swap to the push source (``select_camera push``),
3. connect ``/ws/frames`` and push 12 synthetic *H-only* board frames then 13
   *Bell* board frames at ~10 fps (encoded from ``tests/utils/render_board``),
4. assert ``/ws/state`` emits a circuit reflecting **H** and then **Bell**, both
   with ``source == 'push'``.

Detection/stabilization timing is real, so the assertions use generous
deadlines and drain ``/ws/state`` on a background thread. The test skips
cleanly when the vision package (or cv2) is unavailable.
"""

from __future__ import annotations

import threading
import time

import pytest
from fastapi.testclient import TestClient

from qamposer_host.config import HostConfig
from qamposer_host.main import create_app

cv2 = pytest.importorskip("cv2")
pytest.importorskip("qamposer_vision.pipeline")
from qamposer_vision.board import BoardConfig  # noqa: E402

from tests.utils.render_board import (  # noqa: E402
    SCENARIOS_BY_NAME,
    RenderOptions,
    render_board,
)


def _encode(name: str, config: BoardConfig) -> bytes:
    img = render_board(SCENARIOS_BY_NAME[name].placements, config, RenderOptions())
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    assert ok
    return buf.tobytes()


def _gate_types(circuit: dict) -> list[str]:
    return sorted(g["type"] for g in circuit.get("gates", []))


def _kind(circuit: dict) -> str:
    types = _gate_types(circuit)
    if types == ["H"]:
        return "H"
    if types == ["CNOT", "H"]:
        return "BELL"
    return "OTHER"


def test_push_frames_drive_h_then_bell_over_ws_state():
    config = BoardConfig.from_toml()
    h_jpeg = _encode("single_h", config)
    bell_jpeg = _encode("bell", config)

    app = create_app(
        HostConfig.from_env(
            source="replay:none", backend="off", display_dist="/no/such/dist"
        )
    )

    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as state_ws:
            state_ws.receive_json()  # initial status

            received: list[dict] = []
            stop = threading.Event()

            def drain() -> None:
                try:
                    while not stop.is_set():
                        received.append(state_ws.receive_json())
                except Exception:
                    pass  # socket closed on teardown

            drainer = threading.Thread(target=drain, daemon=True)
            drainer.start()

            # Swap the pipeline onto the shared push source.
            state_ws.send_json({"type": "select_camera", "kind": "push"})

            with client.websocket_connect("/ws/frames") as frames_ws:
                frames_ws.send_json({"type": "hello", "role": "capture"})
                for _ in range(12):
                    frames_ws.send_bytes(h_jpeg)
                    time.sleep(0.1)
                for _ in range(13):
                    frames_ws.send_bytes(bell_jpeg)
                    time.sleep(0.1)

                # Wait (generously) for the H → Bell circuit sequence to appear.
                deadline = time.time() + 25.0
                saw_h_then_bell = False
                circuits: list[dict] = []
                while time.time() < deadline:
                    circuits = [m for m in received if m.get("type") == "circuit"]
                    kinds = [_kind(m["circuit"]) for m in circuits]
                    if "H" in kinds and "BELL" in kinds and kinds.index("H") < kinds.index("BELL"):
                        saw_h_then_bell = True
                        break
                    time.sleep(0.1)

            stop.set()

        # Every circuit came from the pushed frames.
        assert circuits, "no circuit messages received over /ws/state"
        assert all(m["source"] == "push" for m in circuits)
        assert saw_h_then_bell, (
            "expected an H-only circuit followed by a Bell circuit; got "
            f"{[_kind(m['circuit']) for m in circuits]}"
        )
