"""qamposer-vision — OpenCV/ArUco vision pipeline for Entangible.

Detects printed gate tiles on a board mat from a camera frame and builds the
corresponding ``@qamposer/react`` circuit (+ OpenQASM 2).

The :mod:`~qamposer_vision.markers` submodule is a dependency-free data module
(the single source of truth for the marker scheme); its public names are
re-exported here for convenience. Import it directly to avoid pulling in the
heavy ``cv2`` modules.
"""

from __future__ import annotations

from .markers import (
    ARUCO_DICT_NAME,
    CORNER_IDS,
    CORNER_ROLES,
    DIAL_IDS,
    GATE_TYPES,
    MARKER_TABLE,
    RESERVED_IDS,
    ROTATION_ANGLES,
    GateSpec,
    pretty_angle,
    quadrant_rotation,
)

__all__ = [
    "ARUCO_DICT_NAME",
    "CORNER_IDS",
    "CORNER_ROLES",
    "DIAL_IDS",
    "GATE_TYPES",
    "GateSpec",
    "MARKER_TABLE",
    "RESERVED_IDS",
    "ROTATION_ANGLES",
    "pretty_angle",
    "quadrant_rotation",
]
