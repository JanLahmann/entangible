"""``qamposer-physical doctor`` — the terminal preflight (P2 'doctor').

Every check must degrade to a ✗ row with a hint, never a traceback, and the
exit code is the verdict: 0 only when every row is green.
"""

from __future__ import annotations

import socket
from pathlib import Path

from qamposer_host import cli


def _dist(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html>", encoding="utf-8")
    return dist


def _replay(tmp_path: Path) -> Path:
    rec = tmp_path / "recordings" / "bell"
    rec.mkdir(parents=True)
    (rec / "frame_000.jpg").write_bytes(b"\xff\xd8\xff")
    return rec


def _run_doctor(tmp_path: Path, *extra: str) -> int:
    return cli.main([
        "doctor",
        "--cert-dir", str(tmp_path / "certs"),
        "--config-dir", str(tmp_path / "config"),
        "--host", "127.0.0.1",
        *extra,
    ])


def test_doctor_green_on_replay(tmp_path, capsys) -> None:
    rc = _run_doctor(
        tmp_path,
        "--pocket-dist", str(_dist(tmp_path)),
        "--source", f"replay:{_replay(tmp_path)}",
        "--port", "0",
    )
    out = capsys.readouterr().out
    assert rc == 0
    assert "READY" in out and "NOT READY" not in out
    assert out.count("✓") == 5
    # The cert + token side effects landed where the booth will read them.
    assert (tmp_path / "certs" / "cert.pem").is_file()


def test_doctor_missing_build_fails_with_the_fix(tmp_path, capsys) -> None:
    rc = _run_doctor(
        tmp_path,
        "--pocket-dist", str(tmp_path / "nowhere"),
        "--source", f"replay:{_replay(tmp_path)}",
        "--port", "0",
    )
    out = capsys.readouterr().out
    assert rc == 1
    assert "NOT READY" in out
    assert "npm run build" in out  # the hint names the first fix


def test_doctor_reports_a_taken_port(tmp_path, capsys) -> None:
    squatter = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    squatter.bind(("127.0.0.1", 0))
    port = squatter.getsockname()[1]
    try:
        rc = _run_doctor(
            tmp_path,
            "--pocket-dist", str(_dist(tmp_path)),
            "--source", f"replay:{_replay(tmp_path)}",
            "--port", str(port),
        )
    finally:
        squatter.close()
    out = capsys.readouterr().out
    assert rc == 1
    assert f"lsof -i :{port}" in out  # the stale-demo-host trap, named


def test_doctor_push_source_needs_no_camera(tmp_path, capsys) -> None:
    rc = _run_doctor(
        tmp_path,
        "--pocket-dist", str(_dist(tmp_path)),
        "--source", "push",
        "--port", "0",
    )
    assert rc == 0
    assert "staff QR" in capsys.readouterr().out


def test_doctor_unknown_source_is_a_row_not_a_crash(tmp_path, capsys) -> None:
    rc = _run_doctor(
        tmp_path,
        "--pocket-dist", str(_dist(tmp_path)),
        "--source", "webcam:9",
        "--port", "0",
    )
    out = capsys.readouterr().out
    assert rc == 1
    assert "unknown source spec" in out


# --- context: plain vs. under the `entangible` wrapper (QAMPOSER_DOCTOR_CONTEXT) --


def _last_line(out: str) -> str:
    return out.strip().splitlines()[-1]


def _squat() -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen()
    return sock


def test_plain_doctor_output_is_unchanged(tmp_path, capsys, monkeypatch) -> None:
    monkeypatch.delenv(cli.DOCTOR_CONTEXT_ENV, raising=False)
    rc = _run_doctor(tmp_path, "--pocket-dist", str(_dist(tmp_path)),
                     "--source", f"replay:{_replay(tmp_path)}", "--port", "0")
    out = capsys.readouterr().out
    assert rc == 0
    assert _last_line(out) == "READY — start with: qamposer-physical run"
    assert "entangible" not in out


def test_unknown_context_value_means_plain(tmp_path, capsys, monkeypatch) -> None:
    monkeypatch.setenv(cli.DOCTOR_CONTEXT_ENV, "bogus")
    rc = _run_doctor(tmp_path, "--pocket-dist", str(_dist(tmp_path)),
                     "--source", "push", "--port", "0")
    assert rc == 0
    assert _last_line(capsys.readouterr().out) == "READY — start with: qamposer-physical run"


def test_wrapped_service_stopped_says_entangible_start(tmp_path, capsys, monkeypatch) -> None:
    monkeypatch.setenv(cli.DOCTOR_CONTEXT_ENV, "rasqberry")
    rc = _run_doctor(tmp_path, "--pocket-dist", str(_dist(tmp_path)),
                     "--source", f"replay:{_replay(tmp_path)}", "--port", "0")
    out = capsys.readouterr().out
    assert rc == 0
    assert _last_line(out) == "READY — start with: entangible start"
    assert "qamposer-physical run" not in out


def test_wrapped_service_stopped_port_taken_is_someone_else(
    tmp_path, capsys, monkeypatch
) -> None:
    # The service is stopped, so whoever holds the port is NOT the booth: ✗,
    # with a way to name it — and the fixes speak the wrapper's language.
    monkeypatch.setenv(cli.DOCTOR_CONTEXT_ENV, "rasqberry")
    squatter = _squat()
    port = squatter.getsockname()[1]
    try:
        rc = _run_doctor(tmp_path, "--pocket-dist", str(tmp_path / "nowhere"),
                         "--source", "push", "--port", str(port))
    finally:
        squatter.close()
    out = capsys.readouterr().out
    assert rc == 1
    assert f"port {port} is taken, and entangible-host is stopped" in out
    assert f"ss -ltnp 'sport = :{port}'" in out
    assert "entangible install" in out  # the app-build fix, not npm
    assert "npm" not in out and "kill it" not in out
    assert _last_line(out) == "NOT READY — fix the ✗ rows above, then: entangible start"


def test_wrapped_service_running_port_is_the_service(tmp_path, capsys, monkeypatch) -> None:
    # The running service holds the port: that is the booth, not a stale host.
    monkeypatch.setenv(cli.DOCTOR_CONTEXT_ENV, "rasqberry-running")
    squatter = _squat()
    port = squatter.getsockname()[1]
    try:
        rc = _run_doctor(tmp_path, "--pocket-dist", str(_dist(tmp_path)),
                         "--source", f"replay:{_replay(tmp_path)}", "--port", str(port))
    finally:
        squatter.close()
    out = capsys.readouterr().out
    assert rc == 0, out
    assert f"✓ port            port {port} held by the running entangible-host service" in out
    assert "kill" not in out and "lsof" not in out
    assert "✗" not in out
    assert _last_line(out) == (
        "READY — entangible-host is running (after a settings change: entangible restart)"
    )


def _health_server(camera: dict):
    """A plain-HTTP stand-in for the running host's /api/health."""
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 (http.server API)
            body = json.dumps({"status": "ok", "camera": camera, "clients": 0}).encode()
            self.send_response(200 if self.path == "/api/health" else 404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args) -> None:
            return None

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def test_wrapped_service_running_camera_comes_from_health(
    tmp_path, capsys, monkeypatch
) -> None:
    # The service holds the camera: the doctor must not open it again but
    # report what the service sees.
    monkeypatch.setenv(cli.DOCTOR_CONTEXT_ENV, "rasqberry-running")
    import qamposer_vision.sources as sources

    def no_probe():
        raise AssertionError("the camera must not be probed while the service runs")

    monkeypatch.setattr(sources, "list_cameras", no_probe)
    dist = _dist(tmp_path)
    for camera, rc_want, text in (
        ({"kind": "cv2", "name": "cv2:0", "connected": True, "lost": False}, 0,
         "cv2:0 connected (reported by the running entangible-host)"),
        ({"kind": "cv2", "name": "cv2:0", "connected": True, "lost": True}, 1,
         "cv2:0 not connected (reported by the running entangible-host)"),
    ):
        server = _health_server(camera)
        try:
            rc = _run_doctor(tmp_path, "--pocket-dist", str(dist), "--source", "cv2:0",
                             "--no-tls", "--port", str(server.server_address[1]))
        finally:
            server.shutdown()
            server.server_close()
        out = capsys.readouterr().out
        assert rc == rc_want, out
        assert text in out, out
        assert "held by the running entangible-host service" in out
        if rc_want:
            assert _last_line(out) == "NOT READY — fix the ✗ rows above, then: entangible restart"


def test_wrapped_service_running_but_not_answering(tmp_path, capsys, monkeypatch) -> None:
    monkeypatch.setenv(cli.DOCTOR_CONTEXT_ENV, "rasqberry-running")
    squatter = _squat()  # holds the port but never answers HTTP
    port = squatter.getsockname()[1]
    squatter.close()  # nobody listens now: the health probe is refused
    rc = _run_doctor(tmp_path, "--pocket-dist", str(_dist(tmp_path)),
                     "--source", "picamera2", "--no-tls", "--port", str(port))
    out = capsys.readouterr().out
    assert rc == 1
    assert "entangible-host does not answer" in out
    assert "journalctl -u entangible-host" in out


def test_demo_loop_replay_source_is_green_from_the_checkout(monkeypatch) -> None:
    # The documented demo source, as the entangible wrapper runs it (cwd =
    # the checkout): the committed recording, nothing generated.
    repo = Path(__file__).resolve().parents[3]
    monkeypatch.chdir(repo)
    ok, detail, _hint = cli._check_source("replay:examples/recordings/bell-sequence", "x", True)
    assert ok, detail
