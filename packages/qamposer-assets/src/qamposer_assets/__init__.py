"""qamposer-assets — printable asset generator for Entangible.

Generates vector ArUco markers, gate tile faces, cut-sheets and the board mat
(SVG source of truth -> PDF via cairosvg). Imports
:data:`qamposer_vision.markers.MARKER_TABLE` as the single source of truth so
print and detection never drift.
"""

from __future__ import annotations

from .board import board_svg, board_tiled_svgs
from .config import AssetsConfig, load_config
from .laser import (
    laser_bed_grid,
    laser_sheet_svgs,
    laser_tile_body,
    laser_tile_svg,
)
from .marker_svg import marker_bit_matrix, marker_group
from .sheets import kit_sheet_svgs, kit_tile_ids, sample_sheet_svgs, tile_sheet_svgs
from .tile_face import gate_marker_ids, tile_svg

__all__ = [
    "AssetsConfig",
    "load_config",
    "marker_bit_matrix",
    "marker_group",
    "gate_marker_ids",
    "tile_svg",
    "tile_sheet_svgs",
    "kit_sheet_svgs",
    "kit_tile_ids",
    "sample_sheet_svgs",
    "board_svg",
    "board_tiled_svgs",
    "laser_tile_body",
    "laser_tile_svg",
    "laser_sheet_svgs",
    "laser_bed_grid",
]
