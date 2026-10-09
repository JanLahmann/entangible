# Entangible — design history and decision log

> The **current architecture** lives in [`design.md`](design.md). This file is
> the chronological record: the original approved design, the milestones, the
> decision log, phase-by-phase build notes, and the idea backlog. Nothing here
> is needed to understand the system as it runs today.

Design approved 2026-07-11 (planned in Claude Code on the web, ultraplan
session). Implementation followed milestones M1–M6 below.

## Original decisions (2026-07-11)

**Decided with the user:** ArUco fiducial markers on tiles (not symbol ML); v1 physical kit is printed PDF tiles + board mat (3D-printed STLs later, sharing the tile-face design); all three camera paths; the vision component is Python and feeds the existing `@qamposer/react` UI in controlled mode (no new editor); circuits also exposed as OpenQASM 2; **realtime simulation is noise-free in-browser via `localAdapter` — no backend required**; `qamposer-backend` is an *optional* add-on for noisy/real-hardware runs via `qiskitAdapter`.

## Original (pre-Entangible-One) architecture — superseded at U3

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

The two-app split (display-app + phone `/capture` page) was retired in the
Entangible One unification below.

## Milestones (each independently demoable)

1. **M1 – Assets + static detection** ✅: PDF tile sheets + board mats; `qamposer-vision detect --image photo.jpg --json --qasm`; synthetic render→detect→golden-JSON tests green. *Demo: photograph a printed board, get correct QASM.*
2. **M2 – Live loop** ✅: pipeline + stabilizer + host + display app; local camera → WS → live `@qamposer/react` circuit; `/debug`; `make demo` replay mode. *Demo: move tiles, screen follows.*
3. **M3 – Simulation** ✅: localAdapter realtime results + celebrations + booth polish; optional backend proxy + noisy Run. *Demo: build a Bell pair, confetti.*
4. **M4 – iPhone browser camera** ✅: getUserMedia → JPEG over `/ws/frames`, backpressure via `bufferedAmount`, wake lock, HTTPS cert story + QR; verified on iOS Safari. (The original `/capture` page became the pocket camera role in U2.)
5. **M5 – RasQberry packaging** (in progress): install script + systemd + kiosk autostart + `docs/rasqberry.md` shipped 2026-10-09 (`deploy/rasqberry/`); on-device perf validation on Pi 4/5 and a prebuilt flashable image still pending.
6. **M6 (stretch)** (partial): 3MF/STL tiles from shared faces ✅ (the `hardware/` package), dial tiles ✅, SWAP ✅, S/T ✅; marker-less symbol-recognition mode still an idea.

**S/T tiles (pulled forward from M6, per Jan 2026-07-18):** marker IDs 40 (S) and 41 (T), Z-family color. Until `@qamposer/react` gains native S/T gate types, the detector emits them as their RZ equivalents — S → RZ(π/2), T → RZ(π/4) — so simulation/QASM work unchanged (QASM shows `rz(pi/2)`, screen shows RZ(π/2)); tile faces are labeled S/T. Upstream issue: add native S/T to qamposer-react (gate table + matrices + `s`/`t` QASM), then drop the mapping.

**Upstream track (asynchronous, non-blocking — per Jan 2026-07-18):** all qamposer-react/-backend changes require coordination with the other QAMPoser developer; ready-to-post issue drafts live in docs/upstream-wishlist.md (panel exports/unified contexts → Q-sphere returns, native S/T, controlled gates, formatParameter fix, backend ≥3.11). Entangible does NOT block on this: M4→M5 proceed with the interim histogram; when an upstream release lands, swap the booth view back to the real panels and return realtime simulation to the adapter path (our statevector stays for moment detection + `?lowpower` fallback). **Hardware-validation prerequisite for M4/M5:** print the M1 kit (tiles + mat) — all testing so far is synthetic; real-photo fixtures should join the suite once printed. **M4 addition:** document the Mac-hosted booth setup (macOS application firewall allowance, TLS) — discovered 2026-07-18 that LAN access on a Mac host needs explicit firewall approval.

