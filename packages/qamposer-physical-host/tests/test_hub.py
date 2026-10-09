"""Hub: late-joiner replay order, seq semantics, 5 Hz detection throttle."""

from __future__ import annotations

import asyncio

from conftest import (
    FakeCircuitEvent,
    FakeDetectionEvent,
    FakeKindWarning,
    FakeMarker,
    FakeWarning,
    FakeWSClient,
)

from qamposer_host.hub import Hub


def _run(coro):
    return asyncio.run(coro)


def test_late_joiner_replay_order():
    async def scenario():
        hub = Hub()
        await hub.publish_circuit(
            FakeCircuitEvent(circuit={"qubits": 2, "gates": []}, source="replay")
        )
        await hub.publish_detection(FakeDetectionEvent())

        client = FakeWSClient()
        await hub.connect(client)
        # circuit, then detection, then status — in that exact order.
        assert client.types()[:3] == ["circuit", "detection", "status"]

    _run(scenario())


def test_status_only_when_no_prior_state():
    async def scenario():
        hub = Hub()
        client = FakeWSClient()
        await hub.connect(client)
        assert client.types() == ["status"]
        assert client.sent[0]["clients"] == 1

    _run(scenario())


def test_seq_increments_only_on_circuit_publishes():
    async def scenario():
        hub = Hub()
        client = FakeWSClient()
        await hub.connect(client)

        await hub.publish_circuit(FakeCircuitEvent(circuit={"qubits": 1, "gates": []}))
        await hub.publish_detection(FakeDetectionEvent())  # must not bump seq
        await hub.publish_circuit(FakeCircuitEvent(circuit={"qubits": 2, "gates": []}))

        seqs = [m["seq"] for m in client.sent if m["type"] == "circuit"]
        assert seqs == [1, 2]

    _run(scenario())


def test_detection_throttled_to_5hz():
    async def scenario():
        hub = Hub()
        client = FakeWSClient()
        await hub.connect(client)

        # Five detections back-to-back (all inside one 200 ms window):
        for i in range(5):
            await hub.publish_detection(FakeDetectionEvent(fps=float(i)))

        detections = [m for m in client.sent if m["type"] == "detection"]
        assert len(detections) == 1  # leading edge only; intermediates dropped

    _run(scenario())


def test_detection_serialized_camelcase():
    async def scenario():
        hub = Hub()
        client = FakeWSClient()
        await hub.connect(client)
        await hub.publish_detection(
            FakeDetectionEvent(
                markers=[FakeMarker(30, 0, 0), FakeMarker(22, off_grid=True)],
                warnings=[FakeWarning("lone_control", "oops", row=1, col=3)],
            )
        )
        det = next(m for m in client.sent if m["type"] == "detection")
        assert det["board"]["reprojectionErrorMm"] == 0.05
        assert {"id": 30, "row": 0, "col": 0} in det["markers"]
        assert {"id": 22, "offGrid": True} in det["markers"]
        assert det["warnings"][0] == {
            "code": "lone_control", "message": "oops", "row": 1, "col": 3,
        }

    _run(scenario())


def test_disconnect_updates_client_count():
    async def scenario():
        hub = Hub()
        a, b = FakeWSClient(), FakeWSClient()
        await hub.connect(a)
        await hub.connect(b)  # a receives a status update (count -> 2)
        assert hub.client_count() == 2
        await hub.disconnect(b)
        assert hub.client_count() == 1
        # a saw the final status broadcast with clients == 1
        assert a.sent[-1] == {
            "type": "status",
            "camera": {"kind": "none", "name": "", "connected": False, "lost": False},
            "backend": {"enabled": False, "healthy": False},
            "clients": 1,
        }

    _run(scenario())


def test_real_pipeline_warning_shape_serializes():
    # The vision pipeline's BuildWarning carries ``kind`` (no ``code``). Before
    # this was handled, ANY warning made serialize_detection raise, so every
    # detection with a warning (e.g. spare tiles beside the board, every frame)
    # silently never reached a screen.
    async def scenario():
        hub = Hub()
        client = FakeWSClient()
        await hub.connect(client)
        await hub.publish_detection(
            FakeDetectionEvent(
                warnings=[FakeKindWarning("stray_tiles", "3 gate tile(s) ...")]
            )
        )
        det = next(m for m in client.sent if m["type"] == "detection")
        assert det["warnings"] == [{"code": "stray_tiles", "message": "3 gate tile(s) ..."}]

    _run(scenario())


def test_camera_lost_transition_bypasses_throttle_and_flips_status():
    async def scenario():
        hub = Hub()
        hub.set_camera({"kind": "cv2", "name": "cv2:0", "connected": True})
        client = FakeWSClient()
        await hub.connect(client)
        assert client.sent[-1]["camera"]["lost"] is False

        # A live frame, then — inside the same 200 ms throttle window — the
        # pipeline's lost report. The fps-0 detection must NOT be dropped.
        await hub.publish_detection(FakeDetectionEvent(fps=30.0))
        await hub.publish_detection(
            FakeDetectionEvent(fps=0.0, board_found=False, corners=0, camera_lost=True)
        )
        detections = [m for m in client.sent if m["type"] == "detection"]
        assert [d["fps"] for d in detections] == [30.0, 0.0]
        status = client.sent[-1]
        assert status["type"] == "status"
        assert status["camera"]["lost"] is True
        assert hub.camera_status()["lost"] is True

        # A late joiner is told too (replayed detection fps 0 + lost status).
        late = FakeWSClient()
        await hub.connect(late)
        replay = {m["type"]: m for m in late.sent}
        assert replay["detection"]["fps"] == 0.0
        assert replay["status"]["camera"]["lost"] is True

        # Recovery: the first real frame clears it at once, again unthrottled.
        await hub.publish_detection(FakeDetectionEvent(fps=12.0))
        assert client.sent[-1]["type"] == "status"
        assert client.sent[-1]["camera"]["lost"] is False
        assert client.sent[-2]["type"] == "detection"
        assert client.sent[-2]["fps"] == 12.0

        # Steady state is throttled as before (no status spam).
        n = len(client.sent)
        await hub.publish_detection(FakeDetectionEvent(fps=12.0))
        assert len(client.sent) == n

    _run(scenario())


def test_new_camera_starts_not_lost():
    async def scenario():
        hub = Hub()
        await hub.publish_detection(FakeDetectionEvent(fps=0.0, camera_lost=True))
        assert hub.camera_status()["lost"] is True
        hub.set_camera({"kind": "cv2", "name": "cv2:1", "connected": True})
        assert hub.camera_status()["lost"] is False

    _run(scenario())
