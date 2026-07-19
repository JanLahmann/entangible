"""``qamposer-physical`` command-line entry point.

Subcommands:

* ``run``   — start the kiosk host under uvicorn, with self-signed TLS by
  default (``--no-tls`` for plain-HTTP dev). ``--open`` launches a browser.
* ``qr``    — print the phone-capture URL (with the operator key embedded) as an
  ASCII QR code to the terminal.
* ``token`` — print the shared operator token (generating it on first use);
  ``--rotate`` mints a new one (invalidating previously printed staff sheets).
"""

from __future__ import annotations

import argparse
import sys
import threading
import webbrowser

from .certs import ensure_cert, primary_lan_ip
from .config import HostConfig
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
    )


def _cmd_run(args: argparse.Namespace) -> int:
    import uvicorn

    from .main import create_app

    config = _config_from_run_args(args)
    app = create_app(config)

    scheme = "https" if config.tls else "http"
    display_host = primary_lan_ip()
    url = f"{scheme}://{display_host}:{config.port}/"
    # The big-screen booth skin is the `?kiosk` surface of the one app; --open
    # (and `make demo`) launch it already asking to connect to this host.
    kiosk_url = f"{url}?kiosk&connect=1"
    print(f"Entangible host → {url}  (source: {config.source}, backend: {config.backend})")
    print(f"  kiosk screen:  {kiosk_url}")
    print(f"  debug preview: {scheme}://{display_host}:{config.port}/debug/snapshot.jpg")

    kwargs: dict = {"host": config.host, "port": config.port}
    if config.tls:
        cert_path, key_path = ensure_cert(config.cert_dir, hostname=display_host)
        kwargs["ssl_certfile"] = str(cert_path)
        kwargs["ssl_keyfile"] = str(key_path)

    if args.open:
        threading.Timer(1.5, lambda: webbrowser.open(kiosk_url)).start()

    uvicorn.run(app, **kwargs)
    return 0


def _cmd_qr(args: argparse.Namespace) -> int:
    import qrcode

    config = HostConfig.from_env(cert_dir=args.cert_dir, config_dir=args.config_dir)
    port = args.port or config.port
    scheme = "http" if args.no_tls else "https"
    path = args.path if args.path.startswith("/") else "/" + args.path
    # Embed the operator token so the scanning phone arrives already
    # authenticated for the pocket camera role — /ws/frames + operator /ws/state
    # (both token-gated). `/pocket` redirects to `/`.
    token = ensure_token(config.cert_dir)
    sep = "&" if "?" in path else "?"
    path = f"{path}{sep}key={token}"
    url = f"{scheme}://{primary_lan_ip()}:{port}{path}"
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    qr.make(fit=True)
    print(url)
    qr.print_ascii(invert=True)
    return 0


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
    if args.command == "token":
        return _cmd_token(args)
    return 2  # pragma: no cover


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
