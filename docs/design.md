# Entangible (né QAMPoser-physical) — Physical Quantum Circuit Composer

> Design approved 2026-07-11 (planned in Claude Code on the web, ultraplan session). Implementation follows milestones M1–M6 below.

## Context

QAMPoser (github.com/QAMP-62) is an open-source, embeddable quantum circuit composer (like IBM Quantum Composer): `@qamposer/react` (TS/React editor + Q-sphere/histogram, OpenQASM 2 utils, pluggable `SimulationAdapter`, in-browser `localAdapter`) and `qamposer-backend` (FastAPI + Qiskit 2.x for noisy/real simulation). This new repo (**entangible**, formerly QAMPoser-physical, empty at design time) adds a *tangible* composer: visitors at events/fairs/booths build circuits on a table from printed gate tiles on a printed board mat; a camera recognizes the layout and a big screen shows the live circuit and simulation results. Hosts: Raspberry Pi 4/5 (RasQberry.org, Bookworm 64-bit) and macOS; cameras: USB/Pi Camera, Mac Continuity Camera (iPhone as webcam), and iPhone browser streaming to the host.

**Decided with the user:** ArUco fiducial markers on tiles (not symbol ML); v1 physical kit is printed PDF tiles + board mat (3D-printed STLs later, sharing the tile-face design); all three camera paths; the vision component is Python and feeds the existing `@qamposer/react` UI in controlled mode (no new editor); circuits also exposed as OpenQASM 2; **realtime simulation is noise-free in-browser via `localAdapter` — no backend required**; `qamposer-backend` is an *optional* add-on for noisy/real-hardware runs via `qiskitAdapter`.

## Architecture

```
USB / PiCam / Continuity ─┐
                          ├─▶ qamposer-vision ─────▶ ┌─────────────────────────────┐
iPhone browser ───────────┘   (Python / OpenCV      │ qamposer-physical-host      │
  /capture page, JPEG          ArUco pipeline,      │ (FastAPI, HTTPS :8443)      │
  frames over /ws/frames       in-process thread)   │ • /ws/state broadcast hub   │
                                                    │ • serves display app        │
                                                    │ • /qamposer-api/* proxy ────┼──▶ qamposer-backend
display-app (React) ◀───────────────────────────────┤   (only if enabled)         │    (OPTIONAL, own venv,
  @qamposer/react                                   └─────────────────────────────┘     Qiskit/Aer :8001)
  controlled mode; realtimeAdapter = localAdapter (in-browser, default)
```

- Vision runs as a worker thread inside the FastAPI app (no IPC); a standalone `qamposer-vision detect` CLI exists for dev/testing.
- Single HTTPS origin `https://<host>:8443` (iPhone `getUserMedia` requires secure context): display app at `/`, phone capture at `/capture`, diagnostics at `/debug`, WebSockets under `/ws/*`. Self-signed cert auto-generated on first run (SANs = hostname + LAN IPs); QR code on screen links phones to `/capture`.
- **Default mode needs no backend**: `realtimeAdapter={localAdapter()}` simulates ideally in the kiosk browser on every stable circuit change. When the backend is enabled (`--backend spawn|url|off`), the host reverse-proxies it at `/qamposer-api` (same origin → no CORS/mixed-content) and the UI offers "Run on noisy/real backend" (`profile: {type:'noisy_fake'|'real'}`).

## Repo layout (uv workspace + one npm app)

```
pyproject.toml            # uv workspace root
assets.toml               # physical dimensions (mm) — single source of truth for print AND detection
packages/
  qamposer-vision/        # Python ≥3.11: opencv-python-headless ≥4.8, numpy
    src/qamposer_vision/{markers,sources,board,grid,detector,stabilizer,circuit_builder,qasm,pipeline,annotate,cli}.py
  qamposer-physical-host/ # Python ≥3.11: fastapi, uvicorn, httpx, qrcode, cryptography
    src/qamposer_host/{main,config,hub,ws_state,ws_frames,proxy,preview,certs,static,cli}.py
  qamposer-assets/        # printable asset generator: SVG source of truth, cairosvg → PDF
    src/qamposer_assets/{config,marker_svg,tile_face,symbols,sheets,board,cli}.py
display-app/              # Vite + React + TS + @qamposer/react ^0.2
  src/{main.tsx, ws/{stateSocket,messages}.ts, booth/{BoothView,Celebrations}.tsx,
       debug/DebugView.tsx, capture/CaptureView.tsx}
docs/{protocol.md, marker-ids.md, printing.md, rasqberry.md}
deploy/{rasqberry/install.sh, systemd/*.service, kiosk/start-kiosk.sh}
hardware/                 # M6 stretch: STL/3MF sources consuming tile-face SVGs
tests/                    # fixtures (golden circuits, synthetic + real images, recordings) + unit suites
```

