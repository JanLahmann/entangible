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
        entry: dict[str, Any] = {"code": w.code, "message": w.message}
        if getattr(w, "row", None) is not None:
            entry["row"] = w.row
        if getattr(w, "col", None) is not None:
            entry["col"] = w.col
        warnings.append(entry)

    return {
        "type": "detection",
        "fps": event.fps,
        "board": {
            "found": event.board_found,
            "corners": event.corners,
            "reprojectionErrorMm": event.reprojection_error_mm,
        },
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
        self._latest_circuit: dict | None = None
        self._latest_detection: dict | None = None
        self._last_detection_sent = 0.0
        self._camera: dict = {"kind": "none", "name": "", "connected": False}
        self._backend: dict = {"enabled": False, "healthy": False}

    # -- loop binding ------------------------------------------------------

    def attach_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Record the running event loop (called from lifespan startup)."""
        self._loop = loop

    # -- status pieces -----------------------------------------------------

    def set_camera(self, camera: dict) -> None:
        self._camera = dict(camera)

    def set_backend(self, *, enabled: bool, healthy: bool) -> None:
        self._backend = {"enabled": bool(enabled), "healthy": bool(healthy)}

    def camera_status(self) -> dict:
        return dict(self._camera)

    def backend_status(self) -> dict:
        return dict(self._backend)

    def client_count(self) -> int:
        return len(self._clients)

    def _status_message(self) -> dict:
        return {
            "type": "status",
            "camera": dict(self._camera),
            "backend": dict(self._backend),
            "clients": len(self._clients),
        }

    # -- registration ------------------------------------------------------

    async def connect(self, client: WSClient, role: str = "display",
                      label: str | None = None) -> None:
        """Register a client, replay latest circuit+detection+status to it.

        Also broadcasts the new client count to everyone else (a status change).
        """
        self._clients[client] = {"role": role, "label": label}
        if self._latest_circuit is not None:
            await self._send(client, self._latest_circuit)
        if self._latest_detection is not None:
            await self._send(client, self._latest_detection)
        await self._send(client, self._status_message())
        await self._broadcast(self._status_message(), exclude=client)

    async def disconnect(self, client: WSClient) -> None:
        """Unregister a client and broadcast the updated count."""
        if self._clients.pop(client, None) is not None:
            await self._broadcast(self._status_message())

    def set_role(self, client: WSClient, role: str, label: str | None = None) -> None:
        """Update a client's role label from a ``hello`` message."""
        if client in self._clients:
            self._clients[client] = {"role": role, "label": label}

    # -- publishing (async, on the event loop) -----------------------------

    async def publish_circuit(self, event: Any) -> None:
        """Assign the next seq, store as latest, broadcast to all clients."""
        self._seq += 1
        message = serialize_circuit(event, self._seq)
        self._latest_circuit = message
        await self._broadcast(message)

    async def publish_detection(self, event: Any) -> None:
        """Store latest detection; broadcast at most 5 Hz (drop intermediates)."""
        message = serialize_detection(event)
        self._latest_detection = message  # keep replay fresh even when throttled
        now = time.monotonic()
        if now - self._last_detection_sent < DETECTION_MIN_INTERVAL:
            return
        self._last_detection_sent = now
        await self._broadcast(message)

    async def publish_status(self) -> None:
        """Broadcast the current status to all clients (camera/backend change)."""
        await self._broadcast(self._status_message())

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
