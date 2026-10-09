# Entangible (né QAMPoser-physical) — Physical Quantum Circuit Composer

> This file describes the system **as built**. The original approved design
> (2026-07-11), the milestone log, phase-by-phase build notes and the idea
> backlog live in [`design-history.md`](design-history.md).

## Context

QAMPoser (github.com/QAMP-62) is an open-source, embeddable quantum circuit composer (like IBM Quantum Composer): `@qamposer/react` (TS/React editor + Q-sphere/histogram, OpenQASM 2 utils, pluggable `SimulationAdapter`, in-browser `localAdapter`) and `qamposer-backend` (FastAPI + Qiskit 2.x for noisy/real simulation). This repo (**entangible**, formerly QAMPoser-physical) adds a *tangible* composer: visitors at events/fairs/booths build circuits on a table from printed gate tiles on a printed board mat; a camera recognizes the layout and a big screen shows the live circuit and simulation results. Hosts: Raspberry Pi 4/5 (RasQberry.org, Raspberry Pi OS Trixie 64-bit) and macOS; cameras: USB/Pi Camera, Mac Continuity Camera (iPhone as webcam), and iPhone browser streaming to the host. Realtime simulation is noise-free in-browser via `localAdapter` — no backend required; `qamposer-backend` is an *optional* add-on for noisy/real-hardware runs via `qiskitAdapter`.

## Architecture (as built — "Entangible One", post-U3 2026-07-19)

ONE React app serves every role; the booth is a mode of the pocket app.

```
USB / PiCam / Continuity ─┐
                          ├─▶ qamposer-vision ─────▶ ┌─────────────────────────────┐
phone in camera role ─────┘   (Python / OpenCV      │ qamposer-physical-host      │
  (the app itself; JPEG        ArUco pipeline,      │ (FastAPI, HTTPS :8443)      │
  frames over /ws/frames,      in-process thread)   │ • /ws/state broadcast hub   │
  operator-key gated)                               │ • serves THE app at /       │
                                                    │ • operator-token security   │
        ┌───────────────────────────────────────────┤ • /qamposer-api/* proxy ────┼──▶ qamposer-backend
        ▼                                           └─────────────────────────────┘    (OPTIONAL, own venv,
THE app (pocket-app/, React, also live at entangible.org)                              Qiskit/Aer :8001)
  one build, role by URL/context:
  • standalone  — on-device camera + TS detection (no host at all)
  • kiosk       — /?kiosk&connect=1, booth big-screen skin, viewer of /ws/state
  • viewer      — visitor QR → /?connect=1, read-only follow-along on the phone
  • camera      — staff QR → /?connect=1&role=camera&key=…, streams frames
  • /debug      — staff route: keyed MJPEG, fleet, layout card (operator)
  @qamposer/react controlled mode; realtimeAdapter = localAdapter (in-browser)
```

- Vision runs as a worker thread inside the FastAPI app (no IPC); a standalone `qamposer-vision detect` CLI exists for dev/testing.
- Single HTTPS origin `https://<host>:8443` (iPhone `getUserMedia` requires secure context): the app at `/` (SPA fallback covers `/debug` and client routes; `/pocket*` 307-redirects to `/` preserving the query for QRs in the wild), WebSockets under `/ws/*`. Self-signed cert auto-generated on first run (SANs = hostname + LAN IPs). Two QRs: the ungated visitor QR (`/api/visitor-qr` → `/?connect=1`) on the booth footer/attract screen, and the key-gated staff QR (`/api/qr` → camera role).
- **Default mode needs no backend**: `realtimeAdapter={localAdapter()}` simulates ideally in the kiosk browser on every stable circuit change. When the backend is enabled (`--backend spawn|url|off`), the host reverse-proxies it at `/qamposer-api` (same origin → no CORS/mixed-content) and the UI offers "Run on noisy/real backend" (`profile: {type:'noisy_fake'|'real'}`).
- State flows through a `StateSource` abstraction (`LocalPipelineSource` | `BoothSocketSource` | `ManualEditSource`), so standalone detection, booth broadcast and on-screen manual building feed the same shell.

### Roles and security (current policy)

