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
from fastapi.responses import FileResponse, HTMLResponse, Response

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


def _looks_like_asset(path: str) -> bool:
    last = path.rsplit("/", 1)[-1]
    return "." in last


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