## Key component designs

**Markers (`markers.py`, `docs/marker-ids.md`)** — `DICT_4X4_50` (largest bits per mm; `cv2.aruco` is in the main opencv module since 4.7). ID table: 0–3 board corners (TL/TR/BR/BL — orientation implicit); 10–13 H/X/Y/Z; 14/15 CNOT control ●/target ⊕; 20–31 RX/RY/RZ × angle variants (π/4, π/2, π, −π/2) as distinct IDs; 40–49 reserved (S/T/SWAP later). One `MARKER_TABLE: dict[int, GateSpec]` imported by *both* the detector and the assets generator so print and detection can never drift.

**Frame sources (`sources.py`)** — `FrameSource` protocol with: `Cv2CaptureSource` (USB webcams, Mac cams, Continuity Camera — a normal AVFoundation device; add `list-cameras` helper), `Picamera2Source` (required on Bookworm — `cv2.VideoCapture` does NOT see libcamera CSI cams; needs venv with `--system-site-packages`), `PushFrameSource` (latest-frame slot fed by `/ws/frames`), `ReplaySource` (fixtures → no-camera dev mode and CI).

**Board + grid (`board.py`, `grid.py`)** — homography from all 16 corner-marker points (`findHomography` + RANSAC), cached until corners drift; works with 3 of 4 corners. `BoardConfig` from `assets.toml`: 5 rows (qubits, matches `@qamposer/react` default `maxQubits`) × 8 columns, 70 mm pitch, 60 mm tiles, 36 mm tile markers (revised from 40 mm at implementation: preserves the ArUco quiet zone alongside a legible label band — see docs/assets-design.md; board corner markers stay 40 mm). Cell mapping rejects off-grid tiles instead of misfiling. Geometry margin: camera ~70–90 cm above at 720p → ~11–16 px per ArUco bit vs ~2 px needed.

**Detection + stabilization** — one `ArucoDetector` (subpixel corner refinement) per frame; target 1280×720 @ 10–15 fps on Pi 4 (ArUco 4×4 ≈ 15–35 ms/frame; option to detect at half-res). Asymmetric hysteresis so hands don't cause flicker: a tile *appears* after ≥5 agreeing of 7 frames (~0.5 s), *disappears* only after 12 consecutive absent frames (~1 s); circuit emitted only on real deep-equality change.

**Circuit building (`circuit_builder.py`)** — per column: single-qubit tiles → `{type, qubit: row, parameter?, position: col}`; CNOT = ● + ⊕ tiles in the same column, paired deterministically (nearest unpaired target by row); unpaired/conflicting tiles are *excluded with warnings* (shown on `/debug` and as a gentle booth banner), never guessed. Deterministic gate IDs (`h-0-0`, `cnot-1-0`) keep React identity stable across emissions. Output = exact `@qamposer/react` `Circuit` JSON + OpenQASM 2 (Python port of `circuitToQasm`).

**WebSocket protocol (`docs/protocol.md` ⇄ `ws/messages.ts`)** — server pushes `{type:'circuit', seq, circuit, qasm, source}`, `{type:'detection', fps, board, markers, warnings}` (throttled 5 Hz), `{type:'status', camera, backend, clients}`; latest circuit+status replayed to late joiners; clients send `hello` and `select_camera`.