**Dial tiles (decided 2026-07-18, software side first; since shipped incl. hardware):** three new tiles 42/43/44 from the reserved range, angle selected by the tile's board-frame orientation. The conventions (45° steps, `DIAL_ANGLES`, face design) are current behavior — see `design.md`.

## Entangible One — decided target architecture (per Jan 2026-07-19)

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

**Staff security (per Jan 2026-07-19, landed with U1):** a single shared
**operator token**, generated by the host on first run (stored with the
certs; `qamposer-physical token` shows it, `--rotate` rotates).
Enforcement at the host: `select_camera`/`select_layout`/`select_mode` only
honored on connections whose `hello` carried `{role:'operator', key}`
(silently ignored otherwise); `/ws/frames` requires the token (closes frame
injection); `/debug` + MJPEG stream + `/api/qr` are key-gated (enter once →
localStorage; keyless visit shows a prompt). Viewer surfaces stay fully open.
Distribution: the staff cheat sheet embeds a `/debug?key=…` QR (possession of
the printed sheet = credential); docs recommend the booth runs its own
AP/hotspot at venues. No accounts — right-sized for a booth appliance.

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

## Take it home — phase sketch (T1–T4, decided 2026-07-19)

Superseded by the single "Transfer to IBM Composer" button (see `design.md`
for the shipped behavior and the standing no-in-app-credentials policy).
Original phases for reference:

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

Discovery note (2026-07-19): the `?initial=` prefill URL format was verified
working on the live cloud Composer (visually confirmed by Jan, logged-off),
rediscovered from the Qoffee-Maker family project (qoffeefrontend/app.js). An
earlier bundle-forensics pass had wrongly concluded the param was dead — a
negative grep proves nothing.

## In-browser noise model — implementation plan + build log (task #27, 2026-07-19)

The current channel design, presets and validation story are in `design.md`.
The original plan and phasing:

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
  Toggle lives in the settings drawer and a kiosk/layout flag so booth staff
  can enable it from /debug. Golf stays ideal (targets are pure states).
  Backend NoisyRun remains, reframed: local = "simulated noise", backend =
  "real-device noise model / hardware".
- Phasing: NM0 math core + parity/goldens → NM1 histogram pairing + presets
  + settings → NM2 kiosk flag + docs + Guide sentence. Est. ~300 lines + tests.

**As built (2026-07-19).** Shipped in phases: NM0 density-matrix core +
parity/goldens (`bce1491`); one preset per IBM chip generation
falcon/eagle/heron/nighthawk (`6de3d53`, `2212566`); NM1 paired ideal/noisy
Histogram + `noise` setting + `?noise=` override + drawer UI (`b46abc0`); NM2
booth-wide operator control + docs + Guide sentence. NM2 adds a
`noise` field to the `layout` broadcast and a `select_noise {preset}` operator
message (host validates + persists + replays; silently ignored from viewers,
like the other `select_*`), a `/debug` preset control, viewer/kiosk plumbing
(a booth-pushed preset overrides the local setting while connected; the kiosk
falls back to `?noise=` when the host broadcasts none). One deliberate
deviation from the plan: the validation fixtures use `qiskit.quantum_info`
(DensityMatrix / Kraus) rather than Aer — independent, trusted linear algebra
applying the exact documented channel schedule, which carries less alignment
risk than matching Aer's implicit channel ordering.

## Quantum Golf — original build plan (decided 2026-07-19)

Unified the former "Bloch Golf" and "Q-sphere Golf" ideas under one name:
**Quantum Golf**. Original plan: levels 1–5 where level = qubit count, level 1
on a Bloch sphere, 2–5 on the Q-sphere. Build phases:

- **QG0 rename**: pocket UI "Golf" → "Quantum Golf", holes → "Level 1…5"
  with qubit count shown; docs updated.
- **QG1 shared engine**: move pocket's `golf.ts` into the shared home
  (`@quantum`); add level metadata (number, name, view: bloch|qsphere).
