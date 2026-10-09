# Entangible — printed asset design spec

> Graphics design for the physical kit (gate tiles + board mat). Owned by the design track;
> `qamposer-assets` implements this spec, `assets.toml` carries every dimension used by BOTH
> the generator and the vision pipeline. If a number here disagrees with `assets.toml`,
> `assets.toml` wins.

## Design principles

1. **The tile IS the gate on screen.** Tile colors are exactly `@qamposer/react`'s
   `GATE_COLORS` (CircuitEditor.tsx), so the object in a visitor's hand matches the gate
   that appears on the display: H `#fa4d56`, X `#002d9c`, Y `#9f1853`, Z `#33b1ff`,
   RX/RY `#9f1853`, RZ `#33b1ff`, CNOT `#002d9c`.
2. **Detection first.** The ArUco marker gets a clean white quiet zone (≥ 1 module width)
   on all sides; no ink inside it, ever. All decoration lives outside the quiet zone.
3. **Legible at arm's length, cheap to print.** Bold labels ≥ 6 mm cap height; pure
   CMYK-friendly flat colors, no gradients; matte paper recommended (glare kills markers).

## Gate tile — 60 × 60 mm

```
┌──────────────────────────────┐ ─ 0
│ ████ colored frame 2.5 mm ██ │
│ █┌────────────────────────┐█ │
│ █│      white field       │█ │ ─ 2.5
│ █│   ┌──────────────┐     │█ │ ─ 9      ← ≥6.5 mm quiet zone above
│ █│   │              │     │█ │
│ █│   │  ArUco 4×4   │     │█ │            marker 36 × 36 mm,
│ █│   │  36 × 36 mm  │     │█ │            x: 12…48, y: 9…45
│ █│   │              │     │█ │
│ █│   └──────────────┘     │█ │ ─ 45     ← ≥6 mm quiet zone below
│ █└────────────────────────┘█ │
│ ██████████  H  ████████████ │ ─ 51      ← label band 9 mm, gate color
└──────────────────────────────┘ ─ 60
```

- **Tile**: 60 × 60 mm, corner radius 4 mm, white background.
- **Frame**: 2.5 mm border in the gate color (rounds with the corners).
- **Marker**: 36 × 36 mm ArUco (`DICT_4X4_50`), centered horizontally (x 12–48),
  top edge at y = 9. Quiet zone: white on all sides — 9.5 mm left/right
  (12 − 2.5 frame), 6.5 mm top, 6 mm below. *Rationale for 36 mm (design.md said 40):
  at the design camera geometry (720p, 70–90 cm) 36 mm still yields ~10–14 px per
  marker bit vs ~2 px required; 40 mm leaves no room for a label band without
  violating the quiet zone.*
- **Label band**: y 51–60, filled with the gate color, white bold text centered,
  6 mm cap height (≈ 17 pt at 1:1):
  - Single-qubit: `H`, `X`, `Y`, `Z`
  - Rotations: `RX π/2`, `RY −π/2`, `RZ π` … (gate + angle, thin space between)
  - CNOT control: `●` + small caps `CONTROL`; target: `⊕` + `TARGET`.
    Draw ● and ⊕ as **vector shapes** (filled circle; circle + centered cross,
    stroke = 12 % of glyph height), not font glyphs — font fallbacks are unreliable.
- **Typography**: `IBM Plex Sans` Bold (open source, matches the IBM quantum
  aesthetic); fallback stack `Helvetica, Arial, sans-serif`. Document installing
  IBM Plex in docs/printing.md; CI must not fail if it's absent.
- **SVG layers** (semantic ids, per design.md, so M6 can extrude STLs):
  `#outline` (tile edge + frame), `#marker` (ArUco rects), `#symbol` (band + text).

## Board mat — 720 × 500 mm (fits A1 with trim)

Reads like a giant circuit diagram; neutral IBM-Carbon grays so the colored tiles pop.

- **Grid**: 5 rows (qubits) × 8 columns, 70 mm pitch. Cells 62 × 62 mm, outlined
  1 pt dashed `#c1c7cd`, white fill. Play area 560 × 350 mm, centered with a
  little extra top margin for the header.
- **Qubit wires**: 1.2 mm horizontal lines `#8d8d8d` through each row's cell
  centers, running the full grid width — the mat looks like an empty circuit.
- **Row labels**: `q0 |0⟩` … `q4 |0⟩`, IBM Plex Sans, 10 mm cap height, `#525252`,
  left of each wire. Column numbers `1…8` in `#a8a8a8` above the grid.
- **Corner markers**: ArUco IDs 0 (TL), 1 (TR), 2 (BR), 3 (BL), **40 mm**, placed
  in the mat corners with ≥ 8 mm white quiet zone; their *outer* corners define the
  homography rectangle (positions recorded in `assets.toml`).
- **Header**: "**Entangible**" wordmark (Plex Sans Bold, 24 mm caps, `#161616`) +
  tagline "the QAMPoser physical quantum circuit composer" (`#525252`), top center
  between the corner markers.
- **Footer**: CNOT rule, small + friendly: "● and ⊕ placed in the same column
  link into a CNOT" with tiny ●—⊕ glyph; qamposer.org / rasqberry.org credit line.
- **Variants**: single-page PDF (print shop, A1) and multi-page tiled A4/A3 with
  2 mm overlap + registration marks (crop marks + centerlines) per design.md.

## Cut sheets

- A4: 3 × 4 = 12 tiles/page, 5 mm gutters, crop marks at tile corners.
  A3/Letter layouts derived from the same tile SVGs (A3: 4×6=24; Letter: 3×4).
- **Standard booth kit** (3 A4 pages): the shared 32-tile set the 3D beds print
  too — H ×5, X ×5, ● ×4, SWAP ×4, Y/Z/S/T ×2, RX/RY/RZ dial ×2; no ⊕ (an X
  under a ● is the target) and no fixed-angle rotations (the dials cover them).
  Quantities live in `assets.toml` `[kit]`.
- Page footer on every sheet: "print at 100 % scale — no fit-to-page", plus a
  100 mm calibration ruler so booth staff can verify scale.

## Print production notes

- Matte cardstock ≥ 250 g/m²; laminate matte if reused across events.
- Markers must print pure black on pure white (no grayscale dithering).
- Tiles cut on crop marks; corner radius optional when hand-cutting (frame
  tolerates square corners).