**Display app** — `QamposerProvider` controlled mode (`circuit` from WS store; on-screen editing disabled — the table is the source of truth). *Revised at M3 — INTERIM:* `@qamposer/react@0.2` ships the editor and the visualization preset as separate bundles with incompatible React contexts, so the booth view temporarily uses the controlled `CircuitEditor` (main bundle) plus a lightweight statevector-driven histogram (88 kB gzip vs 1.6 MB, Pi-friendly). **Per Jan (2026-07-18): reusing qamposer components is preferred and the Q-sphere is wanted back** — the proper fix is upstream in qamposer-react (export `ResultsPanel`/`QSphereView`/`Histogram` from the main bundle, or have both entries share one context), after which the booth view returns to the real panels; keep the local histogram only as a low-power fallback (`?lowpower`); `realtimeAdapter=localAdapter()`; optional `adapter=qiskitAdapter({baseUrl:'/qamposer-api'})` with the Run control hidden unless `/api/health` reports a backend. Celebrations: Bell/GHZ-state detection → confetti + "Entanglement!" banner. `/debug`: annotated MJPEG preview + marker/warning table for booth-staff calibration. Built `dist/` is bundled into the host wheel — the Pi never needs Node.

**Printable assets (`qamposer-assets`)** — vector ArUco (bit matrix from `getPredefinedDictionary` → SVG rects, crisp at any size); tile SVGs with semantic layers (outline/marker/symbol) so M6 can extrude STLs from the same faces; tile cut-sheets (A4/A3/Letter, crop marks, per-gate quantities) and board mat (single-page for print shops + multi-page tiled with registration marks for home printers; CNOT pairing rule printed on the mat). SVG→PDF via cairosvg (system libcairo documented; svglib/reportlab fallback).

## Packaging & deployment

- **Mac dev**: `make dev` = `uv sync` + npm install + uvicorn (reload) + vite dev (proxying `/ws`, `/qamposer-api`). `make demo` = full stack on `ReplaySource` — no camera or printed board needed.
- **Python versions**: our three packages target ≥3.11 (Bookworm system Python, needed for picamera2 via `--system-site-packages`). `qamposer-backend` requires 3.13 → when enabled on Pi, it gets its own uv-managed 3.13 venv (`uv python install 3.13`, aarch64 fine); launcher hides the split. Also file an upstream issue to relax backend to ≥3.11. If qiskit-aer aarch64 wheels fail at pin time → backend off, localAdapter-only (still fully functional).
- **RasQberry-Two**: `deploy/rasqberry/install.sh` following their demo-install pattern (apt: python3-picamera2, libcairo2, chromium; venv; pip install host wheel; optional backend venv; systemd units; menu entry). One command: `qamposer-physical run --kiosk` → start host (+ optional backend), wait for `/api/health`, launch `chromium --kiosk --ignore-certificate-errors https://localhost:8443/`.

## Milestones (each independently demoable)

1. **M1 – Assets + static detection**: PDF tile sheets + board mats; `qamposer-vision detect --image photo.jpg --json --qasm`; synthetic render→detect→golden-JSON tests green. *Demo: photograph a printed board, get correct QASM.*
2. **M2 – Live loop**: pipeline + stabilizer + host + display app; local camera → WS → live `@qamposer/react` circuit; `/debug`; `make demo` replay mode. *Demo: move tiles, screen follows.*
3. **M3 – Simulation**: localAdapter realtime results + celebrations + booth polish; optional backend proxy + noisy Run. *Demo: build a Bell pair, confetti.*
4. **M4 – iPhone browser camera**: `/capture` page (getUserMedia → JPEG over `/ws/frames`, backpressure via `bufferedAmount`, wake lock), HTTPS cert story + QR; verified on iOS Safari against Mac and Pi hosts.
5. **M5 – RasQberry packaging**: install script, launcher, systemd + kiosk, perf validation on Pi 4/5, `docs/rasqberry.md`.
6. **M6 (stretch)**: STL/3MF tiles from shared SVG faces; marker-less symbol-recognition mode; SWAP tiles from reserved IDs.