- **QG2 Level-1 Bloch view**: 2D Bloch projection (SVG, shared math in
  `@quantum`, per-app styling): ball at the state's (θ,φ), |0⟩ pole top,
  target flag, family styling. Levels 2–5 keep the 2D Q-sphere.
- **QG2b standard Q-sphere display**: a true 3D-projected Q-sphere,
  Qiskit-style — |0…0⟩ north, latitude rings by Hamming weight, node radius =
  |amplitude|, fill = phase hue, stems to center — pure math + thin SVG
  renderers, no WebGL (≤32 nodes; painter's-algorithm depth sort;
  Pi-friendly). Motion = VIEW only: slow idle spin + drag-to-rotate — the
  camera moves, never the state.
- **QG3 booth golf mode**: BoothView `mode === 'golf'` renders the golf
  sidebar, hole-in celebrations, level advance on board clear — switched live
  from /debug. Same engine as pocket.

The game has since grown well beyond this plan (18 holes in four club-unlock
rounds, random courses with shareable seeds, computed-optimal solutions,
roll-the-ball state evolution — see the README); the plan is kept as the
origin record.

## Idea backlog (unscheduled)

### Standalone browser mode — runs on an iPhone

A zero-install variant of the whole loop as a single static HTTPS page (e.g. hosted on qamposer.org): camera via `getUserMedia`, ArUco detection in the browser (OpenCV.js/WASM or js-aruco2), circuit building in TS, display + `localAdapter` simulation as in the main display app. Runs on anything with a camera and a modern browser — notably an iPhone pointed at the tiles becomes a complete "pocket demo" (recent iPhones are far faster than the Pi 4 perf budget; hosting on a real domain also sidesteps the self-signed-cert story). Shares `MARKER_TABLE`, `assets.toml` geometry, and the printed tiles/mat with the main system; the TS circuit-builder port is validated against the Python golden fixtures. Deliberately *not* the primary architecture: it can't reach the Pi CSI camera (libcamera isn't visible to `getUserMedia`), and a phone screen can't replace the 3 m booth display (AirPlay mirroring reintroduces a second device; a kiosk Pi is more robust all-day). Positioning: an extra deployment target/marketing demo alongside M6, after the marker scheme and assets are stable (post-M1) and ideally reusing M3's display components. *(Since largely realized: the pocket app at entangible.org IS this mode.)*

### Rotation-as-dial tiles

Per Jan's question 2026-07-18: detection already recovers each marker's 90°-step orientation (both cv2 and the pocket TS detector match all 4 rotations) — but we discard it. Use it: **one rotation tile per axis**, where the placed orientation selects the angle (0°/90°/180°/270° → π/4, π/2, π, −π/2). Tile face redesign: dial-style, angle labels on all four edges, current-angle at top. Replaces 12 rotation tiles with 3; "turn the tile to turn the knob" is the most physical parameter control imaginable. Touches: detector APIs (expose rotation), circuit builder (angle from orientation), tile-face + 3D generators, marker-ids docs. Non-rotation tiles stay orientation-free. Caveat: hysteresis/stabilizer must treat orientation changes as gate changes (re-emission), and accidental slight rotations must snap to quadrants (they do — 90° steps). *(Since realized as the shipped dial tiles 42–44, with 45° steps.)*

### Adaptive qubit count on the display

