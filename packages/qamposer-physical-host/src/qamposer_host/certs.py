"""Self-signed TLS cert generation (SANs = hostname + LAN IPs + advertised host).

The iPhone ``getUserMedia`` capture page and any LAN browser need a secure
origin, so the host serves HTTPS from a self-signed certificate generated on
first run. :func:`ensure_cert` is idempotent: it regenerates only when the cert
is missing, expired, or its SAN set no longer matches the machine's current
hostname + LAN IPv4s (e.g. after moving networks) + the configured
``--advertise-host``. The private key is written with ``0o600`` permissions.
"""

from __future__ import annotations

import datetime as _dt
import ipaddress
import logging
import os
import socket
import sys
from pathlib import Path
from typing import Iterable

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


#: UDP-connect targets for :func:`_primary_lan_ip_or_none`, in order. The first
#: finds the internet-facing interface; the private broadcast-ish ones find an
#: interface with a matching local route when there is no default route (an
#: offline Pi hotspot serving its own subnet).
_ROUTE_PROBES = ("8.8.8.8", "10.255.255.255", "192.168.255.255", "172.31.255.255")


def _is_usable_ipv4(ip: str) -> bool:
    # The whole 127/8 block is loopback: Debian maps the hostname to 127.0.1.1,
    # which a phone can never reach.
    return bool(ip) and not ip.startswith("127.") and ip != "0.0.0.0"


def lan_ipv4s() -> list[str]:
    """Return the machine's non-loopback IPv4 addresses (best effort)."""
    ips: set[str] = set()
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    ips.update(_interface_ipv4s())
    primary = _primary_lan_ip_or_none()
    if primary:
        ips.add(primary)
    return sorted(
        (ip for ip in ips if _is_usable_ipv4(ip)),
        key=lambda s: tuple(int(p) for p in s.split(".")),
    )


def _interface_ipv4s() -> list[str]:
    """Per-interface IPv4s via ``SIOCGIFADDR`` (Linux only; ``[]`` elsewhere).

    The hostname lookup on an offline Pi yields only 127.0.1.1, and the route
    probes miss a /24 hotspot subnet, so read the interfaces directly.
    """
    # The ioctl number is Linux's; never issue it on another kernel.
    if not sys.platform.startswith("linux"):
        return []
    import fcntl
    import struct

    siocgifaddr = 0x8915
    found: list[str] = []
    try:
        names = [name for _, name in socket.if_nameindex()]
    except OSError:
        return []
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        for name in names:
            try:
                packed = fcntl.ioctl(
                    sock.fileno(), siocgifaddr,
                    struct.pack("256s", name.encode()[:15]),
                )
            except OSError:
                continue  # no IPv4 address on this interface
            found.append(socket.inet_ntoa(packed[20:24]))
    finally:
        sock.close()
    return found


def _primary_lan_ip_or_none() -> str | None:
    """The IPv4 the OS would route outbound traffic from (no packets sent).

    Tries the internet route first, then private broadcast-ish targets so an
    offline access point still resolves to its own subnet address.
    """
    for target in _ROUTE_PROBES:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            # Linux refuses connect() to a broadcast address without this.
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.connect((target, 80))
            ip = sock.getsockname()[0]
        except OSError:
            continue
        finally:
            sock.close()
        if _is_usable_ipv4(ip):
            return ip
    return None


def primary_lan_ip() -> str:
    """The best LAN IPv4 for building QR / capture URLs; falls back to loopback."""
    primary = _primary_lan_ip_or_none()
    if primary:
        return primary
    others = lan_ipv4s()
    return others[0] if others else "127.0.0.1"


# --- certificate lifecycle -------------------------------------------------


def _hostname_names(hostname: str) -> list[str]:
    """``hostname`` plus its ``.local`` twin (an IP or ``localhost`` as is)."""
    hostname = (hostname or "").strip().rstrip(".")
    if not hostname:
        return []
    try:
        ipaddress.ip_address(hostname)
        return [hostname]
    except ValueError:
        pass
    if hostname.lower() == "localhost":
        return [hostname]
    if hostname.lower().endswith(".local"):
        return [hostname, hostname[: -len(".local")]]
    if "." not in hostname:
        return [hostname, f"{hostname}.local"]
    return [hostname]


def _desired_sans(
    hostname: str, extra_hosts: Iterable[str] = ()
) -> tuple[set[str], set[str]]:
    """Return (dns_names, ip_addresses) the cert should cover.

    ``extra_hosts`` (e.g. ``--advertise-host``) land in the IP or DNS set by
    whether they parse as an address, so the advertised URL always verifies.
    The machine's ``hostname`` is covered together with its mDNS name
    (``<host>.local``, how a Pi is reached on most LANs — or the bare name when
    the system reports the ``.local`` form, as macOS does).
    """
    dns = {"localhost"}
    ips = {"127.0.0.1", *lan_ipv4s()}
    for host in (*_hostname_names(hostname), *extra_hosts):
        host = (host or "").strip()
        if not host:
            continue
        try:
            ips.add(str(ipaddress.ip_address(host)))
        except ValueError:
            dns.add(host)
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
    extra_hosts: Iterable[str] = (),
) -> tuple[Path, Path]:
    """Ensure a valid self-signed cert exists in ``cert_dir``.

    Returns ``(cert_path, key_path)``. Reuses an existing cert when it is
    unexpired and its SANs still match; otherwise regenerates. ``hostname`` is
    the machine's name (default ``socket.gethostname()``) — pass the
    advertised host / LAN IP through ``extra_hosts``, never as ``hostname``, or
    the real hostname drops out of the SANs. ``extra_hosts`` adds names/IPs
    beyond the detected ones (the ``--advertise-host``). Only ``cert.pem`` /
    ``key.pem`` are rewritten; the operator token beside them is untouched.
    """
    cert_dir = Path(cert_dir)
    cert_dir.mkdir(parents=True, exist_ok=True)
    cert_path = cert_dir / CERT_NAME
    key_path = cert_dir / KEY_NAME
    hostname = hostname or socket.gethostname() or "localhost"

    dns, ips = _desired_sans(hostname, extra_hosts)
    if cert_path.exists() and key_path.exists() and _cert_matches(cert_path, dns, ips):
        logger.debug("reusing existing cert at %s", cert_path)
        return cert_path, key_path

    _generate(cert_path, key_path, hostname, dns, ips, validity_days)
    return cert_path, key_path
