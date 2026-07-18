"""Self-signed TLS cert generation (SANs = hostname + LAN IPs).

The iPhone ``getUserMedia`` capture page and any LAN browser need a secure
origin, so the host serves HTTPS from a self-signed certificate generated on
first run. :func:`ensure_cert` is idempotent: it regenerates only when the cert
is missing, expired, or its SAN set no longer matches the machine's current
hostname + LAN IPv4s (e.g. after moving networks). The private key is written
with ``0o600`` permissions.
"""

from __future__ import annotations

import datetime as _dt
import ipaddress
import logging
import os
import socket
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

logger = logging.getLogger("qamposer_host.certs")

CERT_NAME = "cert.pem"
KEY_NAME = "key.pem"
_DEFAULT_VALIDITY_DAYS = 825  # max accepted by modern browsers for leaf certs
_RENEW_MARGIN_DAYS = 7


# --- network helpers -------------------------------------------------------


def lan_ipv4s() -> list[str]:
    """Return the machine's non-loopback IPv4 addresses (best effort)."""
    ips: set[str] = set()
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    primary = _primary_lan_ip_or_none()
    if primary:
        ips.add(primary)
    ips.discard("127.0.0.1")
    return sorted(ips, key=lambda s: tuple(int(p) for p in s.split(".")))


def _primary_lan_ip_or_none() -> str | None:
    """The IPv4 the OS would use to reach the internet (no packets sent)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return None
    finally:
        sock.close()


def primary_lan_ip() -> str:
    """The best LAN IPv4 for building QR / capture URLs; falls back to loopback."""
    primary = _primary_lan_ip_or_none()
    if primary and primary != "127.0.0.1":
        return primary
    others = lan_ipv4s()
    return others[0] if others else "127.0.0.1"


# --- certificate lifecycle -------------------------------------------------


def _desired_sans(hostname: str) -> tuple[set[str], set[str]]:
    """Return (dns_names, ip_addresses) the cert should cover."""
    dns = {hostname, "localhost"}
    ips = {"127.0.0.1", *lan_ipv4s()}
    return dns, ips


def _cert_matches(cert_path: Path, dns: set[str], ips: set[str]) -> bool:
    """True if the on-disk cert is unexpired and covers exactly these SANs."""
    try:
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
    except (ValueError, OSError):
        return False

    now = _dt.datetime.now(_dt.timezone.utc)
    try:
        not_after = cert.not_valid_after_utc
    except AttributeError:  # pragma: no cover - old cryptography
        not_after = cert.not_valid_after.replace(tzinfo=_dt.timezone.utc)
    if not_after - _dt.timedelta(days=_RENEW_MARGIN_DAYS) <= now:
        return False

    try:
        san = cert.extensions.get_extension_for_class(
            x509.SubjectAlternativeName
        ).value
    except x509.ExtensionNotFound:
        return False
    have_dns = set(san.get_values_for_type(x509.DNSName))
    have_ips = {str(ip) for ip in san.get_values_for_type(x509.IPAddress)}
    return have_dns == dns and have_ips == ips


def _generate(
    cert_path: Path, key_path: Path, hostname: str, dns: set[str], ips: set[str],
    validity_days: int,
) -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name(
        [x509.NameAttribute(NameOID.COMMON_NAME, hostname)]
    )
    alt_names: list[x509.GeneralName] = [x509.DNSName(name) for name in sorted(dns)]
    alt_names += [x509.IPAddress(ipaddress.ip_address(ip)) for ip in sorted(ips)]

    now = _dt.datetime.now(_dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - _dt.timedelta(minutes=1))
        .not_valid_after(now + _dt.timedelta(days=validity_days))
        .add_extension(x509.SubjectAlternativeName(alt_names), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )

    key_bytes = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    # Write the key restrictively from the start.
    fd = os.open(str(key_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(key_bytes)
    os.chmod(key_path, 0o600)

    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    logger.info(
        "generated self-signed cert for %s (SAN dns=%s ips=%s)",
        hostname, sorted(dns), sorted(ips),
    )


def ensure_cert(
    cert_dir: str | os.PathLike[str],
    hostname: str | None = None,
    validity_days: int = _DEFAULT_VALIDITY_DAYS,
) -> tuple[Path, Path]:
    """Ensure a valid self-signed cert exists in ``cert_dir``.

    Returns ``(cert_path, key_path)``. Reuses an existing cert when it is
    unexpired and its SANs still match; otherwise regenerates.
    """
    cert_dir = Path(cert_dir)
    cert_dir.mkdir(parents=True, exist_ok=True)
    cert_path = cert_dir / CERT_NAME
    key_path = cert_dir / KEY_NAME
    hostname = hostname or socket.gethostname() or "localhost"

    dns, ips = _desired_sans(hostname)
    if cert_path.exists() and key_path.exists() and _cert_matches(cert_path, dns, ips):
        logger.debug("reusing existing cert at %s", cert_path)
        return cert_path, key_path

    _generate(cert_path, key_path, hostname, dns, ips, validity_days)
    return cert_path, key_path
