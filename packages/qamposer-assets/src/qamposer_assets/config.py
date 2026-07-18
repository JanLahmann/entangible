"""Asset generation config: load physical dimensions (mm) from ``assets.toml``.

``assets.toml`` (repo root) is the single source of truth for every dimension
and colour used by both the print generator and the vision pipeline. This
module locates and parses it (stdlib :mod:`tomllib`) into typed dataclasses.

Never hardcode a number that lives in ``assets.toml`` — read it through
:func:`load_config`.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path

__all__ = [
    "AssetsConfig",
    "BoardConfig",
    "Colors",
    "ConfigError",
    "KitConfig",
    "NeutralColors",
    "SheetsConfig",
    "TileConfig",
    "Typography",
    "find_assets_toml",
    "load_config",
]


class ConfigError(RuntimeError):
    """Raised when ``assets.toml`` cannot be located or is malformed."""


# ---------------------------------------------------------------------------
# Typed sections
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class TileConfig:
    """``[tile]`` — gate tile geometry, all millimetres."""

    size: float
    corner_radius: float
    frame_width: float
    band_height: float
    marker_size: float
    marker_top: float
    min_quiet_zone: float

    @property
    def marker_x(self) -> float:
        """Left edge of the (horizontally centred) marker."""
        return (self.size - self.marker_size) / 2.0

    @property
    def marker_y(self) -> float:
        """Top edge of the marker."""
        return self.marker_top

    @property
    def band_top(self) -> float:
        """Y of the top edge of the label band."""
        return self.size - self.band_height


@dataclass(frozen=True, slots=True)
class BoardConfig:
    """``[board]`` — mat geometry, all millimetres."""

    rows: int
    cols: int
    pitch: float
    cell_size: float
    mat_width: float
    mat_height: float
    corner_marker_size: float
    corner_margin: float
    grid_offset_x: float
    grid_offset_y: float

    def cell_origin(self, row: int, col: int) -> tuple[float, float]:
        """Top-left (x, y) of the cell at ``row``/``col`` (0-indexed)."""
        return (
            self.grid_offset_x + col * self.pitch,
            self.grid_offset_y + row * self.pitch,
        )

    def cell_center(self, row: int, col: int) -> tuple[float, float]:
        """Centre (x, y) of the cell at ``row``/``col`` (0-indexed)."""
        ox, oy = self.cell_origin(row, col)
        return (ox + self.cell_size / 2.0, oy + self.cell_size / 2.0)

    @property
    def grid_width(self) -> float:
        """Width from col-0 cell left edge to the last cell's right edge."""
        return (self.cols - 1) * self.pitch + self.cell_size

    @property
    def grid_height(self) -> float:
        """Height from row-0 cell top edge to the last cell's bottom edge."""
        return (self.rows - 1) * self.pitch + self.cell_size


@dataclass(frozen=True, slots=True)
class NeutralColors:
    """``[colors.neutral]`` — IBM Carbon greys for mat structure."""

    grid: str
    wire: str
    label: str
    faint: str
    ink: str


@dataclass(frozen=True, slots=True)
class Colors:
    """``[colors]`` — gate colours (exact ``@qamposer/react`` GATE_COLORS)."""

    H: str
    X: str
    Y: str
    Z: str
    RX: str
    RY: str
    RZ: str
    S: str
    T: str
    CNOT: str
    neutral: NeutralColors

    def for_gate(self, gate: str) -> str:
        """Colour for a gate family (``H``, ``RX``, ``CNOT`` …)."""
        try:
            return getattr(self, gate)
        except AttributeError as exc:  # pragma: no cover - guard
            raise ConfigError(f"no colour for gate {gate!r}") from exc


@dataclass(frozen=True, slots=True)
class Typography:
    """``[typography]`` — font stack and cap heights (mm)."""

    family: str
    fallback: str
    band_cap_height: float
    row_label_cap_height: float

    @property
    def font_family(self) -> str:
        """Full CSS font-family value: primary + fallback stack."""
        return f"'{self.family}', {self.fallback}"


@dataclass(frozen=True, slots=True)
class SheetsConfig:
    """``[sheets]`` — cut-sheet layout parameters."""

    gutter: float
    formats: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class KitConfig:
    """``[kit]`` — standard booth kit tile quantities."""

    H: int
    X: int
    Y: int
    Z: int
    S: int
    T: int
    CNOT_control: int
    CNOT_target: int
    rotations_each: int
    rx_dial: int
    ry_dial: int
    rz_dial: int


@dataclass(frozen=True, slots=True)
class AssetsConfig:
    """Fully parsed ``assets.toml``."""

    aruco_dictionary: str
    tile: TileConfig
    board: BoardConfig
    colors: Colors
    typography: Typography
    sheets: SheetsConfig
    kit: KitConfig
    source_path: Path


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def find_assets_toml(explicit: str | Path | None = None) -> Path:
    """Locate ``assets.toml``.

    Search order:

    1. ``explicit`` path if given (must exist).
    2. Walk up from this file's directory (covers the installed/editable
       package inside the workspace).
    3. Walk up from the current working directory.
    """
    if explicit is not None:
        p = Path(explicit).expanduser().resolve()
        if not p.is_file():
            raise ConfigError(f"assets.toml not found at {p}")
        return p

    for start in (Path(__file__).resolve().parent, Path.cwd().resolve()):
        for parent in (start, *start.parents):
            candidate = parent / "assets.toml"
            if candidate.is_file():
                return candidate

    raise ConfigError(
        "could not locate assets.toml by walking up from the package "
        "or the current directory; pass an explicit path"
    )


def load_config(path: str | Path | None = None) -> AssetsConfig:
    """Load and validate ``assets.toml`` into an :class:`AssetsConfig`."""
    toml_path = find_assets_toml(path)
    with toml_path.open("rb") as fh:
        data = tomllib.load(fh)

    try:
        tile = TileConfig(**data["tile"])
        board = BoardConfig(**data["board"])

        colors_raw = dict(data["colors"])
        neutral = NeutralColors(**colors_raw.pop("neutral"))
        colors = Colors(neutral=neutral, **colors_raw)

        typography = Typography(**data["typography"])
        sheets_raw = dict(data["sheets"])
        sheets = SheetsConfig(
            gutter=sheets_raw["gutter"],
            formats=tuple(sheets_raw["formats"]),
        )
        kit = KitConfig(**data["kit"])
        aruco_dictionary = data["aruco"]["dictionary"]
    except (KeyError, TypeError) as exc:
        raise ConfigError(f"malformed assets.toml ({toml_path}): {exc}") from exc

    return AssetsConfig(
        aruco_dictionary=aruco_dictionary,
        tile=tile,
        board=board,
        colors=colors,
        typography=typography,
        sheets=sheets,
        kit=kit,
        source_path=toml_path,
    )
