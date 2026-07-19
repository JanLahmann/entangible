"""``/ws/frames`` wiring: a single shared ``PushFrameSource`` on the app state.

Frames pushed over ``/ws/frames`` must land in one shared source, and
``select_camera {kind:'push'}`` must swap the pipeline onto *that same*
instance so a frame already in the slot takes effect the moment detection
switches over (see the M4 wiring in ``config.ensure_push_source``).
"""

from __future__ import annotations

import time

import numpy as np
import pytest
from conftest import FakePipeline, authenticate_operator, frames_url
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from qamposer_host.config import HostConfig
from qamposer_host.main import create_app
from qamposer_host.ws_frames import FRAMES_UNAUTHORIZED_CODE

cv2 = pytest.importorskip("cv2")
pytest.importorskip("qamposer_vision.sources")


def _app():
    config = HostConfig.from_env(
        source="replay:none", backend="off"
    )
    # Fake pipeline records swap_source; a REAL PushFrameSource is created by
    # ensure_push_source (the vision package is a workspace member here).
    return create_app(config, pipeline=FakePipeline())


def _jpeg() -> bytes:
    img = np.zeros((48, 64, 3), dtype=np.uint8)
    img[:, :32] = (0, 0, 255)  # half red, half black — valid decodable JPEG
    ok, buf = cv2.imencode(".jpg", img)
    assert ok
    return buf.tobytes()


def test_frames_without_key_is_closed():
    app = _app()
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect("/ws/frames") as ws:
                # The server accepts then closes 4403; the first receive raises.
                ws.receive_bytes()
        assert exc.value.code == FRAMES_UNAUTHORIZED_CODE
        # No push source was created for the unauthorized socket.
        assert app.state.push_source is None


def test_frames_with_wrong_key_is_closed():
    app = _app()
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect("/ws/frames?key=bogus") as ws:
                ws.receive_bytes()
        assert exc.value.code == FRAMES_UNAUTHORIZED_CODE


def test_frames_create_and_fill_shared_push_source():
    app = _app()
    assert app.state.push_source is None  # not created until needed
    jpeg = _jpeg()
    with TestClient(app) as client:
        with client.websocket_connect(frames_url(app)) as ws:
            ws.send_bytes(jpeg)
        # ensure_push_source created the shared instance on connect ...
        push = app.state.push_source
        assert push is not None
        # ... and the pushed JPEG was decoded into its single latest-frame slot.
        frame = None
        for _ in range(200):
            frame = push.read()
            if frame is not None:
                break
            time.sleep(0.01)
        assert frame is not None
        assert frame.ndim == 3 and frame.shape[2] == 3


def test_select_camera_push_swaps_to_the_shared_instance():
    app = _app()
    with TestClient(app) as client:
        # A phone connects first → the shared source now exists.
        with client.websocket_connect(frames_url(app)):
            pass
        shared = app.state.push_source
        assert shared is not None

        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # initial status
            ws.receive_json()  # replayed layout
            authenticate_operator(ws, app)
            ws.send_json({"type": "select_camera", "kind": "push"})
            status = ws.receive_json()
            assert status["type"] == "status"
            assert status["camera"]["kind"] == "push"
            assert status["camera"]["connected"] is True

        # The pipeline was swapped onto the exact shared instance, not a fresh one.
        assert app.state.pipeline.swapped[-1] is shared


def test_select_camera_push_creates_source_when_no_frames_yet():
    app = _app()
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # initial status
            ws.receive_json()  # replayed layout
            authenticate_operator(ws, app)
            ws.send_json({"type": "select_camera", "kind": "push"})
            ws.receive_json()  # status
        shared = app.state.push_source
        assert shared is not None
        assert app.state.pipeline.swapped[-1] is shared
