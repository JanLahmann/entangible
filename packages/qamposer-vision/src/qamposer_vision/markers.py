"""Marker table — the single source of truth for the Entangible tile scheme.

This is a **pure data module**: it maps ArUco marker IDs to the gate (or board
corner) they represent. It is imported by *both* the vision detector
(``qamposer_vision``) and the printable asset generator (``qamposer_assets``),
so the physical print and the runtime detection can never drift apart.

Deliberately dependency-free — it must NOT import ``cv2`` or ``numpy`` so that
the assets package stays lightweight. Only the standard library is used.

Marker scheme (``DICT_4X4_50``) — an **explicit per-ID assignment**, deliberately
*not* a contiguous range. Task #96 re-homed three tiles onto IDs whose printed
bit pattern resembles the gate glyph (H → 30, X → 35, CNOT control → 17,
displacing RZ(π) onto the freed 10), so the list below has intentional gaps and
every ID is spelled out one by one in :func:`_build_marker_table`:

* 0–3   board corners TL/TR/BR/BL (orientation implicit)
* 30/35/12/13 single-qubit gates H/X/Y/Z
* 17/15 CNOT control ``●`` / target ``⊕``
* 20–23 RX(π/4, π/2, π, −π/2), 24–27 the same four RY angles, 28/29/**10**/31
  the same four RZ angles — one distinct ID per angle variant
* 40/41 S / T gates — emitted as their RZ equivalents (RZ(π/2) / RZ(π/4)),
  see :attr:`GateSpec.emit_as`
* 42/43/44 RX/RY/RZ **dial** tiles — one tile per axis whose board-frame
  rotation (eight 45° steps) selects the angle (:attr:`GateSpec.dial_axis`);
  see ``docs/design.md`` "Dial tiles"
* 45    SWAP tile ``×`` — two ``×`` tiles in one column pair into a SWAP between
  their rows; emitted as the 3-CNOT decomposition until ``@qamposer/react`` gains
  a native SWAP type (see ``circuit_builder.emit_swap``)
* 11/14 **free** — vacated by X and the CNOT control in task #96. They are not
  reserved, just unassigned: nothing prints or decodes them today, and a future
  tile may claim them.
* 46    qubit-wire block — board furniture on the board's LEFT edge; up to five
  identical blocks declare the wires, see :data:`QUBIT_WIRE_ID`
* 47    measurement block — the right-edge counterpart of the wire block, an
  optional refinement that ends a wire, see :data:`MEASURE_BLOCK_ID`
* 48–49 reserved for future tiles, see :data:`RESERVED_IDS`
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

__all__ = [
    "ARUCO_DICT_NAME",
    "CORNER_IDS",
    "CORNER_ROLES",
    "DETECTABLE_IDS",
    "DIAL_ANGLES",
    "DIAL_IDS",
    "GATE_TYPES",
    "GateSpec",
    "MARKER_TABLE",
    "MEASURE_BLOCK_ID",
    "QUBIT_WIRE_ID",
    "RESERVED_IDS",
    "ROTATION_ANGLES",
    "ROTATION_GATES",
    "octant_rotation",
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
#: match ``@qamposer/react``'s ``GateType``; ``S``/``T``/``SWAP`` are physical-tile
#: identities with no native ``@qamposer/react`` type yet. S/T carry an
#: :attr:`GateSpec.emit_as` mapping (emitted as their RZ equivalents); a SWAP
#: pair is emitted by the circuit builder as its 3-CNOT decomposition (see
#: ``circuit_builder.emit_swap``) until ``@qamposer/react`` gains those types.
GATE_TYPES: frozenset[str] = frozenset(
    {"H", "X", "Y", "Z", "RX", "RY", "RZ", "CNOT", "S", "T", "SWAP"}
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

#: Dial-tile angles (radians), indexed by the tile's board-frame rotation ``r``
#: (0-7, one per clockwise 45° step). The mapping is the natural one — **the
#: angle IS the physical turn**, wrapped to ``(-π, π]``: turn the tile a quarter
#: circle clockwise and you get ``π/2``; turn it back the other way and you get
#: ``-π/2``. ``r = 0`` is the identity ``0.0``, which is deliberately still
#: **emitted** as a gate (``RX(0)`` etc.) rather than dropped: a dial lying on
#: the board is always visible on screen, so a player can see it before turning
#: it. Distinct from :data:`ROTATION_ANGLES`, which is the fixed-angle *print
#: set* of the classic four-per-family rotation tiles and must not change.
DIAL_ANGLES: tuple[float, ...] = (
    0.0,
    math.pi / 4,
    math.pi / 2,
    3.0 * math.pi / 4,
    math.pi,
    -3.0 * math.pi / 4,
    -math.pi / 2,
    -math.pi / 4,
)

#: Dial-tile marker IDs -> the rotation-gate axis they parameterise. One tile
#: per axis; the tile's board-frame rotation (0-7 clockwise 45° steps) selects
#: the angle ``DIAL_ANGLES[r]``. See :attr:`GateSpec.dial_axis`.
DIAL_IDS: dict[int, str] = {42: "RX", 43: "RY", 44: "RZ"}

#: The qubit-wire block (#95): a board-furniture block, NOT a gate. Up to five
#: *identical* blocks (all this one ID — instance count is the signal) sit along
#: the board's left edge between UL and LL; each block declares one wire at its
#: vertical position, sorted top→bottom, so the physical board plays 1-5 qubits
#: instead of a fixed 5. No blocks present = the classic 5 wires.
QUBIT_WIRE_ID = 46

#: The measurement block (#97): the RIGHT-edge counterpart of
#: :data:`QUBIT_WIRE_ID`, and board furniture just the same. Up to five
#: *identical* blocks sit along the board's right edge between UR and LR, so the
#: table reads like a circuit diagram — state prep on the left, measurement on
#: the right. Measurement blocks are a pure **refinement**: a wire exists iff
#: its LEFT block exists, and a right block only says where that wire *ends*, so
#: a wire that has one runs as the tilted segment through both block centres
#: instead of a horizontal line. A right block with no left partner is ignored
#: (warned as ``unpaired_measure``) — the wire count is NEVER derived from the
#: right side.
MEASURE_BLOCK_ID = 47

#: IDs reserved for future tiles. IDs 40/41 are live S/T tiles, 42/43/44 are
#: live RX/RY/RZ dial tiles, 45 is the live SWAP ``×`` tile, 46 is the
#: qubit-wire block and 47 the measurement block; 48–49 stay reserved — never
#: emitted by the current detector or assets generator, but claimed here so no
#: other gate is assigned into this range.
#:
#: This is *reservation*, not a census of what is unused: the assignment is
#: explicit per ID (see the module docstring), so plenty of IDs outside
#: :data:`MARKER_TABLE` are simply **free** — 11 and 14 among them, vacated by
#: task #96. Free IDs carry no promise either way; 48–49 are the ones held back
#: on purpose.
RESERVED_IDS = range(48, 50)


def quadrant_rotation(dx: float, dy: float) -> int:
    """Clockwise 90° step index (0-3) of a marker's printed top-left corner.

    ``(dx, dy)`` is the offset of the marker's canonical **top-left** corner
    from the marker centre, in a ``+x`` right / ``+y`` down frame (image or
    board mm). At canonical orientation that corner sits top-left of centre
    (``dx<0, dy<0``) -> ``0``; each clockwise 90° turn of the tile advances the
    corner one quadrant clockwise -> TL=0, TR=1, BR=2, BL=3.

    Used for the coarse **image**-frame turn reported by the detector, and
    mirrored byte-for-byte in the TypeScript detector. The *board*-frame
    rotation that drives the dial tiles is the finer
    :func:`octant_rotation` — see :data:`DIAL_ANGLES`.
    """
    angle = math.atan2(dy, dx)
    return int(round((angle + 3.0 * math.pi / 4.0) / (math.pi / 2.0))) % 4


def octant_rotation(dx: float, dy: float) -> int:
    """Clockwise 45° step index (0-7) of a marker's printed top-left corner.

    The finer twin of :func:`quadrant_rotation`, and the value a **dial** tile
    reads: ``(dx, dy)`` is the offset of the marker's canonical **top-left**
    corner from the marker centre in a ``+x`` right / ``+y`` down frame. At
    canonical orientation that corner sits top-left of centre (``dx<0, dy<0``)
    -> ``0``; each clockwise 45° turn of the tile advances the index by one, so
    ``r`` counts eighth-turns: 0 = TL corner, 1 = top edge, 2 = TR corner,
    3 = right edge, 4 = BR corner, 5 = bottom edge, 6 = BL corner, 7 = left
    edge. Even ``r`` therefore agrees with :func:`quadrant_rotation` as
    ``r // 2``.

    Used by :meth:`~qamposer_vision.board.BoardResult.marker_rotation` (board
    frame, via the homography) and mirrored byte-for-byte in the TypeScript
    detector, so a dial's rotation — and hence :data:`DIAL_ANGLES` — resolves
    to the same index everywhere.
    """
    angle = math.atan2(dy, dx)
    return int(round((angle + 3.0 * math.pi / 4.0) / (math.pi / 4.0))) % 8


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
            time from the tile's board-frame rotation ``r`` (0-7, clockwise 45°
            steps) as :data:`DIAL_ANGLES` ``[r]``, then emitted exactly like a
            classic rotation tile — including at ``r = 0``, where the emitted
            angle is ``0.0``. ``None`` for every non-dial tile.
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


#: Single-qubit Pauli / Hadamard tiles, ``marker_id -> gate``. The IDs are
#: **hand-picked, not sequential**: H sits on 30 and X on 35 because those two
#: bit patterns read as their glyphs (see ``docs/marker-ids.md``, "Why these
#: IDs"). Y/Z kept their original 12/13.
_SINGLE_QUBIT_IDS: dict[int, str] = {30: "H", 35: "X", 12: "Y", 13: "Z"}

#: CNOT halves, ``marker_id -> role``. The control ``●`` moved from 14 to 17 in
#: task #96 (ID 17 is the dictionary's most solid pattern — a single square
#: window in an otherwise black field); the target ``⊕`` never moved.
_CNOT_IDS: dict[int, str] = {17: "control", 15: "target"}

#: Fixed-angle rotation tiles, ``marker_id -> (family, angle)``. Written out one
#: ID at a time on purpose: RZ(π) lives on **10** (the ID freed when H moved to
#: 30), so the old "base 20 + index into :data:`ROTATION_ANGLES`" arithmetic no
#: longer holds and must not be reintroduced. Insertion order is the canonical
#: print order — family by family, angles in :data:`ROTATION_ANGLES` order.
_ROTATION_IDS: dict[int, tuple[str, float]] = {
    20: ("RX", math.pi / 4),
    21: ("RX", math.pi / 2),
    22: ("RX", math.pi),
    23: ("RX", -math.pi / 2),
    24: ("RY", math.pi / 4),
    25: ("RY", math.pi / 2),
    26: ("RY", math.pi),
    27: ("RY", -math.pi / 2),
    28: ("RZ", math.pi / 4),
    29: ("RZ", math.pi / 2),
    10: ("RZ", math.pi),
    31: ("RZ", -math.pi / 2),
}


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

    # 30/35/12/13: single-qubit Pauli / Hadamard gates.
    for marker_id, gate in _SINGLE_QUBIT_IDS.items():
        table[marker_id] = GateSpec(kind="gate", gate=gate, label=gate)

    # 17/15: CNOT halves.
    glyph = {"control": "●", "target": "⊕"}
    for marker_id, role in _CNOT_IDS.items():
        table[marker_id] = GateSpec(
            kind="gate",
            gate="CNOT",
            label=f"CNOT {role} {glyph[role]}",
            role=role,
        )

    # 20-29/10/31: rotation gates x angle variants, one explicit ID each.
    for marker_id, (family, angle) in _ROTATION_IDS.items():
        table[marker_id] = GateSpec(
            kind="gate",
            gate=family,
            label=f"{family}({pretty_angle(angle)})",
            parameter=angle,
        )

    # 40/41: S and T. No native @qamposer/react gate type yet, so each carries an
    # ``emit_as`` mapping to its RZ equivalent (see design.md / docs/marker-ids.md);
    # the tile face is still labelled "S"/"T" in the Z-family colour.
    table[40] = GateSpec(kind="gate", gate="S", label="S", emit_as=("RZ", math.pi / 2))
    table[41] = GateSpec(kind="gate", gate="T", label="T", emit_as=("RZ", math.pi / 4))

    # 42/43/44: RX/RY/RZ dial tiles. One tile per axis; the printed tile face is
    # a dial whose board-frame rotation r (0-7, clockwise 45° steps) selects
    # DIAL_ANGLES[r]. The spec's own ``parameter`` stays None — the angle is
    # resolved from rotation at build time — while ``dial_axis`` names the axis
    # emitted (RX/RY/RZ).
    for marker_id, axis in DIAL_IDS.items():
        table[marker_id] = GateSpec(
            kind="gate",
            gate=axis,
            label=f"{axis} dial",
            dial_axis=axis,
        )

    # 45: SWAP tile. There is no native @qamposer/react SWAP gate type, so two
    # SWAP tiles in one column are emitted by the circuit builder as the 3-CNOT
    # decomposition of a SWAP between their rows (see circuit_builder.emit_swap).
    # The physical tile carries the CNOT-family colour and an "×" glyph.
    table[45] = GateSpec(kind="gate", gate="SWAP", label="SWAP ×")

    return table


#: The single source of truth: ArUco marker ID -> :class:`GateSpec`.
#: Imported by both the detector and the assets generator.
MARKER_TABLE: dict[int, GateSpec] = _build_marker_table()

#: Every ID a detector must be able to DECODE: the gate/corner table plus the
#: two board-furniture blocks. IDs 46/47 carry no :class:`GateSpec` — they are
#: furniture, deliberately absent from :data:`MARKER_TABLE` so they can never be
#: mapped to a cell as a gate — but the board still has to recognise them. The
#: pocket dictionary export reads this, so the browser detector decodes exactly
#: the same IDs ``cv2.aruco`` does.
DETECTABLE_IDS: frozenset[int] = frozenset(MARKER_TABLE) | {
    QUBIT_WIRE_ID,
    MEASURE_BLOCK_ID,
}
