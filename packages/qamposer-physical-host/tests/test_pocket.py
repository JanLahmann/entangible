"""Serving the Entangible Pocket standalone app at /pocket."""

from __future__ import annotations

from pathlib import Path

from conftest import FakePipeline
from fastapi.testclient import TestClient

from qamposer_host.config import HostConfig
from qamposer_host.main import create_app


def _app(pocket_dist: str):
    config = HostConfig.from_env(
        source="replay:none",
        backend="off",
        display_dist="/no/such/display",
        pocket_dist=pocket_dist,
    )
    return create_app(config, pipeline=FakePipeline())


def _build_fake_pocket(tmp_path: Path) -> Path:
    dist = tmp_path / "pocket-dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>Entangible Pocket</title>", "utf-8")
    (dist / "assets" / "app.js").write_text("console.log('pocket');", "utf-8")
    (dist / "manifest.webmanifest").write_text('{"name":"Entangible Pocket"}', "utf-8")
    return dist


def test_pocket_root_redirects_to_trailing_slash(tmp_path):
    dist = _build_fake_pocket(tmp_path)
    with TestClient(_app(str(dist))) as client:
        resp = client.get("/pocket", follow_redirects=False)
        assert resp.status_code == 307
        assert resp.headers["location"] == "/pocket/"


def test_pocket_root_preserves_connect_query(tmp_path):
    # The visitor QR points at /pocket?connect=1; the ?connect flag must survive
    # the trailing-slash redirect so the app auto-connects to the booth.
    dist = _build_fake_pocket(tmp_path)
    with TestClient(_app(str(dist))) as client:
        resp = client.get("/pocket?connect=1", follow_redirects=False)
        assert resp.status_code == 307
        assert resp.headers["location"] == "/pocket/?connect=1"
        # And following it lands on the SPA index (which reads ?connect=1).
        followed = client.get("/pocket?connect=1")
        assert followed.status_code == 200
        assert "Entangible Pocket" in followed.text


def test_pocket_serves_index(tmp_path):
    dist = _build_fake_pocket(tmp_path)
    with TestClient(_app(str(dist))) as client:
        resp = client.get("/pocket/")
        assert resp.status_code == 200
        assert "Entangible Pocket" in resp.text


def test_pocket_serves_static_asset(tmp_path):
    dist = _build_fake_pocket(tmp_path)
    with TestClient(_app(str(dist))) as client:
        resp = client.get("/pocket/assets/app.js")
        assert resp.status_code == 200
        assert "pocket" in resp.text


def test_pocket_spa_fallback_for_client_route(tmp_path):
    dist = _build_fake_pocket(tmp_path)
    with TestClient(_app(str(dist))) as client:
        resp = client.get("/pocket/some/deep/route")
        assert resp.status_code == 200
        assert "Entangible Pocket" in resp.text  # index.html served


def test_pocket_missing_asset_is_404(tmp_path):
    dist = _build_fake_pocket(tmp_path)
    with TestClient(_app(str(dist))) as client:
        resp = client.get("/pocket/assets/missing.js")
        assert resp.status_code == 404


def test_pocket_not_built_shows_friendly_page(tmp_path):
    with TestClient(_app(str(tmp_path / "nope"))) as client:
        resp = client.get("/pocket/")
        assert resp.status_code == 200
        assert "not built" in resp.text.lower()


def test_pocket_not_built_asset_is_404(tmp_path):
    with TestClient(_app(str(tmp_path / "nope"))) as client:
        resp = client.get("/pocket/assets/app.js")
        assert resp.status_code == 404


def test_pocket_does_not_shadow_display_root(tmp_path):
    # The display SPA catch-all still owns '/', unaffected by the pocket routes.
    dist = _build_fake_pocket(tmp_path)
    with TestClient(_app(str(dist))) as client:
        resp = client.get("/")
        # display_dist is missing → the display 'not built' page, not pocket's.
        assert resp.status_code == 200
        assert "display app has not been built" in resp.text.lower()