- **Viewer policy**: QR-connected displays are read-only — they receive circuit/detection/layout and never send `select_*`; viewer surfaces (`/`, `/pocket`, `/api/info`, `/ws/state` reads) are fully open, zero-friction.
- **Operator**: a single shared operator token (generated on first run, stored with the certs; `qamposer-physical token`, `--rotate`). It gates `/ws/frames` (frame injection), the `select_*` control messages, `/debug`'s data endpoints and `/api/qr`. Possession of the printed staff sheet (QR embeds `?key=…`) is the credential — no accounts, right-sized for a booth appliance.
- **No in-app API-key/CRN entry, ever** (standing decision): IBM's runtime API is not browser-CORS-open, so in-app runs would proxy visitor credentials through our server, and normalizing credential entry into QR-opened third-party apps is an anti-pattern regardless. "Take it home" is a one-tap **Transfer to IBM Composer** (circuit pre-loaded via `?initial=` + QASM on the clipboard; `pocket-app/src/app/composerTransfer.ts`) — all credential moments happen on IBM's own domain. Revisit only if IBM ships an OAuth device flow with browser CORS.

## Repo layout (uv workspace + one npm app)

```
pyproject.toml            # uv workspace root
assets.toml               # physical dimensions (mm) — single source of truth for print AND detection
packages/
  qamposer-vision/        # Python ≥3.11: opencv-python-headless ≥4.8, numpy
    src/qamposer_vision/{markers,sources,board,grid,detector,stabilizer,circuit_builder,qasm,pipeline,annotate,cli}.py
  qamposer-physical-host/ # Python ≥3.11: fastapi, uvicorn, httpx, qrcode, cryptography
    src/qamposer_host/{main,config,hub,ws_state,ws_frames,proxy,preview,certs,static,token,layout,branding,menu,dispatch,cli}.py
  qamposer-assets/        # printable asset generator: SVG source of truth, cairosvg → PDF
    src/qamposer_assets/{config,marker_svg,tile_face,symbols,sheets,board,cheatsheet,laser,cli}.py
pocket-app/               # THE app (Entangible One): Vite + React + TS + @qamposer/react
  src/{app/…, kiosk/…, debug/…, sources/…, vision/…, pipeline/…}
shared/                   # neutral cross-cutting layer, aliased @quantum / @shared
  {quantum/…, display/…, ws/…, capture/…, menu/…, tokens.css}
hardware/                 # build123d 3D-printable tiles/cubes (colored 3MFs, print plates)
deploy/rasqberry/         # `entangible` command + Pi install script + systemd + kiosk autostart (docs/rasqberry-integration.md)
examples/                 # test-board PNGs, print-kit PDF, renders
docs/{design,design-history,protocol,marker-ids,printing,extending,pocket,booth-ux,mac-booth,rasqberry,iphone-capture,…}.md
tests/                    # fixtures (golden circuits, synthetic + real images, recordings) + unit suites
```

## Key component designs

