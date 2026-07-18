"""``/ws/frames`` endpoint — phone camera pushes JPEG frames to the host.

Binary WebSocket messages are JPEG-encoded frames fed into the active
``PushFrameSource`` (most-recent-wins: the source keeps a single latest-frame
slot, so backpressure is the client's job). Optional JSON text messages
(``{"type":"hello",...}``) are accepted and ignored.

If no push source is active (the pipeline isn't running one, or the vision
package isn't available), frames are accepted and dropped with a warning — this
keeps the endpoint importable and connectable before the M4 capture flow lands.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger("qamposer_host.ws_frames")

router = APIRouter()


@router.websocket("/ws/frames")
async def ws_frames(websocket: WebSocket) -> None:
    app = websocket.app
    await websocket.accept()
    if getattr(app.state, "push_source", None) is None:
        logger.warning(
            "/ws/frames connected but no PushFrameSource is active; "
            "frames will be accepted and dropped"
        )
    warned_push_error = False
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            data = message.get("bytes")
            if data is not None:
                push = getattr(app.state, "push_source", None)
                if push is not None:
                    try:
                        push.push(data)  # most-recent-wins single slot
                    except Exception:
                        if not warned_push_error:
                            logger.warning("push_source.push failed", exc_info=True)
                            warned_push_error = True
            # text frames (optional hello) are ignored
    except WebSocketDisconnect:
        pass
    except Exception:  # pragma: no cover - defensive
        logger.exception("unexpected /ws/frames error")
