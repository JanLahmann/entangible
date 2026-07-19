"""Serve the built Entangible app (SPA) and the QR codes.

Entangible One (U3): the host serves the ONE built app — the pocket build — at
``/``. The former two-app split (display-app at ``/`` + pocket at ``/pocket``)
is retired; the big-screen booth skin is now the pocket app's ``?kiosk``
surface and ``/debug`` is one of its routes.

* ``GET /api/qr`` — a PNG QR encoding
  ``https://<lan-ip>:<port><path>&key=<operator-token>`` (``http`` when TLS is
  off). **Staff-gated:** requires the operator token (query param or
  ``X-Operator-Key`` header) — the QR is a staff-distribution channel, and the
  token it embeds is what lets the scanning phone reach the token-gated
  ``/ws/frames``. A missing/wrong key returns ``403`` JSON. The default
  ``path`` is ``/pocket?connect=1&role=camera``: the scanning phone opens the
  app in its staff CAMERA role, streaming with pocket's camera UI (zoom,
  freeze). ``/pocket`` redirects to ``/`` preserving the query.
* ``GET /api/visitor-qr`` — an UNGATED PNG QR encoding
  ``https://<lan-ip>:<port>/pocket?connect=1``. The public "follow along + take
  your circuit home" QR (booth footer + attract); it embeds NO token because the
  viewer connects read-only, so it is safe to show to visitors. (``/pocket``
  redirects to ``/?connect=1``.)
* ``GET /pocket`` and ``GET /pocket/{path}`` — a compatibility redirect to
  ``/`` (preserving the query). QR codes in the wild encode ``/pocket?connect=1``
  and ``/pocket?connect=1&role=camera``; the app now lives at ``/`` so those
  redirect to ``/?connect=1`` etc.
* ``GET /{path}`` (registered LAST) — serves a file from ``pocket_dist`` when
  it exists, otherwise falls back to ``index.html`` for SPA client routes
  (``/``, ``/debug``, ``/guide``, …). Reserved prefixes (``/api``, ``/ws``,
  ``/qamposer-api``, ``/debug/stream``, ``/debug/snapshot``) never fall through
  to the SPA. The ``/debug`` page shell is served openly (it prompts for the key
  client-side); only the ``/debug`` *data* endpoints (preview stream,
  ``/api/qr``) are gated.

If ``pocket_dist`` has not been built, ``/`` and SPA routes return a friendly
"app not built" page while ``/api``, ``/ws`` and ``/debug`` keep working.
"""

from __future__ import annotations

import io
import logging
from pathlib import Path

import qrcode
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response

from .certs import primary_lan_ip
from .preview import require_operator_key

logger = logging.getLogger("qamposer_host.static")

router = APIRouter()

_RESERVED_PREFIXES = ("/api", "/ws", "/qamposer-api", "/debug/stream", "/debug/snapshot")

