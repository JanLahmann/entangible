"""``qamposer-physical`` command-line entry point.

Subcommands:

* ``run``   — start the kiosk host under uvicorn, with self-signed TLS by
  default (``--no-tls`` for plain-HTTP dev). ``--open`` launches a browser.
  Every URL it prints opens as-is (the staff ``/debug`` one carries the key).
* ``qr``    — print the phone-capture URL (with the operator key embedded) as an
  ASCII QR code to the terminal.
* ``doctor`` — preflight checklist (app build, camera, port, TLS, token):
  ✓/✗ rows with the first fix to try; exit 0 only when everything is green.
* ``token`` — print the shared operator token (generating it on first use);
  ``--rotate`` mints a new one (invalidating previously printed staff sheets).
"""

from __future__ import annotations

import argparse
import sys
import threading
import webbrowser

from .certs import ensure_cert
from .config import HostConfig, advertised_host
from .token import ensure_token, rotate_token


def _add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--port", type=int, default=None, help="listen port (default 8443)")
    parser.add_argument("--no-tls", action="store_true", help="serve plain HTTP (dev)")
    # The staff QR opens the app in its CAMERA role by default (/pocket
    # redirects to /). Override to target any client route.
    parser.add_argument(
        "--path",
        default="/pocket?connect=1&role=camera",
        help="target path for QR URLs (default: the camera role)",
    )
    parser.add_argument(
        "--advertise-host",
        default=None,
        help="host name or IP to put in printed URLs / QR codes and the cert "
        "(default: the detected LAN IP; env QAMPOSER_ADVERTISE_HOST)",
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="qamposer-physical")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="run the kiosk host")
    run.add_argument("--source", default=None,
                    help="frame source: replay:<dir> | cv2:<idx> | picamera2 | push")
    run.add_argument("--host", default=None, help="bind address (default 0.0.0.0)")
    run.add_argument("--backend", default=None, help="off | url:<base-url> | spawn")
    run.add_argument("--pocket-dist", default=None, help="path to the built app (pocket-app/dist)")
    run.add_argument("--cert-dir", default=None, help="TLS cert directory")
    run.add_argument("--config-dir", default=None,
                    help="config dir for layout.toml / branding.toml (default ~/.qamposer-physical)")
    run.add_argument("--branding", default=None, help="path to branding.toml")
    run.add_argument("--open", action="store_true", help="open a browser on start")
    _add_common(run)

    qr = sub.add_parser("qr", help="print the capture URL as an ASCII QR code")
    qr.add_argument("--cert-dir", default=None, help="TLS/token cert directory")
    qr.add_argument("--config-dir", default=None, help="config dir (default ~/.qamposer-physical)")
    _add_common(qr)

    tok = sub.add_parser("token", help="print (or rotate) the shared operator token")
    tok.add_argument("--rotate", action="store_true", help="mint a new token")
    tok.add_argument("--cert-dir", default=None, help="TLS/token cert directory")
    tok.add_argument("--config-dir", default=None, help="config dir (default ~/.qamposer-physical)")

    doctor = sub.add_parser(
        "doctor", help="preflight: check the booth can start, before visitors arrive"
    )
    doctor.add_argument("--source", default=None,
                        help="frame source to check (default: the configured one)")
    doctor.add_argument("--host", default=None, help="bind address (default 0.0.0.0)")
    doctor.add_argument("--pocket-dist", default=None,
                        help="path to the built app (pocket-app/dist)")
    doctor.add_argument("--cert-dir", default=None, help="TLS cert directory")
    doctor.add_argument("--config-dir", default=None,
                        help="config dir (default ~/.qamposer-physical)")
    _add_common(doctor)

    return parser


def _config_from_run_args(args: argparse.Namespace) -> HostConfig:
    return HostConfig.from_env(
        host=args.host,
        port=args.port,
        source=args.source,
        backend=args.backend,
        pocket_dist=args.pocket_dist,
        cert_dir=args.cert_dir,
        config_dir=args.config_dir,
        branding_file=args.branding,
        tls=False if args.no_tls else None,
        advertise_host=args.advertise_host,
    )


