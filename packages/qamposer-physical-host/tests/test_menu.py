"""Custom Quantina menu packs: listing, wire-JSON conversion, image streaming,
structural rejection, and path-traversal safety (docs/menu-packs.md, QN3)."""

from __future__ import annotations

from pathlib import Path

from conftest import FakePipeline
from fastapi.testclient import TestClient

from qamposer_host.config import HostConfig
from qamposer_host.main import create_app
from qamposer_host.menu import _is_plain_filename

# 1x1 transparent PNG (reused as opaque bytes for the image files).
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6360000002000154a24f8f0000000049454e44ae426082"
)
_SVG = b'<svg xmlns="http://www.w3.org/2000/svg"/>'

_PACK_TOML = """\
id = "cocktails"
title = "Quantum Bar"
tagline = "Mix your drink with a quantum computer"
experimental = "keep-me"

[serve]
mode = "shots"
shots = { min = 1, max = 5, default = 3 }

[theme]
accent = "#e91e63"
background = "bar.jpg"
logo = "logo.svg"

[[link]]
name = "IBM Quantum"
url = "https://www.ibm.com/quantum"

[[item]]
code = "0"
name = "Tropical Sunrise"
subtitle = "orange, mango, grenadine"
image = "sunrise.jpg"
emoji = "T"

[item.program]
key = "ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso"
options = [{ key = "FillQuantity", value = 50 }]

[[item]]
code = "1"
name = "Blue Lagoon"
emoji = "B"
"""


def _app(tmp_path):
    config = HostConfig.from_env(
        source="replay:none", backend="off", config_dir=str(tmp_path),
    )
    return create_app(config, pipeline=FakePipeline())


def _write_pack(tmp_path: Path, dir_name: str = "cocktails", toml: str = _PACK_TOML):
    pack_dir = tmp_path / "menu" / dir_name
    pack_dir.mkdir(parents=True)
    (pack_dir / "pack.toml").write_text(toml, encoding="utf-8")
    (pack_dir / "sunrise.jpg").write_bytes(_PNG)
    (pack_dir / "bar.jpg").write_bytes(_PNG)
    (pack_dir / "logo.svg").write_bytes(_SVG)
    return pack_dir


# --- empty / missing -------------------------------------------------------


def test_no_menu_dir_yields_empty_list(tmp_path):
    app = _app(tmp_path)
    with TestClient(app) as client:
        assert client.get("/api/menu/packs").json() == {"packs": []}
        assert client.get("/api/menu/pack/cocktails").status_code == 404


# --- listing ---------------------------------------------------------------


def test_packs_listing(tmp_path):
    _write_pack(tmp_path)
    app = _app(tmp_path)
    with TestClient(app) as client:
        body = client.get("/api/menu/packs").json()
        assert body == {
            "packs": [
                {
                    "id": "cocktails",
                    "title": "Quantum Bar",
                    "tagline": "Mix your drink with a quantum computer",
                }
            ]
        }


# --- wire-JSON conversion golden ------------------------------------------


def test_pack_wire_json_golden(tmp_path):
    _write_pack(tmp_path)
    app = _app(tmp_path)
    with TestClient(app) as client:
        pack = client.get("/api/menu/pack/cocktails").json()
        assert pack == {
            "id": "cocktails",
            "title": "Quantum Bar",
            "tagline": "Mix your drink with a quantum computer",
            # Unknown top-level fields pass through untouched (forward-compatible).
            "experimental": "keep-me",
            "serve": {"mode": "shots", "shots": {"min": 1, "max": 5, "default": 3}},
            "theme": {
                "accent": "#e91e63",
                # File refs rewritten to absolute API URLs.
                "background": "/api/menu/pack/cocktails/image/bar.jpg",
                "logo": "/api/menu/pack/cocktails/image/logo.svg",
            },
            # [[link]] -> links.
            "links": [{"name": "IBM Quantum", "url": "https://www.ibm.com/quantum"}],
            # [[item]] -> items; image rewritten; program payload passed through.
            "items": [
                {
                    "code": "0",
                    "name": "Tropical Sunrise",
                    "subtitle": "orange, mango, grenadine",
                    "image": "/api/menu/pack/cocktails/image/sunrise.jpg",
                    "emoji": "T",
                    "program": {
                        "key": "ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso",
                        "options": [{"key": "FillQuantity", "value": 50}],
                    },
                },
                {"code": "1", "name": "Blue Lagoon", "emoji": "B"},
            ],
        }


