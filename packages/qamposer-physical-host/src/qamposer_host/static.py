"""Serve the built display app (SPA) and the capture QR code.

* ``GET /api/qr?path=/capture`` — a PNG QR encoding
  ``https://<lan-ip>:<port><path>`` (``http`` when TLS is off).
* ``GET /{path}`` (registered LAST) — serves a file from ``display_dist`` when
  it exists, otherwise falls back to ``index.html`` for SPA client routes.
  Reserved prefixes (``/api``, ``/ws``, ``/qamposer-api``, ``/debug/stream``,
  ``/debug/snapshot``) never fall through to the SPA.

If ``display_dist`` has not been built, ``/`` and SPA routes return a friendly
"display app not built" page while ``/api``, ``/ws`` and ``/debug`` keep working.
"""

from __future__ import annotations

import io
import logging
from pathlib import Path

import qrcode
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response

from .certs import primary_lan_ip

logger = logging.getLogger("qamposer_host.static")

router = APIRouter()

_RESERVED_PREFIXES = ("/api", "/ws", "/qamposer-api", "/debug/stream", "/debug/snapshot")

_NOT_BUILT_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entangible — display app not built</title>
<style>
 body{font-family:system-ui,-apple-system,sans-serif;background:#16161a;color:#e6e6ea;
      margin:0;display:grid;place-items:center;min-height:100vh}
 main{max-width:34rem;padding:2rem;line-height:1.6}
 code{background:#26262e;padding:.15em .4em;border-radius:4px}
 h1{font-size:1.4rem} a{color:#5cc8ff}
</style></head>
<body><main>
 <h1>Entangible host is running</h1>
 <p>The display app has not been built yet. Build it with:</p>
 <p><code>cd display-app &amp;&amp; npm ci &amp;&amp; npm run build</code></p>
 <p>The API, WebSocket and <a href="/debug/snapshot.jpg">/debug</a> endpoints are
    already live — this page is served in place of <code>display-app/dist</code>.</p>
</main></body></html>
"""


def _qr_png(url: str) -> bytes:
    qr = qrcode.QRCode(box_size=8, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    out = io.BytesIO()
    img.save(out)
    return out.getvalue()


@router.get("/api/qr")
async def qr(request: Request, path: str = "/capture") -> Response:
    config = request.app.state.config
    scheme = "https" if config.tls else "http"
    if not path.startswith("/"):
        path = "/" + path
    url = f"{scheme}://{primary_lan_ip()}:{config.port}{path}"
    return Response(
        content=_qr_png(url),
        media_type="image/png",
        headers={"Cache-Control": "no-store", "X-Encoded-URL": url},
    )


@router.get("/api/info")
async def info(request: Request) -> dict:
    """LAN reachability facts for the display/debug UI (QR + capture URL).

    ``captureUrl`` is the full origin a phone should open — the same URL encoded
    in ``/api/qr`` — so the ``/debug`` "Phone camera" card can print it verbatim.
    """
    config = request.app.state.config
    scheme = "https" if config.tls else "http"
    ip = primary_lan_ip()
    return {
        "lanIp": ip,
        "port": config.port,
        "tls": bool(config.tls),
        "captureUrl": f"{scheme}://{ip}:{config.port}/capture",
    }


def _looks_like_asset(path: str) -> bool:
    last = path.rsplit("/", 1)[-1]
    return "." in last


# --- Entangible Pocket (standalone browser demo) served at /pocket ----------
# The pocket app is built with base './', so its index.html references assets
# relatively; served under the /pocket/ prefix those resolve to /pocket/assets/…
# which this SPA handler serves. Registered BEFORE the display catch-all so it
# is never shadowed. Skips gracefully (404 / friendly page) when unbuilt.


@router.get("/pocket")
async def pocket_root() -> RedirectResponse:
    # Redirect to the trailing-slash form so relative './asset' URLs resolve
    # under /pocket/ rather than the site root.
    return RedirectResponse(url="/pocket/", status_code=307)


@router.get("/pocket/{full_path:path}")
async def pocket_spa(full_path: str, request: Request):
    dist = Path(request.app.state.config.pocket_dist)
    index = dist / "index.html"

    if not index.is_file():
        if _looks_like_asset(full_path):
            raise HTTPException(status_code=404)
        return HTMLResponse(_POCKET_NOT_BUILT_HTML, status_code=200)

    if full_path:
        candidate = (dist / full_path).resolve()
        dist_root = dist.resolve()
        if candidate.is_file() and str(candidate).startswith(str(dist_root)):
            return FileResponse(candidate)
        # A missing asset (has a file extension) is a real 404, not a client
        # route — only extension-less paths fall through to the SPA index.
        if _looks_like_asset(full_path):
            raise HTTPException(status_code=404)

    return FileResponse(index)  # SPA fallback under /pocket/


_POCKET_NOT_BUILT_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entangible Pocket — not built</title>
<style>
 body{font-family:system-ui,-apple-system,sans-serif;background:#0f1117;color:#e6e9ef;
      margin:0;display:grid;place-items:center;min-height:100vh}
 main{max-width:34rem;padding:2rem;line-height:1.6}
 code{background:#161a22;padding:.15em .4em;border-radius:4px}
 h1{font-size:1.4rem} .en{color:#7a5cff}
</style></head>
<body><main>
 <h1><span class="en">En</span>tangible Pocket is not built yet</h1>
 <p>Build the standalone browser demo with:</p>
 <p><code>cd pocket-app &amp;&amp; npm ci &amp;&amp; npm run build</code></p>
 <p>It will then be served here at <code>/pocket/</code>.</p>
</main></body></html>
"""


@router.get("/{full_path:path}")
async def spa(full_path: str, request: Request):
    path = "/" + full_path
    for pref in _RESERVED_PREFIXES:
        if path == pref or path.startswith(pref + "/"):
            raise HTTPException(status_code=404)

    dist = Path(request.app.state.config.display_dist)
    index = dist / "index.html"

    if not index.is_file():
        if _looks_like_asset(full_path):
            raise HTTPException(status_code=404)
        return HTMLResponse(_NOT_BUILT_HTML)

    if full_path:
        candidate = (dist / full_path).resolve()
        dist_root = dist.resolve()
        if candidate.is_file() and str(candidate).startswith(str(dist_root)):
            return FileResponse(candidate)

    return FileResponse(index)  # SPA fallback
