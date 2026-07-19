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