_NOT_BUILT_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entangible — app not built</title>
<style>
 body{font-family:system-ui,-apple-system,sans-serif;background:#0f1117;color:#e6e9ef;
      margin:0;display:grid;place-items:center;min-height:100vh}
 main{max-width:34rem;padding:2rem;line-height:1.6}
 code{background:#161a22;padding:.15em .4em;border-radius:4px}
 h1{font-size:1.4rem} .en{color:#7a5cff} a{color:#5cc8ff}
</style></head>
<body><main>
 <h1><span class="en">En</span>tangible host is running</h1>
 <p>The app has not been built yet. Build it with:</p>
 <p><code>cd pocket-app &amp;&amp; npm ci &amp;&amp; npm run build</code></p>
 <p>The API, WebSocket and <a href="/debug/snapshot.jpg">/debug</a> endpoints are
    already live — this page is served in place of <code>pocket-app/dist</code>.</p>
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


def _with_key(path: str, token: str) -> str:
    """Append ``key=<token>`` to a target path (staff QRs carry the token)."""
    sep = "&" if "?" in path else "?"
    return f"{path}{sep}key={token}"


@router.get("/api/qr")
async def qr(request: Request, path: str = "/pocket?connect=1&role=camera") -> Response:
    require_operator_key(request)
    config = request.app.state.config
    scheme = "https" if config.tls else "http"
    if not path.startswith("/"):
        path = "/" + path
    # The scanning phone must arrive already carrying the operator token, so it
    # can enter the pocket camera role and connect to /ws/frames + /ws/state as
    # an operator (both token-gated). `/pocket` redirects to `/`.
    path = _with_key(path, request.app.state.operator_token)
    url = f"{scheme}://{primary_lan_ip()}:{config.port}{path}"
    return Response(
        content=_qr_png(url),
        media_type="image/png",
        headers={"Cache-Control": "no-store", "X-Encoded-URL": url},
    )


@router.get("/api/visitor-qr")
async def visitor_qr(request: Request) -> Response:
    """UNGATED PNG QR for visitors: ``https://<lan-ip>:<port>/pocket?connect=1``.

    This is the public "follow along + take your circuit home" QR shown on the
    booth screen (footer + attract). It encodes NO operator token — the viewer
    connects to ``/ws/state`` read-only and needs no credential — so it is safe
    to display to visitors, unlike the staff ``/api/qr`` camera QR (which can
    hijack the booth camera and stays on ``/debug`` only). ``/pocket`` redirects
    to ``/?connect=1``.
    """
    config = request.app.state.config
    scheme = "https" if config.tls else "http"
    url = f"{scheme}://{primary_lan_ip()}:{config.port}/pocket?connect=1"
    return Response(
        content=_qr_png(url),
        media_type="image/png",
        headers={"Cache-Control": "no-store", "X-Encoded-URL": url},
    )


@router.get("/api/info")
async def info(request: Request) -> dict:
    """LAN reachability facts for the display/debug UI (QR + camera-role URL).

    ``captureUrl`` is the full origin a phone should open to become the booth
    camera — the same target encoded in ``/api/qr`` (minus the token) — so the
    ``/debug`` "Phone camera" card can print it verbatim.
    """
    config = request.app.state.config
    scheme = "https" if config.tls else "http"
    ip = primary_lan_ip()
    return {
        "lanIp": ip,
        "port": config.port,
        "tls": bool(config.tls),
        "captureUrl": f"{scheme}://{ip}:{config.port}/pocket?connect=1&role=camera",
        # Additive: advertise that this host enforces the operator token, so
        # clients can detect a token-gated booth. (The token itself is never
        # exposed here — /api/info is an open, read-only surface.)
        "security": {"operator": True},
    }


def _looks_like_asset(path: str) -> bool:
    last = path.rsplit("/", 1)[-1]
    return "." in last


# --- /pocket compatibility redirect ----------------------------------------
# The app now lives at `/` (Entangible One). QRs in the wild encode
# `/pocket?connect=1` (visitor) and `/pocket?connect=1&role=camera` (staff), so
# `/pocket` and any `/pocket/...` path redirect to `/` preserving the query.
# Registered BEFORE the SPA catch-all so it is never shadowed.


def _pocket_redirect(request: Request) -> RedirectResponse:
    query = request.url.query
    target = "/" + (f"?{query}" if query else "")
    return RedirectResponse(url=target, status_code=307)


@router.get("/pocket")
async def pocket_root(request: Request) -> RedirectResponse:
    return _pocket_redirect(request)


@router.get("/pocket/{full_path:path}")
async def pocket_spa(full_path: str, request: Request) -> RedirectResponse:
    return _pocket_redirect(request)


@router.get("/{full_path:path}")
async def spa(full_path: str, request: Request):
    path = "/" + full_path
    for pref in _RESERVED_PREFIXES:
        if path == pref or path.startswith(pref + "/"):
            raise HTTPException(status_code=404)

    dist = Path(request.app.state.config.pocket_dist)
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
        # A missing asset (has a file extension) is a real 404, not a client
        # route — only extension-less paths fall through to the SPA index.
        if _looks_like_asset(full_path):
            raise HTTPException(status_code=404)

    return FileResponse(index)  # SPA fallback (/, /debug, /guide, …)