# --- rejection: id/dir mismatch, bad toml ---------------------------------


def test_id_dir_mismatch_rejected(tmp_path):
    # Directory "wrongname" but the TOML says id = "cocktails" -> skipped.
    _write_pack(tmp_path, dir_name="wrongname")
    app = _app(tmp_path)
    with TestClient(app) as client:
        assert client.get("/api/menu/packs").json() == {"packs": []}
        # Reachable by neither the dir name nor the mismatched id.
        assert client.get("/api/menu/pack/wrongname").status_code == 404
        assert client.get("/api/menu/pack/cocktails").status_code == 404


def test_invalid_toml_skipped(tmp_path):
    pack_dir = tmp_path / "menu" / "broken"
    pack_dir.mkdir(parents=True)
    (pack_dir / "pack.toml").write_text("this is not = valid = toml", encoding="utf-8")
    app = _app(tmp_path)
    with TestClient(app) as client:
        assert client.get("/api/menu/packs").json() == {"packs": []}
        assert client.get("/api/menu/pack/broken").status_code == 404


def test_missing_title_rejected(tmp_path):
    # No title -> structural rejection.
    _write_pack(tmp_path, dir_name="notitle", toml='id = "notitle"\n[[item]]\ncode="0"\nname="x"\n')
    app = _app(tmp_path)
    with TestClient(app) as client:
        assert client.get("/api/menu/pack/notitle").status_code == 404


# --- image streaming -------------------------------------------------------


def test_image_streaming_content_types(tmp_path):
    _write_pack(tmp_path)
    app = _app(tmp_path)
    with TestClient(app) as client:
        jpg = client.get("/api/menu/pack/cocktails/image/sunrise.jpg")
        assert jpg.status_code == 200
        assert jpg.headers["content-type"] == "image/jpeg"
        assert jpg.content == _PNG

        svg = client.get("/api/menu/pack/cocktails/image/logo.svg")
        assert svg.status_code == 200
        assert svg.headers["content-type"].startswith("image/svg+xml")
        assert svg.content == _SVG


def test_image_missing_404(tmp_path):
    _write_pack(tmp_path)
    app = _app(tmp_path)
    with TestClient(app) as client:
        assert client.get("/api/menu/pack/cocktails/image/nope.png").status_code == 404


# --- path-traversal safety -------------------------------------------------


def test_is_plain_filename_rejects_traversal():
    assert _is_plain_filename("sunrise.jpg")
    assert _is_plain_filename("a..b.png")  # embedded dots are fine
    assert not _is_plain_filename("../secret")
    assert not _is_plain_filename("a/b.png")
    assert not _is_plain_filename("..")
    assert not _is_plain_filename(".")
    assert not _is_plain_filename("/etc/passwd")
    assert not _is_plain_filename("")


def test_traversal_image_ref_in_toml_rejected(tmp_path):
    # A pack whose item references a file outside its dir is rejected wholesale.
    toml = (
        'id = "evil"\ntitle = "Evil"\n'
        '[[item]]\ncode = "0"\nname = "x"\nimage = "../secret.png"\n'
        '[[item]]\ncode = "1"\nname = "y"\n'
    )
    _write_pack(tmp_path, dir_name="evil", toml=toml)
    app = _app(tmp_path)
    with TestClient(app) as client:
        assert client.get("/api/menu/packs").json() == {"packs": []}
        assert client.get("/api/menu/pack/evil").status_code == 404


def test_traversal_image_endpoint_rejected(tmp_path):
    _write_pack(tmp_path)
    app = _app(tmp_path)
    with TestClient(app) as client:
        # A non-plain filename segment (encoded "..") -> 400, never a read outside.
        assert client.get("/api/menu/pack/cocktails/image/%2e%2e").status_code == 400
        # A second path segment does not match {filename} -> 404 (no traversal).
        assert client.get("/api/menu/pack/cocktails/image/a/b.png").status_code == 404
        # A non-plain pack id likewise 400s at the image endpoint.
        assert client.get("/api/menu/pack/%2e%2e/image/x.png").status_code == 400