**S/T tiles (pulled forward from M6, per Jan 2026-07-18):** marker IDs 40 (S) and 41 (T), Z-family color. Until `@qamposer/react` gains native S/T gate types, the detector emits them as their RZ equivalents — S → RZ(π/2), T → RZ(π/4) — so simulation/QASM work unchanged (QASM shows `rz(pi/2)`, screen shows RZ(π/2)); tile faces are labeled S/T. Upstream issue: add native S/T to qamposer-react (gate table + matrices + `s`/`t` QASM), then drop the mapping.

**Upstream track (asynchronous, non-blocking — per Jan 2026-07-18):** all qamposer-react/-backend changes require coordination with the other QAMPoser developer; ready-to-post issue drafts live in docs/upstream-wishlist.md (panel exports/unified contexts → Q-sphere returns, native S/T, controlled gates, formatParameter fix, backend ≥3.11). Entangible does NOT block on this: M4→M5 proceed with the interim histogram; when an upstream release lands, swap the booth view back to the real panels and return realtime simulation to the adapter path (our statevector stays for moment detection + `?lowpower` fallback). **Hardware-validation prerequisite for M4/M5:** print the M1 kit (tiles + mat) — all testing so far is synthetic; real-photo fixtures should join the suite once printed. **M4 addition:** document the Mac-hosted booth setup (macOS application firewall allowance, TLS) — discovered 2026-07-18 that LAN access on a Mac host needs explicit firewall approval.

**Arbitrary controlled gates (planned extension, needs upstream):** physical rule "● + any single-qubit gate tile in the same column = controlled-that-gate" (ctrl-H, ctrl-Z, ctrl-RZ…; ⊕ remains the X-target shorthand). Vision-side pairing is a small change; blocked on `@qamposer/react` supporting controlled single-qubit gates (the Gate JSON already carries generic `control`/`target` fields, but editor/localAdapter/QASM only handle CNOT). Track as qamposer-react feature first.

### Idea (unscheduled): standalone browser mode — runs on an iPhone

A zero-install variant of the whole loop as a single static HTTPS page (e.g. hosted on qamposer.org): camera via `getUserMedia`, ArUco detection in the browser (OpenCV.js/WASM or js-aruco2), circuit building in TS, display + `localAdapter` simulation as in the main display app. Runs on anything with a camera and a modern browser — notably an iPhone pointed at the tiles becomes a complete "pocket demo" (recent iPhones are far faster than the Pi 4 perf budget; hosting on a real domain also sidesteps the self-signed-cert story). Shares `MARKER_TABLE`, `assets.toml` geometry, and the printed tiles/mat with the main system; the TS circuit-builder port is validated against the Python golden fixtures. Deliberately *not* the primary architecture: it can't reach the Pi CSI camera (libcamera isn't visible to `getUserMedia`), and a phone screen can't replace the 3 m booth display (AirPlay mirroring reintroduces a second device; a kiosk Pi is more robust all-day). Positioning: an extra deployment target/marketing demo alongside M6, after the marker scheme and assets are stable (post-M1) and ideally reusing M3's display components.

### Dial tiles — IN BUILD (per Jan 2026-07-18, software side first)

Three NEW tiles, coexisting with the normal rotation tiles: marker IDs
**42 = RX-dial, 43 = RY-dial, 44 = RZ-dial** (from the reserved range;
RESERVED shrinks to 45–49). The tile's orientation ON THE BOARD selects the
angle. Conventions: orientation is measured in the board frame (rectified via
the homography, not the camera frame); rotation index r = clockwise 90° steps
from canonical; **angle = ROTATION_ANGLES[r]** (π/4, π/2, π, −π/2). Face
design: marker centered, the four angle labels on the four edges placed so the
ACTIVE angle always reads upright at the top edge (board-top), with a small ▲
pointer; family colors (RX/RY magenta, RZ light blue) as a full frame.
Stabilizer/pipelines: for dial IDs the stability key includes the rotation —
turning a tile in place must re-emit the circuit (with hysteresis, like any
change). Emission stays `RZ/RX/RY(parameter)` — indistinguishable downstream
from the classic tiles. 3D/dial hardware follows later.

### Idea (unscheduled): rotation-as-dial tiles

