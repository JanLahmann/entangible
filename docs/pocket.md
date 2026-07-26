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
  (imports shared/quantum/{statevector,moments} via / aliases —
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
- **Simulation/UI**: reuse `shared/quantum/*` (`@quantum`: statevector, moments)
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
  as in the camera role). Camera: `facingMode: environment`, 1280×720.
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
  CAMERA (device picker), BOOTH (host field + connect — see "Display role"
  below), low-power (confetti cap 60, process every 2nd frame), debug toggle.
- **Debug panel** (toggle or `?debug=1`): detect stats (candidates, blind,
  guided rescues, fps, corners, reprojection error), marker table
  (id/gate/row/col/off-grid), warnings verbatim, active detector params
  (read-only). Appended below the other panels; visitors never see it.
- **Golf mode**: the 18-hole course of `@quantum/golf` (four rounds — Easy
  E1–E5, Medium M1–M5, Difficult D1–D5, Extra X1/X3/X5; see
  [`booth-ux.md`](booth-ux.md) "The course"). Sidebar becomes: the **sphere**
  (`EvolvingState` — Bloch on 1-qubit holes, Q-sphere above, both captioned;
  dashed target ghost rings + phase ticks + ket labels, roll-the-ball evolution
  with a per-column scrubber, opening neutral at `|0…0⟩` up, #75) with the
  live **State / Target** bra-ket lines under it; a **Course** picker
  (Classic 18 / Random 18); and the **SCORECARD** — hole code + name, clubs,
  target ket, par, strokes, live fidelity %, per-hole best (localStorage),
  running total-vs-par, and the round-grouped 18-chip result strip. The
  **recognized circuit stays on the stage** (golf never hides it).
  - **Strokes** = every gate added *and* deleted since the hole was teed off
    (#68) — a retry costs, like real golf; moving a tile between columns is
    free, rewiring/retyping costs 2. Sweeping the board mid-hole keeps counting
    (#73); only *leaving* the hole (hole-in advance, course-complete clear,
    post-course restart) tees the next one off at zero with an empty baseline,
    so a teardown never lands on the next hole. **Par = minimum + 2** (#69), so
    minimum play scores an eagle and one extra a birdie; classic course par 101.
  - **Hole-in** at fidelity ≥ 0.99 → purple banner ("EAGLE!/BIRDIE!/PAR!/
    HOLE IN +n" by strokes vs par) + confetti; clearing the board advances.
    Finishing hole 18 fires a celebration whose intensity and wording scale
    with the round's total vs par (#80: legendary at −18 or better, then under /
    even / over). In build-on-screen mode a **Next hole ▸** button by the sphere
    and on the card does the clearing instead (camera keeps the physical ritual).
  - **Solutions** (#71/#72/#79): "Show solution" draws the hole's worked answer
    as an inert mini circuit — offered on the hole-in, and mid-hole once the
    player is stuck (`par + 3` strokes, or 60 s after the hole's first stroke).
    A background optimal search then draws anything shorter, or relabels the
    stored answer "Solution — optimal"; budget exhaustion says nothing.
  - **Random course** (#70/#76/#77/#78): "Random 18" deals generated targets
    over the same round/level structure, drawn from each round's own clubs and
    filtered so each round plays like its name (no dead wires, per-round phase
    vocabulary, a readable ket, a difficulty floor above `level` gates, and the
    round's added clubs genuinely required) — see the
    `shared/quantum/golfRandom.ts` header for the full rule set. Par is the
    computed minimum + 2. The base seed is the course: it is shown as a base-36
    **Course #…** chip that copies a `?course=<code>` link, and typing a code
    into **Settings → Golf course code** deals the identical eighteen holes.
    Random bests are session-only (never written to the device card).

## Input modes — camera · manual · booth-connected

The standalone pocket app has three ways in to the *same* downstream (editor,
histogram, state/qasm, golf, celebrations, Transfer) — all behind the
`StateSource` seam, so simulation and golf behave identically whichever feeds
them:

- **camera** (default): the on-device vision pipeline (`LocalPipelineSource`) —
  point at the printed board, tiles build the circuit.
- **manual** (`ManualEditSource`; setting `input: camera | manual`, URL
  `?input=manual`): the *no-printer, no-camera* fallback. The camera UI is
  hidden entirely and `@qamposer/react`'s **native on-screen editing** drives
  the circuit — the library's gate palette (`Operations`) plus drag-to-place on
  the wires. Each edit flows through the same `applyUpdate`, so results, golf
  and the Composer handoff all work (play Quantum Golf with on-screen gates).
  The register is pinned to the physical **5 qubits** (`maxQubits: 5`); the
  wires setting still collapses empty trailing wires for the view, so to reach
  q3/q4 switch **Wires → all 5**. Palette gate set (the entangible fork):
  H, X, Y, Z, S, T, RX/RY/RZ, CNOT, CY, CZ, CH, CS, CT, CCX — rotation angles
  are typed per-gate, default π/2. In **golf** the palette is narrowed to the
  round's clubs (`clubGateTypes`, #55), so it teaches the round instead of every
  gate the library knows; outside golf the full set shows. Discovery points: the
  camera-idle start screen's *"No camera? Build on screen"* button, and
  **Settings → Input**.
- **Touch placement (#61)**: dragging a palette tile onto a wire is awkward on a
  phone, so the fork also supports **tap-to-place** — tap a palette tile to
  *arm* it (it renders `aria-pressed`), then tap a wire to drop the gate in the
  tapped column. A controlled gate collects its **control** wire first and then
  its **target** (CCX: two controls, then the target), with a hint line above
  the circuit naming the next expected tap; the column is locked by the very
  first tap. Re-tapping the armed tile, or **Escape**, cancels. A tap on a
  placed gate opens the library's gate toolbar (edit — rotations and controlled
  gates only — and delete). Drag-and-drop is untouched, and a drag disarms.
- **booth-connected** (`BoothSocketSource`, read-only viewer — see below):
  follows a booth host over `/ws/state`.

**Precedence**: a connected booth viewer (`?connect=1` / a booth link) ALWAYS
wins over `?input=manual` (`resolveActiveInput`); manual and camera never run
at once. The staff camera role and the kiosk/`/debug` surfaces are unaffected.

## Display role — follow a booth (Entangible One, U1b)

The pocket app has two roles behind one shell (docs/design.md "Entangible One").
**Standalone** is the default: the on-device camera + TS pipeline drive the
display (everything above). **Display (viewer)** connects to a booth host over
`/ws/state` and renders the booth's live circuit/state through the *exact same*
downstream (editor, histogram, state/qasm, golf, celebrations, Transfer — the
booth-built circuit leaves on the visitor's phone, take-it-home T2).

- **State-source seam** (`src/sources/`): a `StateSource` yields neutral
  `StateUpdate`s (`{circuit, warnings, source, qasm?, boothMode?, boothWires?,
  connection?}`). `LocalPipelineSource` is a thin adapter the camera frame loop
  feeds (`ingest(result)` → emits on `result.changed`, no behavior change);
  `BoothSocketSource` wraps the shared `@shared/ws` client (moved there from the
  display app) and maps circuit/detection/layout messages → updates. `App`
  subscribes to whichever is active and runs the identical moment/golf logic on
  both. (`ManualEditSource` is a separate later task.)
- **Connect triggers**: (a) *served-by-host* — the app's own origin answers
  `GET /api/info`, so the topbar offers "Connect to booth"; (b) *visitor QR* —
  `…/pocket?connect=1` auto-connects to the serving host on load; (c) *manual* —
  the drawer's BOOTH field takes `wss://host:8443` / `https://host:8443` / a
  bare `host:8443` (normalized to the `/ws/state` URL; persisted in settings,
  also `?booth=…`).
- **Viewer policy (read-only)**: the pocket viewer NEVER sends a control message
  (no camera/mode/layout swaps — it connects as a plain `hello {role:'display'}`
  with no operator key). While connected the camera UI is hidden (video, zoom,
  freeze, camera picker) and only a "Connected to booth · viewing" pill +
  Disconnect show; local-only interactions stay (tap-to-inspect, sphere
  rotation, panel toggles, Transfer). The booth's `mode`/`wires` (when
  broadcast) override the local settings. Disconnect returns cleanly to the
  standalone pipeline (the camera resumes if it was running).

## Camera role — be the booth's camera (Entangible One, U2)

A third role behind the same shell (docs/design.md "Entangible One"): a staff
phone serves as the booth's **camera**, streaming JPEG frames to the host with
pocket's richer camera UI, while the host does the detection. This absorbed the
former display-app `/capture` page (removed in U3 — the camera role is now the
only phone-camera path).

- **Trigger / gating** (design: "connected to a host, camera role selected"):
  the role is offered ONLY when a booth host is known (served-by-host `/api/info`
  probe, or a saved BOOTH URL) AND an **operator key** is present. The staff QR
  encodes `…/pocket?connect=1&role=camera&key=<token>` and auto-enters the role;
  the manual path is **Settings → Booth → "Use this phone as the camera"**. A
  plain visitor (no key) NEVER sees the affordance — standalone entangible.org
  shows zero new UI.
- **Behavior** (`src/sources/CameraRoleSource.ts`): the local vision pipeline
  STOPS; `useCamera` runs a streaming loop that draws the zoomed crop (native
  density) to a canvas and hands it to the shared streaming core
  (`@shared/capture` — `StreamController` pacing + `FrameStreamer` `/ws/frames`
  socket with reconnect + backpressure). The camera UI stays live: **preview**,
  **pinch/step zoom** (what you zoom is what streams, matching the former /capture),
  **freeze** (❄ pauses the frame pump), **camera picker** (Continuity Camera).
  It also connects to `/ws/state` as an operator `camera` (`hello {role:'camera',
  key}`) and sends `select_camera {kind:'push'}` so the host hot-swaps onto the
  push source and lists the phone in its `/debug` camera fleet. A **Streaming to
  booth · N fps** pill + **Stop** show; Stop returns to standalone (the still-
  running camera resumes the local pipeline).
- **Frame the mat** (booth-table setup helper; task #34): with a dedicated
  overhead camera you rarely want the whole scene on the wire. Tapping **▣ Frame
  the mat** runs the local ArUco detector ONCE, takes the bounding box of the four
  corner markers (ids 0-3) expanded by a ~12 % margin (`@shared/capture/matRoi` —
  the margin keeps every fiducial *and its quiet zone* inside the crop so the
  host homography still locks), flashes the region for ~1.5 s, then locks the
  stream to it: the `onFrame` sink draws that mat ROI instead of the full/zoomed
  frame. Wins: **bandwidth** (a remote camera streams only the mat), **detection
  speed** (host works a smaller frame), and **privacy** (hands/faces outside the
  mat never leave the phone). A **Mat only** badge (with ✕ to unlock) shows and
  the zoom pill hides — the mat crop replaces digital zoom while locked. It is a
  rough axis-aligned crop, not a warp; re-tap to re-detect after a nudge. The lock
  is session-only (a physical re-aim invalidates it) and freeze still pauses the
  pump regardless. On failure (fewer than three corners in view) a toast asks for
  all four corners and the stream stays unlocked.
- **Security**: operator-gated end to end. The key arrives via `?key=` (shared
  `@shared/ws/operatorKey`), is stored in `localStorage`, and is immediately
  scrubbed from the address bar (`history.replaceState`) — never rendered into
  the UI and never carried into a shared link.

## Wire display: compact by default (revised per Jan, 2026-07-18)

**Display-only** — the physical table is always 5 qubits; detection, circuit
JSON (`qubits: 5`), QASM (`qreg q[5]`), moments, and golf are untouched.

- Setting `wires: compact | all` (drawer: "Wires: auto | all 5"; URL
  `?wires=all`), default **compact**: the editor shows
  `max(3, highest used row + 1)` wires — 3 on an empty board, auto-expanding
  the moment a tile lands on q3/q4 (real tiles are never hidden), contracting
  when removed (stabilizer keeps this non-flickery). `all` pins 5.
- Implemented as a pure display transform (`{qubits: D, gates}` fed to the
  controlled editor).
- **Histogram follows the displayed qubits** (per Jan): at D = 3, always show
  all 8 basis states in basis order — zeros as dim stubs, fixed axis, so
  probability visibly moves between columns. At D ≥ 4, the scale strategies
  apply (zeros hidden, top-6 + tail, uniform pattern).

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
