# Test boards — on-screen detection testing without a printer

Open an image fullscreen on a monitor (high brightness, avoid glare)
and point a camera at it from ~30–60 cm with all four corner markers
in frame: the booth `/capture` page, the pocket app
(https://entangible.org), or `uv run qamposer-vision detect --image`.
Flip between images to simulate placing and moving tiles.

Regenerate: `uv run --with pillow python tools/make_example_boards.py`

- **01-empty.png** — Empty board — corners only; expect an empty circuit
- **02-single-h.png** — H on q0 — superposition
- **03-bell.png** — Bell pair — H then CNOT; expect the entanglement celebration
- **04-ghz3.png** — GHZ-3 — CNOT chain; repeated ●/⊕ ids exercise spatial dedupe
- **05-ghz5.png** — GHZ-5 — full-height CNOT staircase, golf hole 5
- **06-all-families.png** — Every gate family incl. S/T and rotations
- **07-uniform-32.png** — H on all five qubits — 32 equally likely outcomes (histogram stress)
- **08-lone-control.png** — Warning case — a ● with no ⊕ partner; expect a friendly warning, no CNOT
- **09-dials.png** — Dial tiles — RX/RY/RZ dials turned to r=0/1/2 → RX(π/4), RY(π/2), RZ(π)
