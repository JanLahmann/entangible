"""Reverse proxy ``/qamposer-api/*`` to an optional qamposer-backend, plus
``/api/health``.

Same-origin proxying keeps the display app free of CORS / mixed-content issues.
Only ``off`` and ``url:<base>`` modes are implemented here; ``spawn`` is M5 and
is treated as "not a URL backend" (503) until then.

* ``/qamposer-api/{path}`` — streamed pass-through (method, query, headers, body
  preserved; hop-by-hop headers stripped). ``503`` with a clear JSON body when
  the backend is not a live URL.
* ``/api/health`` — ``{"status","backend","camera","clients"}``; backend health
  is ``GET <base>/health`` with a 1 s timeout, cached for 10 s.
"""

from __future__ import annotations

import logging
import time

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.background import BackgroundTask

logger = logging.getLogger("qamposer_host.proxy")

router = APIRouter()

# Hop-by-hop headers (RFC 7230 §6.1) plus framing headers we must not forward.
_HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "content-length", "host",
}
_HEALTH_CACHE_TTL = 10.0
_HEALTH_TIMEOUT = 1.0


class BackendHealth:
    """Cached backend-health probe (``GET <base>/health``, 1 s timeout)."""

    def __init__(self, backend_url: str | None, client_getter) -> None:
        self._url = backend_url.rstrip("/") if backend_url else None
        self._client_getter = client_getter
        self._cached: bool | None = None
        self._checked_at = 0.0

    async def status(self) -> dict:
        if not self._url:
            return {"enabled": False, "healthy": False}
        now = time.monotonic()
        if self._cached is not None and now - self._checked_at < _HEALTH_CACHE_TTL:
            return {"enabled": True, "healthy": self._cached}
        healthy = False
        try:
            client: httpx.AsyncClient = self._client_getter()
            resp = await client.get(f"{self._url}/health", timeout=_HEALTH_TIMEOUT)
            healthy = resp.status_code < 500
        except Exception:
            logger.debug("backend health check failed", exc_info=True)
            healthy = False
        self._cached = healthy
        self._checked_at = now
        return {"enabled": True, "healthy": healthy}


@router.get("/api/health")
async def health(request: Request) -> dict:
    app = request.app
    backend = await app.state.backend_health.status()
    # keep the broadcast status in sync with the freshest backend health
    app.state.hub.set_backend(
        enabled=backend["enabled"], healthy=backend["healthy"]
    )
    return {
        "status": "ok",
        "backend": backend,
        "camera": app.state.hub.camera_status(),
        "clients": app.state.hub.client_count(),
    }


@router.api_route(
    "/qamposer-api/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy(path: str, request: Request):
    config = request.app.state.config
    if config.backend_mode != "url" or not config.backend_url:
        return JSONResponse(
            status_code=503,
            content={
                "error": "backend_disabled",
                "mode": config.backend_mode,
                "detail": (
                    "The qamposer-backend proxy is off. Start the host with "
                    "--backend url:<base-url> to enable /qamposer-api. "
                    "Realtime simulation still works in-browser via localAdapter."
                ),
            },
        )

    base = config.backend_url.rstrip("/")
    url = f"{base}/{path}"
    client: httpx.AsyncClient = request.app.state.http_client
    headers = {
        k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP
    }
    body = await request.body()
    upstream = client.build_request(
        request.method, url, params=request.query_params,
        headers=headers, content=body,
    )
    resp = await client.send(upstream, stream=True)
    out_headers = {
        k: v for k, v in resp.headers.items() if k.lower() not in _HOP_BY_HOP
    }
    return StreamingResponse(
        resp.aiter_raw(),
        status_code=resp.status_code,
        headers=out_headers,
        background=BackgroundTask(resp.aclose),
    )
