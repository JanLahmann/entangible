"""Display layout state (booth-v2 panel/mode system) + its REST endpoint.

A *layout* is the booth's current display mode, sidebar side, and the ordered
list of visible panels (registry names). It is reconfigured OFF the booth screen
(the ``/debug`` "Layout" card, ``select_mode`` / ``select_layout`` WS messages)
and persisted to ``layout.toml`` next to the other host config files.

* :class:`LayoutState` — the immutable-ish value object serialized on the wire.
* :class:`LayoutStore` — owns the current state, applies partial updates with the
  protocol's "omitted fields keep their value" semantics, and persists to TOML.
* :func:`default_panels` — the per-mode panel preset.

Persistence is dependency-free: reads use stdlib ``tomllib`` (3.11+), writes use
a tiny hand-rolled TOML serializer (the schema is three flat keys).
"""

from __future__ import annotations

import logging
import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import APIRouter, Request

logger = logging.getLogger("qamposer_host.layout")

router = APIRouter()

DEFAULT_MODE = "composer"
DEFAULT_SIDEBAR = "right"
DEFAULT_WIRES = "compact"
DEFAULT_NOISE = "off"
VALID_SIDEBARS = ("left", "right")
VALID_WIRES = ("compact", "all")
#: In-browser noise-model presets (one per IBM chip generation, plus off). Kept
#: in lockstep with `NoisePreset` in shared/quantum/noise.ts + shared/ws/messages.ts.
VALID_NOISE = ("off", "falcon", "eagle", "heron", "nighthawk")

#: Quantina menu-pack id format. The host validates FORMAT only — it cannot know
#: which packs a client bundles (see docs/protocol.md), so it accepts any
#: lowercase [a-z0-9-] id of 1..64 chars and leaves pack existence to the client.
VALID_MENU_RE = re.compile(r"^[a-z0-9-]{1,64}$")

#: Per-mode default (preset) panel stacks, in display order (registry names).
#: This is ONLY the preset — panel names are never validated (they pass through
#: ``apply_layout`` untouched, forward-compatible), so a name absent here is
#: still a legal panel; it just isn't turned on by ``select_mode``'s reset.
MODE_PANELS: dict[str, list[str]] = {
    "composer": ["results", "state", "qasm"],
    "golf": ["scorecard", "minicircuit", "results"],
    "quantina": ["menu", "order", "results"],
    # Quantum Runner (task #52) is a pocket-only game surface — it drives its own
    # full-stage UI and needs no sidebar panels. The empty preset also means the
    # booth kiosk (which has no runner UI in v1) falls back gracefully to its
    # composer-style stage when the operator selects ``runner``.
    "runner": [],
    "attract": [],
}

#: Panels valid in EVERY mode but part of NO mode's preset — staff opt into them
#: per session from ``/debug``, so ``select_mode``'s panel reset never enables
#: them. ``camera`` is the operator-key-gated live camera sidebar (task #49):
#: because panels are free-form pass-through, "valid everywhere" already holds;
#: naming it here keeps the registry explicit and pins the "preset nowhere"
#: invariant (see tests).
PRESETLESS_PANELS: tuple[str, ...] = ("camera",)

#: The modes ``select_mode`` accepts. Unknown modes are ignored (never fatal).
VALID_MODES = tuple(MODE_PANELS)


def default_panels(mode: str) -> list[str]:
    """The preset panel stack for ``mode`` (empty list for unknown modes)."""
    return list(MODE_PANELS.get(mode, []))


@dataclass
class LayoutState:
    """Current display layout: mode + sidebar side + visible panels + wire count
    + booth-wide noise-model preset."""

    mode: str = DEFAULT_MODE
    sidebar: str = DEFAULT_SIDEBAR
    panels: list[str] = field(default_factory=lambda: default_panels(DEFAULT_MODE))
    wires: str = DEFAULT_WIRES
    noise: str = DEFAULT_NOISE
    #: Active Quantina menu-pack id (``None`` = pack not chosen yet). Passes
    #: through as JSON ``null`` on the wire.
    menu: str | None = None

    def to_message(self) -> dict:
        """The ``layout`` server message (camelCase wire JSON is already flat)."""
        return {
            "type": "layout",
            "mode": self.mode,
            "sidebar": self.sidebar,
            "panels": list(self.panels),
            "wires": self.wires,
            "noise": self.noise,
            "menu": self.menu,
        }

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "sidebar": self.sidebar,
            "panels": list(self.panels),
            "wires": self.wires,
            "noise": self.noise,
            "menu": self.menu,
        }


