# QAMPoser-physical — Physical Quantum Circuit Composer

> Design approved 2026-07-11 (planned in Claude Code on the web, ultraplan session). Implementation follows milestones M1–M6 below.

## Context

QAMPoser (github.com/QAMP-62) is an open-source, embeddable quantum circuit composer (like IBM Quantum Composer): `@qamposer/react` (TS/React editor + Q-sphere/histogram, OpenQASM 2 utils, pluggable `SimulationAdapter`, in-browser `localAdapter`) and `qamposer-backend` (FastAPI + Qiskit 2.x for noisy/real simulation). This new repo (**QAMPoser-physical**, currently empty) adds a *tangible* composer: visitors at events/fairs/booths build circuits on a table from printed gate tiles on a printed board mat; a camera recognizes the layout and a big screen shows the live circuit and simulation results. Hosts: Raspberry Pi 4/5 (RasQberry.org, Bookworm 64-bit) and macOS; cameras: USB/Pi Camera, Mac Continuity Camera (iPhone as webcam), and iPhone browser streaming to the host.

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

**Display app** — `QamposerProvider` controlled mode (`circuit` from WS store; on-screen editing disabled — the table is the source of truth). *Revised at M3:* `@qamposer/react@0.2` ships the editor and the visualization preset as separate bundles with incompatible React contexts, so the booth view uses the controlled `CircuitEditor` (main bundle) plus its own lightweight statevector-driven histogram instead of the Plotly-based `Qamposer` preset — 88 kB gzip instead of 1.6 MB, much friendlier to the Pi kiosk; Q-sphere view deferred (upstream: unify contexts or export panels from the main bundle); `realtimeAdapter=localAdapter()`; optional `adapter=qiskitAdapter({baseUrl:'/qamposer-api'})` with the Run control hidden unless `/api/health` reports a backend. Celebrations: Bell/GHZ-state detection → confetti + "Entanglement!" banner. `/debug`: annotated MJPEG preview + marker/warning table for booth-staff calibration. Built `dist/` is bundled into the host wheel — the Pi never needs Node.

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

**Arbitrary controlled gates (planned extension, needs upstream):** physical rule "● + any single-qubit gate tile in the same column = controlled-that-gate" (ctrl-H, ctrl-Z, ctrl-RZ…; ⊕ remains the X-target shorthand). Vision-side pairing is a small change; blocked on `@qamposer/react` supporting controlled single-qubit gates (the Gate JSON already carries generic `control`/`target` fields, but editor/localAdapter/QASM only handle CNOT). Track as qamposer-react feature first.

### Idea (unscheduled): standalone browser mode — runs on an iPhone

A zero-install variant of the whole loop as a single static HTTPS page (e.g. hosted on qamposer.org): camera via `getUserMedia`, ArUco detection in the browser (OpenCV.js/WASM or js-aruco2), circuit building in TS, display + `localAdapter` simulation as in the main display app. Runs on anything with a camera and a modern browser — notably an iPhone pointed at the tiles becomes a complete "pocket demo" (recent iPhones are far faster than the Pi 4 perf budget; hosting on a real domain also sidesteps the self-signed-cert story). Shares `MARKER_TABLE`, `assets.toml` geometry, and the printed tiles/mat with the main system; the TS circuit-builder port is validated against the Python golden fixtures. Deliberately *not* the primary architecture: it can't reach the Pi CSI camera (libcamera isn't visible to `getUserMedia`), and a phone screen can't replace the 3 m booth display (AirPlay mirroring reintroduces a second device; a kiosk Pi is more robust all-day). Positioning: an extra deployment target/marketing demo alongside M6, after the marker scheme and assets are stable (post-M1) and ideally reusing M3's display components.

### Idea (unscheduled): physical Bloch Golf mode

Optional booth game mode reusing **`bloch-golf`** (existing QAMPoser repo: React + Three.js/R3F game where each gate in a `@qamposer/react` circuit rolls a golf ball on a grass-textured Bloch sphere toward a target state, with par scoring, physically-correct rotation trajectories, and hole-in celebrations). Physical variant: visitors place gate tiles on the table; the ball rolls on the big screen. Integration is small because bloch-golf is already driven by circuit-change events from the same editor component — feed it the `/ws/state` circuit instead of on-screen edits (single-qubit: row 0 only, or a dedicated 1-row mini-mat; column order = shot order). Tile coverage: H/X/Y/Z and RX/RY/RZ angle variants exist from M1; S/T need the reserved IDs 40–49 (M6). Needs bloch-golf factored to accept an external circuit source (controlled mode) — coordinate upstream. Would slot in as an alternate display-app view (e.g. a `/golf` route or attract-mode rotation) after M3.

### Idea (unscheduled): Q-sphere Golf — multi-qubit extension of Bloch Golf

Extend the golf concept beyond one qubit: the course becomes a **Q-sphere** (basis states as nodes arranged by Hamming weight; amplitude = node size, phase = node color), and the full tile set applies — including CNOT, so entanglement becomes part of the game. Holes are target multi-qubit states with par (e.g. \|11⟩, \|+ +⟩, Bell par 2: H + CNOT, GHZ par 3), scored by state fidelity against the target rather than a single ball position. This is a real game-design problem, not just a port: a multi-qubit state is a *distribution* over nodes, not a point, so the "ball" metaphor needs rethinking — e.g. amplitude flowing between nodes as animated trails (reusing bloch-golf's trajectory/celebration components and Three.js scene), or one ball per active basis state that splits on H and merges on interference. Builds on the physical Bloch Golf mode (same `/ws/state` feed, same tiles, now multi-row) and on `@qamposer/react`'s existing Q-sphere math for state→node layout. Candidate flagship demo: "putt a Bell state" makes entanglement tangible in a way single-qubit demos can't. Coordinate with bloch-golf upstream as a mode or sibling package (`qsphere-golf`).

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
