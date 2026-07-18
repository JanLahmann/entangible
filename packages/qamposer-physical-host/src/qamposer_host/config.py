"""Host runtime configuration (camera, backend mode, TLS, ports).

``HostConfig`` is the single, immutable description of how the kiosk host runs.
Values resolve with precedence: explicit override > ``QAMPOSER_*`` env var >
built-in default. It also carries two small, dependency-free factories used
across the host: :func:`camera_from_spec` (source spec -> ``status.camera``
dict) and :func:`build_frame_source` (source spec -> a live ``FrameSource``,
imported lazily so the host stays importable before the vision package lands).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Mapping

# --- defaults --------------------------------------------------------------

DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 8443
DEFAULT_SOURCE = "replay:tests/fixtures/recordings/bell-sequence"
DEFAULT_BACKEND = "off"
DEFAULT_DISPLAY_DIST = Path("display-app/dist")
DEFAULT_CERT_DIR = Path.home() / ".qamposer-physical" / "certs"
DEFAULT_REPLAY_DIR = Path("tests/fixtures/recordings")

_ENV_PREFIX = "QAMPOSER_"


@dataclass
class HostConfig:
    """Resolved host configuration.

    ``source`` and ``backend`` are opaque spec strings:

    * ``source``  — ``replay:<dir>`` | ``cv2:<idx>`` | ``picamera2`` | ``push``
    * ``backend`` — ``off`` | ``url:<base-url>`` | ``spawn`` (spawn is M5)
    """

    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    source: str = DEFAULT_SOURCE
    backend: str = DEFAULT_BACKEND
    display_dist: Path = field(default_factory=lambda: DEFAULT_DISPLAY_DIST)
    cert_dir: Path = field(default_factory=lambda: DEFAULT_CERT_DIR)
    replay_dir: Path = field(default_factory=lambda: DEFAULT_REPLAY_DIR)
    tls: bool = True

    def __post_init__(self) -> None:
        self.port = int(self.port)
        self.tls = bool(self.tls)
        self.display_dist = Path(self.display_dist)
        self.cert_dir = Path(self.cert_dir)
        self.replay_dir = Path(self.replay_dir)

    # --- backend helpers ---------------------------------------------------

    @property
    def backend_mode(self) -> str:
        """``off`` | ``url`` | ``spawn`` (the scheme part of ``backend``)."""
        return self.backend.split(":", 1)[0].strip().lower() or "off"

    @property
    def backend_url(self) -> str | None:
        """The base URL for ``url:<...>`` mode, else ``None``."""
        if self.backend_mode == "url":
            return self.backend.split(":", 1)[1].strip() or None
        return None

    # --- construction ------------------------------------------------------

    @classmethod
    def from_env(
        cls, env: Mapping[str, str] | None = None, **overrides: object
    ) -> "HostConfig":
        """Build a config from ``QAMPOSER_*`` env vars, then apply overrides.

        Only overrides whose value is not ``None`` are applied, so callers can
        forward parsed CLI args verbatim (``None`` == "not supplied").
        """
        env = os.environ if env is None else env
        values: dict[str, object] = {}

        def take(name: str, env_key: str) -> None:
            raw = env.get(_ENV_PREFIX + env_key)
            if raw is not None:
                values[name] = raw

        take("host", "HOST")
        take("port", "PORT")
        take("source", "SOURCE")
        take("backend", "BACKEND")
        take("display_dist", "DISPLAY_DIST")
        take("cert_dir", "CERT_DIR")
        take("replay_dir", "REPLAY_DIR")
        if (raw := env.get(_ENV_PREFIX + "NO_TLS")) is not None:
            values["tls"] = raw.strip().lower() not in ("1", "true", "yes", "on")

        valid = {f.name for f in fields(cls)}
        for key, val in overrides.items():
            if val is None:
                continue
            if key not in valid:
                raise TypeError(f"unknown HostConfig field: {key!r}")
            values[key] = val

        return cls(**values)  # type: ignore[arg-type]


# --- source-spec factories -------------------------------------------------


def camera_from_spec(spec: str, connected: bool = False) -> dict:
    """Map a source spec string to a ``status.camera`` dict.

    Pure and dependency-free — safe to call before the vision package exists.
    """
    kind, _, rest = spec.partition(":")
    kind = kind or "none"
    if kind == "replay":
        name = Path(rest).name if rest else "replay"
    else:
        name = spec
    return {"kind": kind, "name": name, "connected": bool(connected)}


def build_frame_source(spec: str):
    """Build a live ``FrameSource`` from a source spec (lazy vision import).

    Raises ``ImportError`` if the vision package is not yet available, or
    ``ValueError`` for an unknown spec — callers degrade gracefully.
    """
    kind, _, rest = spec.partition(":")
    from qamposer_vision import sources  # lazy: host imports without vision

    if kind == "replay":
        return sources.ReplaySource(rest)
    if kind == "cv2":
        return sources.Cv2CaptureSource(int(rest or 0))
    if kind == "picamera2":
        return sources.Picamera2Source()
    if kind == "push":
        return sources.PushFrameSource()
    raise ValueError(f"unknown source spec: {spec!r}")


def select_camera_to_spec(msg: Mapping[str, object]) -> str:
    """Translate a ``select_camera`` client message into a source spec."""
    kind = str(msg.get("kind", "")).strip()
    if kind == "cv2":
        return f"cv2:{int(msg.get('index', 0) or 0)}"
    if kind == "replay":
        name = msg.get("name")
        return f"replay:{name}" if name else "replay"
    return kind or "none"
