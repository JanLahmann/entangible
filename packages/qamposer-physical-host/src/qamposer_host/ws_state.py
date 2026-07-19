"""``/ws/state`` endpoint — server pushes circuit/detection/status to clients.

Wires the FastAPI WebSocket to the :class:`~qamposer_host.hub.Hub` and handles
the client -> server messages:

* ``hello`` — courtesy metadata (role label). It may additionally carry
  ``{role:'operator', key:<operator-token>}``; a connection is promoted to
  *operator* only when the role is a staff role (``operator`` or the pocket
  ``camera`` role) **and** the key matches the host token (constant-time
  compare). The server replies to every ``hello`` with
  ``{type:'hello_ack', role:'viewer'|'operator'}`` on that socket so the client
  learns its standing.
* ``select_camera`` / ``select_mode`` / ``select_layout`` — control messages,
  honored **only** for operator connections. From a viewer they are silently
  ignored (logged at debug level, no error sent back).

Viewers stay zero-friction: a plain ``hello`` (or none at all) connects and
receives circuit/detection/status exactly as before. Unknown or malformed
messages are logged and ignored — never fatal.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .config import camera_from_spec, ensure_push_source, select_camera_to_spec
from .token import token_matches

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
        await _handle_hello(websocket, msg)
    elif mtype in ("select_camera", "select_mode", "select_layout", "select_noise"):
        # Control messages are operator-only. A viewer's attempt is silently
        # ignored (per design): no error is returned, just a debug log.
        if not websocket.app.state.hub.is_operator(websocket):
            logger.debug("ignoring %s from non-operator /ws/state client", mtype)
            return
        if mtype == "select_camera":
            await _handle_select_camera(websocket, msg)
        elif mtype == "select_mode":
            await _handle_select_mode(websocket, msg)
        elif mtype == "select_noise":
            await _handle_select_noise(websocket, msg)
        else:
            await _handle_select_layout(websocket, msg)
    else:
        logger.info("ignoring unknown /ws/state message type: %r", mtype)


async def _handle_hello(websocket: WebSocket, msg: dict) -> None:
    """Record role/label + operator standing, then ack the client's standing."""
    role = str(msg.get("role", "display"))
    label = msg.get("client")
    token = websocket.app.state.operator_token
    # Staff roles ('operator' and the pocket CAMERA role) gain operator standing
    # when the key matches; the 'camera' label is kept so the host can log/list
    # it as a camera rather than a generic operator. Any other role stays a
    # viewer regardless of the claimed role.
    is_operator = role in ("operator", "camera") and token_matches(msg.get("key"), token)
    websocket.app.state.hub.set_role(websocket, role, label, operator=is_operator)
    # Additive protocol: tell this socket (only) whether it is an operator.
    await websocket.send_json(
        {"type": "hello_ack", "role": "operator" if is_operator else "viewer"}
    )


async def _handle_select_camera(websocket: WebSocket, msg: dict) -> None:
    app = websocket.app
    hub = app.state.hub
    pipeline = app.state.pipeline
    factory = app.state.source_factory
    spec = select_camera_to_spec(msg)
    is_push = spec.split(":", 1)[0] == "push"

    source = None
    if is_push:
        # Swap the pipeline onto the *shared* push source that /ws/frames feeds,
        # so frames already in the slot take effect immediately after the swap.
        source = ensure_push_source(app)
        if source is None:
            logger.warning("push source unavailable (vision package missing)")
    else:
        try:
            source = factory(spec)
        except Exception:
            logger.warning("could not build frame source for %r", spec, exc_info=True)

    if pipeline is not None and source is not None:
        try:
            pipeline.swap_source(source)
        except Exception:
            logger.warning("pipeline.swap_source failed for %r", spec, exc_info=True)

    hub.set_camera(camera_from_spec(spec, connected=source is not None))
    await hub.publish_status()


async def _handle_select_mode(websocket: WebSocket, msg: dict) -> None:
    mode = msg.get("mode")
    if not isinstance(mode, str):
        logger.info("ignoring select_mode without a string mode: %r", msg)
        return
    store = websocket.app.state.layout_store
    store.select_mode(mode)
    await websocket.app.state.hub.publish_layout(store.message())


async def _handle_select_noise(websocket: WebSocket, msg: dict) -> None:
    preset = msg.get("preset")
    if not isinstance(preset, str):
        logger.info("ignoring select_noise without a string preset: %r", msg)
        return
    store = websocket.app.state.layout_store
    store.select_noise(preset)
    await websocket.app.state.hub.publish_layout(store.message())


async def _handle_select_layout(websocket: WebSocket, msg: dict) -> None:
    sidebar = msg.get("sidebar")
    panels = msg.get("panels")
    wires = msg.get("wires")
    store = websocket.app.state.layout_store
    store.apply_layout(
        sidebar=sidebar if isinstance(sidebar, str) else None,
        panels=[str(p) for p in panels] if isinstance(panels, list) else None,
        wires=wires if isinstance(wires, str) else None,
    )
    await websocket.app.state.hub.publish_layout(store.message())
