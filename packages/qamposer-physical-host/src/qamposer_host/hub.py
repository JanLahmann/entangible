"""In-process broadcast hub for ``/ws/state``.

The hub owns the fan-out of server -> client messages and the small amount of
shared state the protocol requires:

* a monotonically increasing ``seq`` assigned to each new ``circuit`` message,
* the *latest* ``circuit`` / ``detection`` / ``status`` for late-joiner replay
  (sent, in that order, immediately after a client connects),
* per-client role labels (from ``hello``) and the live client count,
* a 5 Hz throttle on ``detection`` broadcasts.

The vision pipeline invokes its callbacks on a worker thread; the host bridges
those to the event loop through :meth:`publish_from_thread`, which schedules the
matching async publish via ``loop.call_soon_threadsafe``.

Clients are duck-typed: any object with an ``async send_json(obj)`` works, so
tests can drive the hub with plain fakes and no real WebSocket.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Protocol

logger = logging.getLogger("qamposer_host.hub")

#: Minimum seconds between broadcast ``detection`` messages (5 Hz).
DETECTION_MIN_INTERVAL = 0.2

#: Source kinds backed by a physical camera device. Only these must prove
#: themselves with a real frame before ``status.camera.connected`` is true, and
#: only these can be ``missing`` (never delivered a frame).
LIVE_CAMERA_KINDS = frozenset({"cv2", "picamera2"})

#: ``status.camera.reason`` when a camera opened (or seemed to) but never
#: delivered a frame within the pipeline's stall window.
NO_FRAMES_REASON = "the camera delivered no frames"


class WSClient(Protocol):
    async def send_json(self, obj: Any) -> None: ...


# --- serialization (snake_case events -> camelCase wire JSON) --------------


def serialize_circuit(event: Any, seq: int) -> dict:
    return {
        "type": "circuit",
        "seq": seq,
        "circuit": event.circuit,
        "qasm": event.qasm,
        "source": event.source,
    }


def serialize_detection(event: Any) -> dict:
    markers: list[dict] = []
    for m in event.markers:
        if getattr(m, "off_grid", False):
            markers.append({"id": m.id, "offGrid": True})
        else:
            markers.append({"id": m.id, "row": m.row, "col": m.col})

    warnings: list[dict] = []
    for w in event.warnings:
        # The pipeline's BuildWarning names its discriminant ``kind``; the wire
        # calls it ``code``. Accept either so a real warning can never make the
        # whole detection message unserializable.
        code = getattr(w, "code", None) or getattr(w, "kind", "")
        entry: dict[str, Any] = {"code": code, "message": w.message}
        if getattr(w, "row", None) is not None:
            entry["row"] = w.row
        if getattr(w, "col", None) is not None:
            entry["col"] = w.col
        warnings.append(entry)

    # Board model (#94/#95) — additive, and tolerant of a pipeline build that
    # predates it (getattr defaults keep the classic shape).
    rect = getattr(event, "rect_mm", None)
    board: dict[str, Any] = {
        "found": event.board_found,
        "corners": event.corners,
        "reprojectionErrorMm": event.reprojection_error_mm,
        "rectMm": (
            None if rect is None else {"widthMm": rect[0], "heightMm": rect[1]}
        ),
        "layout": getattr(event, "board_layout", "mat"),
        "rows": getattr(event, "rows", 0),
        "cols": getattr(event, "cols", 0),
        "wires": getattr(event, "wires", None),
        "measures": getattr(event, "measures", None),
        "unpairedMeasures": getattr(event, "unpaired_measures", 0),
        "strayFurniture": getattr(event, "stray_furniture", 0),
        "strayTiles": getattr(event, "stray_tiles", 0),
    }

    return {
        "type": "detection",
        "fps": event.fps,
        "board": board,
        "markers": markers,
        "warnings": warnings,
    }


def _is_circuit_event(event: Any) -> bool:
    return hasattr(event, "circuit") and hasattr(event, "qasm")


def _is_detection_event(event: Any) -> bool:
    return hasattr(event, "fps") and hasattr(event, "board_found")


class Hub:
    """Broadcast hub + replay/seq/throttle state for ``/ws/state``."""

    def __init__(self) -> None:
        self._clients: dict[Any, dict[str, Any]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._seq = 0
        self._serve_seq = 0
        self._latest_circuit: dict | None = None
        self._latest_detection: dict | None = None
        self._latest_layout: dict | None = None
        self._latest_served: dict | None = None
        self._last_detection_sent = 0.0
        self._camera: dict = {"kind": "none", "name": "", "connected": False}
        #: The pipeline reported the camera stalled (``camera_lost``); surfaced
        #: as ``status.camera.lost`` (only after a first frame) so every screen
        #: can say so plainly.
        self._camera_lost = False
        #: A real frame from the current source has arrived (any non-lost
        #: detection event). A live camera is not ``connected`` before this.
        self._camera_frames = False
        #: Why the current camera is not working (failed open); ``None`` while
        #: nothing is known to be wrong.
        self._camera_reason: str | None = None
        self._backend: dict = {"enabled": False, "healthy": False}

    # -- loop binding ------------------------------------------------------

    def attach_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Record the running event loop (called from lifespan startup)."""
        self._loop = loop

    # -- status pieces -----------------------------------------------------

    def set_camera(self, camera: dict, *, reason: str | None = None) -> None:
        """Record a (new) camera source; a fresh source starts not-lost.

        ``reason`` says why the source is already known not to work (the
        device failed to open); a live camera with a reason is reported
        ``missing`` from the very first status, never briefly ``connected``.
        """
        self._camera = dict(camera)
        self._camera_lost = False
        self._camera_frames = False
        self._camera_reason = reason

    def set_backend(self, *, enabled: bool, healthy: bool) -> None:
        self._backend = {"enabled": bool(enabled), "healthy": bool(healthy)}

    def camera_status(self) -> dict:
        """The ``status.camera`` object (docs/protocol.md).

        For a live camera (``cv2`` / ``picamera2``) ``connected`` means frames
        actually arrive: false until the first real frame, false again while
        ``lost``. ``lost`` is a stall *after* frames arrived (unplugged
        mid-session); ``missing`` is a live camera that has not delivered a
        frame and is known not to work — the device failed to open, or it went
        a whole stall window without a frame — with ``reason`` saying why.
        Replay / push sources keep ``connected`` = "a source is configured".
        """
        status = dict(self._camera)
        live = status.get("kind") in LIVE_CAMERA_KINDS
        lost = self._camera_lost and self._camera_frames
        missing = live and not self._camera_frames and (
            self._camera_lost or self._camera_reason is not None
        )
        if live:
            status["connected"] = (
                bool(status.get("connected")) and self._camera_frames and not lost
            )
        status["lost"] = lost
        status["missing"] = missing
        if missing:
            status["reason"] = self._camera_reason or NO_FRAMES_REASON
        return status

    def backend_status(self) -> dict:
        return dict(self._backend)

    def client_count(self) -> int:
        return len(self._clients)

    def _status_message(self) -> dict:
        return {
            "type": "status",
            "camera": self.camera_status(),
            "backend": dict(self._backend),
            "clients": len(self._clients),
        }

    # -- registration ------------------------------------------------------

    async def connect(self, client: WSClient, role: str = "display",
                      label: str | None = None) -> None:
        """Register a client, replay latest state to it.

        Replay order matches docs/protocol.md: circuit, detection, status,
        layout, then the latest ``served`` (when one exists). Also broadcasts
        the new client count to everyone else (a status change).
        """
        self._clients[client] = {"role": role, "label": label, "operator": False}
        if self._latest_circuit is not None:
            await self._send(client, self._latest_circuit)
        if self._latest_detection is not None:
            await self._send(client, self._latest_detection)
        await self._send(client, self._status_message())
        if self._latest_layout is not None:
            await self._send(client, self._latest_layout)
        if self._latest_served is not None:
            await self._send(client, self._latest_served)
        await self._broadcast(self._status_message(), exclude=client)

    async def disconnect(self, client: WSClient) -> None:
        """Unregister a client and broadcast the updated count."""
        if self._clients.pop(client, None) is not None:
            await self._broadcast(self._status_message())

    def set_role(
        self,
        client: WSClient,
        role: str,
        label: str | None = None,
        *,
        operator: bool = False,
    ) -> None:
        """Update a client's role label + operator standing from a ``hello``.

        ``operator`` is the *authenticated* flag (the caller has already verified
        the token); it gates the ``select_*`` control messages. The ``role`` /
        ``label`` are courtesy metadata only.
        """
        if client in self._clients:
            self._clients[client] = {
                "role": role, "label": label, "operator": bool(operator),
            }

    def is_operator(self, client: WSClient) -> bool:
        """True if this client authenticated as an operator on its ``hello``."""
        entry = self._clients.get(client)
        return bool(entry and entry.get("operator"))

    # -- publishing (async, on the event loop) -----------------------------

    async def publish_circuit(self, event: Any) -> None:
        """Assign the next seq, store as latest, broadcast to all clients."""
        self._seq += 1
        message = serialize_circuit(event, self._seq)
        self._latest_circuit = message
        await self._broadcast(message)

    async def publish_detection(self, event: Any) -> None:
        """Store latest detection; broadcast at most 5 Hz (drop intermediates).

        A camera-status transition (``event.camera_lost`` flipping either way,
        or the first real frame of a source turning it ``connected``) bypasses the throttle — the ``fps: 0`` detection must not be the frame
        that gets dropped — and is followed by a ``status`` broadcast carrying
        ``camera.lost``, so pills turn red (and back) at once.
        """
        message = serialize_detection(event)
        self._latest_detection = message  # keep replay fresh even when throttled
        lost = bool(getattr(event, "camera_lost", False))
        before = self.camera_status()
        self._camera_lost = lost
        if not lost:
            # Every non-lost detection comes from a real frame: the source
            # works (first frame → connected; after a stall → recovered).
            self._camera_frames = True
            self._camera_reason = None
        transition = self.camera_status() != before
        now = time.monotonic()
        if not transition and now - self._last_detection_sent < DETECTION_MIN_INTERVAL:
            return
        self._last_detection_sent = now
        await self._broadcast(message)
        if transition:
            await self._broadcast(self._status_message())

    async def publish_status(self) -> None:
        """Broadcast the current status to all clients (camera/backend change)."""
        await self._broadcast(self._status_message())

    def set_layout(self, message: dict) -> None:
        """Seed the latest ``layout`` message for replay (no broadcast).

        Called at startup with the persisted layout so late joiners get it.
        """
        self._latest_layout = dict(message)

    async def publish_layout(self, message: dict) -> None:
        """Store the latest layout and broadcast it to all clients."""
        self._latest_layout = dict(message)
        await self._broadcast(self._latest_layout)

    async def publish_served(
        self, *, pack_id: str, outcomes: list[str], shot_source: str
    ) -> dict:
        """Stamp + broadcast a Quantina ``served`` message to every client.

        The host is the authority: it assigns the monotonic serve ``seq`` (per
        host process, independent of the circuit ``seq``) and the active
        ``packId``, then fans the serve out so every screen reveals the same
        result in sync. The latest ``served`` is replayed to late joiners.

        Returns the stamped message dict so the caller can hand it to the machine
        dispatcher (QN4) after the broadcast.
        """
        self._serve_seq += 1
        message = {
            "type": "served",
            "seq": self._serve_seq,
            "packId": pack_id,
            "outcomes": list(outcomes),
            "shotSource": shot_source,
        }
        self._latest_served = message
        await self._broadcast(message)
        return message

    # -- thread bridge -----------------------------------------------------

    def publish_from_thread(self, event: Any) -> None:
        """Schedule a publish from the pipeline worker thread.

        Dispatches by event shape so a single callback target works for both
        ``on_circuit`` and ``on_detection``.
        """
        loop = self._loop
        if loop is None:
            logger.warning("publish_from_thread before loop attached; dropping event")
            return
        if _is_circuit_event(event):
            coro = self.publish_circuit
        elif _is_detection_event(event):
            coro = self.publish_detection
        else:
            logger.warning("publish_from_thread: unrecognized event %r", event)
            return

        def _schedule() -> None:
            asyncio.ensure_future(coro(event))

        loop.call_soon_threadsafe(_schedule)

    # -- internals ---------------------------------------------------------

    async def _send(self, client: WSClient, message: dict) -> None:
        try:
            await client.send_json(message)
        except Exception:
            logger.debug("dropping client after send failure", exc_info=True)
            self._clients.pop(client, None)

    async def _broadcast(self, message: dict, exclude: WSClient | None = None) -> None:
        for client in list(self._clients):
            if client is exclude:
                continue
            await self._send(client, message)
