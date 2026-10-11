"""``status.camera`` truthfulness: a live camera is only ``connected`` on frames.

RasQberry rig bug (E1): with ``cv2:0`` and nothing at ``/dev/video0`` the host
used to report ``connected: true, lost: false`` for the ~2 s before the stall
watchdog fired, so the launcher's READY light said "Camera: connected" with no
camera attached — and then the screens said "Camera lost" for a camera that
never existed (E3). Now ``connected`` needs a real frame, a failed open is
``missing`` (with a ``reason``) from the first response, and ``lost`` is kept
for a camera that stops *after* delivering frames.
"""

from __future__ import annotations

import asyncio
import time

import numpy as np
import pytest
from conftest import FakeDetectionEvent, FakePipeline, FakeWSClient
from fastapi.testclient import TestClient

from qamposer_host.config import HostConfig
from qamposer_host.hub import NO_FRAMES_REASON, Hub
from qamposer_host.main import create_app


def _run(coro):
    return asyncio.run(coro)


# --- Hub semantics ----------------------------------------------------------


def test_live_camera_is_not_connected_before_a_frame():
    hub = Hub()
    hub.set_camera({"kind": "cv2", "name": "cv2:0", "connected": True})
    status = hub.camera_status()
    assert status["connected"] is False
    assert status["lost"] is False
    assert status["missing"] is False  # still starting: no verdict yet
    assert "reason" not in status


def test_failed_open_is_missing_from_the_first_status():
    hub = Hub()
    hub.set_camera(
        {"kind": "cv2", "name": "cv2:0", "connected": True},
        reason="could not open camera 0 (/dev/video0)",
    )
    status = hub.camera_status()
    assert status["connected"] is False
    assert status["lost"] is False
    assert status["missing"] is True
    assert status["reason"] == "could not open camera 0 (/dev/video0)"


def test_first_frame_connects_and_broadcasts_status_unthrottled():
    async def scenario():
        hub = Hub()
        hub.set_camera({"kind": "picamera2", "name": "picamera2", "connected": True})
        client = FakeWSClient()
        await hub.connect(client)
        assert client.sent[-1]["camera"]["connected"] is False
        await hub.publish_detection(FakeDetectionEvent(fps=12.0))
        assert client.sent[-1]["type"] == "status"
        assert client.sent[-1]["camera"]["connected"] is True
        assert client.sent[-1]["camera"]["missing"] is False

    _run(scenario())


def test_stall_without_any_frame_is_missing_not_lost():
    async def scenario():
        hub = Hub()
        hub.set_camera({"kind": "cv2", "name": "cv2:0", "connected": True})
        client = FakeWSClient()
        await hub.connect(client)
        await hub.publish_detection(FakeDetectionEvent(fps=0.0, camera_lost=True))
        status = client.sent[-1]
        assert status["type"] == "status"
        assert status["camera"]["connected"] is False
        assert status["camera"]["lost"] is False
        assert status["camera"]["missing"] is True
        assert status["camera"]["reason"] == NO_FRAMES_REASON

        # A camera plugged in later: the first real frame connects it.
        await hub.publish_detection(FakeDetectionEvent(fps=10.0))
        camera = hub.camera_status()
        assert camera["connected"] is True and not camera["missing"]
        assert "reason" not in camera

    _run(scenario())


def test_stall_after_frames_is_lost_not_missing():
    async def scenario():
        hub = Hub()
        hub.set_camera({"kind": "cv2", "name": "cv2:0", "connected": True})
        await hub.publish_detection(FakeDetectionEvent(fps=30.0))
        await hub.publish_detection(FakeDetectionEvent(fps=0.0, camera_lost=True))
        camera = hub.camera_status()
        assert camera["connected"] is False
        assert camera["lost"] is True
        assert camera["missing"] is False

    _run(scenario())


def test_replay_and_push_keep_configured_connected():
    hub = Hub()
    hub.set_camera({"kind": "replay", "name": "bell", "connected": True})
    assert hub.camera_status()["connected"] is True
    assert hub.camera_status()["missing"] is False
    hub.set_camera({"kind": "push", "name": "push", "connected": True})
    assert hub.camera_status()["connected"] is True


