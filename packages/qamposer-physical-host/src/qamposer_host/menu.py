"""Custom Quantina menu packs (host-side config directory) + their REST API.

A *menu pack* encodes N menu items as the binary measurement outcomes of a
quantum circuit (see docs/quantina.md, docs/menu-packs.md). The app bundles a
handful of built-in packs; this module serves ADDITIONAL packs authored on the
host as ``menu/<id>/pack.toml`` (+ image files) next to the other config files
(``branding.toml`` / ``layout.toml``), converting each to the canonical wire
schema of ``shared/menu/pack.ts`` when served.

Endpoints (all OPEN — menu data is visitor-visible, no operator token):

* ``GET /api/menu/packs`` — ``{"packs": [{"id", "title", "tagline"?}]}`` over the
  host-side custom packs only (built-ins live in the client bundle).
* ``GET /api/menu/pack/{id}`` — the wire JSON for one pack (404 unknown).
* ``GET /api/menu/pack/{id}/image/{filename}`` — a streamed image file.

Host-side validation is **structural only** (types/presence + path-traversal
safety); the client re-validates fully with ``validatePack``. Unknown fields
pass through untouched so a newer pack still loads on an older host. The pack
directory name MUST equal the TOML ``id`` — a mismatch rejects the pack (logged).

TOML → wire-schema conversion (field names map 1:1, camelCase already):

* the array-of-tables ``[[item]]`` / ``[[link]]`` become the wire's ``items`` /
  ``links`` arrays;
* ``image`` (item) and ``background`` / ``logo`` (theme) file references become
  absolute URL paths ``/api/menu/pack/{id}/image/{filename}``;
* everything else (``serve``, ``program`` payloads, unknown fields) is copied
  verbatim.
"""

from __future__ import annotations

import logging
import tomllib
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

logger = logging.getLogger("qamposer_host.menu")

router = APIRouter()


class PackError(ValueError):
    """A structural problem that rejects a pack (never fatal — the pack is skipped)."""


def _menu_dir(request: Request) -> Path:
    """Where custom packs live: ``<config_dir>/menu`` (alongside the other config)."""
    config = request.app.state.config
    return Path(config.config_dir) / "menu"


def _is_plain_filename(name: object) -> bool:
    """True for a single, in-directory filename — no separators, no ``..``, not absolute.

    The trust gate for every author-supplied file reference (item ``image``,
    theme ``background`` / ``logo``) AND for the ``{id}`` / ``{filename}`` path
    params: a plain filename cannot escape the pack directory.
    """
    if not isinstance(name, str) or not name:
        return False
    if "/" in name or "\\" in name or name in (".", ".."):
        return False
    return Path(name).name == name and not Path(name).is_absolute()


def _image_url(pack_id: str, filename: str) -> str:
    return f"/api/menu/pack/{pack_id}/image/{filename}"


def _rewrite_image(pack_id: str, value: object, where: str) -> str:
    """Validate a plain-filename image reference and rewrite it to its API URL."""
    if not _is_plain_filename(value):
        raise PackError(f"{where} must be a plain filename in the pack dir (no '/' or '..')")
    return _image_url(pack_id, str(value))


def _convert_theme(theme: dict, pack_id: str) -> dict:
    out = dict(theme)
    for key in ("background", "logo"):
        v = theme.get(key)
        if isinstance(v, str):
            out[key] = _rewrite_image(pack_id, v, f"theme.{key}")
    return out


def _convert_item(item: object, pack_id: str) -> dict:
    if not isinstance(item, dict):
        raise PackError("each [[item]] must be a table")
    out = dict(item)
    img = item.get("image")
    if isinstance(img, str):
        out["image"] = _rewrite_image(pack_id, img, "item image")
    return out


