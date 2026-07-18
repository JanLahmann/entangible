"""Self-signed cert generation: SANs, reuse, and key file permissions."""

from __future__ import annotations

import socket
import stat

from cryptography import x509

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
