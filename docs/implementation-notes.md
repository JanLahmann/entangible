# Implementation notes — model strategy

How to divide work between Claude models when implementing [design.md](design.md). Goal: conserve Fable 5 usage (it draws down limits much faster than Opus 4.8) while keeping it in the loop where its judgment pays off.

## Opus 4.8 — the default (~90% of the work)

The design doc is deliberately detailed enough that most milestones are execution, not invention. Run these as plain Opus 4.8 sessions (`/model opus`), one per milestone or work chunk:

- Scaffolding: uv workspace, the three Python packages, the Vite display app
- Well-specified modules: `markers.py` table, SVG/PDF asset generator, FastAPI routes and WS hub, React components, the camera role
- Tests, fixtures, the synthetic board renderer, golden files
- Deployment: install scripts, systemd units, kiosk launcher, docs

## Fable 5 — short, focused sessions only

- **Orchestration & milestone planning**: decompose the milestone into tasks, spawn Opus subagents (`Agent` calls with `model: "opus"`), integrate results.
- **Design changes**: anything that would alter design.md — architecture, the WebSocket protocol, the marker-ID scheme. Cross-cutting decisions with long consequences.
- **Milestone review gates**: review the full diff at the end of each milestone (M1–M6) before merging; verify against design.md's Verification section.
- **Hard-debugging escalation**: the known tricky spots — homography/grid-mapping errors, stabilizer hysteresis tuning on real footage, iPhone HTTPS + `getUserMedia` behavior, Pi libcamera/picamera2 integration. Rule of thumb: **if Opus fails twice on the same bug, escalate to Fable.**
- **Booth UI/UX direction**: one session producing a concrete visual spec (layout, celebration moments, type scale for a screen viewed from ~3 m, attract mode) — then Opus implements the spec.
- **Graphics design** (per Jan, 2026-07-18): all visual design of the physical kit — tile faces, board mat, cut sheets (docs/assets-design.md + assets.toml) — is Fable work; Opus implements the generator against that spec.

## Practical workflow

1. Start each milestone on Opus 4.8 with: *"Implement milestone Mn from docs/design.md"* (plus docs/implementation-notes.md for context).
2. Keep `~/GitHub/QAMP-62-Composer/` checked out next door — agents should read `@qamposer/react` source (adapters, `Circuit` types, `openqasm.ts`) rather than guess its API.
3. At milestone end: Fable review gate, then commit/merge.
4. Escalate to Fable only per the list above; return to Opus once unblocked.
