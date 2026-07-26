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
| 42 | gate | RX | RX dial |  |  |
| 43 | gate | RY | RY dial |  |  |
| 44 | gate | RZ | RZ dial |  |  |
| 45 | gate | SWAP | SWAP × |  |  |

## Dial tiles (42 / 43 / 44)

**RX-dial (42)**, **RY-dial (43)** and **RZ-dial (44)** are a single tile per
rotation axis whose **orientation on the board selects the angle** — "turn the
tile to turn the knob". The tile face is a dial: the four angle labels
(`π/4`, `π/2`, `π`, `−π/2`) sit on the four edges, the active one reading upright
at board-top, with a `▲` marking the canonical (unturned) top edge and the axis
name in the bottom band; the frame is the family colour (RX/RY `#9f1853`, RZ
`#33b1ff`).

Conventions (see `docs/design.md` "Dial tiles" and `markers.quadrant_rotation`):

- Orientation is measured in the **board frame** (rectified through the corner
  homography, not the camera frame): the marker's printed top-left corner is
  mapped to board mm and classified into a quadrant about the marker centroid.
- `r` = clockwise 90° steps from canonical (TL=0, TR=1, BR=2, BL=3).
- **angle = `ROTATION_ANGLES[r]`** → `π/4, π/2, π, −π/2` for `r = 0, 1, 2, 3`.

The dial is emitted **exactly like a classic rotation tile**: an RX-dial at
rotation `r` produces `{type: "RX", parameter: ROTATION_ANGLES[r]}` with id
`rx-<row>-<col>` — byte-identical to the fixed RX tile of that angle, so the
circuit JSON / QASM / simulation are indistinguishable downstream. The tile's
`GateSpec.dial_axis` names the axis; `GateSpec.parameter` stays `None` because
the angle is resolved from rotation at detection time. The stabilizer's key
includes the rotation (`(id, row, col, r)`), so turning a dial in place re-emits
the circuit under the usual asymmetric hysteresis.

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

## SWAP tile (45)

**SWAP (ID 45)** is a single `×` tile printed in the CNOT-family colour
(`#002d9c`) with a `SWAP ×` band caption; the `×` is drawn as a vector glyph
(two thick, round-capped diagonals), like the CNOT `●`/`⊕` glyphs, so it never
tofus in print. **Two `×` tiles in the same column pair into a SWAP between
their rows** — exactly like the CNOT `●`/`⊕` pairing: nearest-unpaired,
deterministic (ties broken by the lower row). More than two `×` in a column pair
the nearest and warn `lone_swap` on the leftover; a single `×` warns `lone_swap`
and is excluded.

`@qamposer/react@0.2` has no native `SWAP` gate type, so the circuit builder
emits a SWAP between rows `a` and `b` (with `a < b`) at column `c` as its
standard **3-CNOT decomposition**, all at the same position `c` and in this exact
array order:

```
cx(a, b), cx(b, a), cx(a, b)   # ids swap-{a}-{c}-1 / -2 / -3
```

The statevector/localAdapter applies gates in array order and `circuitToQasm`'s
stable sort by position preserves it, so the physics and the 3-`cx` QASM are
exactly correct. The builder anchors all three CNOTs at the lower row `a` when
ordering gates so the triple is never reshuffled by control row. The single
place that knows this decomposition is `circuit_builder.emit_swap` (mirrored in
the pocket TS `emitSwap`); switching to a native `{type: "SWAP", control,
target, position}` gate later is a one-function edit.

**Known cosmetic:** because the emission is three CNOTs in one column, the
`@qamposer/react` editor overlap-renders them in a single column. This is
accepted for now; a native SWAP display arrives with the qamposer-react fork
(then `emit_swap` returns one `{type: "SWAP", …}` gate and the overlap goes away).

## Control tile ● (14) as a generic modifier

The control tile **● (ID 14)** is a *generic controlled-gate modifier*. In one
column, a single-qubit gate tile + one ● is that gate's **controlled version**;
the **control** qubit is the ●'s row, the **target** is the gate's row:

| Column contents | Emitted gate | QASM (qelib1) |
| --- | --- | --- |
| ● + `X` (or ● + ⊕) | `CNOT` (`CX`) | `cx q[c], q[t];` |
| ● + `Y` | `CY` | `cy q[c], q[t];` |
| ● + `Z` | `CZ` | `cz q[c], q[t];` |
| ● + `H` | `CH` | `ch q[c], q[t];` |
| ● + `S` | `CS` | `cu1(pi/2) q[c], q[t];` |
| ● + `T` | `CT` | `cu1(pi/4) q[c], q[t];` |
| ● ● + `X` | `CCX` (Toffoli) | `ccx q[c1], q[c2], q[t];` |

**Backward compatibility.** The target half **⊕ (ID 15)** is still a valid
X-target: `● + ⊕ ≡ ● + X`, and the legacy `●`/`⊕` **CNOT pairing** (nearest-
unpaired, deterministic, multiple pairs per column) is unchanged. Note ⊕ only
ever means an X-target — `● ● + ⊕` stays the legacy *one CX + one lone control*
pairing, **not** a CCX (a CCX requires an `X` gate tile).

**CS/CT are controlled-*phase* gates.** Unlike the bare `S`/`T` tiles (emitted as
`RZ(π/2)`/`RZ(π/4)`), the controlled forms emit `cu1(π/2)`/`cu1(π/4)` — the true
controlled-`diag(1, i)` / `diag(1, e^{iπ/4})`. A controlled-`RZ` would carry a
different control-conditional global phase, so the engine applies `S`/`T` (not
`RZ`) as the target unitary, matching `cu1`.

