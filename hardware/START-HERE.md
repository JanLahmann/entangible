# START HERE — which files do I actually print?

This zip holds every form of the Entangible tile kit. You will print a small
fraction of it. Answer three questions and you are down to one folder.

## 1. What printer do you have?

| Printer | Print these | Filaments |
| ------- | ----------- | --------- |
| **Multi-material, 4+ slots** (Prusa MMU, Bambu/other AMS) | `print-jobs/tile/plate*-batch*.3mf` | white + black + 2 accent colours per bed |
| **Two materials** (IDEX, toolchanger, MMU/AMS with 2 loaded) | `print-jobs/tile/bw-batch*.3mf` | white + black |
| **One nozzle, one filament** | `tile/*-mono-recessed.stl` (paint the wells) or `*-mono-raised.stl` (one filament swap) — recipe in `tile/mono.md` | white (+ paint pens or a dark filament) |
| **No 3D printer** | Close this zip — download `entangible-print-kit-A4.pdf` from the same release and print it on paper | — |

Every bed-ready `.3mf` opens in PrusaSlicer with each part already on its
filament slot (Bambu Studio / OrcaSlicer read the same colours). Load the
filaments in the order `plates.md` lists for that bed and slice.

## 2. Flat tiles or cubes?

- **`tile/`** (6 mm flat) — the default. Works with any camera angle.
- **`cube/`** (60 mm, gate names on the sides) — showy on a table, but wants a
  near-vertical camera; skip it for your first kit.
- **`tile-double/` / `cube-double/`** — two gates per piece (flip it over).
  Half the pieces to store; the colour beds need 3 accent slots (a 5-slot MMU).

## 3. The board

Print `print-jobs/<variant>/corners-batch*.3mf` (white + black): four corner
blocks that replace the printed mat, plus qubit-wire and measurement blocks.
`corners.md` in the same folder says which block goes where — **orientation
matters**. Or print the paper mat from the PDF kit instead.

## Before you print the whole kit

Print **one H tile**, point the app (<https://entangible.org>) at it, and
confirm it is detected. Matte filament, marker face up, ironing on. Details and
troubleshooting: `README.md` in this zip.

## What the bed-ready kit builds

The beds are a fixed, playable 32-tile set (duplicates included — five H, a
full GHZ-5 CNOT staircase, dial tiles for every rotation angle). Want a tile
the beds leave out (⊕ art, fixed-angle rotations)? Every design exists as a
per-piece file in `tile/` / `cube/` — print it separately.

## Folder map

```
START-HERE.md        you are here
README.md            the full hardware guide (printing, painting, magnets…)
tile/  cube/         one 3MF + STL parts per gate design (all designs)
tile-double/  cube-double/
print-jobs/<variant>/   bed-ready plates: plate*/bw-/corners-batch*.3mf
                        + plates.md (filament table) + corners.md (board)
```
