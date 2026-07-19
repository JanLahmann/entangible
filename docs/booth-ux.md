# Entangible — booth experience spec (M3)

> UX/visual spec for the big-screen booth display. Owned by the design track;
> the pocket app's `?kiosk` surface implements this. Context: a fair/booth
> screen viewed from
> 1–3 m by passersby who got no instructions, interact for ~30 seconds, and
> should leave having *felt* something quantum happen.

## Principles

1. **The table is the star.** The screen reacts; it never asks for input.
   No buttons in the main flow, no cursor, no menus.
2. **Every action gets a reaction ≤ 1 s.** Place a tile → the gate appears and
   the histogram moves. That immediacy *is* the product.
3. **Celebrate insight, not usage.** Fireworks are reserved for genuinely
   quantum moments (entanglement), not for placing any tile.
4. **Readable at 3 m.** Nothing informational below 24 px @1080p (≈0.55° visual
   angle at 3 m); headline moments 96–140 px.
5. **Pi-friendly motion**: CSS transforms/opacity + one canvas only; no blur
   filters; ≤ 150 confetti particles (`?lowpower` caps at 60, for Pi 4).

## Design system (v2 — exhibit grade, traQmania-derived)

> v2 (2026-07-18): Jan asked for a more professional, high-end look, in the
> spirit of traQmania's exhibit UI (`~/GitHub/traQmania/traqmania/web/`, a
> Fable-designed layout). We adopt its layered-surface system, scaled for 3 m.

**Design lineage** — three references, one synthesis:

| Reference | Concept | What we take | What we reject |
|---|---|---|---|
| IBM Quantum Composer | IDE workbench for a seated user: gate palette, circuit canvas, docked live panels (probabilities/Q-sphere), synced QASM pane | the *"circuit and its consequences at once"* dock; the **live synced QASM pane** (its signature); Carbon color/type discipline | palettes, toolbars, anything drag/clickable — input is the table |
| QAMPoser frontend | same workbench, literally `@carbon/react` g100 (operations \| circuit / probabilities \| Q-sphere / code column) | family identity: g100-adjacent darks, Plex, gate colors — booth must read as QAMPoser's sibling | the 50 cm information density |
| traQmania | exhibit UI for standing spectators: stage + stacked sidebar panels, pills, small-caps labels, layered surfaces | the whole spatial system: stage-first hierarchy, surface layering, pills, quiet chrome | its 14 px desktop scale (we scale ~1.4×) |

Checked against the **live IBM Composer** (quantum.cloud.ibm.com/composer,
screenshot 2026-07-18): near-black surfaces + hairline dividers, zero
decoration; quiet panel headers (plain title + caret + small icons);
syntax-colored synced QASM pane; probability bars in light cyan; exactly ONE
saturated primary button per screen ("Set up and run"). Adoptions below:
histogram bars go **cyan `#4589ff`→`#33b1ff` family** (not `--accent` blue);
the QASM pane gets IBM-style syntax tint (keywords cyan, literals magenta);
and the noisy-Run control, when a backend is present, is styled as the
booth's single primary blue button — it *is* our "Set up and run".

In one line: **a spectator surface with traQmania's bones, wearing the
composer family's skin, at 3 m scale.**

**Surface tokens** (replace flat `#161616`):

```css
--bg:        #0f1117;   /* page */
--bg-panel:  #161a22;   /* panels, top bar */
--bg-inset:  #11141b;   /* wells inside panels (histogram plot area, QASM) */
--border:    #262b36;   /* hairline 1px — the ONLY separator; no shadows */
--text:      #e6e9ef;
--muted:     #8a91a0;
--accent:    #0f62fe;   /* Carbon blue: bars, active states */
--entangle:  #7a5cff;   /* quantum purple: brand accent + entanglement moments */
--ok:        #2fbf71;  --warn: #f1c21b;  --danger: #e5484d;
```

