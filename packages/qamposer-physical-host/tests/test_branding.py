"""/api/branding with and without branding.toml, plus logo serving."""

from __future__ import annotations

from conftest import FakePipeline
from fastapi.testclient import TestClient

from qamposer_host.config import HostConfig
from qamposer_host.main import create_app

# 1x1 transparent PNG.
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6360000002000154a24f8f0000000049454e44ae426082"
)


def _app(tmp_path):
    config = HostConfig.from_env(
        source="replay:none", backend="off",
        config_dir=str(tmp_path),
    )
    return create_app(config, pipeline=FakePipeline())


def test_branding_defaults_when_absent(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        body = client.get("/api/branding").json()
        assert body == {"name": "Entangible", "logoUrl": None, "qrTarget": None}
        # No logo file → the logo endpoint 404s.
        assert client.get("/api/branding/logo").status_code == 404


def test_branding_from_toml_with_logo(tmp_path):
    (tmp_path / "logo.png").write_bytes(_PNG)
    (tmp_path / "branding.toml").write_text(
        'name = "Quantum Fair 2026"\n'
        'logo = "logo.png"\n'
        'qr_target = "https://example.org/learn"\n',
        encoding="utf-8",
    )
    app = _app(tmp_path)
    with TestClient(app) as client:
        body = client.get("/api/branding").json()
        assert body == {
            "name": "Quantum Fair 2026",
            "logoUrl": "/api/branding/logo",
            "qrTarget": "https://example.org/learn",
        }
        logo = client.get("/api/branding/logo")
        assert logo.status_code == 200
        assert logo.headers["content-type"] == "image/png"
        assert logo.content == _PNG


def test_branding_missing_logo_file_yields_null(tmp_path):
    # branding.toml names a logo that does not exist → logoUrl is null, no 500.
    (tmp_path / "branding.toml").write_text(
        'name = "No Logo Event"\nlogo = "missing.svg"\n', encoding="utf-8",
    )
    app = _app(tmp_path)
    with TestClient(app) as client:
        body = client.get("/api/branding").json()
        assert body["name"] == "No Logo Event"
        assert body["logoUrl"] is None
        assert client.get("/api/branding/logo").status_code == 404