# --- end to end: real Cv2CaptureSource + real Pipeline, fake VideoCapture ----


class _DeadCapture:
    """``cv2.VideoCapture`` for a missing device: never opens."""

    def __init__(self, index) -> None:
        self.index = index

    def isOpened(self) -> bool:  # noqa: N802 - cv2 API
        return False

    def set(self, prop, value) -> bool:
        return False

    def get(self, prop) -> float:
        return 0.0

    def read(self):
        return False, None

    def release(self) -> None:
        pass


class _MuteCapture(_DeadCapture):
    """Opens fine but ``read()`` never yields a frame (a wedged driver)."""

    def isOpened(self) -> bool:  # noqa: N802 - cv2 API
        return True

    def read(self):
        time.sleep(0.005)
        return False, None


class _LiveCapture(_MuteCapture):
    """Opens and delivers (blank) frames."""

    def read(self):
        time.sleep(0.01)
        return True, np.full((48, 64, 3), 255, dtype=np.uint8)


@pytest.fixture
def cv2_app(monkeypatch):
    sources = pytest.importorskip("qamposer_vision.sources")
    pipeline_mod = pytest.importorskip("qamposer_vision.pipeline")
    monkeypatch.setattr(pipeline_mod, "CAMERA_STALL_S", 0.3)
    monkeypatch.setattr(pipeline_mod, "_WATCHDOG_INTERVAL", 0.05)

    def make(capture_cls):
        monkeypatch.setattr(sources.cv2, "VideoCapture", capture_cls)
        config = HostConfig.from_env(
            source="cv2:0", backend="off", pocket_dist="/no/such/dist",
        )
        return create_app(config)

    return make


def _camera(client) -> dict:
    return client.get("/api/health").json()["camera"]


def _wait_for(client, predicate, timeout=5.0) -> dict:
    deadline = time.monotonic() + timeout
    camera = _camera(client)
    while not predicate(camera) and time.monotonic() < deadline:
        time.sleep(0.05)
        camera = _camera(client)
    return camera


def test_health_reports_missing_camera_from_the_first_response(cv2_app):
    with TestClient(cv2_app(_DeadCapture)) as client:
        camera = _camera(client)
        assert camera["kind"] == "cv2"
        assert camera["connected"] is False
        assert camera["lost"] is False
        assert camera["missing"] is True
        assert "could not open camera 0" in camera["reason"]
        # ... and it stays that way past the stall window (never "lost").
        time.sleep(0.6)
        camera = _camera(client)
        assert camera["connected"] is False and camera["lost"] is False
        assert camera["missing"] is True


def test_open_device_without_frames_is_never_connected(cv2_app):
    with TestClient(cv2_app(_MuteCapture)) as client:
        assert _camera(client)["connected"] is False
        camera = _wait_for(client, lambda c: c["missing"])
        assert camera["missing"] is True
        assert camera["connected"] is False
        assert camera["lost"] is False
        assert camera["reason"] == NO_FRAMES_REASON


def test_frames_make_the_camera_connected(cv2_app):
    with TestClient(cv2_app(_LiveCapture)) as client:
        camera = _wait_for(client, lambda c: c["connected"])
        assert camera["connected"] is True
        assert camera["missing"] is False
        assert camera["lost"] is False


def test_select_camera_failed_open_reports_missing(monkeypatch):
    sources = pytest.importorskip("qamposer_vision.sources")
    monkeypatch.setattr(sources.cv2, "VideoCapture", _DeadCapture)
    config = HostConfig.from_env(source="replay:none", backend="off")
    app = create_app(config, pipeline=FakePipeline())
    from qamposer_host.config import build_frame_source

    app.state.source_factory = build_frame_source
    from conftest import authenticate_operator

    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # layout
            authenticate_operator(ws, app)
            ws.send_json({"type": "select_camera", "kind": "cv2", "index": 2})
            status = ws.receive_json()
            assert status["type"] == "status"
            assert status["camera"]["connected"] is False
            assert status["camera"]["missing"] is True
            assert "could not open camera 2" in status["camera"]["reason"]
