"""/ws/state client-message handling: hello, select_camera, malformed JSON."""

from __future__ import annotations

from conftest import FakePipeline
from fastapi.testclient import TestClient

from qamposer_host.config import HostConfig
from qamposer_host.main import create_app


def _make_app(pipeline):
    config = HostConfig.from_env(
        source="replay:none", backend="off", display_dist="/no/such/dist"
    )
    app = create_app(config, pipeline=pipeline)
    # Deterministic source factory so select_camera never touches vision.
    app.state.source_factory = lambda spec: ("SRC", spec)
    return app


def test_hello_sets_role_label():
    pipeline = FakePipeline()
    app = _make_app(pipeline)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # initial status
            ws.send_json({"type": "hello", "role": "debug", "client": "booth-screen"})
            # follow with select_camera so we can await a status round-trip
            ws.send_json({"type": "select_camera", "kind": "cv2", "index": 0})
            status = ws.receive_json()
            assert status["type"] == "status"
            # both messages are now processed on the server:
            roles = [c["role"] for c in app.state.hub._clients.values()]
            labels = [c["label"] for c in app.state.hub._clients.values()]
            assert "debug" in roles
            assert "booth-screen" in labels


def test_select_camera_calls_swap_source():
    pipeline = FakePipeline()
    app = _make_app(pipeline)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # initial status
            ws.send_json({"type": "select_camera", "kind": "cv2", "index": 2})
            status = ws.receive_json()
            assert status["type"] == "status"
            assert pipeline.swapped == [("SRC", "cv2:2")]
            assert status["camera"]["kind"] == "cv2"


def test_malformed_json_ignored():
    pipeline = FakePipeline()
    app = _make_app(pipeline)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # initial status
            ws.send_text("this is not json {")
            ws.send_text('{"type": 42}')  # not a real message, but valid JSON
            # connection still alive; a valid select_camera still works:
            ws.send_json({"type": "select_camera", "kind": "cv2", "index": 1})
            status = ws.receive_json()
            assert status["type"] == "status"
            assert pipeline.swapped == [("SRC", "cv2:1")]
