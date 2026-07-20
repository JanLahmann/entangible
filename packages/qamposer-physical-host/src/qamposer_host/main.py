"""FastAPI application factory and ASGI entry point.

:func:`create_app` wires the broadcast hub, WebSocket routes, debug preview,
backend proxy and static SPA into one app, and manages the vision pipeline over
the app lifespan. The pipeline and its vision imports are *lazy*: if the vision
package isn't available (or a camera can't open), the host logs a clear error
and serves every HTTP/WS endpoint without live detection.

Tests inject a fake pipeline via ``create_app(config, pipeline=...)`` — when a
pipeline is supplied, the lifespan does not import the vision package at all.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

import httpx
from fastapi import FastAPI

from . import branding, layout, menu, preview, proxy, static, ws_frames, ws_state
from .branding import load_branding
from .config import HostConfig, build_frame_source, camera_from_spec, ensure_push_source
from .hub import Hub
from .layout import LayoutStore
from .proxy import BackendHealth
from .token import ensure_token

logger = logging.getLogger("qamposer_host.main")


def create_app(
    config: HostConfig | None = None,
    *,
    pipeline=None,
    source_factory=None,
) -> FastAPI:
    """Build the kiosk host application.

    ``pipeline`` and ``source_factory`` are injection seams for tests; in normal
    operation both default to the real (lazy) vision-backed implementations.
    """
    config = config or HostConfig.from_env()
    hub = Hub()

    app = FastAPI(title="Entangible host", lifespan=_lifespan)
    app.state.config = config
    app.state.hub = hub
    # Staff credential: a single shared operator token, generated on first run
    # and persisted next to the certs. Gates the staff/control surfaces
    # (select_* on /ws/state, /ws/frames, /debug preview, /api/qr); viewer
    # surfaces (`/`, `/pocket`, /ws/state reads, /api/info) stay fully open.
    app.state.operator_token = ensure_token(config.cert_dir)
    app.state.pipeline = pipeline
    app.state.push_source = None
    app.state.source_factory = source_factory or build_frame_source
    app.state.http_client = None
    app.state.owns_pipeline = False
    app.state.backend_health = BackendHealth(
        config.backend_url, lambda: app.state.http_client
    )

    # booth-v2: persisted display layout + event branding.
    app.state.layout_store = LayoutStore(config.resolved_layout_file)
    app.state.branding = load_branding(config.resolved_branding_file)

    hub.set_camera(camera_from_spec(config.source, connected=False))
    hub.set_backend(enabled=config.backend_mode != "off", healthy=False)
    hub.set_layout(app.state.layout_store.message())  # seed late-joiner replay

    # Order matters: the static catch-all ("/{path}") must be registered LAST so
    # it never shadows the API / WS / debug routes.
    app.include_router(ws_state.router)
    app.include_router(ws_frames.router)
    app.include_router(preview.router)
    app.include_router(proxy.router)
    app.include_router(layout.router)
    app.include_router(branding.router)
    app.include_router(menu.router)
    app.include_router(static.router)

    return app


def app_from_env() -> FastAPI:
    """ASGI factory for ``uvicorn ... --factory`` (reads ``QAMPOSER_*`` env)."""
    return create_app(HostConfig.from_env())


@contextlib.asynccontextmanager
async def _lifespan(app: FastAPI):
    hub: Hub = app.state.hub
    hub.attach_loop(asyncio.get_running_loop())
    app.state.http_client = httpx.AsyncClient(follow_redirects=False)

    if app.state.pipeline is None:
        _try_start_pipeline(app)

    try:
        yield
    finally:
        if app.state.owns_pipeline and app.state.pipeline is not None:
            try:
                app.state.pipeline.stop()
            except Exception:
                logger.warning("pipeline.stop() failed", exc_info=True)
        if app.state.http_client is not None:
            await app.state.http_client.aclose()


def _try_start_pipeline(app: FastAPI) -> None:
    config: HostConfig = app.state.config
    hub: Hub = app.state.hub
    try:
        from qamposer_vision.pipeline import Pipeline  # lazy

        if config.source.split(":", 1)[0] == "push":
            # Start on the shared push source so /ws/frames feeds it directly.
            source = ensure_push_source(app) or app.state.source_factory(config.source)
            app.state.push_source = source
        else:
            source = app.state.source_factory(config.source)
        pipeline = Pipeline(
            source=source,
            on_circuit=hub.publish_from_thread,
            on_detection=hub.publish_from_thread,
        )
        pipeline.start()
        app.state.pipeline = pipeline
        app.state.owns_pipeline = True
        hub.set_camera(camera_from_spec(config.source, connected=True))
        logger.info("vision pipeline started on source %r", config.source)
    except Exception as exc:
        logger.error(
            "vision pipeline unavailable (%s: %s); serving without live "
            "detection. HTTP/WS/debug endpoints still work.",
            type(exc).__name__, exc,
        )
        app.state.owns_pipeline = False
