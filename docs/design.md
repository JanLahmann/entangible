# Entangible (né QAMPoser-physical) — Physical Quantum Circuit Composer

> Design approved 2026-07-11 (planned in Claude Code on the web, ultraplan session). Implementation follows milestones M1–M6 below.

## Context

QAMPoser (github.com/QAMP-62) is an open-source, embeddable quantum circuit composer (like IBM Quantum Composer): `@qamposer/react` (TS/React editor + Q-sphere/histogram, OpenQASM 2 utils, pluggable `SimulationAdapter`, in-browser `localAdapter`) and `qamposer-backend` (FastAPI + Qiskit 2.x for noisy/real simulation). This new repo (**entangible**, formerly QAMPoser-physical, empty at design time) adds a *tangible* composer: visitors at events/fairs/booths build circuits on a table from printed gate tiles on a printed board mat; a camera recognizes the layout and a big screen shows the live circuit and simulation results. Hosts: Raspberry Pi 4/5 (RasQberry.org, Bookworm 64-bit) and macOS; cameras: USB/Pi Camera, Mac Continuity Camera (iPhone as webcam), and iPhone browser streaming to the host.

**Decided with the user:** ArUco fiducial markers on tiles (not symbol ML); v1 physical kit is printed PDF tiles + board mat (3D-printed STLs later, sharing the tile-face design); all three camera paths; the vision component is Python and feeds the existing `@qamposer/react` UI in controlled mode (no new editor); circuits also exposed as OpenQASM 2; **realtime simulation is noise-free in-browser via `localAdapter` — no backend required**; `qamposer-backend` is an *optional* add-on for noisy/real-hardware runs via `qiskitAdapter`.

## Architecture

> **As built (post-U3, 2026-07-19).** The original two-app design (display-app
> at `/`, phone `/capture` page) was superseded by "Entangible One" (section
> below): ONE React app serves every role. The original diagram is kept
> further below for history.

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

### Original (pre-Entangible-One) architecture — historical

```
USB / PiCam / Continuity ─┐
                          ├─▶ qamposer-vision ─────▶ ┌─────────────────────────────┐
iPhone browser ───────────┘   (Python / OpenCV      │ qamposer-physical-host      │
  /capture page, JPEG          ArUco pipeline,      │ (FastAPI, HTTPS :8443)      │
  frames over /ws/frames       in-process thread)   │ • /ws/state broadcast hub   │
                                                    │ • serves display app        │
                                                    │ • /qamposer-api/* proxy ────┼──▶ qamposer-backend
display-app (React) ◀───────────────────────────────┤   (only if enabled)         │
  @qamposer/react                                   └─────────────────────────────┘
  controlled mode; realtimeAdapter = localAdapter (in-browser, default)
```

## Repo layout (uv workspace + one npm app; as built post-U3)

