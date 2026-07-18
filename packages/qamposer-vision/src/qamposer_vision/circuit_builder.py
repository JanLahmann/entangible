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

from .markers import MARKER_TABLE, GateSpec

__all__ = [
    "TilePlacement",
    "BuildWarning",
    "BuildResult",
    "build_circuit",
]

#: The two CNOT marker halves.
_CNOT_CONTROL_ID = 14
_CNOT_TARGET_ID = 15


@dataclass(frozen=True, slots=True)
class TilePlacement:
    """A detected gate tile resolved to a board cell."""

    marker_id: int
    row: int
    col: int

    @property
    def spec(self) -> GateSpec:
        return MARKER_TABLE[self.marker_id]


@dataclass(frozen=True, slots=True)
class BuildWarning:
    """A structured, machine-readable reason a tile was excluded.

    ``kind`` is one of ``"cell_conflict"``, ``"lone_control"``,
    ``"lone_target"``.
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


def _single_qubit_gate(spec: GateSpec, row: int, col: int) -> dict[str, Any]:
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

    # 2. Split kept tiles into single-qubit gates and CNOT halves per column.
    gates: list[dict[str, Any]] = []
    controls_by_col: dict[int, list[int]] = {}
    targets_by_col: dict[int, list[int]] = {}

    for placement in kept:
        spec = placement.spec
        if spec.gate == "CNOT":
            if spec.role == "control":
                controls_by_col.setdefault(placement.col, []).append(placement.row)
            else:  # target
                targets_by_col.setdefault(placement.col, []).append(placement.row)
        else:
            gates.append(_single_qubit_gate(spec, placement.row, placement.col))

    # 3. Pair CNOT halves per column.
    for col in sorted(set(controls_by_col) | set(targets_by_col)):
        pairs, col_warnings = _pair_cnots(
            controls_by_col.get(col, []), targets_by_col.get(col, []), col
        )
        warnings.extend(col_warnings)
        for control_row, target_row in pairs:
            gates.append(_cnot_gate(control_row, target_row, col))

    # 4. Deterministic gate ordering: by column, then by primary row.
    def sort_key(gate: dict[str, Any]) -> tuple[int, int, str]:
        primary_row = gate.get("qubit", gate.get("control", 0))
        return (gate["position"], int(primary_row), str(gate["type"]))

    gates.sort(key=sort_key)

    # Deterministic warning ordering.
    warnings.sort(key=lambda w: (w.col or 0, w.row or 0, w.kind))

    circuit = {"qubits": qubits, "gates": gates}
    return BuildResult(circuit=circuit, warnings=warnings)