Gate colors stay the Carbon/`@qamposer/react` set (tiles ⇄ screen identity).
Radius 8 px (booth scale of traQmania's 6). No gradients, no shadows, no blur —
depth comes from the three surface levels + hairline borders only.

**Type**: IBM Plex Sans; base 20 px @1080p. Section labels are traQmania-style
small caps: 15 px, `letter-spacing 0.08em`, weight 600, `--muted`, uppercase
("RESULTS", "STATE"). Numbers in IBM Plex Mono.

## Layout (stage + sidebar, 16:9)

```
┌──────────────────────────────────────────────────────────────┐
│ En̲tangible      ⬤ camera  ⬤ live  2 viewers      [56px bar] │ topbar, panel bg
├───────────────────────────────────────────┬──────────────────┤
│                                           │ RESULTS          │
│   STAGE — the circuit, full bleed         │ ┌──────────────┐ │
│   (controlled editor on --bg, generous    │ │ histogram in │ │
│    padding; wires + gates are the hero)   │ │ inset well   │ │
│                                           │ └──────────────┘ │
│   ── celebration banner + confetti are    │ STATE            │
│      STAGE OVERLAYS, not layout items ──  │  qubits touched…│ │
│                                           │ stat rows        │
│   ▁ message strip: overlay, bottom-left ▁ │ (Q-sphere panel  │
│                                           │  post-upstream)  │
├───────────────────────────────────────────┴──────────────────┤
│ hint ticker (muted) / warnings (amber)             [44px bar] │
└──────────────────────────────────────────────────────────────┘
```

- **Topbar** (`--bg-panel`, bottom hairline): wordmark 30 px — "En" in
  `--entangle` purple, "tangible" in `--text` (the pun, typeset); right side:
  status **pills** (traQmania-style: 999px radius, `--bg-inset`, hairline
  border, 8 px dot + label): camera kind, connection (green/amber pulse),
  viewer count. Pills are 3 m-legible but visually quiet.
- **Stage** (left, fluid): the circuit editor sits directly on `--bg` with
  generous padding — no panel box around the hero. Celebration banner +
  confetti render as absolutely-positioned stage overlays. **Message strip** is
  a bottom-left stage overlay in a subtle `--bg-panel` pill, 34 px text, one
  line, 300 ms fade, min 4 s dwell.
- **Sidebar** (right, 400 px @1080p ≈ 21%, `--bg-panel`, left hairline):
  stacked sections with small-caps labels. RESULTS: histogram bars in
  `--accent` on an inset well, axis labels Plex Mono `--muted`; reserve the
  slot where the Q-sphere panel lands post-upstream. STATE: stat rows
  (label `--muted` left / value Plex Mono right): qubits touched, gates,
  columns used. OPENQASM: the composer's signature — a compact live QASM pane
  (inset well, Plex Mono 17 px, last ~7 lines, gate lines tinted with their
  gate color at 60%, silent autoscroll). It syncs with every tile placed —
  visitors who know the IBM Composer recognize it instantly, and it
  photographs well. Bottom of sidebar: small "scan to learn more" QR
  when idle (optional, config-gated).
- **Footer** (`--bg-panel`, top hairline): hint ticker in `--muted`; warnings
  replace it in `--warn` amber with a leading ⚠ glyph, friendly wording
  ("A ● tile is waiting for its ⊕ partner in column 3"), gone with the cause.
- **Celebration banners** restyle to match: Bell = "ENTANGLEMENT!" in
  `--entangle` purple (not red — purple is the entanglement color across the
  system), GHZ = purple with count; confetti keeps the four gate colors.
- Attract mode inherits the surfaces (dim to 30%, same tokens), and its call
  to action uses the purple accent.

## Moments (message strip + celebrations)

State detection: compute the 5-qubit statevector from the circuit in TS
(32 amplitudes, trivial). Let *active qubits* = qubits touched by any gate.
Compare against canonical states up to global phase, fidelity ≥ 0.99.

| Trigger (on stable circuit change)         | Reaction |
|--------------------------------------------|----------|
| First gate ever this session               | strip: "q0 is alive!" (or actual qubit) |
| H placed, that qubit now in equal superposition | strip: "Superposition — q0 is 0 *and* 1" |
| X on \|0⟩                                  | strip: "Bit flip — q2 is now 1" |
| **Bell pair** (2 active qubits, fid vs (\|00⟩+\|11⟩)/√2) | **CONFETTI** + banner "ENTANGLEMENT!" + strip: "These qubits now answer together — measure one, know the other" |
| **GHZ-k** (k ≥ 3 active, fid vs (\|0…0⟩+\|1…1⟩)/√2) | bigger confetti + banner "GHZ STATE — k QUBITS ENTANGLED!" |
| All 5 rows carry an H (uniform superposition) | strip: "32 possibilities at once" |
| Board cleared after activity               | strip: "Ready for the next quantum architect" + reset achievements |

- **Banner**: centered overlay, 120 px condensed caps in gate-red `#fa4d56`
  (Bell) / Carbon purple `#8a3ffc` (GHZ), scales in (200 ms, ease-out-back),
  holds 2.5 s, fades 500 ms. Confetti burst from bottom corners, particles in
  the four gate colors, 1.8 s, gravity fall.
- **Anti-spam**: a celebration type fires once per "build session"; re-arm only
  after the board is emptied. 10 s global cooldown between any two
  celebrations. Never celebrate on reconnect replay (only on seq advance
  observed live).
- Strip messages: min 4 s on screen, drop intermediate messages if they queue.

> **DECIDED 2026-07-18: Variant A (stage & sidebar) is the booth layout**, with
> the refinements below. Golf mode may adopt cinema-style chrome later.

## Variant-A refinements (Jan, 2026-07-18)

- **Histogram form (final, Jan 2026-07-18): column bars + vertical bit-stack
  labels + zero-states hidden.** Bars stand vertically side by side; each
  column's label is its bit-string stacked vertically beneath it (top bit =
  q0, mirroring wire order), with a faint `q0…` guide column at the left.
  **Basis states with probability 0 are hidden** — this is what makes columns
  scale: Bell/GHZ show 2 columns, shallow circuits show few. When > 8 nonzero
  outcomes: sorted top-6 columns + aggregated-tail note; uniform
  superposition (all 2^k nonzero and equal): micro-column pattern block +
  "2^k equally likely" callout.
