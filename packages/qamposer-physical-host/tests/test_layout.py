"""LayoutStore defaults/partial-updates/persistence + /ws/state select_* + /api/layout."""

from __future__ import annotations

from conftest import FakePipeline, authenticate_operator
from fastapi.testclient import TestClient

from qamposer_host.config import HostConfig
from qamposer_host.layout import DEFAULT_MODE, MODE_PANELS, LayoutStore
from qamposer_host.main import create_app


# --- LayoutStore unit ------------------------------------------------------


def test_defaults_are_composer_preset():
    store = LayoutStore(None)
    state = store.state
    assert state.mode == DEFAULT_MODE == "composer"
    assert state.sidebar == "right"
    assert state.panels == ["results", "state", "qasm"]
    assert state.wires == "compact"
    assert store.message() == {
        "type": "layout",
        "mode": "composer",
        "sidebar": "right",
        "panels": ["results", "state", "qasm"],
        "wires": "compact",
    }


def test_select_mode_resets_panels_to_preset():
    store = LayoutStore(None)
    store.select_mode("golf")
    assert store.state.mode == "golf"
    assert store.state.panels == MODE_PANELS["golf"] == ["scorecard", "minicircuit", "results"]
    store.select_mode("attract")
    assert store.state.mode == "attract"
    assert store.state.panels == []


def test_select_mode_unknown_is_ignored():
    store = LayoutStore(None)
    before = store.state.to_dict()
    store.select_mode("cinema")
    assert store.state.to_dict() == before


def test_apply_layout_partial_keeps_omitted_fields():
    store = LayoutStore(None)
    store.apply_layout(sidebar="left")  # panels untouched
    assert store.state.sidebar == "left"
    assert store.state.panels == ["results", "state", "qasm"]

    store.apply_layout(panels=["results", "qasm"])  # sidebar untouched
    assert store.state.sidebar == "left"
    assert store.state.panels == ["results", "qasm"]


def test_apply_layout_unknown_panel_names_pass_through():
    store = LayoutStore(None)
    store.apply_layout(panels=["results", "totally_new_panel", "qsphere"])
    assert store.state.panels == ["results", "totally_new_panel", "qsphere"]


def test_apply_layout_invalid_sidebar_ignored():
    store = LayoutStore(None)
    store.apply_layout(sidebar="middle")
    assert store.state.sidebar == "right"


def test_persistence_roundtrip(tmp_path):
    path = tmp_path / "layout.toml"
    store = LayoutStore(path)
    store.select_mode("golf")
    store.apply_layout(sidebar="left", panels=["scorecard", "custom"])
    assert path.is_file()

    # A fresh store over the same file recovers the exact state.
    reloaded = LayoutStore(path)
    assert reloaded.state.mode == "golf"
    assert reloaded.state.sidebar == "left"
    assert reloaded.state.panels == ["scorecard", "custom"]


# --- WS + REST integration -------------------------------------------------


def _app(tmp_path):
    config = HostConfig.from_env(
        source="replay:none", backend="off",
        config_dir=str(tmp_path),
    )
    return create_app(config, pipeline=FakePipeline())


def test_ws_select_mode_broadcasts_and_persists(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()   # status
            ws.receive_json()   # seeded layout (replayed after status)
            authenticate_operator(ws, app)
            ws.send_json({"type": "select_mode", "mode": "golf"})
            layout = ws.receive_json()
            assert layout["type"] == "layout"
            assert layout["mode"] == "golf"
            assert layout["panels"] == ["scorecard", "minicircuit", "results"]
        # persisted next to config_dir
        assert (tmp_path / "layout.toml").is_file()
        # and reflected by REST
        body = client.get("/api/layout").json()
        assert body["mode"] == "golf"
        assert body["panels"] == ["scorecard", "minicircuit", "results"]


def test_ws_select_layout_partial(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()   # status
            ws.receive_json()   # seeded layout
            authenticate_operator(ws, app)
            ws.send_json({"type": "select_layout", "panels": ["results", "qasm"]})
            layout = ws.receive_json()
            assert layout["sidebar"] == "right"          # unchanged
            assert layout["panels"] == ["results", "qasm"]
            assert layout["mode"] == "composer"          # unchanged


def test_layout_replayed_to_late_joiner(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        # First client changes the layout.
        with client.websocket_connect("/ws/state") as ws1:
            ws1.receive_json()  # status
            ws1.receive_json()  # seeded layout
            authenticate_operator(ws1, app)
            ws1.send_json({"type": "select_layout", "sidebar": "left"})
            ws1.receive_json()  # updated layout broadcast

            # A late joiner must receive the current (changed) layout after status.
            with client.websocket_connect("/ws/state") as ws2:
                first = ws2.receive_json()
                assert first["type"] == "status"
                layout = ws2.receive_json()
                assert layout["type"] == "layout"
                assert layout["sidebar"] == "left"


def test_api_layout_default_shape(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        body = client.get("/api/layout").json()
        assert body == {
            "mode": "composer",
            "sidebar": "right",
            "panels": ["results", "state", "qasm"],
            "wires": "compact",
        }


# --- wires (booth-v2 display wire count) -----------------------------------


def test_apply_layout_sets_wires_and_keeps_omitted():
    store = LayoutStore(None)
    store.apply_layout(wires="all")  # sidebar/panels untouched
    assert store.state.wires == "all"
    assert store.state.sidebar == "right"
    assert store.state.panels == ["results", "state", "qasm"]


def test_apply_layout_invalid_wires_ignored():
    store = LayoutStore(None)
    store.apply_layout(wires="triangle")
    assert store.state.wires == "compact"


def test_select_mode_keeps_wires():
    store = LayoutStore(None)
    store.apply_layout(wires="all")
    store.select_mode("golf")  # switching mode must not reset the wire count
    assert store.state.wires == "all"


def test_wires_persist_roundtrip(tmp_path):
    path = tmp_path / "layout.toml"
    store = LayoutStore(path)
    store.apply_layout(wires="all")
    reloaded = LayoutStore(path)
    assert reloaded.state.wires == "all"


def test_ws_select_layout_wires_broadcasts(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # seeded layout
            authenticate_operator(ws, app)
            ws.send_json({"type": "select_layout", "wires": "all"})
            layout = ws.receive_json()
            assert layout["wires"] == "all"
            assert layout["panels"] == ["results", "state", "qasm"]  # unchanged
        assert client.get("/api/layout").json()["wires"] == "all"