**Ambiguities → excluded with a `control_ambiguous` warning** (the tiles are
never guessed at): ● with two or more gate tiles in its column; two ● with a
gate other than `X`; three or more ●; `● + ⊕ + another gate`; and **`RX`/`RY`/
`RZ` + ●** (no controlled rotations in v1 — dial tiles count as rotations). A ●
with no gate and no ⊕ in its column stays the existing `lone_control` warning.

**Representation & known limitation.** `@qamposer/react@0.2`'s `GateType` has no
controlled gate beyond `CNOT`, so `CY`/`CZ`/`CH`/`CS`/`CT`/`CCX` are carried as
their own gate types in the Circuit JSON (a `CCX` adds a `control2` field) and
applied directly by `shared/quantum` (generic controlled-U via a control mask on
the basis indices) and by `qasm.py` / the pocket `qasm.ts` port (native QASM
above). The library's `CircuitEditor` does not render these types natively, so
in camera mode a controlled gate shows as a plain labelled box without the
control line — a display-only gap, fixed upstream when the fork gains native
controlled-gate types (upstream wishlist). The build-on-screen manual editor can
only place what the library's palette offers (`CNOT` among them), so it cannot
yet express e.g. `CH`.

## Qubit-wire block

ID **46** (`QUBIT_WIRE_ID`) is the **qubit-wire block** — board furniture, not
a gate. Up to five *identical* blocks (all carrying this one ID — the instance
count is the signal, so one printed piece is simply duplicated) sit along the
board's left edge between the UL and LL corner blocks. Each block declares one
qubit wire at its vertical position; blocks are sorted top→bottom into q1…qn.
No wire blocks on the table = the classic fixed 5 wires.

A block counts as a wire only when its centre falls **left of the grid's first
column** in board mm, which keeps a block that wandered onto the lattice from
silently becoming a wire; gate tiles then snap to the nearest wire within half a
cell height. Because ID 46 carries no `GateSpec` it is absent from
`MARKER_TABLE` (so it can never be filed into a cell as a gate) but present in
`markers.DETECTABLE_IDS`, which is what the pocket dictionary export
(`tools/export_dictionary.py` → `pocket-app/src/vision/dictionary.json`) reads —
so the browser detector decodes exactly the same IDs `cv2.aruco` does. See
docs/design.md, "Variable corner placement + qubit-wire blocks".

## Measurement block

ID **47** (`MEASURE_BLOCK_ID`) is the **measurement block** — the right-edge
counterpart of the qubit-wire block, and board furniture just the same. Up to
five *identical* blocks (all this one ID) sit along the board's **right** edge
between the UR and LR corner blocks, so the table reads like a circuit diagram:
state prep on the left, measurement on the right.

Measurement blocks are a pure **refinement**, never a source of wires:

- A wire exists **iff** its left (ID 46) block exists. The wire count is never
  derived from the right side.
- Each right block pairs with the nearest left block by vertical position
  (within half the wire-block pitch). A **paired** wire runs as the straight
  segment through *both* block centres — so a board whose left and right blocks
  sit at slightly different heights gets a tilted wire, and gate tiles snap by
  distance to that segment rather than to a horizontal line.
- A right block with no left partner is ignored and reported as an
  `unpaired_measure` warning (plus a `/debug` entry). Nothing about the circuit
  changes.

Like ID 46, ID 47 carries no `GateSpec`, so it is absent from `MARKER_TABLE`
(it can never be filed into a cell as a gate) but present in
`markers.DETECTABLE_IDS` and therefore in the exported pocket dictionary.

## Reserved

IDs **48–49** (`RESERVED_IDS = range(48, 50)`) are reserved for future tiles.
They are never emitted by the current detector or assets generator, and no
current gate is assigned into this range. (IDs 40/41 are live S/T tiles,
42/43/44 are live RX/RY/RZ dial tiles, 45 is the live SWAP × tile, 46 is the
qubit-wire block and 47 the measurement block — see above.)

## Notes

- **Corners (0–3)** are board fiducials placed TL/TR/BR/BL. Orientation is
  implicit from which corner is which; the board homography works with 3 of 4
  corners visible.
- **Rotation gates (20–31)** encode each angle variant as a *distinct* marker ID
  (π/4, π/2, π, −π/2) rather than a parameterised marker, so a single tile fully
  specifies its gate. Angle labels are rendered by `pretty_angle()` /
  `GateSpec.param_label` so tiles and QASM format angles identically. The **dial
  tiles (42–44)** cover the same four angles per axis with one physical tile,
  choosing the angle from the tile's board-frame rotation instead of the ID.
- **CNOT (14/15)** is split into a control (●) and target (⊕) tile; the two are
  paired within a column by the circuit builder. The ● is also a **generic
  controlled-gate modifier** — see "Control tile ● (14) as a generic modifier".
- Base tile gate types match `@qamposer/react`'s `GateType`
  (`H`, `X`, `Y`, `Z`, `RX`, `RY`, `RZ`, `CNOT`). The controlled forms emitted by
  the ● modifier (`CY`, `CZ`, `CH`, `CS`, `CT`, `CCX`) are additional Circuit-JSON
  gate types with no native `@qamposer/react` equivalent (see that section).
