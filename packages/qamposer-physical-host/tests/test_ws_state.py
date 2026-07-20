"""/ws/state client-message handling: hello, hello_ack, operator gating."""

from __future__ import annotations

import pytest
from conftest import FakePipeline, authenticate_operator, operator_hello
from fastapi.testclient import TestClient

from qamposer_host.config import HostConfig
from qamposer_host.main import create_app


def _make_app(pipeline):
    config = HostConfig.from_env(
        source="replay:none", backend="off"
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


# --- Quantina select_menu / serve / served (QN2) ---------------------------


def _menu_app(tmp_path):
    """A host app whose layout persists under an isolated ``tmp_path``."""
    config = HostConfig.from_env(
        source="replay:none", backend="off", config_dir=str(tmp_path)
    )
    app = create_app(config, pipeline=FakePipeline())
    app.state.source_factory = lambda spec: ("SRC", spec)
    return app


def _recv_until(ws, mtype, limit=10):
    """Read messages until one of ``mtype`` (broadcasts may interleave status)."""
    for _ in range(limit):
        msg = ws.receive_json()
        if msg.get("type") == mtype:
            return msg
    raise AssertionError(f"no {mtype!r} message received")


def _operator_with_menu(ws, app, pack="cocktails"):
    """Authenticate as operator and activate ``pack`` (consumes the layout)."""
    authenticate_operator(ws, app)
    ws.send_json({"type": "select_menu", "pack": pack})
    layout = _recv_until(ws, "layout")
    assert layout["menu"] == pack


def test_viewer_select_menu_and_serve_silently_ignored(tmp_path):
    app = _menu_app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # layout
            # Viewer (no operator hello): both are silently ignored — no
            # broadcast. If select_menu had broadcast a layout, it would arrive
            # before the hello_ack and authenticate_operator would fail.
            ws.send_json({"type": "select_menu", "pack": "cocktails"})
            ws.send_json({"type": "serve", "outcomes": ["101"]})
            ws.send_text("not json {")  # still alive
            authenticate_operator(ws, app)
            # Menu is still unset (viewer select_menu ignored); set it now, then
            # a valid serve stamps seq 1 (the viewer serve produced nothing).
            ws.send_json({"type": "select_menu", "pack": "coffee"})
            assert _recv_until(ws, "layout")["menu"] == "coffee"
            ws.send_json({"type": "serve", "outcomes": ["101"]})
            served = _recv_until(ws, "served")
            assert served["seq"] == 1
            assert served["packId"] == "coffee"
        assert client.get("/api/layout").json()["menu"] == "coffee"


def test_serve_ignored_without_active_menu(tmp_path):
    app = _menu_app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # layout
            authenticate_operator(ws, app)  # operator, but no menu yet
            ws.send_json({"type": "serve", "outcomes": ["101"]})  # menu None → ignored
            ws.send_json({"type": "select_menu", "pack": "coffee"})
            assert _recv_until(ws, "layout")["menu"] == "coffee"
            ws.send_json({"type": "serve", "outcomes": ["101"]})
            served = _recv_until(ws, "served")
            assert served["seq"] == 1  # the pre-menu serve never produced a served


@pytest.mark.parametrize(
    "bad",
    [
        {"outcomes": []},                                 # empty list
        {"outcomes": ["1"] * 21},                         # > 20 outcomes
        {"outcomes": ["102"]},                            # non-bitstring char
        {"outcomes": ["101010"]},                         # > 5 chars
        {"outcomes": ["101", "22"]},                      # one bad element
        {"outcomes": "101"},                              # not a list
        {"outcomes": [101]},                              # not strings
        {"outcomes": [""]},                               # empty bitstring
        {"outcomes": ["101"], "shotSource": "quantum"},   # bad shotSource
        {},                                               # missing outcomes
    ],
)
def test_serve_validation_matrix_ignored(tmp_path, bad):
    app = _menu_app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # layout
            _operator_with_menu(ws, app)
            ws.send_json({"type": "serve", **bad})  # invalid → ignored
            # A valid serve now stamps seq 1 (the invalid one produced nothing).
            ws.send_json({"type": "serve", "outcomes": ["111"]})
            served = _recv_until(ws, "served")
            assert served["seq"] == 1
            assert served["outcomes"] == ["111"]


def test_valid_serve_broadcasts_to_all_clients_with_stamped_seq(tmp_path):
    app = _menu_app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as op:
            op.receive_json()  # status
            op.receive_json()  # layout
            _operator_with_menu(op, app, pack="cocktails")
            with client.websocket_connect("/ws/state") as viewer:
                _recv_until(viewer, "layout")  # replayed layout (menu=cocktails)
                op.send_json(
                    {"type": "serve", "outcomes": ["101"], "shotSource": "noisy"}
                )
                for who in (op, viewer):
                    served = _recv_until(who, "served")
                    assert served["seq"] == 1
                    assert served["packId"] == "cocktails"  # host-stamped active pack
                    assert served["outcomes"] == ["101"]
                    assert served["shotSource"] == "noisy"
                # A second serve increments the host-stamped seq; shotSource
                # defaults to ideal when omitted.
                op.send_json({"type": "serve", "outcomes": ["010", "111", "000"]})
                for who in (op, viewer):
                    served2 = _recv_until(who, "served")
                    assert served2["seq"] == 2
                    assert served2["shotSource"] == "ideal"
                    assert served2["outcomes"] == ["010", "111", "000"]


def test_serve_shot_source_real_passes_through(tmp_path):
    app = _menu_app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # layout
            _operator_with_menu(ws, app)
            ws.send_json({"type": "serve", "outcomes": ["11"], "shotSource": "real"})
            served = _recv_until(ws, "served")
            assert served["shotSource"] == "real"
            assert served["outcomes"] == ["11"]


def test_served_replayed_to_late_joiner_after_layout(tmp_path):
    app = _menu_app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as op:
            op.receive_json()  # status
            op.receive_json()  # layout
            _operator_with_menu(op, app, pack="icecream")
            op.send_json({"type": "serve", "outcomes": ["101"], "shotSource": "ideal"})
            _recv_until(op, "served")
            # Replay ordering (docs/protocol.md): status, layout, THEN served.
            with client.websocket_connect("/ws/state") as late:
                assert late.receive_json()["type"] == "status"
                layout = late.receive_json()
                assert layout["type"] == "layout"
                assert layout["menu"] == "icecream"
                served = late.receive_json()
                assert served["type"] == "served"
                assert served["packId"] == "icecream"
                assert served["outcomes"] == ["101"]
                assert served["seq"] == 1
