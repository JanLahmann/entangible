"""HTTP surface: /api/health shape, /qamposer-api 503, static fallback, QR."""

from __future__ import annotations

from conftest import FakePipeline
from fastapi.testclient import TestClient

from qamposer_host.config import HostConfig
from qamposer_host.main import create_app


def _app(**overrides):
    config = HostConfig.from_env(
        source="replay:none", backend="off", display_dist="/no/such/dist",
        **overrides,
    )
    # Inject a fake pipeline so the suite never depends on the vision package
    # being importable (it is built in parallel).
    return create_app(config, pipeline=FakePipeline())


def test_health_shape():
    with TestClient(_app()) as client:
        resp = client.get("/api/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["backend"] == {"enabled": False, "healthy": False}
        assert set(body["camera"]) == {"kind", "name", "connected"}
        assert body["camera"]["kind"] == "replay"
        assert body["clients"] == 0


def test_info_shape_tls_default():
    with TestClient(_app()) as client:
        resp = client.get("/api/info")
        assert resp.status_code == 200
        body = resp.json()
        assert set(body) == {"lanIp", "port", "tls", "captureUrl", "security"}
        assert body["tls"] is True
        assert isinstance(body["port"], int)
        assert body["captureUrl"] == f"https://{body['lanIp']}:{body['port']}/capture"
        # Additive: token-enforcing hosts advertise operator security.
        assert body["security"] == {"operator": True}


def test_info_reflects_no_tls():
    with TestClient(_app(tls=False, port=8080)) as client:
        body = client.get("/api/info").json()
        assert body["tls"] is False
        assert body["port"] == 8080
        assert body["captureUrl"].startswith("http://")
        assert body["captureUrl"].endswith(":8080/capture")


def test_qamposer_api_503_when_off():
    with TestClient(_app()) as client:
        resp = client.get("/qamposer-api/jobs")
        assert resp.status_code == 503
        body = resp.json()
        assert body["error"] == "backend_disabled"
        assert body["mode"] == "off"


def test_static_fallback_when_dist_missing():
    with TestClient(_app()) as client:
        root = client.get("/")
        assert root.status_code == 200
        assert "display app has not been built" in root.text.lower()

        # SPA client route also gets the friendly page:
        spa = client.get("/capture")
        assert spa.status_code == 200
        assert "not been built" in spa.text.lower()

        # asset-looking request 404s rather than returning HTML:
        asset = client.get("/assets/app.js")
        assert asset.status_code == 404


def test_reserved_prefixes_not_spa():
    with TestClient(_app()) as client:
        # unknown /api path is a 404, not the SPA index:
        assert client.get("/api/does-not-exist").status_code == 404


def test_qr_returns_png_and_embeds_key():
    app = _app()
    token = app.state.operator_token
    with TestClient(app) as client:
        resp = client.get("/api/qr", params={"path": "/capture", "key": token})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"
        # The encoded capture URL carries the operator key for the phone.
        encoded = resp.headers["X-Encoded-URL"]
        assert encoded.endswith(f"/capture?key={token}")


def test_qr_default_targets_pocket_camera_role():
    # U2: with no `path` param, the staff QR opens the pocket app in its CAMERA
    # role, carrying the operator token so /ws/frames + operator /ws/state work.
    app = _app()
    token = app.state.operator_token
    with TestClient(app) as client:
        resp = client.get("/api/qr", params={"key": token})
        assert resp.status_code == 200
        encoded = resp.headers["X-Encoded-URL"]
        assert encoded.endswith(f"/pocket?connect=1&role=camera&key={token}")


def test_qr_legacy_capture_path_still_available():
    # The display-app capture page stays reachable via ?path=/capture (until U3).
    app = _app()
    token = app.state.operator_token
    with TestClient(app) as client:
        resp = client.get("/api/qr", params={"path": "/capture", "key": token})
        assert resp.status_code == 200
        assert resp.headers["X-Encoded-URL"].endswith(f"/capture?key={token}")


def test_qr_requires_key():
    with TestClient(_app()) as client:
        resp = client.get("/api/qr", params={"path": "/capture"})
        assert resp.status_code == 403
        assert resp.json()["detail"]["error"] == "operator_key_required"

        wrong = client.get("/api/qr", params={"path": "/capture", "key": "nope"})
        assert wrong.status_code == 403


def test_qr_accepts_header_key():
    app = _app()
    with TestClient(app) as client:
        resp = client.get(
            "/api/qr",
            params={"path": "/capture"},
            headers={"X-Operator-Key": app.state.operator_token},
        )
        assert resp.status_code == 200


def test_visitor_qr_is_open_and_encodes_pocket_connect():
    app = _app()
    token = app.state.operator_token
    with TestClient(app) as client:
        # No key needed — the visitor QR is view-only.
        resp = client.get("/api/visitor-qr")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"
        encoded = resp.headers["X-Encoded-URL"]
        assert encoded.endswith("/pocket?connect=1")
        # The visitor QR must NEVER leak the operator token.
        assert "key=" not in encoded
        assert token not in encoded


def test_visitor_qr_reflects_no_tls_scheme():
    with TestClient(_app(tls=False, port=8080)) as client:
        resp = client.get("/api/visitor-qr")
        assert resp.status_code == 200
        encoded = resp.headers["X-Encoded-URL"]
        assert encoded.startswith("http://")
        assert encoded.endswith(":8080/pocket?connect=1")


def test_debug_snapshot_requires_key():
    with TestClient(_app()) as client:
        resp = client.get("/debug/snapshot.jpg")
        assert resp.status_code == 403


def test_debug_snapshot_returns_jpeg_placeholder_with_key():
    app = _app()
    with TestClient(app) as client:
        resp = client.get("/debug/snapshot.jpg", params={"key": app.state.operator_token})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/jpeg"
        assert resp.content[:2] == b"\xff\xd8"  # JPEG SOI marker


def test_debug_stream_requires_key():
    with TestClient(_app()) as client:
        resp = client.get("/debug/stream")
        assert resp.status_code == 403
