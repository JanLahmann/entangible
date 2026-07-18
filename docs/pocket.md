# Entangible Pocket — standalone browser demo (iPad-first)

> The whole loop as one static web app, no host process: camera →
> in-browser marker detection → circuit → simulation → celebrations.
> Primary target: **iPad (Safari, landscape on a stand)**; works on iPhone
> and laptops too. Zero install; deployable to qamposer.org and served by the
> kiosk host at `/pocket` for LAN use. Design decided 2026-07-18.

## Why / role

The zero-infrastructure demo of the whole project (design.md "standalone
browser mode" idea): a visitor — or a fair we're not at — points an iPad at
the printed tiles and gets the Entangible experience. It shares the marker
scheme, geometry, quantum engine, moment engine, and the booth-v2 visual
system with the main product. It is NOT a replacement for the booth (no big
screen, no multi-device); it's the pocket edition and marketing surface.

## Architecture

```
pocket-app/                  # Vite + React + TS, static output (pocket-app/dist)
  src/vision/                # TS ports, validated against Python goldens
    dictionary.ts            # OUR marker codes (generated — see below)
    detect.ts                # threshold → contours → quads → sample 6x6 → match
    board.ts, grid.ts        # homography from corners 0-3 (DLT), cell mapping
    circuitBuilder.ts        # port of circuit_builder.py (CNOT pairing, warnings)
    stabilizer.ts            # asymmetric hysteresis (5-of-7 / 12-absent)
  src/app/                   # UI (booth-v2 tokens)
  (imports display-app/src/quantum/{statevector,moments} via vite fs.allow —
   single source, no copies)
tools/export_dictionary.py   # qamposer_vision.markers + cv2 bit matrices → JSON
```

- **Detection**: our own lightweight matcher over the ~24 codes we actually
  use (`DICT_4X4_50` subset). `tools/export_dictionary.py` emits
  `src/vision/dictionary.json` (id → 4×4 bit matrix, all 4 rotations
  precomputed) from the SAME cv2 source as print + Python detection — a
  parity test asserts the export matches `qamposer_assets.marker_bit_matrix`.
  Candidate pipeline (js-aruco2-style, hand-rolled, no WASM): grayscale →
  adaptive threshold → contour trace → polygon approx to quads → perspective
  sample 6×6 → border check → code match with Hamming distance ≤ 1.
  Budget: 1280×720 @ ≥10 fps on an A-series iPad — comfortably within reach;
  detect at half-res with full-res corner refinement if needed.
- **Geometry/logic**: straight ports of `board.py`/`grid.py`/
  `circuit_builder.py` reading the same `assets.toml` values (imported at
  build time as JSON). Golden-fixture tests: the repo's
  `tests/fixtures/circuits/*.json` MUST pass through the TS builder
  byte-identically (same ids, same warnings).
- **Simulation/UI**: reuse `display-app/src/quantum/*` (statevector, moments)
  and the booth-v2 histogram/celebration components' design language.
- **No server**: everything client-side; QASM shown locally; noisy-Run absent.

## iPad UX (booth-v2 tokens, scaled for handheld)

Landscape (primary, ~4:3):

```
┌──────────────────────────────────────────────────────┐
│ En̲tangible pocket        ⬤ camera   [start/stop]     │ topbar
├──────────────────────────────────┬───────────────────┤
│                                  │ camera preview    │
│   recognized circuit (stage)     │ w/ marker overlay │
│   — same controlled editor       │ (tap → fullscreen)│
│                                  ├───────────────────┤
│   strip + celebrations overlay   │ RESULTS (bit-stack│
│                                  │ columns, 0 hidden)│
├──────────────────────────────────┴───────────────────┤
│ hint ticker / warnings                               │
└──────────────────────────────────────────────────────┘
```

- Portrait: stacked — collapsible camera preview on top (thumbnail once the
  board locks), circuit, results.
- Start state: big "Start camera" card (secure-context error card otherwise,
  as in /capture). Camera: `facingMode: environment`, 1280×720.
- The camera preview shows the detection overlay (marker outlines, board
  quad, fps chip) — it doubles as the /debug view here.
- Wake lock while running; PWA manifest + icons so "Add to Home Screen"
  gives a fullscreen standalone app (iPad kiosk-able via Guided Access).
- Moments/celebrations identical to the booth (same engine); confetti capped
  at 100 particles (tablet budget).
- Board affordances: until 3+ corners are seen, a gentle overlay on the
  preview: "Point at the board — all four corners in view".

## Settings, debug, golf (added per Jan, 2026-07-18)

Serverless equivalents of the booth's /debug controls — all local
(localStorage `entangible.pocket.settings`), URL params override
(`?mode=golf&debug=1&panels=camera,results&side=left&lowpower=1`).

- **Settings drawer**: gear pill in the topbar → right-side drawer (panel
  styling): MODE (composer | golf pills), PANELS (camera preview / results /
  state / qasm toggles — state+qasm ported from the booth), sidebar side,
  low-power (confetti cap 60, process every 2nd frame), debug toggle.
- **Debug panel** (toggle or `?debug=1`): detect stats (candidates, blind,
  guided rescues, fps, corners, reprojection error), marker table
  (id/gate/row/col/off-grid), warnings verbatim, active detector params
  (read-only). Appended below the other panels; visitors never see it.
- **Golf mode (MVP — first playable golf!)**: holes = 1 Superposition
  (H on any qubit, par 1), 2 Bell (par 2), 3 GHZ-3 (par 3), 4 GHZ-4 (par 4),
  5 GHZ-5 (par 5). Sidebar becomes: **Q-SPHERE (2D)** — static SVG flat
  projection: concentric rings by Hamming weight 0–5, nodes on rings, node
  radius ∝ |amplitude|, fill hue = phase, target-state nodes outlined in
  `--entangle` purple; **SCORECARD** — hole name + target ket, par, strokes
  (= gates on board), live fidelity %, best-of-device (localStorage); the
  **recognized circuit stays on the stage** (golf never hides it). Hole-in at
  fidelity ≥ 0.99 → purple banner ("EAGLE!/BIRDIE!/PAR!/HOLE IN +n" by
  strokes vs par) + confetti; clearing the board advances to the next hole.
  Animated state evolution deliberately absent (that's qsphere-evolution).

## Qubit count: 3 by default, 5 on demand (per Jan, 2026-07-18)

- Setting `qubits: 3 | 5` (segmented control in the drawer; URL `?qubits=5`),
  **default 3** on first run; persisted choice wins. Simpler first contact:
  3 wires, ≤8 outcomes, less visual noise — full power one toggle away.
- Active rows = the TOP `qubits` rows of the unchanged physical mat. Tiles
  detected on sleeping rows are excluded with a friendly warning ("q3 and q4
  are asleep — wake them in settings (5 qubits)"), warning code
  `row_out_of_range`.
- Everything derives from the count: `circuit.qubits`, editor wires, QASM
  `qreg q[N]`, histogram outcome space (uniform case at 3 qubits = 8 normal
  columns — no micro mode needed), moments' "every row carries an H" rule,
  and golf (holes with k ≤ N; a muted scorecard row invites switching to 5
  for holes 4–5).
- `display-app/src/quantum/statevector.ts` generalizes from the fixed
  NUM_QUBITS=5 to `circuit.qubits`-driven dimensions (booth keeps passing 5 —
  behavior there unchanged until the booth gains its own setting, tracked
  separately).

## Deployment

- `npm run build` → static `pocket-app/dist`.
- Kiosk host serves it at `/pocket` (same origin; the /debug QR card gains a
  second QR later). qamposer.org deployment is a copy of `dist/` (real HTTPS
  → no cert tap-through at all).

## Verification

- Unit: dictionary parity vs Python (generated JSON vs cv2 matrices);
  quad sampling + rotation matching on synthetic 6×6 grids; homography DLT vs
  known point sets; circuit-builder goldens (all fixtures incl. warnings
  cases); stabilizer scripted sequences (same cases as Python).
- Integration (no camera): feed PNG frames rendered by
  `tests/utils/make_recording.py` through the full TS pipeline in vitest
  (node canvas or raw RGBA decode) → empty → H → Bell, occlusion stable.
- Real device (Jan, with printed kit): iPad Safari — start camera, board
  lock, Bell build → celebration; Add-to-Home-Screen; fps ≥ 10.
