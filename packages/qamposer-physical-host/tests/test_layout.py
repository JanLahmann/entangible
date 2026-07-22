"""LayoutStore defaults/partial-updates/persistence + /ws/state select_* + /api/layout."""

from __future__ import annotations

from conftest import FakePipeline, authenticate_operator
from fastapi.testclient import TestClient

from qamposer_host.config import HostConfig
import pytest
from qamposer_host.layout import (
    DEFAULT_MODE,
    MODE_PANELS,
    PRESETLESS_PANELS,
    LayoutStore,
)
from qamposer_host.main import create_app


# --- LayoutStore unit ------------------------------------------------------


def test_defaults_are_composer_preset():
    store = LayoutStore(None)
    state = store.state
    assert state.mode == DEFAULT_MODE == "composer"
    assert state.sidebar == "right"
    assert state.panels == ["results", "state", "qasm"]
    assert state.wires == "compact"
    assert state.noise == "off"
    assert state.menu is None
    assert store.message() == {
        "type": "layout",
        "mode": "composer",
        "sidebar": "right",
        "panels": ["results", "state", "qasm"],
        "wires": "compact",
        "noise": "off",
        "menu": None,
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


# --- camera panel (presetless, valid in every mode; task #49) --------------


def test_camera_is_in_no_mode_preset():
    # The operator-key-gated camera panel is opt-in per session — select_mode's
    # panel reset must never enable it, so it appears in no mode's preset.
    for preset in MODE_PANELS.values():
        for panel in PRESETLESS_PANELS:
            assert panel not in preset
    assert "camera" in PRESETLESS_PANELS


def test_select_mode_never_yields_camera():
    store = LayoutStore(None)
    for mode in MODE_PANELS:
        store.select_mode(mode)
        assert "camera" not in store.state.panels


def test_apply_layout_accepts_camera_in_every_mode():
    # Panels are free-form pass-through, so 'camera' is a legal panel in every
    # mode — select_layout keeps it regardless of the current mode, and the
    # mode's preset constant is never mutated by the opt-in.
    presets_before = {m: list(p) for m, p in MODE_PANELS.items()}
    for mode in MODE_PANELS:
        store = LayoutStore(None)
        store.select_mode(mode)
        store.apply_layout(panels=[*store.state.panels, "camera"])
        assert store.state.panels[-1] == "camera"
    assert {m: list(p) for m, p in MODE_PANELS.items()} == presets_before


def test_camera_panel_persist_roundtrip(tmp_path):
    path = tmp_path / "layout.toml"
    store = LayoutStore(path)
    store.apply_layout(panels=["results", "camera"])
    reloaded = LayoutStore(path)
    assert reloaded.state.panels == ["results", "camera"]


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
            "noise": "off",
            "menu": None,
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


# --- noise (booth-wide in-browser noise-model preset) ----------------------


def test_select_noise_sets_preset_and_keeps_omitted():
    store = LayoutStore(None)
    store.select_noise("heron")  # mode/sidebar/panels/wires untouched
    assert store.state.noise == "heron"
    assert store.state.mode == "composer"
    assert store.state.wires == "compact"
    assert store.state.panels == ["results", "state", "qasm"]


def test_select_noise_invalid_ignored():
    store = LayoutStore(None)
    store.select_noise("qutrit")
    assert store.state.noise == "off"


def test_select_mode_keeps_noise():
    store = LayoutStore(None)
    store.select_noise("eagle")
    store.select_mode("golf")  # switching mode must not reset the noise preset
    assert store.state.noise == "eagle"


def test_noise_persist_roundtrip(tmp_path):
    path = tmp_path / "layout.toml"
    store = LayoutStore(path)
    store.select_noise("nighthawk")
    reloaded = LayoutStore(path)
    assert reloaded.state.noise == "nighthawk"


def test_ws_select_noise_broadcasts_for_operator(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # seeded layout
            authenticate_operator(ws, app)
            ws.send_json({"type": "select_noise", "preset": "heron"})
            layout = ws.receive_json()
            assert layout["type"] == "layout"
            assert layout["noise"] == "heron"
            assert layout["panels"] == ["results", "state", "qasm"]  # unchanged
        assert client.get("/api/layout").json()["noise"] == "heron"


def test_ws_select_noise_replayed_to_late_joiner(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws1:
            ws1.receive_json()  # status
            ws1.receive_json()  # seeded layout
            authenticate_operator(ws1, app)
            ws1.send_json({"type": "select_noise", "preset": "falcon"})
            ws1.receive_json()  # updated layout broadcast

            # A late joiner receives the current (changed) noise after status.
            with client.websocket_connect("/ws/state") as ws2:
                assert ws2.receive_json()["type"] == "status"
                layout = ws2.receive_json()
                assert layout["type"] == "layout"
                assert layout["noise"] == "falcon"


def test_ws_select_noise_ignored_for_viewers(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # seeded layout
            # No operator hello → select_noise is silently ignored (no broadcast).
            ws.send_json({"type": "select_noise", "preset": "heron"})
            ws.send_text("not json {")  # still alive, still no response
            # Authenticate, then the same select_noise is honored.
            authenticate_operator(ws, app)
            ws.send_json({"type": "select_noise", "preset": "heron"})
            layout = ws.receive_json()
            assert layout["type"] == "layout"
            assert layout["noise"] == "heron"
        # The viewer attempt never mutated state (only the operator one did).
        assert client.get("/api/layout").json()["noise"] == "heron"


def test_ws_select_noise_invalid_value_ignored(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # seeded layout
            authenticate_operator(ws, app)
            # An invalid preset leaves the state at the default 'off' (the
            # re-broadcast layout — like select_mode/select_layout no-ops —
            # carries the unchanged value).
            ws.send_json({"type": "select_noise", "preset": "qutrit"})
            layout = ws.receive_json()
            assert layout["type"] == "layout"
            assert layout["noise"] == "off"
        assert client.get("/api/layout").json()["noise"] == "off"


# --- quantina (menu-pack mode + select_menu) -------------------------------


def test_quantina_mode_panels_preset():
    assert MODE_PANELS["quantina"] == ["menu", "order", "results"]


def test_select_mode_quantina_sets_panels():
    store = LayoutStore(None)
    store.select_mode("quantina")
    assert store.state.mode == "quantina"
    assert store.state.panels == ["menu", "order", "results"]


def test_menu_defaults_none_and_in_message_and_dict():
    store = LayoutStore(None)
    assert store.state.menu is None
    assert store.message()["menu"] is None
    assert store.state.to_dict()["menu"] is None


def test_select_menu_sets_pack_and_keeps_omitted():
    store = LayoutStore(None)
    store.select_menu("cocktails")  # mode/sidebar/panels/wires/noise untouched
    assert store.state.menu == "cocktails"
    assert store.state.mode == "composer"
    assert store.state.noise == "off"
    assert store.state.panels == ["results", "state", "qasm"]
    assert store.message()["menu"] == "cocktails"
    assert store.state.to_dict()["menu"] == "cocktails"


@pytest.mark.parametrize(
    "pack",
    ["Cocktails", "COCKTAILS", "", "a" * 65, "with space", "under_score", "café"],
)
def test_select_menu_invalid_format_ignored(pack):
    store = LayoutStore(None)
    store.select_menu(pack)
    assert store.state.menu is None


def test_select_menu_boundary_ids_accepted():
    store = LayoutStore(None)
    store.select_menu("a")  # 1 char
    assert store.state.menu == "a"
    long_id = "a" * 64  # 64 chars — the upper bound
    store.select_menu(long_id)
    assert store.state.menu == long_id


def test_menu_persist_roundtrip(tmp_path):
    path = tmp_path / "layout.toml"
    store = LayoutStore(path)
    store.select_menu("icecream")
    reloaded = LayoutStore(path)
    assert reloaded.state.menu == "icecream"


def test_menu_absent_from_toml_when_none(tmp_path):
    path = tmp_path / "layout.toml"
    store = LayoutStore(path)
    store.select_mode("quantina")  # persists, but no menu chosen yet
    assert path.is_file()
    assert "menu =" not in path.read_text()  # no top-level menu key emitted
    reloaded = LayoutStore(path)
    assert reloaded.state.menu is None


def test_toml_ignores_malformed_menu(tmp_path):
    path = tmp_path / "layout.toml"
    path.write_text('mode = "quantina"\nmenu = "Bad Id!"\n')
    store = LayoutStore(path)
    assert store.state.mode == "quantina"
    assert store.state.menu is None  # invalid format → left None


def test_select_mode_keeps_menu():
    store = LayoutStore(None)
    store.select_menu("coffee")
    store.select_mode("golf")  # switching mode must not clear the menu pack
    assert store.state.menu == "coffee"


def test_ws_select_menu_broadcasts_and_persists(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # seeded layout
            authenticate_operator(ws, app)
            ws.send_json({"type": "select_menu", "pack": "cocktails"})
            layout = ws.receive_json()
            assert layout["type"] == "layout"
            assert layout["menu"] == "cocktails"
            assert layout["panels"] == ["results", "state", "qasm"]  # unchanged
        assert client.get("/api/layout").json()["menu"] == "cocktails"


def test_ws_select_menu_ignored_for_viewers(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        with client.websocket_connect("/ws/state") as ws:
            ws.receive_json()  # status
            ws.receive_json()  # seeded layout
            # No operator hello → select_menu is silently ignored (no broadcast).
            ws.send_json({"type": "select_menu", "pack": "cocktails"})
            ws.send_text("not json {")  # still alive, still no response
            authenticate_operator(ws, app)
            ws.send_json({"type": "select_menu", "pack": "cocktails"})
            layout = ws.receive_json()
            assert layout["type"] == "layout"
            assert layout["menu"] == "cocktails"
        assert client.get("/api/layout").json()["menu"] == "cocktails"
