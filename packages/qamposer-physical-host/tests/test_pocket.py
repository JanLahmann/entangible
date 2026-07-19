"""Serving the ONE Entangible app (pocket build) at / (Entangible One, U3).

The former two-app split is retired: the pocket build is served at ``/`` (with
``/debug`` and any client route falling back to its SPA index), and the legacy
``/pocket`` path is a compatibility redirect to ``/`` that preserves the query
(QRs in the wild still encode ``/pocket?connect=1``).
"""

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


def test_serves_app_at_root(tmp_path):
    dist = _build_fake_pocket(tmp_path)
    with TestClient(_app(str(dist))) as client:
        resp = client.get("/")
        assert resp.status_code == 200
        assert "Entangible Pocket" in resp.text


def test_serves_static_asset(tmp_path):
    dist = _build_fake_pocket(tmp_path)
    with TestClient(_app(str(dist))) as client:
        resp = client.get("/assets/app.js")
        assert resp.status_code == 200
        assert "pocket" in resp.text


def test_debug_route_serves_spa_index(tmp_path):
    # /debug is a client route of the one app; the host serves the SPA index.
    dist = _build_fake_pocket(tmp_path)
    with TestClient(_app(str(dist))) as client:
        resp = client.get("/debug")
        assert resp.status_code == 200
        assert "Entangible Pocket" in resp.text


def test_spa_fallback_for_client_route(tmp_path):
    dist = _build_fake_pocket(tmp_path)
    with TestClient(_app(str(dist))) as client:
        resp = client.get("/some/deep/route")
        assert resp.status_code == 200
        assert "Entangible Pocket" in resp.text  # index.html served


def test_missing_asset_is_404(tmp_path):
    dist = _build_fake_pocket(tmp_path)
    with TestClient(_app(str(dist))) as client:
        resp = client.get("/assets/missing.js")
        assert resp.status_code == 404


def test_pocket_redirects_to_root(tmp_path):
    # QRs in the wild encode /pocket?connect=1 — it must redirect to / and keep
    # the query so the app auto-connects to the booth.
    dist = _build_fake_pocket(tmp_path)
    with TestClient(_app(str(dist))) as client:
        bare = client.get("/pocket", follow_redirects=False)
        assert bare.status_code == 307
        assert bare.headers["location"] == "/"

        connect = client.get("/pocket?connect=1", follow_redirects=False)
        assert connect.status_code == 307
        assert connect.headers["location"] == "/?connect=1"

        # The staff camera-role QR (/pocket?connect=1&role=camera&key=…) too.
        camera = client.get(
            "/pocket?connect=1&role=camera&key=abc", follow_redirects=False
        )
        assert camera.status_code == 307
        assert camera.headers["location"] == "/?connect=1&role=camera&key=abc"

        # Any /pocket/* subpath redirects home as well.
        sub = client.get("/pocket/anything?x=1", follow_redirects=False)
        assert sub.status_code == 307
        assert sub.headers["location"] == "/?x=1"

        # And following the visitor redirect lands on the SPA index.
        followed = client.get("/pocket?connect=1")
        assert followed.status_code == 200
        assert "Entangible Pocket" in followed.text


def test_not_built_shows_friendly_page(tmp_path):
    with TestClient(_app(str(tmp_path / "nope"))) as client:
        resp = client.get("/")
        assert resp.status_code == 200
        assert "not been built" in resp.text.lower()


def test_not_built_asset_is_404(tmp_path):
    with TestClient(_app(str(tmp_path / "nope"))) as client:
        resp = client.get("/assets/app.js")
        assert resp.status_code == 404
