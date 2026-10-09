"""``GET /api/cameras``: shape, operator gate, never re-opening the held index."""

from __future__ import annotations

import threading
import time

from conftest import FakePipeline, authenticate_operator
from fastapi.testclient import TestClient

from qamposer_host import cameras
from qamposer_host.config import HostConfig
from qamposer_host.main import create_app


def _app(tmp_path, source="cv2:1", pipeline=None, prober=None):
    replay_dir = tmp_path / "recordings"
    (replay_dir / "bell-sequence").mkdir(parents=True)
    (replay_dir / "bell-sequence" / "frame_0001.png").write_bytes(b"")
    (replay_dir / "empty-dir").mkdir()
    config = HostConfig.from_env(
        source=source, backend="off", pocket_dist="/no/such/dist",
        replay_dir=str(replay_dir), config_dir=str(tmp_path),
    )
    app = create_app(config, pipeline=pipeline or FakePipeline())
    app.state.source_factory = lambda spec: ("SRC", spec)
    app.state.camera_prober = prober
    return app


class _Prober:
    """Fake cv2 prober: devices at ``present`` indices; records every open."""

    def __init__(self, present: dict[int, dict | None]):
        self.present = present
        self.opened: list[int] = []
        self.lock = threading.Lock()

    def __call__(self, index: int):
        with self.lock:
            self.opened.append(index)
        return self.present.get(index)


def _get(client, app):
    return client.get("/api/cameras", params={"key": app.state.operator_token})


def test_requires_operator_key(tmp_path):
    app = _app(tmp_path, prober=_Prober({}))
    with TestClient(app) as client:
        assert client.get("/api/cameras").status_code == 403
        assert client.get("/api/cameras", params={"key": "nope"}).status_code == 403


def test_shape_and_active_index_is_never_probed(tmp_path):
    prober = _Prober({
        0: {"ok": True, "width": 1280, "height": 720},
        1: {"ok": True, "width": 640, "height": 480},  # held by the pipeline
        3: {"ok": False, "width": None, "height": None},
    })
    app = _app(tmp_path, source="cv2:1", prober=prober)
    with TestClient(app) as client:
        resp = _get(client, app)
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"active", "cameras", "picamera2", "replays", "push"}
    assert body["active"] == "cv2:1"
    assert isinstance(body["picamera2"], bool)
    assert body["push"] is True
    # Only directories that actually hold frames are offered.
    assert body["replays"] == ["bell-sequence"]

    # The held device is reported, never opened (a second open can wedge V4L2).
    assert 1 not in prober.opened
    assert sorted(prober.opened) == [0, 2, 3, 4, 5]

    by_index = {c["index"]: c for c in body["cameras"]}
    assert sorted(by_index) == [0, 1, 3]
    for cam in body["cameras"]:
        assert set(cam) == {"spec", "kind", "index", "ok", "width", "height", "active"}
        assert cam["kind"] == "cv2" and cam["spec"] == f"cv2:{cam['index']}"
    assert by_index[0] == {
        "spec": "cv2:0", "kind": "cv2", "index": 0, "ok": True,
        "width": 1280, "height": 720, "active": False,
    }
    assert by_index[1]["active"] is True
    assert by_index[3]["ok"] is False and by_index[3]["active"] is False


def test_held_index_follows_select_camera(tmp_path):
    prober = _Prober({0: {"ok": True, "width": 1, "height": 1}})
    app = _app(tmp_path, source="cv2:0", prober=prober)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # layout
            authenticate_operator(ws, app)
            ws.send_json({"type": "select_camera", "kind": "cv2", "index": 2})
            ws.receive_json()  # status
        body = _get(client, app).json()
    assert body["active"] == "cv2:2"
    assert 2 not in prober.opened
    assert 0 in prober.opened  # released by the swap, so probing it is safe


def test_every_index_probed_when_no_pipeline_holds_one(tmp_path):
    prober = _Prober({})
    app = _app(tmp_path, source="cv2:0", prober=prober)
    with TestClient(app) as client:
        app.state.pipeline = None  # the pipeline never started (no camera at boot)
        body = _get(client, app).json()
    assert sorted(prober.opened) == list(cameras.CV2_INDICES)
    assert body["cameras"] == []


def test_no_cv2_yields_no_cameras(tmp_path):
    def prober(index):
        raise ImportError("No module named 'cv2'")

    app = _app(tmp_path, source="replay:none", prober=prober)
    with TestClient(app) as client:
        body = _get(client, app).json()
    assert body["cameras"] == []
    assert body["replays"] == ["bell-sequence"]


def test_slow_probe_is_cut_off(tmp_path, monkeypatch):
    monkeypatch.setattr(cameras, "PROBE_BUDGET_S", 0.05)
    monkeypatch.setattr(cameras, "CV2_INDICES", range(2))

    def prober(index):
        if index == 0:
            time.sleep(0.3)
        return {"ok": True, "width": 2, "height": 2}

    app = _app(tmp_path, source="replay:none", prober=prober)
    with TestClient(app) as client:
        body = _get(client, app).json()
    by_index = {c["index"]: c for c in body["cameras"]}
    assert by_index[0]["ok"] is False  # overran its budget
    assert by_index[1]["ok"] is True   # the scan moved on


def test_select_camera_replay_name_resolves_against_replay_dir(tmp_path):
    pipeline = FakePipeline()
    app = _app(tmp_path, source="cv2:0", pipeline=pipeline, prober=_Prober({}))
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()
            ws.receive_json()
            authenticate_operator(ws, app)
            ws.send_json({"type": "select_camera", "kind": "replay", "name": "bell-sequence"})
            status = ws.receive_json()
    expected = f"replay:{tmp_path / 'recordings' / 'bell-sequence'}"
    assert pipeline.swapped == [("SRC", expected)]
    assert app.state.source_spec == expected
    assert status["camera"]["kind"] == "replay"
    assert status["camera"]["name"] == "bell-sequence"
