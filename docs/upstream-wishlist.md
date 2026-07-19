# Upstream wishlist — qamposer-react / qamposer-backend

> Changes we'd like in QAMP-62-Composer repos, discovered while building Entangible.
> **Asynchronous / non-blocking**: these need coordination with the other QAMPoser
> developer; Entangible proceeds with documented workarounds until releases land.
> Each section below is drafted so it can be pasted as a GitHub issue.

## 1. Export visualization panels from the main bundle (or unify contexts)

**Repo:** qamposer-react · **Priority: highest for Entangible**

The package ships two bundles — the main entry (`QamposerProvider`, `CircuitEditor`,
`localAdapter`) and `@qamposer/react/visualization` (`Qamposer`, `ResultsPanel`,
Q-sphere/histogram) — each defining its **own React context**. Mixing a controlled
`CircuitEditor` with `ResultsPanel` from the other bundle throws a context-mismatch
error, so an embedder can't compose "editor + results" from parts.

*Ask:* export `ResultsPanel` / `QSphereView` / `Histogram` from the main entry (or
make both entries share one context module). *Bonus:* an export that doesn't pull
Plotly for embedders who only need the histogram — Plotly is 1.5 MB gzip and heavy
for a Raspberry Pi kiosk.

*Workaround meanwhile (Entangible M3):* controlled `CircuitEditor` + a local
statevector-driven histogram; Q-sphere absent. We'd like to delete this.

## 2. Native S and T gate types

**Repo:** qamposer-react

Add `'S'` and `'T'` to `GateType` (gate table, colors — Z family, matrices in
`localAdapter`, `s`/`t` in `GATE_TO_QASM`/`QASM_TO_GATE`). Entangible has physical
S/T tiles today that emit `RZ(π/2)`/`RZ(π/4)` as a workaround, so the screen shows
"RZ(π/2)" where the tile in the visitor's hand says "S".

## 3. Controlled single-qubit gates (CH, CZ, CRX/CRY/CRZ…)

**Repo:** qamposer-react · **Larger feature — worth discussing scope first**

`Gate` already carries generic `control`/`target` fields, but only `CNOT` is
rendered/simulated/exported. Supporting `control` on any single-qubit gate type
(render ● + gate box, controlled-U in `localAdapter`, `ch`/`cz`/`crz`… in QASM)
unlocks a lovely physical interaction in Entangible: a ● tile in the same column
as any gate tile makes it controlled — ctrl-H with no new hardware.

## 4. `formatParameter` — defensive hardening (optional)

**Repo:** qamposer-react · **Hardening, not a live bug**

While porting `circuitToQasm` to Python for byte-identical output we initially
suspected `formatParameter` could emit an empty string for near-zero angles —
on closer analysis it cannot (the leading digit always survives the regex).
We still added an explicit `'' → '0'` guard + regression test in our fork as
an invariant lock. Take it or skip it — zero pressure.

## 5. Relax qamposer-backend to Python ≥ 3.11

**Repo:** qamposer-backend

`requires-python = ">=3.13"` forces a second uv-managed interpreter on Raspberry
Pi OS Bookworm (system Python 3.11, needed for picamera2). If 3.13-only features
aren't essential, `>=3.11` lets the RasQberry install use one venv.

---

*Coordination:* Jan reaches out to the other developer with these; happy to turn
any accepted item into a PR from the Entangible side. Items 2 and 4 are
PR-sized already; item 1 needs a short design chat (bundle/export strategy);
item 3 is a feature discussion.
