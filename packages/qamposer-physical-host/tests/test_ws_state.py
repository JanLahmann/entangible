"""/ws/state client-message handling: hello, hello_ack, operator gating."""

from __future__ import annotations

from conftest import FakePipeline, authenticate_operator, operator_hello
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
            ws.receive_json()  # replayed layout
            ws.send_json({"type": "hello", "role": "debug", "client": "booth-screen"})
            ack = ws.receive_json()
            assert ack == {"type": "hello_ack", "role": "viewer"}
            roles = [c["role"] for c in app.state.hub._clients.values()]
            labels = [c["label"] for c in app.state.hub._clients.values()]
            assert "debug" in roles
            assert "booth-screen" in labels


def test_viewer_hello_acked_as_viewer_with_wrong_key():
    app = _make_app(FakePipeline())
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # layout
            ws.send_json({"type": "hello", "role": "operator", "key": "nope"})
            ack = ws.receive_json()
            assert ack == {"type": "hello_ack", "role": "viewer"}


def test_operator_hello_acked_as_operator():
    app = _make_app(FakePipeline())
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # layout
            ws.send_json(operator_hello(app))
            ack = ws.receive_json()
            assert ack == {"type": "hello_ack", "role": "operator"}


def test_camera_role_hello_acked_as_operator():
    # U2: the pocket CAMERA role announces itself as role='camera' and, with the
    # operator key, gains operator standing (so its select_camera is honored) —
    # while keeping the 'camera' label so the host can list it as a camera.
    app = _make_app(FakePipeline())
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # layout
            ws.send_json(
                {"type": "hello", "role": "camera", "client": "pocket-camera",
                 "key": app.state.operator_token}
            )
            ack = ws.receive_json()
            assert ack == {"type": "hello_ack", "role": "operator"}
            roles = [c["role"] for c in app.state.hub._clients.values()]
            assert "camera" in roles


def test_camera_role_without_key_stays_viewer():
    app = _make_app(FakePipeline())
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # layout
            ws.send_json({"type": "hello", "role": "camera", "client": "pocket-camera"})
            ack = ws.receive_json()
            assert ack == {"type": "hello_ack", "role": "viewer"}


def test_select_camera_ignored_for_viewers():
    pipeline = FakePipeline()
    app = _make_app(pipeline)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # layout
            # No operator hello → select_camera is silently ignored (no status,
            # no swap). A subsequent malformed message keeps the socket alive.
            ws.send_json({"type": "select_camera", "kind": "cv2", "index": 2})
            ws.send_text("not json {")  # still alive, still no response
            # Authenticate, then the same select_camera is honored.
            authenticate_operator(ws, app)
            ws.send_json({"type": "select_camera", "kind": "cv2", "index": 2})
            status = ws.receive_json()
            assert status["type"] == "status"
            assert pipeline.swapped == [("SRC", "cv2:2")]


def test_select_camera_calls_swap_source_for_operator():
    pipeline = FakePipeline()
    app = _make_app(pipeline)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # initial status
            ws.receive_json()  # replayed layout
            authenticate_operator(ws, app)
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
            ws.receive_json()  # replayed layout
            ws.send_text("this is not json {")
            ws.send_text('{"type": 42}')  # not a real message, but valid JSON
            # connection still alive; a valid operator select_camera still works:
            authenticate_operator(ws, app)
            ws.send_json({"type": "select_camera", "kind": "cv2", "index": 1})
            status = ws.receive_json()
            assert status["type"] == "status"
            assert pipeline.swapped == [("SRC", "cv2:1")]