```
pyproject.toml            # uv workspace root
assets.toml               # physical dimensions (mm) — single source of truth for print AND detection
packages/
  qamposer-vision/        # Python ≥3.11: opencv-python-headless ≥4.8, numpy
    src/qamposer_vision/{markers,sources,board,grid,detector,stabilizer,circuit_builder,qasm,pipeline,annotate,cli}.py
  qamposer-physical-host/ # Python ≥3.11: fastapi, uvicorn, httpx, qrcode, cryptography
    src/qamposer_host/{main,config,hub,ws_state,ws_frames,proxy,preview,certs,static,token,layout,branding,cli}.py
  qamposer-assets/        # printable asset generator: SVG source of truth, cairosvg → PDF
    src/qamposer_assets/{config,marker_svg,tile_face,symbols,sheets,board,cheatsheet,cli}.py
pocket-app/               # THE app (Entangible One): Vite + React + TS + @qamposer/react
  src/{app/…, kiosk/…, debug/…, sources/…, vision/…, pipeline/…}
shared/                   # neutral cross-cutting layer, aliased @quantum / @shared
  {quantum/…, display/…, ws/…, capture/…, tokens.css}
hardware/                 # build123d 3D-printable tiles/cubes (colored 3MFs, print plates)
examples/                 # test-board PNGs, print-kit PDF, 3D-tiles ZIP
docs/{design,protocol,marker-ids,printing,pocket,booth-ux,mac-booth,iphone-capture,…}.md
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
`BoothSocketSource` \| `ManualEditSource` — the last per Jan 2026-07-19: an
explicit manual-editing input mode as fallback when no tiles/camera are
available or desired; enables on-screen gate placement via the editor's
native editing, camera strip hidden, everything downstream unchanged)
feeding one shared shell; everything below it is already
the shared `@quantum` layer. **Additionally (per Jan 2026-07-19):
`LocalPipelineSource` gets a pluggable FRAME input — `getUserMedia` or a
remote camera stream (e.g. the host's MJPEG endpoint)** — enabling the
"dumb network camera + one smart display" topology (a Pi serving only its
CSI cam; the app detects locally). This complements, not replaces,
`BoothSocketSource`: state broadcast stays the multi-viewer path (~1 KB per
change vs 1–2 Mbit/s per video viewer; byte-identical sync via `seq`; no
CV battery cost on passive phones). The host serves the unified app at `/` (it
already serves the pocket build at `/pocket`); the staff `/debug` becomes a
route of the same app.

**Staff security (per Jan 2026-07-19, lands with U1):** a single shared
**operator token**, generated by the host on first run (stored with the
certs; `qamposer-physical token` shows it, `--rotate-token` rotates).
Enforcement at the host: `select_camera`/`select_layout`/`select_mode` only
honored on connections whose `hello` carried `{role:'operator', key}`
(silently ignored otherwise); `/ws/frames` requires the token (closes frame
injection); `/debug` + MJPEG stream + `/api/qr` are key-gated (enter once →
localStorage; keyless visit shows a prompt). Viewer surfaces stay fully open.
Distribution: the staff cheat sheet embeds a `/debug?key=…` QR (possession of
the printed sheet = credential; cheatsheet CLI gains a `--token` option);
docs recommend the booth runs its own AP/hotspot at venues. No accounts —
right-sized for a booth appliance.

**Phases (each leaves everything working) — ALL IMPLEMENTED 2026-07-19
(commits e673edb..c31222f; suites 474 py + 400 ts at completion):**
1. **SC1** ✅ `e673edb` — move `display-app/src/quantum` → neutral top-level
   `shared/` (both apps alias); consolidate pure logic duplicates
   (displayWires, outcomes/histogram math, warnings, hints, inspectCopy
   already shared).
2. **SC2** ✅ `6ec1a36` — unify structural components behind the `classPrefix`
   pattern (Histogram, Celebrations, MessageStrip, QASM/State panels,
   Scorecard, TouchInspector) + one shared `tokens.css` (single design-system
   source).
3. **U1** ✅ `7fae89d` + `04cf0ed` — `StateSource` abstraction + WS source +
   operator-token security + viewer policy + visitor QR. (Ordering deviation:
   `/` kept serving display-app until U3 parity, rather than flipping at U1 —
   flipping earlier would have regressed the physical big screen.)
4. **U2** ✅ `71a9bee` — Camera role absorbs `/capture` (staff QR flips to the
   pocket camera role; zoomed crop is what streams).
5. **U3** ✅ `c31222f` — kiosk skin (`?kiosk`, vh scale) + host-layout mapping
   + `/debug` route; display-app deleted; M5 packages ONE app.

Consequences (now in effect): features ship once for all roles; one
deploy/test surface; M5 (RasQberry packaging) serves the same app that runs
at entangible.org. A static policy test pins the only `select_*` send sites
to the camera role and the /debug module.

### Take it home — run on real hardware (DECIDED per Jan 2026-07-19; T1 anytime, T2 after U1)

**Simplified per Jan 2026-07-19: ONE "Transfer to IBM Composer" button** in
the pocket app (visible whenever a circuit exists; also in the future viewer).
Behavior (SHIPPED, pocket-app/src/app/composerTransfer.ts): open the Composer
in a new tab with the circuit PRE-LOADED via `?initial=` — the payload is
`encodeURIComponent(LZString.compressToEncodedURIComponent(JSON.stringify(
{title, description, qasm})))` — and copy the QASM to the clipboard as a
belt-and-braces fallback. (URL format VERIFIED WORKING 2026-07-19: visually
confirmed by Jan on the live cloud Composer, logged-off; rediscovered from
the Qoffee-Maker family project, qoffeefrontend/app.js. An earlier
bundle-forensics pass had wrongly concluded the param was dead — a negative
grep proves nothing.) The prefill works logged-off, but RUNNING needs an
account, so toasts + Guide point to sign-in/registration at
quantum.cloud.ibm.com/registration (free). Copy/Download/Share and the Qiskit
snippet remain optional extras, not requirements. Original phase sketch kept
below for reference:
- **T1 QASM handoff** (standalone pocket, pre-U1 OK): "Take it home" section —
  Copy QASM / Download .qasm / Web-Share (AirDrop, mail). QASM is the
  interchange; Composer ingests .qasm uploads (documented path).
- **T2 viewer integration**: the visitor-QR Display role carries the same
  handoff — the booth-built circuit leaves on the visitor's phone.
- **T3 "Open in IBM Composer" guide**: Guide section with the account steps
  (free Open Plan) + upload + Run-on-QPU. During implementation, probe for an
  undocumented circuit-in-URL param (current cloud Composer documents only
  .qasm upload; old IQX had `?initial=`) — if found, one-tap prefill.
- **T4 Qiskit snippet**: generated copy-ready code (their circuit + SamplerV2
  boilerplate + clearly marked key/CRN slots) for Lab/local execution.

**Decision: NO in-app API-key/CRN entry.** Rationale: IBM's runtime API is
not browser-CORS-open, so in-app runs would proxy visitor credentials through
our server (unacceptable custody); and normalizing credential entry into
QR-opened third-party apps is an anti-pattern regardless of our
trustworthiness. T3/T4 achieve the same outcome with all credential moments
on IBM's own domain. Revisit only if IBM ships an OAuth device flow with
browser CORS.

### In-browser noise model (task #27; designed + implemented 2026-07-19)

**Why**: the booth's best teaching moment is "this is why quantum computing is
hard" — ideal vs realistic results side by side. Today that needs the optional
Qiskit backend (NoisyRun). A noise model in the browser makes the comparison
work with ZERO infrastructure — on entangible.org, on a visitor's phone,
offline — and pairs with the take-home story: *see ideal → see realistic →
run it for real via the Composer.*

**Method — full density matrix (DECIDED over alternatives).** At ≤5 qubits a
density matrix is 32×32 ≈ 1k complex numbers (16 KB); a gate application is
two 32³ complex matrix products ≈ microseconds in JS. So we can afford the
*honest* simulation: exact, deterministic (no sampling jitter in the bars),
every standard channel expressible as Kraus operators. Rejected: Monte-Carlo
Pauli trajectories (sampling noise in the display, many shots for smooth
bars) and readout-error-only (dishonest — no depth dependence, which is the
whole lesson).

**Channels** (applied in circuit order):
- *Depolarizing* after each gate on its qubits: 1-qubit `p1` (default 1e-3),
  2-qubit `p2` (default 8e-3) — ρ → (1−p)ρ + p/(4^k−1)·Σ PρP over the
  non-identity Paulis on the k participating qubits.
- *Amplitude damping + dephasing per MOMENT on every qubit* — including idle
  ones (pedagogically the point: a deep circuit decays even where nothing
  happens). Fixed per-moment γ₁ (default 2e-3) and γ_φ (default 2e-3),
  standard Kraus forms.
- *Readout error*: per-qubit confusion matrix (default p(flip) 2e-2,
  optionally asymmetric like real devices), applied classically to the final
  32-probability vector — cheap and exact.

This is the same channel family Qiskit's `NoiseModel.from_backend()` builds
from a device snapshot (depolarizing to match gate error + thermal
relaxation from T1/T2 + readout confusion) — deliberately, so parameters
can be *sourced from real devices*, not invented.

**Presets — parameters from IBM fake-backend snapshots (decided with Jan
2026-07-19).** The defaults above were hand-picked round numbers; instead,
extract them from `qiskit_ibm_runtime.fake_provider` calibration snapshots
(T1/T2, per-gate error + duration, per-qubit asymmetric readout error):
As built (per Jan 2026-07-19): **one preset per IBM chip generation**,
oldest to newest — keys `off | falcon | eagle | heron | nighthawk`:
- `falcon` — **FakeManilaV2** (5-qubit Falcon, 2021): its 5 qubits map 1:1
  onto our 5 wires, so this preset gets *per-qubit* T1/T2/readout for free
  and is a genuinely real early device — better story than an artificial
  "10× worse".
- `eagle` — **FakeBrussels** (127-qubit Eagle): device-wide medians; note
  Eagle's 2-qubit gate is `ecr` (slow, ~660 ns moment → heavier per-moment
  decay).
- `heron` — **FakeAachen** (156-qubit Heron): median 1q/2q gate error →
  p1/p2; median T1/T2 + a moment duration set to the median 2q-gate
  duration → per-moment γ₁/γ_φ; median readout confusion. Today's workhorse
  and the cleanest preset.
- `nighthawk` — **FakeBerlin** (120-qubit Nighthawk): same median
  extraction. IBM's newest chip generation — better T1 than Heron but
  early-calibration CZ and readout, an honest "new architectures start
  behind mature ones" datum.

The story arc "hardware is improving" is now literal, told in four real
chip generations. Sanity-check against the fixtures below that Bell stays visibly
degraded-but-Bell and GHZ-5 shows recognizable-but-eroded peaks; if a
median-based preset is too subtle on a 6-gate booth circuit, prefer
switching the statistic (e.g. worst-quartile qubits) over inventing
numbers. UI labels stay human ("Today's hardware"); the Guide/fine print
names the source ("based on an ibm_aachen calibration snapshot, 2026") —
consistent with the existing IBM trademark disclaimer.

**Implementation plan**:
- `shared/quantum/noise.ts`: `noisyProbabilities(circuit, params): number[]`
  over a small complex-matrix kernel (Float64Array, interleaved re/im).
  Refactor `statevector.ts` to EXPORT its gate unitaries (single source of
  gate definitions for both simulators — no drift).
- `tools/extract_noise_presets.py`: one-off uv script (dev dependency on
  `qiskit-ibm-runtime`, NOT a runtime dependency) that reads the fake
  backends and writes `shared/quantum/noisePresets.json` — checked in, with
  backend name + snapshot provenance in the file — so the browser never
  needs Qiskit and presets change only via a reviewed re-run.
- UI: the shared Histogram gains an optional paired-bar series (ideal solid,
  noisy dimmed/hatched; classPrefix-safe so booth + pocket both get it).
  Toggle lives in the settings drawer (`noise: 'off'|'today'|'early'`) and a
  kiosk/layout flag so booth staff can enable it from /debug. Golf stays
  ideal (targets are pure states). Backend NoisyRun remains, reframed:
  local = "simulated noise", backend = "real-device noise model / hardware".
- **Validation**: (1) `noise=0` must reproduce `statevector.ts`
  probabilities exactly (parity test); (2) closed-form goldens (depolarized
  Bell, amplitude-damped |1⟩, readout on known vectors); (3) JSON fixtures
  generated once with `qiskit.quantum_info` (DensityMatrix / Kraus), TS
  compares within 1e-9; (4) invariants: trace 1, Hermitian, probs sum to 1;
  (5) ballpark cross-check: Bell under `NoiseModel.from_backend(FakeAachen)`
  in Aer vs our simplified preset — same qualitative shape (no tight
  tolerance; ours is deliberately uniform-median, not per-qubit/per-gate).
- Phasing: NM0 math core + parity/goldens → NM1 histogram pairing + presets
  + settings → NM2 kiosk flag + docs + Guide sentence. Est. ~300 lines + tests.

**As built (2026-07-19).** Shipped in phases: NM0 density-matrix core +
parity/goldens (`bce1491`); one preset per IBM chip generation
falcon/eagle/heron/nighthawk (`6de3d53`, `2212566`); NM1 paired ideal/noisy
Histogram + `noise` setting + `?noise=` override + drawer UI (`b46abc0`); NM2
booth-wide operator control + docs + Guide sentence (this change). NM2 adds a
`noise` field to the `layout` broadcast and a `select_noise {preset}` operator
message (host validates + persists + replays; silently ignored from viewers,
like the other `select_*`), a `/debug` preset control, viewer/kiosk plumbing
(a booth-pushed preset overrides the local setting while connected; the kiosk
falls back to `?noise=` when the host broadcasts none). One deliberate
deviation from the plan above: the validation fixtures use `qiskit.quantum_info`
(DensityMatrix / Kraus) rather than Aer — independent, trusted linear algebra
applying the exact documented channel schedule, which carries less alignment
risk than matching Aer's implicit channel ordering.

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
