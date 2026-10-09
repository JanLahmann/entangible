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
