"""Marker table — the single source of truth for the Entangible tile scheme.

This is a **pure data module**: it maps ArUco marker IDs to the gate (or board
corner) they represent. It is imported by *both* the vision detector
(``qamposer_vision``) and the printable asset generator (``qamposer_assets``),
so the physical print and the runtime detection can never drift apart.

Deliberately dependency-free — it must NOT import ``cv2`` or ``numpy`` so that
the assets package stays lightweight. Only the standard library is used.

Marker scheme (``DICT_4X4_50``):

* 0–3   board corners TL/TR/BR/BL (orientation implicit)
* 10–13 single-qubit gates H/X/Y/Z
* 14/15 CNOT control ``●`` / target ``⊕``
* 20–31 rotation gates RX/RY/RZ, one distinct ID per angle variant
* 40/41 S / T gates — emitted as their RZ equivalents (RZ(π/2) / RZ(π/4)),
  see :attr:`GateSpec.emit_as`
* 42/43/44 RX/RY/RZ **dial** tiles — one tile per axis whose board-frame
  rotation selects the angle (:attr:`GateSpec.dial_axis`); see
  ``docs/design.md`` "Dial tiles"
* 45–49 reserved for future tiles (SWAP, …), see :data:`RESERVED_IDS`
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

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
    "ROTATION_GATES",
    "pretty_angle",
    "quadrant_rotation",
]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

#: ArUco dictionary used for every printed marker. 4x4 = largest bits-per-mm,
#: 50 IDs is plenty for the current + reserved scheme. ``cv2.aruco`` ships this
#: predefined dictionary; the assets generator renders the same bit matrix.
ARUCO_DICT_NAME = "DICT_4X4_50"

#: Board-corner roles in clockwise order starting top-left.
CORNER_ROLES: tuple[str, str, str, str] = ("TL", "TR", "BR", "BL")

#: Marker ID -> corner role for the four board corners.
CORNER_IDS: dict[int, str] = {0: "TL", 1: "TR", 2: "BR", 3: "BL"}

#: Valid tile gate types. ``H``/``X``/``Y``/``Z``/``RX``/``RY``/``RZ``/``CNOT``
#: match ``@qamposer/react``'s ``GateType``; ``S``/``T`` are physical-tile
#: identities that carry an :attr:`GateSpec.emit_as` mapping and are emitted as
#: their RZ equivalents until ``@qamposer/react`` gains native S/T gate types.
GATE_TYPES: frozenset[str] = frozenset(
    {"H", "X", "Y", "Z", "RX", "RY", "RZ", "CNOT", "S", "T"}
)

#: Rotation gate families that come in angle variants.
ROTATION_GATES: tuple[str, str, str] = ("RX", "RY", "RZ")

#: The angle variants (radians) printed for every rotation gate family.
ROTATION_ANGLES: tuple[float, float, float, float] = (
    math.pi / 4,
    math.pi / 2,
    math.pi,
    -math.pi / 2,
)

#: Dial-tile marker IDs -> the rotation-gate axis they parameterise. One tile
#: per axis; the tile's board-frame rotation (0-3 clockwise 90° steps) selects
#: the angle ``ROTATION_ANGLES[r]``. See :attr:`GateSpec.dial_axis`.
DIAL_IDS: dict[int, str] = {42: "RX", 43: "RY", 44: "RZ"}

#: IDs reserved for future tiles (SWAP, …). IDs 40/41 are live S/T tiles and
#: 42/43/44 are live RX/RY/RZ dial tiles; 45–49 stay reserved — never emitted by
#: the current detector or assets generator, but claimed here so no other gate is
#: assigned into this range.
RESERVED_IDS = range(45, 50)


def quadrant_rotation(dx: float, dy: float) -> int:
    """Clockwise 90° step index (0-3) of a marker's printed top-left corner.

    ``(dx, dy)`` is the offset of the marker's canonical **top-left** corner
    from the marker centre, in a ``+x`` right / ``+y`` down frame (image or
    board mm). At canonical orientation that corner sits top-left of centre
    (``dx<0, dy<0``) -> ``0``; each clockwise 90° turn of the tile advances the
    corner one quadrant clockwise -> TL=0, TR=1, BR=2, BL=3.

    Shared by the OpenCV detector (image frame) and the board port (board frame,
    via the homography) and mirrored byte-for-byte in the TypeScript detector,
    so a tile's rotation resolves to the same index everywhere.
    """
    angle = math.atan2(dy, dx)
    return int(round((angle + 3.0 * math.pi / 4.0) / (math.pi / 2.0))) % 4


# ---------------------------------------------------------------------------
# Spec dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class GateSpec:
    """What a single ArUco marker ID represents.

    Attributes:
        kind: ``"corner"`` for board fiducials, ``"gate"`` for tiles.
        gate: For ``kind == "gate"`` a ``GateType`` string (see
            :data:`GATE_TYPES`); for ``kind == "corner"`` the corner role
            (one of :data:`CORNER_ROLES`).
        label: Human-facing label (tile caption / debug table), e.g.
            ``"RX(π/2)"`` or ``"Corner TL"``.
        parameter: Rotation angle in radians for RX/RY/RZ, else ``None``.
        role: For corners one of ``TL|TR|BR|BL``; for CNOT ``control|target``;
            otherwise ``None``.
        emit_as: For tiles with no native ``@qamposer/react`` gate type (S / T),
            the ``(gate_type, parameter)`` the circuit builder should emit
            instead — e.g. ``("RZ", π/2)`` for an S tile. ``None`` for tiles
            emitted verbatim. Both the print label (``label``) and this
            emission mapping live on the one :data:`MARKER_TABLE` entry so the
            physical tile and the runtime circuit can never drift.
        dial_axis: For a **dial** tile (IDs 42/43/44), the rotation-gate axis
            (``"RX"``/``"RY"``/``"RZ"``) it parameterises. The angle is *not*
            fixed on the spec (``parameter is None``); it is chosen at detection
            time from the tile's board-frame rotation ``r`` as
            ``ROTATION_ANGLES[r]``, then emitted exactly like a classic rotation
            tile. ``None`` for every non-dial tile.
    """

    kind: Literal["corner", "gate"]
    gate: str
    label: str
    parameter: float | None = None
    role: str | None = None
    emit_as: tuple[str, float] | None = None
    dial_axis: str | None = None

    @property
    def param_label(self) -> str | None:
        """Pretty angle label (e.g. ``"π/2"``) for rotation gates, else ``None``.

        Shared by the assets generator (tile face text) and QASM/label
        rendering so angles are formatted identically everywhere.
        """
        if self.parameter is None:
            return None
        return pretty_angle(self.parameter)


# ---------------------------------------------------------------------------
# Angle formatting
# ---------------------------------------------------------------------------

# Known exact multiples of pi, keyed by angle/pi, for crisp tile labels.
_PI_FRACTIONS: dict[float, str] = {
    0.25: "π/4",
    0.5: "π/2",
    1.0: "π",
    2.0: "2π",
    0.75: "3π/4",
    1.0 / 3.0: "π/3",
    1.0 / 6.0: "π/6",
}


def pretty_angle(theta: float) -> str:
    """Format a radian angle as a compact π-relative label.

    Examples:
        ``π/2`` -> ``"π/2"``; ``-π/2`` -> ``"-π/2"``; ``π`` -> ``"π"``.

    Falls back to a 4-decimal radian value for angles that are not a
    recognised simple multiple of π.
    """
    if theta == 0:
        return "0"
    sign = "-" if theta < 0 else ""
    ratio = abs(theta) / math.pi
    for value, text in _PI_FRACTIONS.items():
        if math.isclose(ratio, value, rel_tol=1e-9, abs_tol=1e-12):
            return f"{sign}{text}"
    return f"{theta:.4f}"


# ---------------------------------------------------------------------------
# Table construction
# ---------------------------------------------------------------------------


def _build_marker_table() -> dict[int, GateSpec]:
    table: dict[int, GateSpec] = {}

    # 0-3: board corners.
    for marker_id, role in CORNER_IDS.items():
        table[marker_id] = GateSpec(
            kind="corner",
            gate=role,
            label=f"Corner {role}",
            role=role,
        )

    # 10-13: single-qubit Pauli / Hadamard gates.
    for marker_id, gate in ((10, "H"), (11, "X"), (12, "Y"), (13, "Z")):
        table[marker_id] = GateSpec(kind="gate", gate=gate, label=gate)

    # 14/15: CNOT halves.
    table[14] = GateSpec(kind="gate", gate="CNOT", label="CNOT control ●", role="control")
    table[15] = GateSpec(kind="gate", gate="CNOT", label="CNOT target ⊕", role="target")

    # 20-31: rotation gates x angle variants (4 angles each, contiguous).
    base = 20
    for family in ROTATION_GATES:
        for offset, angle in enumerate(ROTATION_ANGLES):
            marker_id = base + offset
            label = f"{family}({pretty_angle(angle)})"
            table[marker_id] = GateSpec(
                kind="gate",
                gate=family,
                label=label,
                parameter=angle,
            )
        base += len(ROTATION_ANGLES)

    # 40/41: S and T. No native @qamposer/react gate type yet, so each carries an
    # ``emit_as`` mapping to its RZ equivalent (see design.md / docs/marker-ids.md);
    # the tile face is still labelled "S"/"T" in the Z-family colour.
    table[40] = GateSpec(kind="gate", gate="S", label="S", emit_as=("RZ", math.pi / 2))
    table[41] = GateSpec(kind="gate", gate="T", label="T", emit_as=("RZ", math.pi / 4))

    # 42/43/44: RX/RY/RZ dial tiles. One tile per axis; the printed tile face is
    # a dial whose board-frame rotation r (0-3) selects ROTATION_ANGLES[r]. The
    # spec's own ``parameter`` stays None — the angle is resolved from rotation
    # at build time — while ``dial_axis`` names the axis emitted (RX/RY/RZ).
    for marker_id, axis in DIAL_IDS.items():
        table[marker_id] = GateSpec(
            kind="gate",
            gate=axis,
            label=f"{axis} dial",
            dial_axis=axis,
        )

    return table


#: The single source of truth: ArUco marker ID -> :class:`GateSpec`.
#: Imported by both the detector and the assets generator.
MARKER_TABLE: dict[int, GateSpec] = _build_marker_table()
