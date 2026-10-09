"""``GET /api/cameras`` — on-demand camera discovery for the ``/debug`` picker.

Staff-gated (operator token, like the rest of ``/debug``'s data). Runs ONLY
when staff press "Scan cameras" — never polled — because probing opens real
devices. Response::

    {"active": "cv2:0",
     "cameras": [{"spec": "cv2:0", "kind": "cv2", "index": 0, "ok": true,
                  "width": 1280, "height": 720, "active": true}, ...],
     "picamera2": false,
     "replays": ["bell-sequence"],
     "push": true}

Constraints:

* The cv2 index the running pipeline holds is NEVER opened: a second open of a
  busy V4L2 device can wedge the driver. It is reported from the hub's camera
  status instead (``active: true``).
* Probes run one at a time in a worker thread, each under a wall-clock budget;
  a probe that overruns is reported ``ok: false`` and the scan moves on.
* ``cv2`` is imported lazily; without it ``cameras`` is ``[]``.
* The prober is ``app.state.camera_prober`` (tests inject a fake): it takes an
  index and returns ``None`` (nothing there) or ``{"ok", "width", "height"}``.
"""

from __future__ import annotations

import asyncio
import importlib.util
import logging
from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Request

from .preview import require_operator_key

logger = logging.getLogger("qamposer_host.cameras")

router = APIRouter()

#: cv2 indices a scan covers (a booth has a handful of cameras at most).
CV2_INDICES = range(6)
#: Per-index wall budget, seconds. A missing index fails fast; a real camera
#: delivers its first frame well inside this.
PROBE_BUDGET_S = 2.0

Prober = Callable[[int], "dict | None"]


def probe_cv2_index(index: int) -> dict | None:
    """Open ``cv2.VideoCapture(index)``, read one frame, release.

    ``None`` when nothing opens at that index. Raises ``ImportError`` when cv2
    is missing (the endpoint then reports no cv2 cameras).
    """
    import cv2  # lazy: the host runs without OpenCV

    cap = cv2.VideoCapture(index)
    try:
        if not cap.isOpened():
            return None
        ok, frame = cap.read()
        if not ok or frame is None:
            return {"ok": False, "width": None, "height": None}
        height, width = frame.shape[:2]
        return {"ok": True, "width": int(width), "height": int(height)}
    finally:
        cap.release()


def _active_spec(app) -> str:
    return str(getattr(app.state, "source_spec", None) or app.state.config.source)


def _held_cv2_index(app, spec: str) -> int | None:
    """The cv2 index the live pipeline holds open, if any."""
    if getattr(app.state, "pipeline", None) is None:
        return None  # nothing holds a device; every index is safe to probe
    kind, _, rest = spec.partition(":")
    if kind != "cv2":
        return None
    try:
        return int(rest or 0)
    except ValueError:
        return None


def list_replays(replay_dir: Path) -> list[str]:
    """Recording names (subdirectories holding ``frame_*`` files), sorted."""
    try:
        return sorted(
            d.name for d in Path(replay_dir).iterdir()
            if d.is_dir() and any(d.glob("frame_*"))
        )
    except OSError:
        return []


async def _scan_cv2(app, prober: Prober, held: int | None) -> list[dict]:
    loop = asyncio.get_running_loop()
    found: list[dict] = []
    for index in CV2_INDICES:
        entry = {"spec": f"cv2:{index}", "kind": "cv2", "index": index}
        if index == held:
            camera = app.state.hub.camera_status()
            found.append({
                **entry,
                "ok": bool(camera.get("connected")) and not camera.get("lost"),
                "width": None, "height": None, "active": True,
            })
            continue
        try:
            result = await asyncio.wait_for(
                loop.run_in_executor(None, prober, index), PROBE_BUDGET_S
            )
        except ImportError:
            logger.info("cv2 not installed; no cv2 cameras to list")
            return []
        except asyncio.TimeoutError:
            logger.warning("camera probe of cv2:%d overran %.1fs", index, PROBE_BUDGET_S)
            result = {"ok": False, "width": None, "height": None}
        except Exception:
            logger.warning("camera probe of cv2:%d failed", index, exc_info=True)
            continue
        if result is None:
            continue
        found.append({
            **entry,
            "ok": bool(result.get("ok")),
            "width": result.get("width"),
            "height": result.get("height"),
            "active": False,
        })
    return found


@router.get("/api/cameras")
async def cameras(request: Request) -> dict:
    require_operator_key(request)
    app = request.app
    # One scan at a time: a double-click must not open the same device twice.
    lock = getattr(app.state, "camera_scan_lock", None)
    if lock is None:
        lock = app.state.camera_scan_lock = asyncio.Lock()
    async with lock:
        spec = _active_spec(app)
        prober = getattr(app.state, "camera_prober", None) or probe_cv2_index
        found = await _scan_cv2(app, prober, _held_cv2_index(app, spec))
    return {
        "active": spec,
        "cameras": found,
        "picamera2": importlib.util.find_spec("picamera2") is not None,
        "replays": list_replays(app.state.config.replay_dir),
        "push": True,
    }
