"""Self-signed cert generation (SANs, reuse, key permissions) + LAN IP detection."""

from __future__ import annotations

import socket
import stat

from cryptography import x509

from qamposer_host import certs
from qamposer_host.certs import ensure_cert


def _load_sans(cert_path):
    cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
    san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    dns = set(san.get_values_for_type(x509.DNSName))
    ips = {str(ip) for ip in san.get_values_for_type(x509.IPAddress)}
    return dns, ips


def test_cert_generated_with_expected_sans(tmp_path):
    cert_path, key_path = ensure_cert(tmp_path)
    assert cert_path.exists() and key_path.exists()

    dns, ips = _load_sans(cert_path)
    assert "localhost" in dns
    assert socket.gethostname() in dns
    assert "127.0.0.1" in ips


def test_key_permissions_are_600(tmp_path):
    _, key_path = ensure_cert(tmp_path)
    mode = stat.S_IMODE(key_path.stat().st_mode)
    assert mode == 0o600


def test_cert_reused_on_second_call(tmp_path):
    cert_path, _ = ensure_cert(tmp_path)
    first = cert_path.read_bytes()
    cert_path2, _ = ensure_cert(tmp_path)
    assert cert_path2 == cert_path
    assert cert_path2.read_bytes() == first  # not regenerated


def test_cert_regenerated_when_sans_change(tmp_path):
    cert_path, _ = ensure_cert(tmp_path, hostname="host-a")
    dns_a, _ = _load_sans(cert_path)
    assert "host-a" in dns_a

    # Different hostname -> SAN set differs -> must regenerate.
    cert_path2, _ = ensure_cert(tmp_path, hostname="host-b")
    dns_b, _ = _load_sans(cert_path2)
    assert "host-b" in dns_b
    assert "host-a" not in dns_b


def test_cert_sans_include_advertised_hosts(tmp_path):
    cert_path, _ = ensure_cert(
        tmp_path, hostname="host-a", extra_hosts=["entangible.local", "10.42.0.1"]
    )
    dns, ips = _load_sans(cert_path)
    assert "entangible.local" in dns
    assert "10.42.0.1" in ips
    # Stable: the same advertised set reuses the cert…
    first = cert_path.read_bytes()
    ensure_cert(tmp_path, hostname="host-a", extra_hosts=["entangible.local", "10.42.0.1"])
    assert cert_path.read_bytes() == first
    # …and dropping it regenerates without it.
    ensure_cert(tmp_path, hostname="host-a")
    dns2, ips2 = _load_sans(cert_path)
    assert "entangible.local" not in dns2


def test_cert_sans_cover_hostname_dot_local_localhost_and_lan(tmp_path, monkeypatch):
    monkeypatch.setattr(certs, "lan_ipv4s", lambda: ["192.168.4.1"])
    cert_path, _ = ensure_cert(tmp_path, hostname="rasqberry", extra_hosts=["192.168.4.1"])
    dns, ips = _load_sans(cert_path)
    assert dns == {"rasqberry", "rasqberry.local", "localhost"}
    assert ips == {"127.0.0.1", "192.168.4.1"}


def test_macos_style_local_hostname_also_covers_the_bare_name(tmp_path):
    cert_path, _ = ensure_cert(tmp_path, hostname="Jans-Mac.local")
    dns, _ = _load_sans(cert_path)
    assert {"Jans-Mac.local", "Jans-Mac", "localhost"} <= dns


def test_default_hostname_is_the_machine_name(tmp_path, monkeypatch):
    monkeypatch.setattr(certs.socket, "gethostname", lambda: "boothpi")
    cert_path, _ = ensure_cert(tmp_path)
    dns, _ = _load_sans(cert_path)
    assert {"boothpi", "boothpi.local"} <= dns


def test_cert_lacking_hostname_is_regenerated_and_token_kept(tmp_path, monkeypatch):
    """A cert from before this fix (SANs without the hostname) is replaced.

    `run` used to pass the advertised LAN IP as the hostname, so the on-disk
    cert carried the IP as a DNS name and no hostname at all. The next start
    must regenerate it — while the operator token beside it stays the same.
    """
    from qamposer_host.token import ensure_token

    monkeypatch.setattr(certs, "lan_ipv4s", lambda: ["192.168.4.1"])
    monkeypatch.setattr(certs.socket, "gethostname", lambda: "rasqberry")
    token = ensure_token(tmp_path)
    # The old buggy call: hostname = advertised IP.
    certs._generate(
        tmp_path / certs.CERT_NAME, tmp_path / certs.KEY_NAME, "192.168.4.1",
        {"192.168.4.1", "localhost"}, {"127.0.0.1", "192.168.4.1"}, 30,
    )
    old = (tmp_path / certs.CERT_NAME).read_bytes()

    cert_path, _ = ensure_cert(tmp_path, extra_hosts=["192.168.4.1"])
    assert cert_path.read_bytes() != old
    dns, ips = _load_sans(cert_path)
    assert {"rasqberry", "rasqberry.local", "localhost"} == dns
    assert "192.168.4.1" in ips
    assert ensure_token(tmp_path) == token
    # ... and a second start reuses it.
    again = cert_path.read_bytes()
    ensure_cert(tmp_path, extra_hosts=["192.168.4.1"])
    assert cert_path.read_bytes() == again