def _convert_pack(data: dict, pack_id: str) -> dict:
    """Build the wire-schema dict from a parsed pack.toml (structural checks only)."""
    # Copy every top-level field verbatim (forward-compatible), except the ones
    # that are renamed (item/link → items/links) or rewritten (theme images).
    out = {k: v for k, v in data.items() if k not in ("item", "link", "theme")}

    theme = data.get("theme")
    if theme is not None:
        if not isinstance(theme, dict):
            raise PackError("theme must be a table")
        out["theme"] = _convert_theme(theme, pack_id)

    if "link" in data:
        links = data["link"]
        if not isinstance(links, list):
            raise PackError("[[link]] must be an array of tables")
        out["links"] = links

    items = data.get("item")
    if not isinstance(items, list) or not items:
        raise PackError("a pack needs at least one [[item]]")
    out["items"] = [_convert_item(it, pack_id) for it in items]

    return out


def _build_pack(data: object, dir_name: str) -> dict:
    """Structural validation + conversion. Raises :class:`PackError` on rejection."""
    if not isinstance(data, dict):
        raise PackError("pack.toml must be a table")
    pack_id = data.get("id")
    if not isinstance(pack_id, str) or not pack_id:
        raise PackError("id must be a nonempty string")
    if pack_id != dir_name:
        raise PackError(
            f"id {pack_id!r} must equal the directory name {dir_name!r}"
        )
    title = data.get("title")
    if not isinstance(title, str) or not title:
        raise PackError("title must be a nonempty string")
    return _convert_pack(data, pack_id)


def load_pack(pack_dir: Path) -> dict | None:
    """Load + convert ``<pack_dir>/pack.toml`` to wire JSON, or ``None`` if invalid.

    Every failure (missing/unreadable TOML, structural rejection) is logged and
    yields ``None`` so a bad pack is simply skipped, never fatal.
    """
    toml_path = pack_dir / "pack.toml"
    if not toml_path.is_file():
        return None
    try:
        with toml_path.open("rb") as fh:
            data = tomllib.load(fh)
    except (OSError, tomllib.TOMLDecodeError):
        logger.warning("could not read menu pack %s; skipping", toml_path, exc_info=True)
        return None
    try:
        return _build_pack(data, pack_dir.name)
    except PackError as exc:
        logger.warning("invalid menu pack %s: %s; skipping", toml_path, exc)
        return None


def _iter_pack_dirs(request: Request) -> list[Path]:
    menu_dir = _menu_dir(request)
    if not menu_dir.is_dir():
        return []
    return sorted(p for p in menu_dir.iterdir() if p.is_dir())


def _load_by_id(request: Request, pack_id: str) -> dict | None:
    if not _is_plain_filename(pack_id):
        return None
    pack_dir = _menu_dir(request) / pack_id
    if not pack_dir.is_dir():
        return None
    return load_pack(pack_dir)


@router.get("/api/menu/packs")
async def list_packs(request: Request) -> dict:
    packs = []
    for pack_dir in _iter_pack_dirs(request):
        pack = load_pack(pack_dir)
        if pack is None:
            continue
        entry = {"id": pack["id"], "title": pack["title"]}
        tagline = pack.get("tagline")
        if isinstance(tagline, str):
            entry["tagline"] = tagline
        packs.append(entry)
    return {"packs": packs}


@router.get("/api/menu/pack/{pack_id}")
async def get_pack(request: Request, pack_id: str) -> dict:
    pack = _load_by_id(request, pack_id)
    if pack is None:
        raise HTTPException(status_code=404)
    return pack


@router.get("/api/menu/pack/{pack_id}/image/{filename}")
async def get_pack_image(request: Request, pack_id: str, filename: str) -> FileResponse:
    # Both path segments must be plain filenames — a traversal attempt (``..``,
    # a separator) is a bad request, never a filesystem read outside the pack.
    if not _is_plain_filename(pack_id) or not _is_plain_filename(filename):
        raise HTTPException(status_code=400)
    menu_dir = _menu_dir(request)
    pack_dir = (menu_dir / pack_id).resolve()
    path = (pack_dir / filename).resolve()
    # Defense in depth: the resolved file must sit inside the pack directory.
    if pack_dir not in path.parents or not path.is_file():
        raise HTTPException(status_code=404)
    # FileResponse guesses the content-type from the extension (svg/png/jpg/webp).
    return FileResponse(path)
