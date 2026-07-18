# Marker IDs

ArUco dictionary: **`DICT_4X4_50`** (4×4 = largest bits-per-mm; 50 IDs cover the
current scheme plus the reserved range).

> **`MARKER_TABLE` is the single source of truth.** It lives in
> [`packages/qamposer-vision/src/qamposer_vision/markers.py`](../packages/qamposer-vision/src/qamposer_vision/markers.py)
> and is imported by **both** the vision detector (`qamposer-vision`) and the
> printable-asset generator (`qamposer-assets`), so the physical print and the
> runtime detection can never drift apart. This document is generated to match
> that table — if you change the table, regenerate this file.

## ID table

| ID | Kind | Gate | Label | Angle | Role |
|----|------|------|-------|-------|------|
| 0 | corner | TL | Corner TL |  | TL |
| 1 | corner | TR | Corner TR |  | TR |
| 2 | corner | BR | Corner BR |  | BR |
| 3 | corner | BL | Corner BL |  | BL |
| 10 | gate | H | H |  |  |
| 11 | gate | X | X |  |  |
| 12 | gate | Y | Y |  |  |
| 13 | gate | Z | Z |  |  |
| 14 | gate | CNOT | CNOT control ● |  | control |
| 15 | gate | CNOT | CNOT target ⊕ |  | target |
| 20 | gate | RX | RX(π/4) | π/4 |  |
| 21 | gate | RX | RX(π/2) | π/2 |  |
| 22 | gate | RX | RX(π) | π |  |
| 23 | gate | RX | RX(-π/2) | -π/2 |  |
| 24 | gate | RY | RY(π/4) | π/4 |  |
| 25 | gate | RY | RY(π/2) | π/2 |  |
| 26 | gate | RY | RY(π) | π |  |
| 27 | gate | RY | RY(-π/2) | -π/2 |  |
| 28 | gate | RZ | RZ(π/4) | π/4 |  |
| 29 | gate | RZ | RZ(π/2) | π/2 |  |
| 30 | gate | RZ | RZ(π) | π |  |
| 31 | gate | RZ | RZ(-π/2) | -π/2 |  |
| 40 | gate | S | S |  |  |
| 41 | gate | T | T |  |  |

## S / T tiles (40 / 41)

**S (ID 40)** and **T (ID 41)** are printed in the Z-family colour (`#33b1ff`)
with a big single-letter label, exactly like H/X/Y/Z. `@qamposer/react@0.2` has
no native `S`/`T` gate type, so the circuit builder emits each as its **RZ
equivalent**, carried on the `GateSpec.emit_as` field of the one `MARKER_TABLE`
entry:

- **S → `RZ(π/2)`** — emitted as `{type: "RZ", parameter: π/2}`; QASM shows
  `rz(pi/2)`.
- **T → `RZ(π/4)`** — emitted as `{type: "RZ", parameter: π/4}`; QASM shows
  `rz(pi/4)`.

The emitted gate id uses the RZ type (e.g. `rz-0-2`). It stays collision-free
against a real RZ(π/2) tile because the id embeds `(row, col)` and no two tiles
can share a cell — an S tile and an RZ(π/2) tile produce identical gates, which
is intended. When `@qamposer/react` gains native S/T types (gate table +
matrices + `s`/`t` QASM), drop the `emit_as` mapping.

## Reserved

IDs **42–49** (`RESERVED_IDS = range(42, 50)`) are reserved for future tiles
(SWAP, …). They are never emitted by the current detector or assets generator,
and no current gate is assigned into this range. (IDs 40/41 in the 40–49 block
are now live S/T tiles — see above.)

## Notes

- **Corners (0–3)** are board fiducials placed TL/TR/BR/BL. Orientation is
  implicit from which corner is which; the board homography works with 3 of 4
  corners visible.
- **Rotation gates (20–31)** encode each angle variant as a *distinct* marker ID
  (π/4, π/2, π, −π/2) rather than a parameterised marker, so a single tile fully
  specifies its gate. Angle labels are rendered by `pretty_angle()` /
  `GateSpec.param_label` so tiles and QASM format angles identically.
- **CNOT (14/15)** is split into a control (●) and target (⊕) tile; the two are
  paired within a column by the circuit builder.
- Gate types match `@qamposer/react`'s `GateType`
  (`H`, `X`, `Y`, `Z`, `RX`, `RY`, `RZ`, `CNOT`).
