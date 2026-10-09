# Extending Entangible: adding a new gate tile

The checklist for giving the board a new physical tile. The architecture keeps
one source of truth per concern, so most steps are "add one entry and let the
gates fail until everything agrees" — the suites are deliberately built to
catch a half-added tile (totality tests, parity gates).

Work through the list in order; run the full gates
([`CONTRIBUTING.md`](../CONTRIBUTING.md)) at the end.

## 1. Identity

- [ ] **Pick a marker ID** — a *free* ID in `DICT_4X4_50`, assigned explicitly
  (never by range). Check [`marker-ids.md`](marker-ids.md): 48–49 are reserved
  for exactly this; 11/14 are free. If the ID's bit pattern happens to echo the
  glyph, prefer it (see "Why these IDs" there) — but IDs already printed in a
  released kit are frozen.
- [ ] **`MARKER_TABLE`** in
  `packages/qamposer-vision/src/qamposer_vision/markers.py` — the single
  source of truth for *both* detection and print. Add the `GateSpec`
  (kind, gate, label, angle/role if any).
- [ ] **Update [`marker-ids.md`](marker-ids.md)** — the ID table must match the
  code (`test_markers.py` pins the documented IDs).

## 2. Detection (Python + browser parity)

- [ ] **Circuit builder** — `packages/qamposer-vision/.../circuit_builder.py`:
  how the tile becomes a circuit column (pairing rules, warnings it can
  raise). New warning kinds need friendly copy + an audience
  (`shared/display/warnings.ts` `WARNING_AUDIENCE` — its totality test fails
  until every kind has both).
- [ ] **Pocket mirror** — the TS twins in `pocket-app/src/vision/`
  (`markers.ts`, `circuitBuilder.ts`) must match the Python behavior; the
  dictionary/geometry JSONs are regenerated with
  `uv run python tools/export_dictionary.py`
  (`tests/test_pocket_dictionary_parity.py` fails loudly until you do).
- [ ] **Gate type downstream** — if the gate is new to the editor, check
  `@qamposer/react`'s `GateType` and the Circuit-JSON mapping (see the
  "controlled forms" note in [`marker-ids.md`](marker-ids.md)); the QASM
  export and the simulator must both understand it.

## 3. Physical artifacts (print / laser / paper)

- [ ] **Tile art** — `packages/qamposer-assets/` (`symbols.py`,
  `tile_face.py`): the top-face glyph; cube side faces get the gate name
  inlay automatically from the same spec.
- [ ] **Kit quantities** — `assets.toml` `[kit]`: how many of the new tile the
  32-tile booth kit ships (this one table drives colour, mono, b/w 3D kits,
  the laser sheets and the paper kit).
- [ ] **3D forms** — `hardware/src/qamposer_hardware/` picks the tile up from
  the shared config; check plate packing still fits
  (`uv run qamposer-hardware plates`, AMS slot rule: ≤2 accents on colour
  plates).
- [ ] **Cheat sheet + Guide** — `cheatsheet.py` (and the dial-rule lines if it
  is a dial-like tile); the app's Guide page counts
  (`pocket-app/src/app/GuidePage.tsx`).

## 4. Examples and release

- [ ] **Example boards** — `tools/make_example_boards.py` +
  `examples/test-boards/` if the tile should appear in a ready-made board.
- [ ] **Regenerate committed artifacts** and cut a **`kit-N` tag** — art or
  kit changes without a new tag is exactly how kit-8 went stale
  (`.github/workflows/artifacts.yml` header has the rule).

## 5. Tests you must leave behind

- The totality suites will already be failing wherever you missed a step —
  that is by design. Add on top:
  - a detection test placing the new tile on a fixture board,
  - a circuit-builder test for its pairing/warning rules (Python **and** TS),
  - and, for any orientation/sign convention the tile introduces, the
    convention test *written at design time* (project discipline — see
    CONTRIBUTING).