def test_run_and_doctor_request_the_same_cert(tmp_path, monkeypatch):
    """`run` and `doctor` share one SAN set — neither regenerates the other's cert."""
    from qamposer_host import cli
    from qamposer_host.config import HostConfig

    monkeypatch.setattr(certs, "lan_ipv4s", lambda: ["10.0.0.5"])
    monkeypatch.setattr(certs.socket, "gethostname", lambda: "rasqberry")
    config = HostConfig.from_env(cert_dir=str(tmp_path), advertise_host="10.0.0.5")
    cert_path, _ = cli._ensure_host_cert(config)
    dns, ips = _load_sans(cert_path)
    assert {"rasqberry", "rasqberry.local", "localhost"} == dns
    assert ips == {"127.0.0.1", "10.0.0.5"}
    first = cert_path.read_bytes()
    cli._ensure_host_cert(config)
    assert cert_path.read_bytes() == first


# --- LAN address detection -------------------------------------------------


def _fake_getaddrinfo(*ips):
    def getaddrinfo(host, port, family=0, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_DGRAM, 0, "", (ip, 0)) for ip in ips]

    return getaddrinfo


def test_lan_ipv4s_drops_the_whole_loopback_block(monkeypatch):
    # Debian/Raspberry Pi OS map the hostname to 127.0.1.1 — never advertisable.
    monkeypatch.setattr(
        socket, "getaddrinfo", _fake_getaddrinfo("127.0.1.1", "127.0.0.1", "10.42.0.1")
    )
    monkeypatch.setattr(certs, "_primary_lan_ip_or_none", lambda: None)
    monkeypatch.setattr(certs, "_interface_ipv4s", lambda: ["127.0.0.1"])
    assert certs.lan_ipv4s() == ["10.42.0.1"]


def test_offline_hotspot_never_advertises_loopback(monkeypatch):
    # Offline Pi hotspot: no route anywhere, hostname → 127.0.1.1 only.
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo("127.0.1.1"))
    monkeypatch.setattr(certs, "_primary_lan_ip_or_none", lambda: None)
    monkeypatch.setattr(certs, "_interface_ipv4s", lambda: ["127.0.0.1", "10.42.0.1"])
    assert certs.primary_lan_ip() == "10.42.0.1"


class _FakeSock:
    """UDP socket whose connect() succeeds only for targets in ``routes``."""

    routes: dict[str, str] = {}
    tried: list[str] = []

    def __init__(self, *args, **kwargs):
        self._ip = None

    def setsockopt(self, *args):
        pass

    def connect(self, addr):
        _FakeSock.tried.append(addr[0])
        if addr[0] not in _FakeSock.routes:
            raise OSError("Network is unreachable")
        self._ip = _FakeSock.routes[addr[0]]

    def getsockname(self):
        return (self._ip, 54321)

    def close(self):
        pass


def _route_probe(monkeypatch, routes):
    _FakeSock.routes = routes
    _FakeSock.tried = []
    monkeypatch.setattr(socket, "socket", _FakeSock)
    return certs._primary_lan_ip_or_none()


def test_primary_ip_prefers_the_internet_route(monkeypatch):
    ip = _route_probe(monkeypatch, {"8.8.8.8": "192.168.178.20", "10.255.255.255": "10.0.0.5"})
    assert ip == "192.168.178.20"
    assert _FakeSock.tried == ["8.8.8.8"]


def test_primary_ip_falls_back_to_private_routes_offline(monkeypatch):
    ip = _route_probe(monkeypatch, {"192.168.255.255": "192.168.4.1"})
    assert ip == "192.168.4.1"
    assert _FakeSock.tried == ["8.8.8.8", "10.255.255.255", "192.168.255.255"]


def test_primary_ip_skips_loopback_answers(monkeypatch):
    ip = _route_probe(monkeypatch, {"8.8.8.8": "127.0.1.1", "172.31.255.255": "172.20.0.1"})
    assert ip == "172.20.0.1"
    assert _route_probe(monkeypatch, {}) is None
