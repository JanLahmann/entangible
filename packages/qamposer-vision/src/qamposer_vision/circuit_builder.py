"""Build a ``@qamposer/react`` Circuit from per-cell tile placements.

Input: gate tiles already resolved to a ``(row, col)`` cell. Output: the exact
``Circuit`` JSON shape the display app consumes (see
``qamposer-react/src/types/index.ts``):

* single-qubit gate -> ``{id, type, qubit: row, position: col, parameter?}``
* CNOT (control ID 14 + target ID 15 in the same column) ->
  ``{id, type: 'CNOT', control, target, position: col}``

Pairing is deterministic (globally nearest control/target by row). Tiles that
cannot form a valid gate — two tiles in one cell, a lone CNOT control or
target — are **excluded** and reported as structured :class:`BuildWarning`\\ s;
they are never guessed at (design.md).

Gate IDs are deterministic and stable across runs: ``"h-0-0"``,
``"cnot-1-0"`` (``type-qubit-position`` / ``cnot-control-position``, lowercase),
so React keeps element identity between emissions.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .markers import MARKER_TABLE, ROTATION_ANGLES, GateSpec

__all__ = [
    "TilePlacement",
    "BuildWarning",
    "BuildResult",
    "build_circuit",
    "emit_swap",
]

#: The two CNOT marker halves.
_CNOT_CONTROL_ID = 14
_CNOT_TARGET_ID = 15
#: The SWAP tile (``×``). Two in one column pair into a SWAP between their rows.
_SWAP_ID = 45

#: A ● (id 14) is a generic controlled-gate modifier (task #51): one single-qubit
#: gate tile + one ● in a column is that gate's controlled form. ``X`` maps to a
#: native CNOT (``● + X ≡ ● + ⊕``, preserving legacy pairing); the rest map to a
#: controlled type carried in the circuit JSON and emitted natively in QASM.
_CONTROLLED_GATE: dict[str, str] = {"Y": "CY", "Z": "CZ", "H": "CH", "S": "CS", "T": "CT"}


@dataclass(frozen=True, slots=True)
class TilePlacement:
    """A detected gate tile resolved to a board cell.

    ``rotation`` is the tile's board-frame clockwise 90° step index (0-3). It is
    only meaningful for **dial** tiles (IDs 42/43/44), where it selects the
    angle ``ROTATION_ANGLES[rotation]``; every other tile is orientation-free
    and leaves it at the default ``0``.
    """

    marker_id: int
    row: int
    col: int
    rotation: int = 0

    @property
    def spec(self) -> GateSpec:
        return MARKER_TABLE[self.marker_id]


@dataclass(frozen=True, slots=True)
class BuildWarning:
    """A structured, machine-readable reason a tile was excluded.

    ``kind`` is one of ``"cell_conflict"``, ``"lone_control"``,
    ``"lone_target"``, ``"lone_swap"``, ``"control_ambiguous"``.
    """

    kind: str
    message: str
    row: int | None = None
    col: int | None = None
    marker_ids: tuple[int, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "message": self.message,
            "row": self.row,
            "col": self.col,
            "marker_ids": list(self.marker_ids),
        }


@dataclass(slots=True)
class BuildResult:
    """The built circuit plus any structured warnings."""

    circuit: dict[str, Any]
    warnings: list[BuildWarning] = field(default_factory=list)


def _single_qubit_gate(
    spec: GateSpec, row: int, col: int, rotation: int
) -> dict[str, Any]:
    # Dial tiles (IDs 42/43/44): the angle comes from the tile's board-frame
    # rotation, ROTATION_ANGLES[rotation]. The emitted gate is byte-identical to
    # a classic rotation tile of that axis/angle at the same cell (same id
    # "rx-0-0", same type, same parameter) — indistinguishable downstream. The
    # rotation is part of the stabilizer key, so turning the dial re-emits.
    if spec.dial_axis is not None:
        axis = spec.dial_axis
        angle = ROTATION_ANGLES[rotation % len(ROTATION_ANGLES)]
        return {
            "id": f"{axis.lower()}-{row}-{col}",
            "type": axis,
            "qubit": row,
            "position": col,
            "parameter": angle,
        }

    # Tiles without a native @qamposer/react type (S / T) are emitted as their
    # RZ equivalent via ``emit_as`` — so the circuit JSON / QASM only ever carry
    # RZ. The gate id uses the *emitted* type ("rz-0-2"); it stays collision-free
    # against a real RZ(π/2) tile because the id embeds (row, col) and no two
    # tiles share a cell (see build_circuit's cell-conflict handling).
    if spec.emit_as is not None:
        emit_type, emit_parameter = spec.emit_as
        return {
            "id": f"{emit_type.lower()}-{row}-{col}",
            "type": emit_type,
            "qubit": row,
            "position": col,
            "parameter": emit_parameter,
        }

    gate: dict[str, Any] = {
        "id": f"{spec.gate.lower()}-{row}-{col}",
        "type": spec.gate,
        "qubit": row,
        "position": col,
    }
    if spec.parameter is not None:
        gate["parameter"] = spec.parameter
    return gate


def _cnot_gate(control_row: int, target_row: int, col: int) -> dict[str, Any]:
    return {
        "id": f"cnot-{control_row}-{col}",
        "type": "CNOT",
        "control": control_row,
        "target": target_row,
        "position": col,
    }


def _controlled_gate(
    ctype: str, control_row: int, target_row: int, col: int
) -> dict[str, Any]:
    """A single-control controlled gate (CY/CZ/CH/CS/CT) in circuit JSON form."""
    return {
        "id": f"{ctype.lower()}-{control_row}-{col}",
        "type": ctype,
        "control": control_row,
        "target": target_row,
        "position": col,
    }


def _ccx_gate(control_rows: list[int], target_row: int, col: int) -> dict[str, Any]:
    """A Toffoli (CCX): two controls + one X target. Controls stored sorted."""
    c0, c1 = sorted(control_rows)
    return {
        "id": f"ccx-{c0}-{c1}-{col}",
        "type": "CCX",
        "control": c0,
        "control2": c1,
        "target": target_row,
        "position": col,
    }


def _build_controlled(
    controls: list[int],
    xtargets: list[int],
    sgates: list[TilePlacement],
    col: int,
) -> tuple[list[dict[str, Any]], list[BuildWarning]]:
    """Resolve a column holding ≥1 ● control AND ≥1 single-qubit gate tile.

    Ruling (task #51 — FIXED): one gate + one ● → its controlled form; two ● + X
    → CCX. Everything else (● + ⊕ + gate; ● + ≥2 gates; ≥3 controls; 2 controls
    with a non-X gate; a controlled rotation) is ambiguous → excluded with a
    single :class:`BuildWarning` of kind ``"control_ambiguous"``.
    """
    gates: list[dict[str, Any]] = []
    warnings: list[BuildWarning] = []
    nc = len(controls)
    ng = len(sgates)
    marker_ids = tuple(
        sorted(
            [_CNOT_CONTROL_ID] * nc
            + [_CNOT_TARGET_ID] * len(xtargets)
            + [p.marker_id for p in sgates]
        )
    )
    anchor_row = min(controls)

    def ambiguous(reason: str) -> None:
        warnings.append(
            BuildWarning(
                kind="control_ambiguous",
                message=(
                    f"Ambiguous ● control in column {col}: {reason}; excluded."
                ),
                row=anchor_row,
                col=col,
                marker_ids=marker_ids,
            )
        )

    if xtargets:
        ambiguous("a ● control shares its column with both a ⊕ target and a gate")
        return gates, warnings
    if ng >= 2:
        ambiguous("a ● control shares its column with two or more gate tiles")
        return gates, warnings

    # Exactly one gate tile from here on.
    sgate = sgates[0]
    gate_letter = sgate.spec.gate  # H/X/Y/Z/S/T/RX/RY/RZ
    target = sgate.row

    if nc >= 3:
        ambiguous("three or more ● controls")
        return gates, warnings

    if nc == 2:
        if gate_letter == "X":
            gates.append(_ccx_gate(controls, target, col))
        else:
            ambiguous("two ● controls with a gate other than X (only CCX is supported)")
        return gates, warnings

    # nc == 1
    control = controls[0]
    if gate_letter == "X":
        gates.append(_cnot_gate(control, target, col))
    elif gate_letter in _CONTROLLED_GATE:
        gates.append(_controlled_gate(_CONTROLLED_GATE[gate_letter], control, target, col))
    else:
        # RX/RY/RZ (incl. dial tiles) — no controlled rotations in v1.
        ambiguous("a ● control with a rotation gate (controlled rotations unsupported)")
    return gates, warnings


def emit_swap(row_a: int, row_b: int, col: int) -> list[dict[str, Any]]:
    """Emit a SWAP between ``row_a``/``row_b`` at column ``col``.

    Until ``@qamposer/react`` gains a native SWAP gate type, a SWAP is emitted
    as its standard 3-CNOT decomposition, **all at the same position ``col``**
    and in this exact array order::

        cx(a, b), cx(b, a), cx(a, b)

    The statevector/localAdapter applies gates in array order and
    ``circuit_to_qasm``'s stable sort by position preserves it, so the physics
    and the 3-``cx`` QASM are exactly correct. The three ids are
    ``swap-{a}-{col}-1/2/3`` (``a`` = the lower of the two rows), keeping React
    element identity stable across emissions.

    This is the *single* place that knows the decomposition: swapping to a native
    ``{"type": "SWAP", "control": a, "target": b, "position": col}`` gate later is
    a one-function edit here (mirrored in the TS ``emitSwap``).
    """
    prefix = f"swap-{row_a}-{col}"
    return [
        {"id": f"{prefix}-1", "type": "CNOT", "control": row_a, "target": row_b, "position": col},
        {"id": f"{prefix}-2", "type": "CNOT", "control": row_b, "target": row_a, "position": col},
        {"id": f"{prefix}-3", "type": "CNOT", "control": row_a, "target": row_b, "position": col},
    ]


def _pair_swaps(
    swap_rows: list[int], col: int
) -> tuple[list[tuple[int, int]], list[BuildWarning]]:
    """Pair ``×`` tiles in one column into SWAPs, nearest-by-row first.

    Deterministic, mirroring the CNOT pairing: repeatedly consume the globally
    closest unpaired pair of rows (ties broken by the lower row, then the higher
    row). Each pair is returned as ``(a, b)`` with ``a < b``. An odd tile left
    over (a single ``×`` in the column, or the remainder of >2 tiles) becomes a
    ``lone_swap`` warning and is excluded.
    """
    remaining = sorted(swap_rows)
    pairs: list[tuple[int, int]] = []

    while len(remaining) >= 2:
        best: tuple[int, int, int] | None = None  # (dist, a_row, b_row)
        for i, a in enumerate(remaining):
            for b in remaining[i + 1 :]:
                dist = b - a  # remaining is sorted, so b > a
                key = (dist, a, b)
                if best is None or key < best:
                    best = key
        assert best is not None
        _, a_row, b_row = best
        pairs.append((a_row, b_row))
        remaining.remove(a_row)
        remaining.remove(b_row)

    warnings: list[BuildWarning] = []
    for r in remaining:  # 0 or 1 leftover
        warnings.append(
            BuildWarning(
                kind="lone_swap",
                message=(
                    f"SWAP tile at row {r}, column {col} has no partner in its "
                    "column; excluded."
                ),
                row=r,
                col=col,
                marker_ids=(_SWAP_ID,),
            )
        )
    return pairs, warnings


def _pair_cnots(
    control_rows: list[int], target_rows: list[int], col: int
) -> tuple[list[tuple[int, int]], list[BuildWarning]]:
    """Pair controls with targets in one column, nearest-by-row first.

    Deterministic: repeatedly consume the globally closest unpaired
    control/target pair (ties broken by lower control row, then lower target
    row). Leftover controls/targets become lone-tile warnings.
    """
    controls = sorted(control_rows)
    targets = sorted(target_rows)
    pairs: list[tuple[int, int]] = []

    remaining_c = list(controls)
    remaining_t = list(targets)
    while remaining_c and remaining_t:
        best: tuple[int, int, int, int] | None = None  # (dist, c_row, t_row, ...)
        for c in remaining_c:
            for t in remaining_t:
                dist = abs(c - t)
                key = (dist, c, t)
                if best is None or key < best[:3]:
                    best = (dist, c, t, 0)
        assert best is not None
        _, c_row, t_row, _ = best
        pairs.append((c_row, t_row))
        remaining_c.remove(c_row)
        remaining_t.remove(t_row)

    warnings: list[BuildWarning] = []
    for c in remaining_c:
        warnings.append(
            BuildWarning(
                kind="lone_control",
                message=(
                    f"CNOT control at row {c}, column {col} has no target in its "
                    "column; excluded."
                ),
                row=c,
                col=col,
                marker_ids=(_CNOT_CONTROL_ID,),
            )
        )
    for t in remaining_t:
        warnings.append(
            BuildWarning(
                kind="lone_target",
                message=(
                    f"CNOT target at row {t}, column {col} has no control in its "
                    "column; excluded."
                ),
                row=t,
                col=col,
                marker_ids=(_CNOT_TARGET_ID,),
            )
        )
    return pairs, warnings


def build_circuit(
    placements: list[TilePlacement], qubits: int
) -> BuildResult:
    """Assemble the Circuit JSON from resolved tile placements.

    Args:
        placements: gate tiles, each already mapped to a ``(row, col)`` cell.
        qubits: number of qubit wires (board rows) — emitted verbatim as
            ``circuit["qubits"]``.
    """
    warnings: list[BuildWarning] = []

    # 1. Resolve cell conflicts: at most one tile per (row, col).
    by_cell: dict[tuple[int, int], list[TilePlacement]] = {}
    for placement in placements:
        by_cell.setdefault((placement.row, placement.col), []).append(placement)

    kept: list[TilePlacement] = []
    for (row, col), cell_tiles in by_cell.items():
        if len(cell_tiles) > 1:
            warnings.append(
                BuildWarning(
                    kind="cell_conflict",
                    message=(
                        f"{len(cell_tiles)} tiles occupy cell (row {row}, "
                        f"column {col}); all excluded."
                    ),
                    row=row,
                    col=col,
                    marker_ids=tuple(sorted(t.marker_id for t in cell_tiles)),
                )
            )
            continue
        kept.append(cell_tiles[0])

    # 2. Bucket kept tiles by column: single-qubit gate tiles, CNOT halves and
    #    SWAP tiles. Gate tiles are bucketed (not emitted immediately) because a
    #    ● control now combines with a gate tile in its column (see step 3).
    gates: list[dict[str, Any]] = []
    controls_by_col: dict[int, list[int]] = {}
    targets_by_col: dict[int, list[int]] = {}
    swaps_by_col: dict[int, list[int]] = {}
    sgates_by_col: dict[int, list[TilePlacement]] = {}

    for placement in kept:
        spec = placement.spec
        if spec.gate == "CNOT":
            if spec.role == "control":
                controls_by_col.setdefault(placement.col, []).append(placement.row)
            else:  # target (⊕)
                targets_by_col.setdefault(placement.col, []).append(placement.row)
        elif spec.gate == "SWAP":
            swaps_by_col.setdefault(placement.col, []).append(placement.row)
        else:
            sgates_by_col.setdefault(placement.col, []).append(placement)

    # 3. Resolve each column carrying a control, ⊕ target and/or gate tile. A ●
    #    + single-qubit gate is that gate's controlled form (X→CX, Y→CY, Z→CZ,
    #    H→CH, S→CS, T→CT); two ● + X is CCX. A column with a ● but NO gate tile
    #    keeps the legacy ●/⊕ CNOT pairing (incl. nearest-unpaired) UNCHANGED.
    for col in sorted(
        set(controls_by_col) | set(targets_by_col) | set(sgates_by_col)
    ):
        controls = controls_by_col.get(col, [])
        xtargets = targets_by_col.get(col, [])
        sgates = sgates_by_col.get(col, [])
        if controls and sgates:
            col_gates, col_warnings = _build_controlled(controls, xtargets, sgates, col)
            gates.extend(col_gates)
            warnings.extend(col_warnings)
        else:
            for p in sgates:
                gates.append(_single_qubit_gate(p.spec, p.row, p.col, p.rotation))
            if controls or xtargets:
                pairs, col_warnings = _pair_cnots(controls, xtargets, col)
                warnings.extend(col_warnings)
                for control_row, target_row in pairs:
                    gates.append(_cnot_gate(control_row, target_row, col))

    # 3b. Pair SWAP (×) tiles per column and emit each as its 3-CNOT form.
    for col in sorted(swaps_by_col):
        swap_pairs, col_warnings = _pair_swaps(swaps_by_col[col], col)
        warnings.extend(col_warnings)
        for row_a, row_b in swap_pairs:
            gates.extend(emit_swap(row_a, row_b, col))

    # 4. Deterministic gate ordering: by column, then by primary row, then type.
    def sort_key(gate: dict[str, Any]) -> tuple[int, int, str]:
        gate_id = gate["id"]
        if gate_id.startswith("swap-"):
            # A SWAP's three CNOTs must keep their emission order
            # (cx(a,b), cx(b,a), cx(a,b)); anchor all three at the SWAP's lower
            # row ``a`` (id = "swap-{a}-{col}-{n}") so this stable sort leaves
            # them in place — using the control row would reorder them.
            _, a_str, _col_str, _n = gate_id.split("-")
            return (gate["position"], int(a_str), "CNOT")
        primary_row = gate.get("qubit", gate.get("control", 0))
        return (gate["position"], int(primary_row), str(gate["type"]))

    gates.sort(key=sort_key)

    # Deterministic warning ordering.
    warnings.sort(key=lambda w: (w.col or 0, w.row or 0, w.kind))

    circuit = {"qubits": qubits, "gates": gates}
    return BuildResult(circuit=circuit, warnings=warnings)
