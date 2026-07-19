# Slack draft — upstream proposal to the QAMPoser co-developer

> Draft for Jan to send (edit freely; written to be pasted as one message,
> links at the end). Tone: peer-to-peer, zero pressure, he owns the decisions.

---

Hey! Quick update + a proposal. I've been building the physical tile version
of QAMPoser we talked about — it grew wings. It's now called **Entangible**:
printed (and 3D-printed) gate tiles on a board, a camera reads them, and
`@qamposer/react` renders the live circuit. There's a booth/kiosk stack for
the Pi, and a zero-install browser demo — try it: **https://entangible.org**
(point a phone at the test boards in the guide; it all runs client-side).

Building on top of `@qamposer/react` as an embedder was genuinely smooth —
controlled mode + `localAdapter` did exactly what your README promised. Along
the way I hit a handful of things that would make the library even better for
embedders, and I'd like to propose them:

1. **Export the visualization panels from the main bundle** (or share one
   React context between the two entries). Today `CircuitEditor` (main) and
   `ResultsPanel`/Q-sphere (visualization) can't be composed — the contexts
   clash — so Entangible currently ships its own histogram and has no
   Q-sphere. This is my #1 wish. (Bonus: a histogram export that doesn't pull
   Plotly would be lovely for the Raspberry Pi.)
2. **Native S and T gate types** — small: gate table, matrices, colors,
   `s`/`t` in the QASM maps. We have physical S/T tiles that currently emit
   RZ(π/2)/RZ(π/4) as a workaround, so the screen shows "RZ(π/2)" where the
   tile says "S".
3. **Controlled single-qubit gates** (CH, CZ, CRZ…) — bigger, worth a chat
   first. `Gate` already has generic `control`/`target` fields; supporting
   them for any single-qubit type would let a physical ● tile control *any*
   gate tile — and makes S vs RZ(π/2) physically distinguishable, which is a
   beautiful teaching moment.
4. **Tiny bug**: `formatParameter` in `openqasm.ts` returns an empty string
   for near-zero angles (`rx() q[0];`). One-line fix.
5. **qamposer-backend on Python ≥3.11** (from 3.13) would let the Pi run one
   venv alongside picamera2.

**How I'd like to work this**: no work lands on your plate. I'll implement
these in my fork, and offer each as a PR — you decide freely whether to
merge, modify, or rewrite (or decline!). Entangible will run against my fork
in the meantime, so there's zero time pressure on your side.

Also a heads-up on the games: I'm folding the golf ideas into **Quantum
Golf** — levels 1–5 matching qubit count, level 1 on a Bloch sphere,
2+ on the Q-sphere — first version is live in the Entangible pocket app.
Longer-term I'd love to extract the animated state-evolution Q-sphere as a
shared component (think grok-bloch, but multi-qubit) that bloch-golf,
Entangible, and maybe the main composer could all use. Curious what you
think.

Links:
- Live demo: https://entangible.org (guide: https://entangible.org/#guide)
- Repo: https://github.com/JanLahmann/entangible
- The full wishlist with details: https://github.com/JanLahmann/entangible/blob/main/docs/upstream-wishlist.md
