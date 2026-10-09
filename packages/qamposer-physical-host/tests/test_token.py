"""Operator-token lifecycle: create, reuse, rotate, permissions, CLI, matching."""

from __future__ import annotations

import stat

import pytest

from qamposer_host.token import (
    TOKEN_NAME,
    ensure_token,
    rotate_token,
    token_matches,
)


def test_ensure_token_creates_and_persists(tmp_path):
    token = ensure_token(tmp_path)
    assert isinstance(token, str) and token
    path = tmp_path / TOKEN_NAME
    assert path.is_file()
    assert path.read_text(encoding="utf-8").strip() == token


def test_ensure_token_reused_on_second_call(tmp_path):
    first = ensure_token(tmp_path)
    second = ensure_token(tmp_path)
    assert first == second  # generate-once, reuse-thereafter


def test_token_file_permissions_are_600(tmp_path):
    ensure_token(tmp_path)
    mode = stat.S_IMODE((tmp_path / TOKEN_NAME).stat().st_mode)
    assert mode == 0o600


def test_rotate_token_changes_and_persists(tmp_path):
    first = ensure_token(tmp_path)
    rotated = rotate_token(tmp_path)
    assert rotated != first
    # The new token is what ensure_token now returns.
    assert ensure_token(tmp_path) == rotated
    mode = stat.S_IMODE((tmp_path / TOKEN_NAME).stat().st_mode)
    assert mode == 0o600


def test_token_matches_is_exact_and_typed():
    assert token_matches("abc", "abc") is True
    assert token_matches("abcd", "abc") is False
    assert token_matches("", "abc") is False
    assert token_matches(None, "abc") is False
    assert token_matches(123, "abc") is False


# --- CLI --------------------------------------------------------------------


def test_cli_token_prints_and_persists(tmp_path, capsys):
    from qamposer_host.cli import main

    rc = main(["token", "--cert-dir", str(tmp_path)])
    assert rc == 0
    printed = capsys.readouterr().out.strip()
    assert printed
    assert (tmp_path / TOKEN_NAME).read_text(encoding="utf-8").strip() == printed
    # A second call prints the same token (reuse).
    main(["token", "--cert-dir", str(tmp_path)])
    assert capsys.readouterr().out.strip() == printed


def test_cli_token_rotate_changes(tmp_path, capsys):
    from qamposer_host.cli import main

    main(["token", "--cert-dir", str(tmp_path)])
    first = capsys.readouterr().out.strip()
    main(["token", "--rotate", "--cert-dir", str(tmp_path)])
    rotated = capsys.readouterr().out.strip()
    assert rotated and rotated != first


def test_cli_qr_embeds_key(tmp_path, capsys):
    from qamposer_host.cli import main

    token = ensure_token(tmp_path)
    rc = main(["qr", "--cert-dir", str(tmp_path), "--no-tls", "--path", "/pocket"])
    assert rc == 0
    out = capsys.readouterr().out
    assert f"/pocket?key={token}" in out


def test_cli_qr_default_is_pocket_camera_role(tmp_path, capsys):
    # The default `qr` target is the pocket camera role (staff QR); an arbitrary
    # target can still be set via --path (covered above).
    from qamposer_host.cli import main

    token = ensure_token(tmp_path)
    rc = main(["qr", "--cert-dir", str(tmp_path), "--no-tls"])
    assert rc == 0
    out = capsys.readouterr().out
    assert f"/pocket?connect=1&role=camera&key={token}" in out


def test_cli_qr_uses_advertise_host(tmp_path, capsys):
    from qamposer_host.cli import main

    token = ensure_token(tmp_path)
    rc = main([
        "qr", "--cert-dir", str(tmp_path), "--no-tls", "--port", "9000",
        "--advertise-host", "entangible.local",
    ])
    assert rc == 0
    out = capsys.readouterr().out
    assert f"http://entangible.local:9000/pocket?connect=1&role=camera&key={token}" in out


# --- `run` startup lines ----------------------------------------------------
# Every URL `run` prints must open verbatim: the staff /debug data endpoints are
# operator-gated, so a keyless debug URL would 403 (the former
# `/debug/snapshot.jpg` line did).


def _run_output(tmp_path, monkeypatch, capsys, *extra: str) -> str:
    import uvicorn

    from qamposer_host.cli import main

    calls: list[dict] = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: calls.append(kw))
    rc = main([
        "run", "--cert-dir", str(tmp_path / "certs"), "--config-dir", str(tmp_path),
        "--source", "replay:none", "--pocket-dist", str(tmp_path / "dist"), *extra,
    ])
    assert rc == 0 and len(calls) == 1
    return capsys.readouterr().out


def _printed_urls(out: str) -> list[str]:
    import re

    return re.findall(r"https?://\S+", out)


def test_cli_run_prints_keyed_debug_url(tmp_path, monkeypatch, capsys):
    out = _run_output(tmp_path, monkeypatch, capsys, "--no-tls", "--advertise-host", "10.42.0.1")
    token = ensure_token(tmp_path / "certs")
    assert f"staff debug:   http://10.42.0.1:8443/debug?key={token}" in out
    assert "qamposer-physical qr" in out


def test_cli_run_prints_no_gated_url_without_a_key(tmp_path, monkeypatch, capsys):
    out = _run_output(tmp_path, monkeypatch, capsys, "--no-tls", "--advertise-host", "booth.lan")
    token = ensure_token(tmp_path / "certs")
    urls = _printed_urls(out)
    assert urls, out
    for url in urls:
        # Every printed URL carries the advertised host, never a detected one.
        assert url.startswith("http://booth.lan:8443/"), url
        # A staff-gated path is only ever printed with the key.
        if "/debug" in url or "/api/qr" in url:
            assert f"key={token}" in url, url
    assert "/debug/snapshot.jpg" not in out


def test_cli_run_qr_hint_repeats_url_flags(tmp_path, monkeypatch, capsys):
    out = _run_output(
        tmp_path, monkeypatch, capsys,
        "--no-tls", "--port", "9001", "--advertise-host", "booth.lan",
    )
    assert (
        f"qamposer-physical qr --no-tls --port 9001 --cert-dir {tmp_path / 'certs'} "
        "--advertise-host booth.lan"
    ) in out


def test_cli_run_tls_cert_covers_advertise_host(tmp_path, monkeypatch, capsys):
    from cryptography import x509

    _run_output(tmp_path, monkeypatch, capsys, "--advertise-host", "entangible.local")
    cert = x509.load_pem_x509_certificate((tmp_path / "certs" / "cert.pem").read_bytes())
    san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert "entangible.local" in san.get_values_for_type(x509.DNSName)