def _qr_command(args: argparse.Namespace, config: HostConfig) -> str:
    """The ``qr`` invocation that encodes the same origin this ``run`` serves.

    Printed verbatim at startup, so it repeats every flag that changes the URL
    or the token location (``qr`` does not see ``run``'s arguments).
    """
    parts = ["qamposer-physical qr"]
    if not config.tls:
        parts.append("--no-tls")
    if args.port is not None:
        parts.append(f"--port {config.port}")
    if args.cert_dir is not None:
        parts.append(f"--cert-dir {config.cert_dir}")
    if args.advertise_host is not None and config.advertise_host:
        parts.append(f"--advertise-host {config.advertise_host}")
    return " ".join(parts)


def _ensure_host_cert(config: HostConfig):
    """The one TLS cert ``run`` and ``doctor`` share (``(cert, key)`` paths).

    SANs: the machine's hostname (+ ``.local``), ``localhost``, 127.0.0.1, the
    LAN IPv4s and the advertised host. Both commands must ask for the same set,
    or each would regenerate the other's cert; the hostname is never replaced
    by the advertised host (it used to be, dropping it from the SANs).
    """
    return ensure_cert(config.cert_dir, extra_hosts=[advertised_host(config)])


def _cmd_run(args: argparse.Namespace) -> int:
    import uvicorn

    from .main import create_app

    config = _config_from_run_args(args)
    app = create_app(config)

    scheme = "https" if config.tls else "http"
    display_host = advertised_host(config)
    url = f"{scheme}://{display_host}:{config.port}/"
    # The big-screen booth skin is the `?kiosk` surface of the one app; --open
    # (and `make demo`) launch it already asking to connect to this host.
    kiosk_url = f"{url}?kiosk&connect=1"
    # Staff /debug data endpoints are operator-gated: a keyless URL would 403 or
    # prompt, so the printed one carries the key (the page stores it and strips
    # it from the address bar).
    token = app.state.operator_token
    print(f"Entangible host → {url}  (source: {config.source}, backend: {config.backend})")
    if config.source.startswith("replay:"):
        print("  NOTE: replay source — this is the recorded DEMO loop, not a live camera")
    print(f"  kiosk screen:  {kiosk_url}")
    print(f"  staff debug:   {scheme}://{display_host}:{config.port}/debug?key={token}")
    print(f"  phone camera:  run `{_qr_command(args, config)}` for the staff QR (also on /debug)")

    kwargs: dict = {"host": config.host, "port": config.port}
    if config.tls:
        cert_path, key_path = _ensure_host_cert(config)
        kwargs["ssl_certfile"] = str(cert_path)
        kwargs["ssl_keyfile"] = str(key_path)

    if args.open:
        threading.Timer(1.5, lambda: webbrowser.open(kiosk_url)).start()

    uvicorn.run(app, **kwargs)
    return 0


def _cmd_qr(args: argparse.Namespace) -> int:
    import qrcode

    config = HostConfig.from_env(
        cert_dir=args.cert_dir,
        config_dir=args.config_dir,
        advertise_host=args.advertise_host,
    )
    port = args.port or config.port
    scheme = "http" if args.no_tls else "https"
    path = args.path if args.path.startswith("/") else "/" + args.path
    # Embed the operator token so the scanning phone arrives already
    # authenticated for the pocket camera role — /ws/frames + operator /ws/state
    # (both token-gated). `/pocket` redirects to `/`.
    token = ensure_token(config.cert_dir)
    sep = "&" if "?" in path else "?"
    path = f"{path}{sep}key={token}"
    url = f"{scheme}://{advertised_host(config)}:{port}{path}"
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    qr.make(fit=True)
    print(url)
    qr.print_ascii(invert=True)
    return 0


# --- doctor ------------------------------------------------------------------