Per Jan 2026-07-18: trim unused qubits from the on-screen view. The board keeps 5 physical rows and the wire circuit always reports `qubits: 5`, but the display could show only rows `0..max_used` (collapse trailing empty wires, min 2 for composure, gentle expand/collapse animation as tiles appear on lower rows). Biggest win is the **histogram**: a 2-qubit circuit reads as 4 bars instead of 32 sparse ones. Middle unused rows must stay visible (hiding them would break the physical row ↔ screen wire mapping visitors rely on); only trailing rows collapse. Purely display-level — protocol and QASM keep the full register. Pairs naturally with the 1-row mini-mat idea from Bloch Golf. *(The physical side was since subsumed by the qubit-wire blocks, #95.)*

### Physical Bloch Golf mode (superseded by Quantum Golf)

Optional booth game mode reusing **`bloch-golf`** (existing QAMPoser repo: React + Three.js/R3F game where each gate in a `@qamposer/react` circuit rolls a golf ball on a grass-textured Bloch sphere toward a target state, with par scoring, physically-correct rotation trajectories, and hole-in celebrations). Physical variant: visitors place gate tiles on the table; the ball rolls on the big screen. Integration is small because bloch-golf is already driven by circuit-change events from the same editor component — feed it the `/ws/state` circuit instead of on-screen edits (single-qubit: row 0 only, or a dedicated 1-row mini-mat; column order = shot order). Tile coverage: H/X/Y/Z and RX/RY/RZ angle variants exist from M1; S/T need the reserved IDs 40–49 (M6). Needs bloch-golf factored to accept an external circuit source (controlled mode) — coordinate upstream. Would slot in as an alternate display-app view (e.g. a `/golf` route or attract-mode rotation) after M3.

### Q-sphere Golf — multi-qubit extension (superseded by Quantum Golf)

Extend the golf concept beyond one qubit: the course becomes a **Q-sphere** (basis states as nodes arranged by Hamming weight; amplitude = node size, phase = node color), and the full tile set applies — including CNOT, so entanglement becomes part of the game. Holes are target multi-qubit states with par (e.g. \|11⟩, \|+ +⟩, Bell par 2: H + CNOT, GHZ par 3), scored by state fidelity against the target rather than a single ball position. This is a real game-design problem, not just a port: a multi-qubit state is a *distribution* over nodes, not a point, so the "ball" metaphor needs rethinking — e.g. amplitude flowing between nodes as animated trails (reusing bloch-golf's trajectory/celebration components and Three.js scene), or one ball per active basis state that splits on H and merges on interference. Builds on the physical Bloch Golf mode (same `/ws/state` feed, same tiles, now multi-row) and on `@qamposer/react`'s existing Q-sphere math for state→node layout. Candidate flagship demo: "putt a Bell state" makes entanglement tangible in a way single-qubit demos can't. Coordinate with bloch-golf upstream as a mode or sibling package (`qsphere-golf`).

**Q-sphere evolution as its own project (per Jan 2026-07-18):** the animated state-evolution Q-sphere likely deserves to be a separate package/repo (working name `qsphere-evolution`): a Three.js/R3F component taking a Circuit + gate layers and animating the state through them (physically-correct rotation arcs, amplitude flow between nodes). Consumers: qsphere-golf, Bloch Golf, the Entangible booth (step-through mode), `@qamposer/react` visualization, teaching notebooks. Would live in the QAMP-62 family → part of the async upstream coordination with the other developer. Per Jan: conceptually an **extension of "grokking the Bloch sphere"** (javafxpert/grok-bloch, RasQberry fork at ~/GitHub/rasqberry-grok-bloch — the interactive single-qubit Bloch sphere teaching app): grok-bloch shows *one qubit's* state responding to gates; qsphere-evolution generalizes that pedagogy to multi-qubit states on the Q-sphere with animated evolution through a whole circuit.

**Layer-by-layer evolution animation (for both golf modes, per Jan 2026-07-18):** on every stable circuit from the board, don't jump to the final state — replay the state's journey column by column: apply gate layer 1, animate the ball/amplitude flow along its trajectory, then layer 2, etc. (bloch-golf already animates single gate *additions* with physically correct rotation paths; this generalizes it to a full replay per circuit change, which is what the physical flow needs since tiles can appear anywhere, not just appended). Doubles as the teaching moment: visitors see *how* the state evolves through their circuit, not just where it lands. Also worth considering for the main booth view later (step-through of the Q-sphere on demand). *(Since realized in the pocket app as the roll-the-ball state evolution with per-column scrubber.)*
