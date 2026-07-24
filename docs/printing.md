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

## Laser-cutting the tiles from wood

The `laser` command exports the gate tiles as **laser-shop-ready SVGs** — a
single-faced wood version of the tile kit. (Only the *tiles* are laser-cut; the
board mat stays printed paper/PDF — see below.)

```bash
# Kit nested onto the default 300×200 mm bed + one SVG per gate + a shop README
uv run qamposer-assets laser

# A bigger bed, and tell the cutter your kerf so pieces come out at nominal size
uv run qamposer-assets --bed 600x400 --kerf 0.15 laser
```

Laser options:

| Option        | Values          | Default   | Meaning                                                        |
| ------------- | --------------- | --------- | -------------------------------------------------------------- |
| `--bed WxH`   | mm, e.g. `300x200` | `300x200` | Laser bed size; tiles are grid-nested onto sheets of this size. |
| `--spacing`   | mm              | `3`       | Gap between nested tiles. Keep `--spacing ≥ --kerf`.           |
| `--kerf`      | mm              | `0`       | Laser kerf; outsets each cut outline by `kerf/2` (see below).  |
| `--out DIR`   | any path        | `out/assets` | Output directory.                                           |

Output layout (SVG only — laser shops import vector SVG, so no PDF is produced):

```
out/assets/laser/
  sheets/  kit-bed300x200-p01.svg …   (kit nested onto the bed, one file per sheet)
  tiles/   tile-10.svg … tile-45.svg  (one SVG per gate, for one-off cuts)
  README.txt                          (the shop notes: colour convention, kerf, validation)
```

### Layer / colour convention

The SVGs use the standard laser-shop **stroke-colour convention** — exactly two
colours, nothing else:

- **CUT** — the tile outline, a pure **red `#ff0000`** hairline stroke (`0.01 mm`,
  no fill). The cutter cuts the path centre-line all the way through.
- **ENGRAVE** — pure **black `#000000`**: the ArUco marker's dark modules, the
  gate label / glyph, and a thin border score. Raster- or vector-engrave; both
  read as black.

The marker **field is left bare** — there is no white fill and no page
background, so the natural light wood *is* the marker's "white". The geometry is
identical to the paper tiles (`assets.toml` is the single source of truth: 60 mm
tile, 36 mm marker), and the engraved module grid is byte-identical to what the
detector expects.

### Kerf

The laser beam removes a finite width of material (the *kerf*), so a cut drawn at
nominal size yields a piece that is kerf-narrow.

- **`--kerf 0` (default):** cut paths are drawn at **nominal** size and the
  README says the shop should apply their own kerf offset in the cutter software.
- **`--kerf k`:** each rectangular cut outline is **outset by `k/2`**, so the
  finished piece lands at the nominal 60 mm after the beam takes half the kerf
  from each side. (This is exact for the tiles because their outline is a
  rectangle — no offset geometry is approximated.) Keep `--spacing ≥ k` so a
  neighbouring tile's outset cut can never touch.

### Material, finish and grain

- Recommend **birch or maple plywood, matte finish** (no gloss / no glare-adding
  lacquer — glare kills marker detection, same as glossy paper).
- **Wood grain in the un-engraved (light) field is fine for detection.** The
  contrast the detector needs comes from the engraved dark modules against the
  bare wood, not from a perfectly uniform field.

### Validate one tile before batch-cutting

**Engrave one H tile first** (`out/assets/laser/tiles/tile-10.svg`). Photograph it
on the mat and point the pocket app ([entangible.org](https://entangible.org)) at
it; confirm the marker is detected and the gate reads as **H**. Only then cut the
full kit. If detection fails, deepen/darken the engrave for more contrast or
switch to a lighter ply.

### Single-faced tiles and the flip piece

Wood tiles are **single-faced** in laser v1. For a physical "flip" piece (two
gate faces back-to-back), **glue two tiles back-to-back**.

### Board mat is out of scope for laser

The `laser` command exports **only the gate tiles**. The board mat stays printed
paper/PDF — generate it with `qamposer-assets board` (see above) and print it at
100 % scale.

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
