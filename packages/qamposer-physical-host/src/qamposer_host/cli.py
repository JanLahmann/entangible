"""``qamposer-physical`` command-line entry point.

Subcommands:

* ``run``  — start the kiosk host under uvicorn, with self-signed TLS by
  default (``--no-tls`` for plain-HTTP dev). ``--open`` launches a browser.
* ``qr``   — print the phone-capture URL as an ASCII QR code to the terminal.
"""

from __future__ import annotations

import argparse
import sys
import threading
import webbrowser

from .certs import ensure_cert, primary_lan_ip
from .config import HostConfig


def _add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--port", type=int, default=None, help="listen port (default 8443)")
    parser.add_argument("--no-tls", action="store_true", help="serve plain HTTP (dev)")
    parser.add_argument("--path", default="/capture", help="capture path for QR URLs")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="qamposer-physical")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="run the kiosk host")
    run.add_argument("--source", default=None,
                    help="frame source: replay:<dir> | cv2:<idx> | picamera2 | push")
    run.add_argument("--host", default=None, help="bind address (default 0.0.0.0)")
    run.add_argument("--backend", default=None, help="off | url:<base-url> | spawn")
    run.add_argument("--display-dist", default=None, help="path to built display app")
    run.add_argument("--cert-dir", default=None, help="TLS cert directory")
    run.add_argument("--open", action="store_true", help="open a browser on start")
    _add_common(run)

    qr = sub.add_parser("qr", help="print the capture URL as an ASCII QR code")
    _add_common(qr)

    return parser


def _config_from_run_args(args: argparse.Namespace) -> HostConfig:
    return HostConfig.from_env(
        host=args.host,
        port=args.port,
        source=args.source,
        backend=args.backend,
        display_dist=args.display_dist,
        cert_dir=args.cert_dir,
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
    print(f"Entangible host → {url}  (source: {config.source}, backend: {config.backend})")
    print(f"  capture page:  {scheme}://{display_host}:{config.port}/capture")
    print(f"  debug preview: {scheme}://{display_host}:{config.port}/debug/snapshot.jpg")

    kwargs: dict = {"host": config.host, "port": config.port}
    if config.tls:
        cert_path, key_path = ensure_cert(config.cert_dir, hostname=display_host)
        kwargs["ssl_certfile"] = str(cert_path)
        kwargs["ssl_keyfile"] = str(key_path)

    if args.open:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()

    uvicorn.run(app, **kwargs)
    return 0


def _cmd_qr(args: argparse.Namespace) -> int:
    import qrcode

    port = args.port or HostConfig.from_env().port
    scheme = "http" if args.no_tls else "https"
    path = args.path if args.path.startswith("/") else "/" + args.path
    url = f"{scheme}://{primary_lan_ip()}:{port}{path}"
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    qr.make(fit=True)
    print(url)
    qr.print_ascii(invert=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv if argv is not None else sys.argv[1:])
    if args.command == "run":
        return _cmd_run(args)
    if args.command == "qr":
        return _cmd_qr(args)
    return 2  # pragma: no cover


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
