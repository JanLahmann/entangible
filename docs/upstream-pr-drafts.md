# Upstream PR drafts — QAMP-62/qamposer-react

Drafts for offering the fork's feature branches upstream. **Nothing has been
opened** — these wait for Jan's sign-off (same rule as the QN5 sunset drafts).
All three branches are pushed to `JanLahmann/qamposer-react` and merged into its
`entangible` integration branch; each is a self-contained PR candidate.

Suggested order: PR 1 and PR 2 are independent; PR 3 stacks on PR 1.

---

## PR 1 — `feat/native-s-t-gates` → `main`

**Title:** feat: native S and T gate types

> This adds first-class `S` and `T` phase gates to the gate set (types, palette,
> editor, QASM `s`/`t`, local simulation with diag(1, i) / diag(1, e^{iπ/4})).
>
> Motivation: downstream embedders with fixed physical gate sets (we build
> [Entangible](https://entangible.org), a camera-based tangible composer that
> uses `@qamposer/react` as its display) currently have to emit `RZ(pi/2)` /
> `RZ(pi/4)` equivalents, so the on-screen label doesn't match the tile in the
> visitor's hand. Native types fix label, QASM and matrix in one step.
>
> Note: before merging we'd add S/T rows to the README supported-gates table
> (currently missing on the branch).

## PR 2 — `fix/qasm-format-parameter-zero` → `main`

**Title:** fix: formatParameter emits '0' instead of empty string for near-zero angles

> `formatParameter` strips trailing zeros after `toFixed(6)`; for angles within
> 1e-6 of zero the strip empties the string entirely and the export produces
> invalid QASM like `rx() q[0];`. One-line guard + regression test.

## PR 3 — `feat/controlled-gates` → `main` (stacked on PR 1)

**Title:** feat: first-class controlled gates (CY, CZ, CH, CS, CT, CCX)

> This generalizes the existing CNOT support into a controlled-gate family:
>
> - **Types**: `GateType` grows `CY | CZ | CH | CS | CT | CCX`; `Gate` gains
>   `control2?` (second CCX control). CNOT is untouched — fully backward
>   compatible.
> - **Editor**: the CNOT renderer becomes a generic controlled-gate shape —
>   ● dot per control, vertical line across the span, ⊕ target for CNOT/CCX and
>   a lettered box (Y/Z/H/S/T) for the others; drop previews, selection toolbar
>   and the qubit-assignment editor (incl. a "second control" select for CCX)
>   all generalized.
> - **Palette**: six new tiles in the multi-qubit section; CCX disabled below
>   3 qubits, the rest below 2 — same pattern as CNOT today.
> - **Simulation**: a generic control-mask `applyControlled`; CS/CT are true
>   controlled-phase ops diag(1, i) / diag(1, e^{iπ/4}). CNOT keeps its
>   dedicated legacy path (bit-identical behaviour).
> - **QASM**: emits/parses `cy`, `cz`, `ch`, `ccx` natively and CS/CT as
>   `cu1(pi/2)` / `cu1(pi/4)` (all qelib1.inc); unknown `cu1` angles produce a
>   line error rather than silent data loss.
> - **Keyboard**: the two-step control→target flow works for the whole 2-qubit
>   family; CCX is drag/drop + editor only for now.
> - Two small latent fixes that surfaced during the generalization: the drop
>   "right wall" scan only considered CNOT, and `removeQubit` didn't reindex a
>   Toffoli's second control.
>
> 146 tests pass (was 113); typecheck/lint/prettier/build/size all clean.
> Motivation as in the S/T PR: Entangible's physical control-marker tiles
> (● + gate = controlled gate) already produce these circuit-JSON shapes; this
> makes the library render and simulate them first-class.

## PR 4 — `feat/palette-filter` → `main` (stacked on PR 3)

**Title:** feat: Operations gateTypes filter prop

> Adds an optional `gateTypes?: GateType[]` to `Operations` (threaded through
> the `Qamposer`/`QamposerMicro` presets): embedders can restrict the visible
> palette — sections whose filtered list is empty disappear, library order
> wins, unknown entries are ignored, and the placed-gate editor is unaffected.
> Motivation: Entangible's golf mode unlocks gates round by round (easy = X/H/CX
> only) and tutorial-style embeddings generally want a reduced palette.

## PR 5 — `feat/touch-placement` → `main` (stacked on PR 4)

**Title:** feat: tap-to-place gate placement + coarse-pointer touch targets

> HTML5 drag-and-drop needs a long-press lift on iOS Safari, which makes the
> palette effectively unusable on phones. This adds tap-to-place: tap a tile to
> arm it (`aria-pressed`, visual outline), tap a wire to place at the same
> snapped column drops use; controlled gates collect control → target taps
> (CCX: three) with a pending indicator and a hint line; Escape/re-tap cancels.
> Drag is unchanged — the two inputs share one placement path
> (`planPlacement`/`commitPlacement`, deduplicating the old drop logic). Under
> `@media (pointer: coarse)` palette tiles and the gate toolbar get ≥44px hit
> areas (Apple HIG minimum). 18 new tests.

---

## Follow-ups after any of these merge upstream

- Drop the corresponding merge from the fork's `entangible` branch and rebase it
  onto the new upstream `main` (see FORK.md).
- Once `entangible` (or an upstream release) carries controlled gates, switch
  QAMPoser-physical's `@qamposer/react` dependency from npm `0.2.0` to the fork
  branch / new release so the booth editor draws control lines natively
  (task #55 wants the same switch for the palette-filter prop).