Per Jan's question 2026-07-18: detection already recovers each marker's 90°-step orientation (both cv2 and the pocket TS detector match all 4 rotations) — but we discard it. Use it: **one rotation tile per axis**, where the placed orientation selects the angle (0°/90°/180°/270° → π/4, π/2, π, −π/2). Tile face redesign: dial-style, angle labels on all four edges, current-angle at top. Replaces 12 rotation tiles with 3; "turn the tile to turn the knob" is the most physical parameter control imaginable. Touches: detector APIs (expose rotation), circuit builder (angle from orientation), tile-face + 3D generators, marker-ids docs. Non-rotation tiles stay orientation-free. Caveat: hysteresis/stabilizer must treat orientation changes as gate changes (re-emission), and accidental slight rotations must snap to quadrants (they do — 90° steps).

### Idea (unscheduled): adaptive qubit count on the display

Per Jan 2026-07-18: trim unused qubits from the on-screen view. The board keeps 5 physical rows and the wire circuit always reports `qubits: 5`, but the display could show only rows `0..max_used` (collapse trailing empty wires, min 2 for composure, gentle expand/collapse animation as tiles appear on lower rows). Biggest win is the **histogram**: a 2-qubit circuit reads as 4 bars instead of 32 sparse ones. Middle unused rows must stay visible (hiding them would break the physical row ↔ screen wire mapping visitors rely on); only trailing rows collapse. Purely display-level — protocol and QASM keep the full register. Pairs naturally with the 1-row mini-mat idea from Bloch Golf.

### Entangible One — DECIDED target architecture (per Jan 2026-07-19)

**The booth becomes a mode of the pocket app: one app, three roles.** The
two-app split (display-app + pocket-app) is retired once parity is reached.

