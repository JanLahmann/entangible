# Entangible — booth experience spec (M3)

> UX/visual spec for the big-screen booth display. Owned by the design track;
> the display-app implements this. Context: a fair/booth screen viewed from
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

## Layout (16:9, dark `#161616`, IBM Plex Sans)

```
┌────────────────────────────────────────────────────────────┐
│ Entangible ●connected                          [72px bar]  │  header, muted
├──────────────────────────────────┬─────────────────────────┤
│                                  │                         │
│   circuit (controlled Qamposer)  │  histogram (localAdapter│
│   ~62% width, gates scaled up    │  realtime), bars in     │
│                                  │  Carbon blue            │
│                                  ├─────────────────────────┤
│                                  │  message strip (see ↓)  │
├──────────────────────────────────┴─────────────────────────┤
│ hint ticker: "● and ⊕ in the same column make a CNOT…"     │  40px, muted
└────────────────────────────────────────────────────────────┘
```

- Header: wordmark 28 px, connection dot 12 px (green `#42be65` / amber pulse
  while reconnecting). Nothing else.
- **Message strip** is the voice of the app (see Moments) — 32 px, one line,
  never two messages at once, 300 ms fade between.
- Warnings replace the hint ticker (not the message strip), amber `#f1c21b`
  text, friendly wording ("A ● tile is waiting for its ⊕ partner in column 3"),
  disappear with the cause.

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
