"""Hardware build parameters and the two height variants (tile / cube).

The colour/footprint geometry lives in ``assets.toml`` (consumed via
:mod:`qamposer_assets.config`); this module only adds the *print-specific*
dimensions that have no place in the shared spec: face depth, wall thickness,
the elephant-foot chamfer, magnet-pocket sizing and the two height presets.
"""

from __future__ import annotations

from dataclasses import dataclass

from .face import FACE_DEPTH

__all__ = [
    "HardwareParams",
    "VARIANTS",
    "DOUBLE_VARIANTS",
    "DOUBLE_FACED_KIT",
    "variant_height",
    "variant_names",
    "double_kit_count",
]

#: Height (mm) of each single-faced variant preset. ``height`` is a free
#: parameter in the builder; these are the two documented presets.
VARIANTS: dict[str, float] = {
    "tile": 6.0,
    "cube": 60.0,
}

#: Height (mm) of each double-faced variant preset. The tile gains a second
#: 0.8 mm colour face on the underside: 0.8 (face A) + 6.4 (white core) + 0.8
#: (face B) = 8.0 mm. The cube keeps its 60 mm height (top + bottom faces).
DOUBLE_VARIANTS: dict[str, float] = {
    "tile": 8.0,
    "cube": 60.0,
}

#: Double-faced kit pairing table: ``(face_a_marker_id, face_b_marker_id, qty)``.
#: ``face_b`` is a marker id (``None`` would mean "same gate both sides", but the
#: shipped kit deliberately carries NO same-gate pieces — every piece pairs two
#: distinct gates so one flip switches the gate). One piece carries face A on top
#: and face B (mirrored, see :mod:`build`) on the underside — flip to switch.
#:
#: Angle mapping verified against
#: :data:`qamposer_vision.markers.ROTATION_ANGLES` = ``(π/4, π/2, π, -π/2)`` with
#: family bases RX=20, RY=24, RZ=28 (offset = index into ROTATION_ANGLES):
#:   * offset 1 = +π/2, offset 3 = -π/2  →  (21,23)/(25,27)/(29,31)
#:   * offset 0 =  π/4, offset 2 =  π    →  (20,22)/(24,26)/(28,30)
#: so the rotation pairs are exactly (+π/2 | -π/2) and (π/4 | π) — a flip gives
#: the inverse for the ±π/2 pieces.
DOUBLE_FACED_KIT: list[tuple[int, int | None, int]] = [
    (14, 15, 4),  # CNOT: control ● | target ⊕      (both dark blue)
    (21, 23, 1),  # RX: +π/2 | -π/2  (flip = inverse)
    (25, 27, 1),  # RY: +π/2 | -π/2
    (29, 31, 1),  # RZ: +π/2 | -π/2
    (20, 22, 1),  # RX: π/4 | π
    (24, 26, 1),  # RY: π/4 | π
    (28, 30, 1),  # RZ: π/4 | π
    (40, 41, 2),  # S | T                            (both light blue)
    # Single-qubit gates: two of every pair type. Symmetric — each of H/X/Y/Z
    # appears on exactly 6 faces. All six cross-family combinations appear, so
    # each of these pieces carries TWO accent colours.
    (10, 11, 2),  # H | X   (red | dark blue)
    (10, 12, 2),  # H | Y   (red | magenta)
    (10, 13, 2),  # H | Z   (red | light blue)
    (11, 12, 2),  # X | Y   (dark blue | magenta)
    (11, 13, 2),  # X | Z   (dark blue | light blue)
    (12, 13, 2),  # Y | Z   (magenta | light blue)
]


@dataclass(frozen=True, slots=True)
class HardwareParams:
    """Print-specific dimensions (mm), all with sensible Prusa Core One defaults."""

    face_depth: float = FACE_DEPTH  # coloured top-face thickness (MMU colour layer)
    bottom_chamfer: float = 0.4  # elephant-foot relief on the first-layer edge
    wall: float = 3.0  # cube hollow-shell wall thickness
    hollow_min_height: float = 12.0  # only hollow bodies taller than this
    magnet_diameter: float = 6.2  # magnet pocket Ø (6 mm magnet + fit clearance)
    magnet_depth: float = 2.1  # magnet pocket depth (2 mm magnet + clearance)
    magnet_offset: float = 15.0  # pocket centre distance from tile centre (±x)
    marker_bleed: float = 0.02  # per-side growth of black modules (µm-scale) so
    # diagonally-adjacent modules overlap into a manifold solid instead of a
    # non-manifold edge/point contact — invisible at print resolution.
    mono_pocket_depth: float = 0.5  # single-colour "recessed" variant: depth of the
    # paint-well pocket cut where each colour region sits. Kept ≤ 0.6 mm so an
    # oblique camera's pocket shadow can't eat into a ~6 mm ArUco module.
    mono_raise_height: float = 0.6  # single-colour "raised" variant: uniform height
    # the art stands proud of the body face, so one filament swap at that Z prints
    # two-tone on any single-material printer.


def variant_height(variant: str, *, faces: str = "single") -> float:
    table = DOUBLE_VARIANTS if faces == "double" else VARIANTS
    try:
        return table[variant]
    except KeyError as exc:
        raise ValueError(
            f"unknown variant {variant!r}; choose one of {sorted(table)}"
        ) from exc


def variant_names() -> list[str]:
    return list(VARIANTS)


def double_kit_count() -> int:
    """Total number of physical pieces in the double-faced kit (sum of qty)."""
    return sum(qty for _a, _b, qty in DOUBLE_FACED_KIT)