| Role | Trigger | Behavior |
|---|---|---|
| **Standalone** | default (entangible.org, any device) | on-device camera + TS detection + display (today's pocket) |
| **Display** | served by a host (origin answers `/api/info` → auto-connect) or manual/QR "connect to booth"; `?kiosk` selects the big-screen vh-scale skin | state from `/ws/state` instead of the local pipeline; host-driven layout/mode/wires; multi-viewer sync; camera fleet + noisy-backend Run |
| **Camera** | connected to a host, camera role selected | absorbs `/capture`: streams JPEG frames to the host with pocket's camera UI (zoom, freeze) |

**Viewer policy (per Jan 2026-07-19 — the visitor QR is view-only):** the
Display role has two policies. `viewer` (default for QR-connected clients):
read-only — receives circuit/detection/layout, local-only interactions
(inspect popovers, Q-sphere rotation, own panel toggles); NEVER sends
`select_camera`/`select_layout`/`select_mode`; no freeze of the booth; no
camera-role offer. `operator` (staff, reached via /debug or an explicit
operator URL): full controls incl. the camera role. QR audiences: the
**visitor QR** (booth footer + attract mode, U1) links to the viewer; the
**staff QR** stays on /debug only (today's /capture QR is staff-only — it can
hijack the booth camera and must never be shown to visitors).

Key mechanism: a `StateSource` abstraction (`LocalPipelineSource` \|
`BoothSocketSource`) feeding one shared shell; everything below it is already
the shared `@quantum` layer. The host serves the unified app at `/` (it
already serves the pocket build at `/pocket`); the staff `/debug` becomes a
route of the same app.

**Phases (each leaves everything working):**
1. **SC1** — move `display-app/src/quantum` → neutral top-level `shared/`
   (both apps alias); consolidate pure logic duplicates (displayWires,
   outcomes/histogram math, warnings, hints, inspectCopy already shared).
2. **SC2** — unify structural components behind the `classPrefix` pattern
   (Histogram, Celebrations, MessageStrip, QASM/State panels, Scorecard,
   TouchInspector) + one shared `tokens.css` (single design-system source).
3. **U1** — `StateSource` abstraction + WS source + host serves the unified
   app at `/`; display-app enters deprecation (kept until parity verified).
4. **U2** — Camera role absorbs `/capture`.
5. **U3** — kiosk skin (`?kiosk`, vh scale) + host-layout mapping + `/debug`
   route; delete display-app; M5 packages ONE app.

Consequences: features ship once for all roles; one deploy/test surface; M5
(RasQberry packaging) serves the same app that runs at entangible.org.

### Quantum Golf — DECIDED (per Jan 2026-07-19, build today)

Unifies the former "Bloch Golf" and "Q-sphere Golf" ideas under one name and
one progression: **Quantum Golf**, levels 1–5 where **level = qubit count**.
Level 1 plays on a **Bloch sphere** view (single qubit — superposition hole);
levels 2–5 play on the **Q-sphere** (Bell, GHZ-3/4/5). The pocket app's golf
MVP is the engine seed. Build plan (QG0–QG3):

- **QG0 rename**: pocket UI "Golf" → "Quantum Golf", holes → "Level 1…5"
  with qubit count shown; docs updated.
- **QG1 shared engine**: move pocket's `golf.ts` into
  `display-app/src/quantum/golf.ts` (the shared home pocket already imports
  via `@quantum`); add level metadata (number, name, view: bloch|qsphere).
- **QG2 Level-1 Bloch view**: 2D Bloch projection (SVG, shared math in
  `@quantum`, per-app styling): ball at the state's (θ,φ), |0⟩ pole top,
  target flag, family styling. Levels 2–5 keep the 2D Q-sphere.
- **QG2b standard Q-sphere display (per Jan 2026-07-19 — ours to build,
  distinct from the animated evolution)**: a true 3D-projected Q-sphere,
  Qiskit-style — |0…0⟩ north, latitude rings by Hamming weight, node radius =
  |amplitude|, fill = phase hue, stems to center — implemented as pure math in
  `display-app/src/quantum/qsphere.ts` (sphere layout + orthographic
  projection with a rotatable view matrix) and thin per-app SVG renderers.
  No WebGL/three.js (≤32 nodes; painter's-algorithm depth sort; Pi-friendly).
  Motion = VIEW only: slow idle spin + drag-to-rotate (touch) — the camera
  moves, never the state (state animation stays with qsphere-evolution).
  Consumers: booth `qsphere` panel (registry slot exists), Quantum Golf
  levels 2–5 (replaces the flat QSphere2D), pocket optional RESULTS panel.
- **QG3 booth golf mode**: BoothView `mode === 'golf'` renders the golf
  sidebar (Bloch/Q-sphere view per level + scorecard; circuit stays on
  stage), hole-in celebrations, level advance on board clear — switched live
  from /debug (mode pills already exist). Same engine as pocket.

The animated 3D evolution sphere remains the separate qsphere-evolution
project (upstream family track); Quantum Golf ships with the 2D views now and
upgrades its stage when that lands. bloch-golf upstream becomes an optional
convergence (offer our engine/levels back), not a dependency.

### Idea (unscheduled, superseded by Quantum Golf above): physical Bloch Golf mode

Optional booth game mode reusing **`bloch-golf`** (existing QAMPoser repo: React + Three.js/R3F game where each gate in a `@qamposer/react` circuit rolls a golf ball on a grass-textured Bloch sphere toward a target state, with par scoring, physically-correct rotation trajectories, and hole-in celebrations). Physical variant: visitors place gate tiles on the table; the ball rolls on the big screen. Integration is small because bloch-golf is already driven by circuit-change events from the same editor component — feed it the `/ws/state` circuit instead of on-screen edits (single-qubit: row 0 only, or a dedicated 1-row mini-mat; column order = shot order). Tile coverage: H/X/Y/Z and RX/RY/RZ angle variants exist from M1; S/T need the reserved IDs 40–49 (M6). Needs bloch-golf factored to accept an external circuit source (controlled mode) — coordinate upstream. Would slot in as an alternate display-app view (e.g. a `/golf` route or attract-mode rotation) after M3.

### Idea (unscheduled): Q-sphere Golf — multi-qubit extension of Bloch Golf

Extend the golf concept beyond one qubit: the course becomes a **Q-sphere** (basis states as nodes arranged by Hamming weight; amplitude = node size, phase = node color), and the full tile set applies — including CNOT, so entanglement becomes part of the game. Holes are target multi-qubit states with par (e.g. \|11⟩, \|+ +⟩, Bell par 2: H + CNOT, GHZ par 3), scored by state fidelity against the target rather than a single ball position. This is a real game-design problem, not just a port: a multi-qubit state is a *distribution* over nodes, not a point, so the "ball" metaphor needs rethinking — e.g. amplitude flowing between nodes as animated trails (reusing bloch-golf's trajectory/celebration components and Three.js scene), or one ball per active basis state that splits on H and merges on interference. Builds on the physical Bloch Golf mode (same `/ws/state` feed, same tiles, now multi-row) and on `@qamposer/react`'s existing Q-sphere math for state→node layout. Candidate flagship demo: "putt a Bell state" makes entanglement tangible in a way single-qubit demos can't. Coordinate with bloch-golf upstream as a mode or sibling package (`qsphere-golf`).

**Q-sphere evolution as its own project (per Jan 2026-07-18):** the animated state-evolution Q-sphere likely deserves to be a separate package/repo (working name `qsphere-evolution`): a Three.js/R3F component taking a Circuit + gate layers and animating the state through them (physically-correct rotation arcs, amplitude flow between nodes). Consumers: qsphere-golf, Bloch Golf, the Entangible booth (step-through mode), `@qamposer/react` visualization, teaching notebooks. Would live in the QAMP-62 family → part of the async upstream coordination with the other developer. Per Jan: conceptually an **extension of "grokking the Bloch sphere"** (javafxpert/grok-bloch, RasQberry fork at ~/GitHub/rasqberry-grok-bloch — the interactive single-qubit Bloch sphere teaching app): grok-bloch shows *one qubit's* state responding to gates; qsphere-evolution generalizes that pedagogy to multi-qubit states on the Q-sphere with animated evolution through a whole circuit.

**Layer-by-layer evolution animation (for both golf modes, per Jan 2026-07-18):** on every stable circuit from the board, don't jump to the final state — replay the state's journey column by column: apply gate layer 1, animate the ball/amplitude flow along its trajectory, then layer 2, etc. (bloch-golf already animates single gate *additions* with physically correct rotation paths; this generalizes it to a full replay per circuit change, which is what the physical flow needs since tiles can appear anywhere, not just appended). Doubles as the teaching moment: visitors see *how* the state evolves through their circuit, not just where it lands. Also worth considering for the main booth view later (step-through of the Q-sphere on demand).

## Risks & mitigations (top)

- **Pi 4 fps**: 720p + 4×4 dict; optional half-res detect; realtime sim offloaded to browser; perf harness on ReplaySource at M2.
- **iPhone HTTPS**: single self-signed HTTPS origin with LAN-IP SANs, tap-through instructions on `/capture`, documented as a booth-setup step.
- **Venue lighting / hands over board**: big matte markers, tuned adaptive thresholds on real-photo fixtures, asymmetric hysteresis, `/debug` makes bad setups visible in seconds.
- **Ecosystem drift**: pin `@qamposer/react@0.2.x`; Circuit-JSON schema snapshot checked in CI; QASM as escape hatch.

## Verification

- **CI (no hardware)**: synthetic board renderer (`tests/utils/render_board.py`: markers via `generateImageMarker`, perspective warp, blur/noise jitter) → full detect path vs golden `tests/fixtures/circuits/*.json`; unit suites for stabilizer (scripted flicker/occlusion sequences), CNOT pairing matrix, QASM golden round-trips, grid tolerances; vitest for `stateSocket` seq/reconnect and protocol-type parity.
- **End-to-end without a camera**: `make demo` (ReplaySource) — open `https://localhost:8443/`, confirm the recorded tile sequence drives the live editor and localAdapter histogram updates.
- **End-to-end with hardware**: print M1 assets, run M2 on a Mac webcam then a Pi + PiCam; place H + CNOT tiles → Bell state appears with ~50/50 histogram; check `/debug` shows 4 corners, stable markers, ≥10 fps on Pi 4. M4: scan the QR with an iPhone, accept the cert, verify frames flow and detection matches. Optional backend: enable `--backend spawn`, run `noisy_fake`, confirm counts differ from ideal.
