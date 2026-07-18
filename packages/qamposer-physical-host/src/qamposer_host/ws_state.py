"""``/ws/state`` endpoint — server pushes circuit/detection/status to clients.

Wires the FastAPI WebSocket to the :class:`~qamposer_host.hub.Hub` and handles
the two client -> server messages:

* ``hello`` — courtesy metadata; sets the client's role label (never required).
* ``select_camera`` — builds a new frame source and hot-swaps it into the
  pipeline, then broadcasts a fresh ``status``.

Unknown or malformed messages are logged and ignored — never fatal.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .config import camera_from_spec, select_camera_to_spec

logger = logging.getLogger("qamposer_host.ws_state")

router = APIRouter()


@router.websocket("/ws/state")
async def ws_state(websocket: WebSocket) -> None:
    hub = websocket.app.state.hub
    await websocket.accept()
    await hub.connect(websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            await _handle_message(websocket, raw)
    except WebSocketDisconnect:
        pass
    except Exception:  # pragma: no cover - defensive; keep the server alive
        logger.exception("unexpected /ws/state error")
    finally:
        await hub.disconnect(websocket)


async def _handle_message(websocket: WebSocket, raw: str) -> None:
    try:
        msg = json.loads(raw)
        if not isinstance(msg, dict):
            raise ValueError("not an object")
    except (ValueError, TypeError):
        logger.info("ignoring malformed /ws/state message: %r", raw[:200])
        return

    mtype = msg.get("type")
    if mtype == "hello":
        role = str(msg.get("role", "display"))
        label = msg.get("client")
        websocket.app.state.hub.set_role(websocket, role, label)
    elif mtype == "select_camera":
        await _handle_select_camera(websocket, msg)
    else:
        logger.info("ignoring unknown /ws/state message type: %r", mtype)


async def _handle_select_camera(websocket: WebSocket, msg: dict) -> None:
    app = websocket.app
    hub = app.state.hub
    pipeline = app.state.pipeline
    factory = app.state.source_factory
    spec = select_camera_to_spec(msg)

    source = None
    try:
        source = factory(spec)
    except Exception:
        logger.warning("could not build frame source for %r", spec, exc_info=True)

    if pipeline is not None and source is not None:
        try:
            pipeline.swap_source(source)
        except Exception:
            logger.warning("pipeline.swap_source failed for %r", spec, exc_info=True)

    if spec.split(":", 1)[0] == "push":
        app.state.push_source = source

    hub.set_camera(camera_from_spec(spec, connected=source is not None))
    await hub.publish_status()
