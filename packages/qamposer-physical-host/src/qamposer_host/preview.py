"""Annotated MJPEG preview for ``/debug`` — booth-staff calibration view.

* ``GET /debug/stream``      — ``multipart/x-mixed-replace`` MJPEG at ~5 fps,
  re-encoding ``pipeline.latest_annotated()`` each tick.
* ``GET /debug/snapshot.jpg`` — a single JPEG frame.

When no pipeline or no frame is available yet, both endpoints return a generated
placeholder image with an explanatory caption. Image libraries (cv2 / PIL) are
imported lazily so the host stays importable without them.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Request
from fastapi.responses import Response, StreamingResponse

logger = logging.getLogger("qamposer_host.preview")

router = APIRouter()

_STREAM_INTERVAL = 0.2  # ~5 fps
_BOUNDARY = "frame"
_PLACEHOLDER_CACHE: dict[str, bytes] = {}


def _encode_jpeg(frame) -> bytes | None:
    """Encode a BGR ndarray to JPEG bytes (lazy cv2). ``None`` on failure."""
    try:
        import cv2  # lazy

        ok, buf = cv2.imencode(".jpg", frame)
        if ok:
            return buf.tobytes()
    except Exception:
        logger.debug("cv2 JPEG encode failed", exc_info=True)
    return None


def _placeholder_jpeg(text: str = "Entangible — no camera frame yet") -> bytes:
    """Generate a captioned placeholder JPEG (lazy PIL), cached per caption."""
    if text in _PLACEHOLDER_CACHE:
        return _PLACEHOLDER_CACHE[text]
    data = b""
    try:
        import io

        from PIL import Image, ImageDraw

        img = Image.new("RGB", (640, 360), (24, 24, 28))
        draw = ImageDraw.Draw(img)
        draw.rectangle((8, 8, 631, 351), outline=(80, 80, 96), width=2)
        draw.text((24, 168), text, fill=(220, 220, 230))
        draw.text((24, 190), "/debug preview", fill=(120, 120, 140))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=80)
        data = out.getvalue()
    except Exception:  # pragma: no cover - PIL always present in this env
        logger.debug("placeholder generation failed", exc_info=True)
        data = b""
    _PLACEHOLDER_CACHE[text] = data
    return data


def _current_jpeg(request: Request) -> bytes:
    pipeline = getattr(request.app.state, "pipeline", None)
    frame = None
    if pipeline is not None and hasattr(pipeline, "latest_annotated"):
        try:
            frame = pipeline.latest_annotated()
        except Exception:
            logger.debug("latest_annotated() failed", exc_info=True)
    if frame is None:
        return _placeholder_jpeg()
    encoded = _encode_jpeg(frame)
    return encoded if encoded is not None else _placeholder_jpeg()


@router.get("/debug/snapshot.jpg")
async def snapshot(request: Request) -> Response:
    return Response(content=_current_jpeg(request), media_type="image/jpeg",
                    headers={"Cache-Control": "no-store"})


@router.get("/debug/stream")
async def stream(request: Request) -> StreamingResponse:
    async def frames():
        while True:
            if await request.is_disconnected():
                break
            jpg = _current_jpeg(request)
            yield (
                f"--{_BOUNDARY}\r\n"
                f"Content-Type: image/jpeg\r\n"
                f"Content-Length: {len(jpg)}\r\n\r\n"
            ).encode() + jpg + b"\r\n"
            await asyncio.sleep(_STREAM_INTERVAL)

    return StreamingResponse(
        frames(),
        media_type=f"multipart/x-mixed-replace; boundary={_BOUNDARY}",
        headers={"Cache-Control": "no-store"},
    )