def _check_source(spec: str, replay_dir) -> tuple[bool, str, str]:
    """(ok, detail, hint) for one frame-source spec, without starting a pipeline."""
    from pathlib import Path

    kind, _, rest = spec.partition(":")
    if kind == "push":
        return True, "phone camera (push) — frames arrive once a phone scans the staff QR", ""
    if kind == "replay":
        directory = Path(rest) if rest else Path(replay_dir)
        if directory.is_dir() and any(directory.glob("**/frame_*")):
            return True, f"replay {directory} — the recorded DEMO loop, not a live camera", ""
        return False, f"replay dir {directory} has no frame_* files", \
            "the committed demo loop is replay:examples/recordings/bell-sequence (run from the checkout)"
    if kind == "picamera2":
        import importlib.util

        if importlib.util.find_spec("picamera2") is not None:
            return True, "picamera2 importable", ""
        return False, "picamera2 not importable", \
            "apt install python3-picamera2 + a venv with --system-site-packages (docs/rasqberry.md)"
    if kind == "cv2":
        index = int(rest or 0)
        try:
            from qamposer_vision.sources import list_cameras  # lazy
        except Exception:
            return False, "qamposer-vision not importable", "run `uv sync` from the repo root"
        openable = list_cameras()
        if index in openable:
            return True, f"cv2:{index} opens (openable: {openable})", ""
        if openable:
            return False, f"cv2:{index} does not open (openable: {openable})", \
                f"run with --source cv2:{openable[0]}, or pick one on /debug"
        return False, "no cv2 camera opens", \
            "plug in a camera, or use --source push / replay (the host still starts and retries)"
    return False, f"unknown source spec {spec!r}", "use replay:<dir> | cv2:<idx> | picamera2 | push"


def _cmd_doctor(args: argparse.Namespace) -> int:
    """Preflight for booth operators: every row is ✓/✗ + the first fix to try.

    Mirrors the /debug READY card for the moments before the host runs. Checks
    never raise; exit 0 only when every row is green.
    """
    import socket as _socket

    config = HostConfig.from_env(
        host=args.host,
        port=args.port,
        source=args.source,
        pocket_dist=args.pocket_dist,
        cert_dir=args.cert_dir,
        config_dir=args.config_dir,
        tls=False if args.no_tls else None,
        advertise_host=args.advertise_host,
    )
    rows: list[tuple[bool, str, str, str]] = []  # (ok, label, detail, hint)

    def check(label: str, fn) -> None:
        try:
            ok, detail, hint = fn()
        except Exception as exc:  # a check must never kill the doctor
            ok, detail, hint = False, f"{type(exc).__name__}: {exc}", ""
        rows.append((ok, label, detail, hint))

    check("app build", lambda: (
        (config.pocket_dist / "index.html").is_file(),
        str(config.pocket_dist),
        "cd pocket-app && npm ci && npm run build",
    ))
    check("camera", lambda: _check_source(config.source, config.replay_dir))

    def port_free() -> tuple[bool, str, str]:
        sock = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
        try:
            sock.bind((config.host, config.port))
        except OSError:
            # The classic trap: a stale host from an earlier demo still running.
            return False, f"port {config.port} is taken", \
                f"another host is running — lsof -i :{config.port}, then kill it"
        finally:
            sock.close()
        return True, f"port {config.port} free on {config.host}", ""

    check("port", port_free)

    def tls_ready() -> tuple[bool, str, str]:
        if not config.tls:
            return True, "TLS off (--no-tls) — phones cannot use their camera", ""
        cert_path, _key = _ensure_host_cert(config)
        return True, f"cert ready at {cert_path} (host {advertised_host(config)})", ""

    check("tls", tls_ready)
    check("operator token", lambda: (
        bool(ensure_token(config.cert_dir)),
        f"stored with the certs in {config.cert_dir}",
        "",
    ))

    for ok, label, detail, hint in rows:
        mark = "✓" if ok else "✗"
        line = f" {mark} {label:<15} {detail}"
        if not ok and hint:
            line += f"\n     → {hint}"
        print(line)
    ready = all(ok for ok, *_ in rows)
    print("READY — start with: qamposer-physical run" if ready
          else "NOT READY — fix the ✗ rows above")
    return 0 if ready else 1


def _cmd_token(args: argparse.Namespace) -> int:
    config = HostConfig.from_env(cert_dir=args.cert_dir, config_dir=args.config_dir)
    token = rotate_token(config.cert_dir) if args.rotate else ensure_token(config.cert_dir)
    print(token)
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv if argv is not None else sys.argv[1:])
    if args.command == "run":
        return _cmd_run(args)
    if args.command == "qr":
        return _cmd_qr(args)
    if args.command == "doctor":
        return _cmd_doctor(args)
    if args.command == "token":
        return _cmd_token(args)
    return 2  # pragma: no cover


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