- **Touch (optional, config `--touch` / auto via `pointer: coarse`)**: touch
  never edits the circuit (the table is the editor). Touch = *inspect*: tap a
  gate → one-sentence info popover ("H puts q0 in superposition"); tap an
  outcome row → what that basis state means; tap the sphere in golf → replay
  the trajectory. Popovers auto-dismiss (6 s); attract-mode exits on touch too.
- **Golf-mode layout**: sidebar widens (22% → ~30%). Below the scorecard, a
  **mini recognized-circuit panel** (compact wires + gates) — visitors must
  always see what the camera read, in every mode.
- **Golf-mode animation** (builds on the layer-evolution idea in design.md):
  the target node carries the flag and *pulses* (2 s cycle); on every stable
  circuit change the ball replays from |0…0⟩ **gate-layer by gate-layer**
  (~600 ms per layer, physically-correct rotation arcs, fading purple trail);
  a subtle glow scales with fidelity as the ball nears the flag; fidelity
  ≥ 0.99 → hole-in celebration.

## Scaling, modes, branding, help (v2 additions, 2026-07-18)

**RESULTS at high qubit counts** — the sidebar histogram is **vertical**
(per Jan 2026-07-18): one row per outcome — mono basis label left, bar growing
right, % on the bar — sorted by probability. ≤8 outcomes: all rows, roomy.
More: top rows at full height, then the remaining outcomes as micro-rows
(the full distribution stays visible as a *pattern* even at 32 rows; labels
thin out to every 4th). Uniform superposition renders all-equal micro-rows +
a "2^k equally likely outcomes" callout — a featured state, not a failed
chart. (Variant B's bottom dock, being wide, may keep columns.) The Q-sphere
(post-upstream) is the scale-proof view and takes the RESULTS top slot when
available; bars become secondary.

**Dynamic layout (panel system)** — yes, IBM-Composer-style, adapted to a
screen with no input devices: every sidebar/dock section is a **panel** in a
registry (results, state, qasm, qsphere, golf-scorecard, branding …). A
layout = ordered list of visible panels + sidebar side (left/right) + stage
mode. Reconfiguration happens OFF the booth screen: a "Layout" card on
`/debug` (staff phone/laptop) with per-panel show/hide toggles and reorder
arrows, broadcast live via an additive `select_layout` WS message; persisted
to `layout.toml` next to `branding.toml`; URL params (`?panels=results,qasm`)
for one-off kiosk setups; per-mode presets (composer/golf/attract ship with
sensible defaults). The booth screen animates panel changes (200 ms slide,
reduced-motion aware) so reconfiguration during an event looks intentional.

**Display modes** — the booth is a mode host: `composer` (default), `golf`
(Bloch/Q-sphere golf, when built — stage becomes the sphere, sidebar becomes
the scorecard: hole, par, strokes = gates, best-of-day), `attract`. Switching:
staff selector on /debug (pills), additive `select_mode` WS message
(protocol v1 additive), `--mode` CLI flag, kiosk hotkey. Current mode reads as
a topbar pill. Golf hidden entirely until implemented.

**Event branding (white-label slot)** — topbar right end: "presented at" zone
(event logo ≤ 60% topbar height, white/mono recommended, optional event name),
configured via `branding.toml` (name, logo path, QR target override) served at
`/api/branding` + static logo. Attract mode carries the larger co-brand
("Entangible at ⟨event⟩"). Tokens never change per event — guest logos live
inside our system.

**Help & docs, by audience** — Visitors: no on-screen help ever (the table is
the tutorial); curious ones get the config-gated "scan to learn more" QR →
`/about`, a static page served by the host itself (offline-safe at venues):
what-is-this, gate cheatsheet, entanglement in one paragraph, project links;
the hint ticker rotates one-line facts as ambient education. Staff: /debug +
runbooks (mac-booth.md, iphone-capture.md, printing.md) + a printable
one-page cheat-sheet PDF emitted by qamposer-assets (commands, QRs,
troubleshooting). Developers: repo docs.

## Attract mode

- Enter: board empty AND no circuit change for 90 s.
- Content: full-screen slow loop (~12 s): Entangible wordmark; ghost H tile
  slides onto a drawn board → gate appears on a mini circuit; ghost ● ⊕ pair →
  mini confetti; text 48 px: "Build a quantum circuit with your hands —
  place a tile on the table". Subtle, ≤ 30% brightness; loop forever.
- Exit: ANY detection event with markers, or circuit change → instant cut
  (< 100 ms) back to the live view. Attract never covers a non-empty board.

## Optional noisy Run (only when `/api/health.backend.healthy`)

- A single quiet control in the histogram corner: "Run on a noisy simulator" —
  28 px, outline style; hidden entirely when backend is absent (booth default).
- On run: histogram shows ideal vs noisy side-by-side bars (ideal = Carbon blue
  `#0f62fe`, noisy = gray `#8d8d8d`), strip: "Real quantum computers are noisy —
  see the difference". Auto-reverts to ideal-only on next circuit change.
- Staff-only by intent: it's small, corner-placed, and mouse-operated.

## Non-goals (M3)

Sound (fairs are loud; revisit only if asked). Multi-language. Touch
interaction. Leaderboards. The /debug view stays as built in M2.
