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
        assert set(body) == {"lanIp", "port", "tls", "captureUrl"}
        assert body["tls"] is True
        assert isinstance(body["port"], int)
        assert body["captureUrl"] == f"https://{body['lanIp']}:{body['port']}/capture"


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


def test_qr_returns_png():
    with TestClient(_app()) as client:
        resp = client.get("/api/qr", params={"path": "/capture"})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"
        assert resp.headers["X-Encoded-URL"].endswith("/capture")


def test_debug_snapshot_returns_jpeg_placeholder():
    with TestClient(_app()) as client:
        resp = client.get("/debug/snapshot.jpg")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/jpeg"
        assert resp.content[:2] == b"\xff\xd8"  # JPEG SOI marker
