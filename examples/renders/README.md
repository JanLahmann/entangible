# Renders

Isometric artwork of the 3D-printable gate cubes, generated from the SAME
sources as the print kit and the vision detector (tile faces, marker bit
matrices, gate colours, board geometry) — so the renders can never drift from
the physical kit.

- `cube-family.svg/.png` — the gate-cube family (H, X, Y, Z, CNOT ●/⊕, RX(π/2), S, T)
- `bell-on-mat.svg/.png` — H + CNOT cubes on the board mat forming a Bell pair

Regenerate:

```sh
uv run python tools/render_cube_art.py
```