def _toml_str(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _dump_toml(state: LayoutState) -> str:
    panels = ", ".join(_toml_str(p) for p in state.panels)
    out = (
        f"mode = {_toml_str(state.mode)}\n"
        f"sidebar = {_toml_str(state.sidebar)}\n"
        f"panels = [{panels}]\n"
        f"wires = {_toml_str(state.wires)}\n"
        f"noise = {_toml_str(state.noise)}\n"
    )
    # Only emit ``menu`` when a pack is active — TOML has no ``null``, so absence
    # is how ``None`` round-trips.
    if state.menu is not None:
        out += f"menu = {_toml_str(state.menu)}\n"
    return out


def _state_from_toml(data: dict) -> LayoutState:
    mode = data.get("mode")
    sidebar = data.get("sidebar")
    panels = data.get("panels")
    wires = data.get("wires")
    noise = data.get("noise")
    menu = data.get("menu")
    state = LayoutState()
    if isinstance(mode, str):
        state.mode = mode
    if isinstance(sidebar, str) and sidebar in VALID_SIDEBARS:
        state.sidebar = sidebar
    if isinstance(panels, list):
        state.panels = [str(p) for p in panels]
    if isinstance(wires, str) and wires in VALID_WIRES:
        state.wires = wires
    if isinstance(noise, str) and noise in VALID_NOISE:
        state.noise = noise
    if isinstance(menu, str) and VALID_MENU_RE.match(menu):
        state.menu = menu
    return state


class LayoutStore:
    """Owns the live :class:`LayoutState` and its ``layout.toml`` persistence.

    ``path=None`` disables persistence (state is in-memory only) — handy for
    tests and ``--no-persist`` style runs.
    """

    def __init__(self, path: Path | str | None = None) -> None:
        self._path = Path(path) if path is not None else None
        self._state = LayoutState()
        self._load()

    # -- accessors ---------------------------------------------------------

    @property
    def state(self) -> LayoutState:
        return self._state

    def message(self) -> dict:
        return self._state.to_message()

    # -- mutations (persist on change) -------------------------------------

    def select_mode(self, mode: str) -> LayoutState:
        """Switch mode and reset panels to that mode's preset.

        Unknown modes are ignored (state unchanged) — the wire protocol only
        defines ``composer`` / ``golf`` / ``quantina`` / ``runner`` / ``attract``.
        """
        if mode not in VALID_MODES:
            logger.info("ignoring select_mode with unknown mode: %r", mode)
            return self._state
        self._state.mode = mode
        self._state.panels = default_panels(mode)
        self._save()
        return self._state

    def apply_layout(
        self,
        *,
        sidebar: str | None = None,
        panels: list[str] | None = None,
        wires: str | None = None,
    ) -> LayoutState:
        """Partial update: ``None`` fields keep their current value.

        Unknown panel names pass through untouched (forward-compatible); the
        server never validates the registry — clients ignore names they lack.
        An unknown ``wires`` value is ignored (state unchanged).
        """
        changed = False
        if sidebar is not None:
            if sidebar in VALID_SIDEBARS:
                self._state.sidebar = sidebar
                changed = True
            else:
                logger.info("ignoring select_layout with unknown sidebar: %r", sidebar)
        if panels is not None:
            self._state.panels = [str(p) for p in panels]
            changed = True
        if wires is not None:
            if wires in VALID_WIRES:
                self._state.wires = wires
                changed = True
            else:
                logger.info("ignoring select_layout with unknown wires: %r", wires)
        if changed:
            self._save()
        return self._state

    def select_noise(self, preset: str) -> LayoutState:
        """Set the booth-wide noise-model preset (persist on change).

        An unknown preset is ignored (state unchanged) — the wire protocol only
        defines ``off | falcon | eagle | heron | nighthawk``.
        """
        if preset not in VALID_NOISE:
            logger.info("ignoring select_noise with unknown preset: %r", preset)
            return self._state
        if preset != self._state.noise:
            self._state.noise = preset
            self._save()
        return self._state

    def select_menu(self, pack: str) -> LayoutState:
        """Set the active Quantina menu-pack id (persist on change).

        The host validates FORMAT only (``[a-z0-9-]{1,64}``) — it cannot know
        which packs a client bundles (docs/protocol.md); an ill-formed id is
        ignored (state unchanged).
        """
        if not VALID_MENU_RE.match(pack):
            logger.info("ignoring select_menu with invalid pack id: %r", pack)
            return self._state
        if pack != self._state.menu:
            self._state.menu = pack
            self._save()
        return self._state

    # -- persistence -------------------------------------------------------

    def _load(self) -> None:
        if self._path is None or not self._path.is_file():
            return
        try:
            with self._path.open("rb") as fh:
                data = tomllib.load(fh)
        except (OSError, tomllib.TOMLDecodeError):
            logger.warning("could not read layout file %s; using defaults",
                           self._path, exc_info=True)
            return
        self._state = _state_from_toml(data)

    def _save(self) -> None:
        if self._path is None:
            return
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(_dump_toml(self._state), encoding="utf-8")
        except OSError:
            logger.warning("could not persist layout to %s", self._path, exc_info=True)


@router.get("/api/layout")
async def get_layout(request: Request) -> dict:
    """Current layout as JSON — the REST sibling of the ``layout`` WS message."""
    store: LayoutStore = request.app.state.layout_store
    return store.state.to_dict()