**Markers (`markers.py`, `docs/marker-ids.md`)** — `DICT_4X4_50` (largest bits per mm; `cv2.aruco` is in the main opencv module since 4.7). ID table (assigned **explicitly per ID**, never by range — task #96 re-homed three tiles onto IDs whose bit pattern resembles the glyph): 0–3 board corners (TL/TR/BR/BL — orientation implicit); 30/35/12/13 H/X/Y/Z; 17/15 CNOT control ●/target ⊕; RX 20–23, RY 24–27, RZ 28/29/**10**/31 × angle variants (π/4, π/2, π, −π/2) as distinct IDs; 40/41 S/T, 42–44 dials, 45 SWAP, 46/47 furniture, 48–49 reserved; 11/14 free. One `MARKER_TABLE: dict[int, GateSpec]` imported by *both* the detector and the assets generator so print and detection can never drift.

**Frame sources (`sources.py`)** — `FrameSource` protocol with: `Cv2CaptureSource` (USB webcams, Mac cams, Continuity Camera — a normal AVFoundation device; `list-cameras` helper), `Picamera2Source` (required on Pi OS — `cv2.VideoCapture` does NOT see libcamera CSI cams; needs venv with `--system-site-packages`), `PushFrameSource` (latest-frame slot fed by `/ws/frames`), `ReplaySource` (fixtures → no-camera dev mode and CI).

**Board + grid (`board.py`, `grid.py`)** — homography from all 16 corner-marker points (`findHomography` + RANSAC), cached until corners drift; works with 3 of 4 corners. `BoardConfig` from `assets.toml`: 5 rows (qubits, matches `@qamposer/react` default `maxQubits`) × 8 columns, 70 mm pitch, 60 mm tiles, 36 mm tile markers (revised from 40 mm at implementation: preserves the ArUco quiet zone alongside a legible label band — see docs/assets-design.md; board corner markers stay 40 mm). Cell mapping rejects off-grid tiles instead of misfiling — on the **row** axis only: a tile takes the nearest lattice row (or qubit wire, below) within half a cell height, else it is `off_grid`. **Columns are dynamic (#109):** they are clustered from the tiles' actual x positions, not read off a fixed x-lattice — single-linkage over the sorted x's, a new column wherever neighbours are more than `COLUMN_GAP_MM` = 30 mm apart (half a tile: closer centres would physically overlap, and a hand-misaligned ● / ⊕ pair stays inside it). The spacing still comes from the pitch: the first cluster takes `max(0, round((x − first_center_x) / pitch))`, each next one the previous plus `max(1, round(Δx / pitch))`, so an empty column between tiles is kept and tiles at mat cell centres get exactly their lattice columns (the mat goldens are unchanged). No x position is rejected any more — a tile pushed off its cell joins the column it visibly belongs to. Python and TS share one rounding rule (`floor(x + 0.5)`) so the mirrors agree at the halves. Geometry margin: camera ~70–90 cm above at 720p → ~11–16 px per ArUco bit vs ~2 px needed.

**Detection + stabilization** — one `ArucoDetector` (subpixel corner refinement) per frame; target 1280×720 @ 10–15 fps on Pi 4 (ArUco 4×4 ≈ 15–35 ms/frame; option to detect at half-res). Asymmetric hysteresis so hands don't cause flicker: a tile *appears* after ≥5 agreeing of 7 frames (~0.5 s), *disappears* only after 12 consecutive absent frames (~1 s); circuit emitted only on real deep-equality change. The stability key is `(marker id, row, x bucket, rotation)` with an *absolute* 10 mm x bucket (`X_BUCKET_MM`), never a column: columns depend on the whole board, so keying by column would let one tile inserted on the left renumber every key and flap the whole board through the hysteresis. Columns are clustered from the *stable* set at emission (the per-frame debug table clusters that frame's tiles, display only). Camera loss is watched by a stall watchdog (`CAMERA_STALL_S`, reopen with backoff) and board loss by a time-based grace (`BOARD_LOSS_GRACE_S`) — see `docs/protocol.md`.

**Circuit building (`circuit_builder.py`)** — per column: single-qubit tiles → `{type, qubit: row, parameter?, position: col}`; CNOT = ● + ⊕ tiles in the same column, paired deterministically (nearest unpaired target by row); unpaired/conflicting tiles are *excluded with warnings* (every warning kind has friendly copy and a visitor/staff audience — `shared/display/warnings.ts`), never guessed. Deterministic gate IDs (`h-0-0`, `cnot-1-0`) keep React identity stable across emissions. Output = exact `@qamposer/react` `Circuit` JSON + OpenQASM 2 (Python port of `circuitToQasm`).

**WebSocket protocol (`docs/protocol.md` ⇄ `ws/messages.ts`)** — server pushes `{type:'circuit', seq, circuit, qasm, source}`, `{type:'detection', fps, board, markers, warnings}` (throttled 5 Hz), `{type:'status', camera, backend, clients}`; latest circuit+status replayed to late joiners; clients send `hello` and the operator-gated `select_*` family.

**Display** — `QamposerProvider` controlled mode (`circuit` from the state source; on-screen editing disabled when the table is the source of truth). *Interim since M3:* `@qamposer/react@0.2` ships the editor and the visualization preset as separate bundles with incompatible React contexts, so the booth view uses the controlled `CircuitEditor` (main bundle) plus a lightweight statevector-driven histogram (88 kB gzip vs 1.6 MB, Pi-friendly). **Per Jan (2026-07-18): reusing qamposer components is preferred and the Q-sphere is wanted back** — the proper fix is upstream in qamposer-react (export `ResultsPanel`/`QSphereView`/`Histogram` from the main bundle, or have both entries share one context), after which the booth view returns to the real panels; the local histogram stays as a low-power fallback (`?lowpower`). Celebrations: Bell/GHZ-state detection → confetti + "Entanglement!" banner. Built `dist/` is served by the host — the Pi needs Node only once, at install/build time.

**Dial tiles (42/43/44)** — the tile's orientation ON THE BOARD selects the rotation angle. Conventions: orientation measured in the board frame (rectified via the homography, not the camera frame); rotation index r = clockwise **45°** steps from canonical (0–7); **angle = DIAL_ANGLES[r]**, wrapped to (−π, π]: 0, π/4, π/2, 3π/4, π, −3π/4, −π/2, −π/4. r = 0 emits the identity (parameter 0.0) rather than nothing, so a placed dial is always visible on screen. Face design: marker centered, the eight angle labels around it placed so the ACTIVE angle always reads upright at the top edge, with a ▲ pointer; family colors as a full frame. For dial IDs the stability key includes the rotation — turning a tile in place re-emits the circuit (with hysteresis, like any change). Emission is plain `RX/RY/RZ(parameter)` — indistinguishable downstream from the classic tiles.

**Printable assets (`qamposer-assets`)** — vector ArUco (bit matrix from `getPredefinedDictionary` → SVG rects, crisp at any size); tile SVGs with semantic layers (outline/marker/symbol) so the 3D pipeline extrudes the same faces; tile cut-sheets and board mat; laser-cut SVGs; SVG→PDF via cairosvg. Kit composition is the one `[kit]` table in `assets.toml`, which drives the colour/mono/b&w 3D kits, the laser sheets and the paper kit alike. Adding a tile: [`extending.md`](extending.md).

### Variable corner placement + qubit-wire blocks (tasks #94/#95/#97)

Corner blocks (#90) replaced the printed mat, but detection still assumed the
mat's exact geometry — the homography was fitted from 16 correspondences at
fixed board-mm positions, so any other corner spacing produced inconsistent
correspondences and a high reprojection error. Two changes remove that
assumption; both live in `board.py`/`board_model.py` and their byte-mirrors in
`pocket-app/src/vision/`.

**Measuring the board.** `estimate_board_rect` recovers the rectangle the corner
markers actually span. The markers give the *shape*; their printed 40 mm size
gives the absolute *scale*. A short fixed-point iteration separates the two: fit
image-px → a model board of the current guess (initially the mat), map the
detected marker quads through it, measure their mean horizontal/vertical edge
length, and scale the centre spacing by `40/e` per axis. With four corners the
composite world → model map is exactly the anisotropic scaling (a homography is
determined by four correspondences, and that scaling satisfies them), so the
first pass is exact; the extra passes only average out detector noise, and the
same loop converges from the 12 points three corners give. The pipeline holds
the rectangle **sticky**: it starts at the mat and only moves when an estimate
differs by more than ±5 %, which both keeps a real mat pinned to exactly the mat
geometry (classic output, bit-for-bit) and stops a board near a column boundary
from re-deriving its size every frame.

**Reading the board.** A rectangle within ±5 % of the mat is the mat. Anything
else is interpreted under one operator-chosen layout:

- **`grid`** (default — Jan's pick): keep the mat's 70 mm pitch and 62 mm cells,
  so a printed tile always covers exactly one cell, and derive the COLUMN count
  from the measured width. A wider table simply means more columns. Capped at 20
  — `@qamposer/react`'s `CircuitEditor` has no hard limit (it always renders
  `MIN_POSITIONS = 20` and grows with the circuit), so the cap is ours, chosen as
  the widest board guaranteed to be fully visible without the editor growing.
- **`stretch`**: keep the 5 × 8 lattice and scale it into the rectangle, x and y
  independently, so the cells grow with the table.

The setting is `settings.boardLayout` (`?board=stretch|grid`), broadcast
booth-wide as `layout.boardLayout` / `select_board_layout` on the noise-preset
pattern — a connected booth owns it so every screen in the room reads the table
the same way.

**Qubit-wire blocks.** Marker ID 46 is furniture, not a gate (deliberately
absent from `MARKER_TABLE`, so it can never be filed into a cell; present in
`DETECTABLE_IDS` so both detectors decode it). Up to five identical blocks along
the left edge — anything left of the grid's first column — each declare one wire
at their own y. Sorted top-down they are q0…qn−1, the emitted circuit carries
exactly that many qubits, and a tile takes the row of the NEAREST wire within
half a cell height (further away is off-grid, as ever — never guessed). The wire
SET goes through its own asymmetric hysteresis, matching the tile stabilizer:
growing it takes 5 of the last 7 frames, shrinking it (including losing the last
block, which falls back to the model's own rows) takes 12 consecutive frames, so
a hand crossing the left edge cannot resize the circuit. While the count holds
steady the positions keep tracking silently.

**Measurement blocks (task #97).** Marker ID 47 is the mirror piece on the
**right** edge — furniture too, and a pure *refinement*. A wire exists iff its
LEFT block exists; the wire count is never derived from the right side. Each
right block (anything right of the last column) pairs with the nearest left
block by y, within half a row pitch, greedily from the closest candidate pair
so the matching is a deterministic function of the two ordered lists. A paired
wire is then read as the SEGMENT through both block centres instead of a
horizontal line, and gate tiles snap by distance to *that* segment at their own
x — so two rows of blocks that are a centimetre out of square give tilted wires
that still follow the tiles instead of drifting off them. A right block with no
partner is ignored and reported (`unpaired_measure`); in `grid` layout the mean
left→right run is additionally cross-checked against the corner blocks' span
(`measure_span_mismatch`, informational — the corners are what the homography is
fitted to, so they win). The right-hand set carries the same asymmetric
hysteresis as the left, so a hand crossing the right edge cannot make wires snap
between tilted and horizontal. Zero measurement blocks is the normal case and
changes nothing.

### Quantina — unified Qoffee-Maker/quantum-mixer successor (task #35)

**Quantina** ("quantum cantina") replaces the standalone
[Qoffee-Maker](https://qoffee-maker.org) and quantum-mixer apps: "order
something by programming a quantum computer" is a **mode of Entangible One**
(mode key `quantina`), not a separate stack. Load-bearing decisions: **menu
packs** are data-only configs (canonical JSON schema in `shared/menu/`, host
TOML packs via `/api/menu/*`, `?menu=`/`?menupack=` standalone) with unfilled
codes auto-padded as "Surprise me" — the measurement is never remapped; three
**serve modes** `single`/`shots`/`subset`; menu probabilities come from the
**same vector as the histogram** (noise-aware); serving is **operator-gated**
booth-side; machine **dispatch** (`log`/`webhook`/`homeconnect`) is host-only,
disarmed by default, secrets never in the browser; **no real-QPU serve** —
visitors take the circuit home via the Composer-transfer QR instead (standing
no-in-app-credentials decision). Everything else — full spec, the
quantum-mixer parity audit, the resolved decision list, phase-by-phase
as-built status and commit hashes — lives in
[`docs/quantina.md`](quantina.md).

### In-browser noise model (task #27)

**Why**: the booth's best teaching moment is "this is why quantum computing is
hard" — ideal vs realistic results side by side, with ZERO infrastructure: on
entangible.org, on a visitor's phone, offline. Pairs with the take-home story:
*see ideal → see realistic → run it for real via the Composer.*

**Method — full density matrix.** At ≤5 qubits a density matrix is 32×32 ≈ 1k
complex numbers (16 KB); a gate application is two 32³ complex matrix products
≈ microseconds in JS — so the *honest* simulation is affordable: exact,
deterministic (no sampling jitter in the bars), every standard channel
expressible as Kraus operators. Rejected: Monte-Carlo Pauli trajectories
(sampling noise in the display) and readout-error-only (dishonest — no depth
dependence, which is the whole lesson).

**Channels** (applied in circuit order): *depolarizing* after each gate on its
qubits (1-qubit `p1`, 2-qubit `p2`); *amplitude damping + dephasing per MOMENT
on every qubit* — including idle ones (pedagogically the point: a deep circuit
decays even where nothing happens); *readout error* as a per-qubit confusion
matrix applied classically to the final probability vector. The same channel
family Qiskit's `NoiseModel.from_backend()` builds from a device snapshot —
deliberately, so parameters are *sourced from real devices*, not invented.

**Presets — one per IBM chip generation**, oldest to newest, keys
`off | falcon | eagle | heron | nighthawk`, extracted from
`qiskit_ibm_runtime.fake_provider` calibration snapshots (FakeManilaV2,
FakeBrussels, FakeAachen, FakeBerlin) by `tools/extract_noise_presets.py` into
the checked-in `shared/quantum/noisePresets.json` (provenance in the file; the
browser never needs Qiskit). The story arc "hardware is improving" is literal,
told in four real chip generations. UI labels stay human; the Guide names the
source — consistent with the IBM trademark disclaimer.

**Validation**: `noise=0` reproduces `statevector.ts` exactly (parity test);
closed-form goldens (depolarized Bell, amplitude-damped |1⟩, readout on known
vectors); JSON fixtures generated once with `qiskit.quantum_info`
(DensityMatrix / Kraus), TS compares within 1e-9; invariants (trace 1,
Hermitian, probs sum to 1). Booth-wide control: `noise` on the `layout`
broadcast + the operator `select_noise {preset}` message; a booth-pushed
preset overrides the local setting while connected.

### Quantum Golf (as built)

The golf engine lives in `shared/quantum/` (one implementation for standalone
and booth): 18 holes in four club-unlock rounds, strokes counting adds *and*
removals, par = minimum + 2; random courses from a 32-bit seed with difficulty
floors and club-necessity rules, shareable as `Course #…` codes / `?course=`
links (course generation is a cooperative generator dealt asynchronously
behind a progress card — deals are bit-identical to the synchronous path, so
printed course codes stay valid); background BFS computes/certifies optimal
solutions; the roll-the-ball Q-sphere/Bloch view steps the state through the
circuit column by column. The original QG0–QG3 plan and the superseded
Bloch-/Q-sphere-golf ideas are in
[`design-history.md`](design-history.md).

### Planned extension (needs upstream): arbitrary controlled gates

Physical rule "● + any single-qubit gate tile in the same column =
controlled-that-gate" (ctrl-H, ctrl-Z, ctrl-RZ…; ⊕ remains the X-target
shorthand). Vision-side pairing is a small change; blocked on
`@qamposer/react` supporting controlled single-qubit gates (the Gate JSON
already carries generic `control`/`target` fields, but editor/localAdapter/
QASM only handle CNOT). Track as a qamposer-react feature first.

## Packaging & deployment

- **Mac dev**: `make dev` = `uv sync` + npm install + uvicorn (reload) + vite dev (proxying `/ws`, `/qamposer-api`). `make demo` = full stack on `ReplaySource` — no camera or printed board needed. Mac booth specifics (firewall, TLS, Continuity Camera): [`mac-booth.md`](mac-booth.md).
- **Python versions**: our three packages target ≥3.11 (Pi OS Trixie system Python 3.13, needed for picamera2 via `--system-site-packages`). `qamposer-backend` requires 3.13 → when enabled on Pi, it gets its own uv-managed 3.13 venv (`uv python install 3.13`, aarch64 fine). If qiskit-aer aarch64 wheels fail at pin time → backend off, localAdapter-only (still fully functional).
- **Raspberry Pi / RasQberry**: the stable `deploy/rasqberry/entangible` command (install/start/stop/status JSON/url/doctor/uninstall) over `install.sh` (apt picamera2 + libcairo2 + Chromium, the prebuilt web bundle from the `booth-v*` release pinned in `BUNDLE_TAG` — no Node on the Pi, uv venv with system site packages, cache on `/data` so a reinstall after an A/B update is fast/offline, systemd service, optional `--kiosk` autostart that waits on `/api/health`); contract in [`rasqberry-integration.md`](rasqberry-integration.md), guide in [`rasqberry.md`](rasqberry.md). On-device validation and a prebuilt image are still pending.

## Risks & mitigations (top)

- **Pi 4 fps**: 720p + 4×4 dict; optional half-res detect; realtime sim offloaded to browser; perf harness on ReplaySource.
- **iPhone HTTPS**: single self-signed HTTPS origin with LAN-IP SANs, tap-through instructions in the Phone-camera card, documented as a booth-setup step.
- **Venue lighting / hands over board**: big matte markers, tuned adaptive thresholds on real-photo fixtures, asymmetric hysteresis, board-loss grace, `/debug` makes bad setups visible in seconds.
- **Ecosystem drift**: pin `@qamposer/react@0.2.x`; Circuit-JSON schema snapshot checked in CI; QASM as escape hatch.

## Verification

- **CI (no hardware)**: synthetic board renderer (`tests/utils/render_board.py`: markers via `generateImageMarker`, perspective warp, blur/noise jitter) → full detect path vs golden `tests/fixtures/circuits/*.json`; unit suites for stabilizer (scripted flicker/occlusion sequences), CNOT pairing matrix, QASM golden round-trips, grid tolerances; vitest for `stateSocket` seq/reconnect and protocol-type parity.
- **End-to-end without a camera**: `make demo` (ReplaySource) — open `https://localhost:8443/`, confirm the recorded tile sequence drives the live editor and localAdapter histogram updates.
- **End-to-end with hardware**: print the kit, run on a Mac webcam then a Pi + PiCam; place H + CNOT tiles → Bell state appears with ~50/50 histogram; check `/debug` shows 4 corners, stable markers, ≥10 fps on Pi 4. Phone camera: scan the QR with an iPhone, accept the cert, verify frames flow and detection matches. Optional backend: enable `--backend spawn`, run `noisy_fake`, confirm counts differ from ideal.
