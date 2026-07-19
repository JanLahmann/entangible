# Printing the Entangible kit

How to turn the generated PDFs into a physical gate-tile + board-mat kit. The
geometry and colours come from [`assets.toml`](../assets.toml); the graphics
spec is [`docs/assets-design.md`](assets-design.md).

## Generate the PDFs

From the repo root:

```bash
# Everything (booth-kit + sample cut-sheets, board mat single-page + tiled)
uv run qamposer-assets all

# Just the tiles, on A3
uv run qamposer-assets --format A3 tiles

# Just the board mat, and keep the intermediate SVGs too
uv run qamposer-assets --svg board
```

Options:

| Option            | Values              | Default      | Meaning                                   |
| ----------------- | ------------------- | ------------ | ----------------------------------------- |
| `--format`        | `A4` `A3` `Letter`  | `A4`         | Paper size for cut-sheets and tiled mat.  |
| `--out DIR`       | any path            | `out/assets` | Output directory (git-ignored).           |
| `--svg`           | flag                | off          | Also write the source SVG next to each PDF. |
| `--assets-toml`   | path                | auto-locate  | Use an explicit `assets.toml`.            |

Output layout:

```
out/assets/
  tiles/  booth-kit_A4-p01.pdf … p05.pdf   (49 tiles → 5 A4 pages)
          sample_A4-p01.pdf … p02.pdf      (one of every gate)
  board/  board_full.pdf                    (720×500 mm, single page — print shops / A1)
          board_A4_tiled-p01.pdf … p09.pdf  (home-printer tiles, tape together)
```

### Per-format tile counts

Tiles are laid **edge-to-edge** (no gutter), so each boundary between two tiles
is a single shared cut — see "Paper, cutting and lamination" below.

| Format | Tiles/page | Booth-kit pages (49 tiles) | Board tiled pages |
| ------ | ---------- | -------------------------- | ----------------- |
| A4     | 3 × 4 = 12 | 5                          | 9 (3 × 3)         |
| A3     | 4 × 6 = 24 | 3                          | 4 (2 × 2)         |
| Letter | 3 × 4 = 12 | 5                          | 9 (3 × 3)         |

For a seamless mat, use `board_full.pdf` (single 720 × 500 mm page) at a print
shop; the tiled pages are for home printers.

## Print at 100 % scale — this matters

The markers are only detectable if the printed millimetres match `assets.toml`.

- In the print dialog choose **Actual size / 100 % / no "fit to page"/"shrink
  to fit"**. Every cut-sheet prints a **100 mm calibration ruler** in the
  footer — measure it with a real ruler before cutting a whole batch.
- Print **markers pure black on pure white** — turn off "toner save", greyscale
  dithering and colour management for the marker area. Dithered greys break
  detection.
- Each SVG/PDF carries real `mm` dimensions (`width`/`height` in mm with a
  matching `viewBox`), so a correctly configured printer reproduces exact size.

## Paper, cutting and lamination

From the spec's print-production notes:

- **Matte cardstock ≥ 250 g/m².** Matte, not glossy — glare from gloss or from
  glossy lamination kills marker detection under booth lights.
- If tiles are reused across events, **laminate matte**.
- **Tiles are printed edge-to-edge, so cut once per shared boundary** — a single
  straight cut splits the two neighbouring tiles at the same time. Line a ruler
  between the pair of tick marks that flank each grid line (the ticks sit
  *outside* the tile block, top/bottom for the vertical cuts and left/right for
  the horizontal cuts) and cut straight across. This halves the number of cuts
  versus per-tile gutters.
- **Sliver caveat:** the ArUco marker's quiet zone sits safely inside each
  tile's white field, but the 2.5 mm coloured frame runs right to the tile edge.
  A slightly-off cut therefore leaves a thin sliver of the neighbouring tile's
  frame colour on an edge — cosmetic only; detection is unaffected. To restore
  classic per-tile corner crop marks (with a gutter between tiles), set
  `[sheets] gutter` to a non-zero value in `assets.toml`.
- The 4 mm corner radius is optional when hand-cutting — the coloured frame
  tolerates square corners.
- **Board mat (single page):** send `board_full.pdf` to a print shop (fits A1
  with trim). **Tiled:** print the `board_*_tiled-*.pdf` pages at 100 %, trim on
  the crop marks, and align using the centreline registration ticks; adjacent
  pages share a 2 mm overlap.

## Fonts — IBM Plex Sans (recommended, not required)

Labels use **IBM Plex Sans Bold** (open source, matches the IBM Quantum
aesthetic) with a `Helvetica, Arial, sans-serif` fallback. Generation and CI do
**not** fail if IBM Plex Sans is absent — the renderer substitutes a system
sans-serif. For print output that matches the design exactly, install it:

- Download: <https://github.com/IBM/plex> (or `brew install --cask font-ibm-plex-sans`).
- The `●`/`⊕` CNOT glyphs and the tile frames are drawn as **vector shapes**,
  not font glyphs, so they render correctly regardless of installed fonts.

## SVG → PDF backend

PDFs are rendered from SVG via [`cairosvg`](https://cairosvg.org/), which needs
the native **libcairo** library:

- macOS: `brew install cairo`
- Debian/Ubuntu: `sudo apt install libcairo2`

The generator automatically adds common Homebrew/MacPorts/Linux library
directories to the loader search path, so `uv run qamposer-assets …` usually
works out of the box once libcairo is installed.

If libcairo cannot be loaded, the tool falls back to `svglib` + `reportlab`
(install with `uv pip install 'qamposer-assets[fallback]'`). If neither backend
is available it writes the **SVG files only** and exits non-zero with a hint —
you can still open or convert those SVGs elsewhere.
