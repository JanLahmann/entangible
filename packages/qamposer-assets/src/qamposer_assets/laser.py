"""Laser-cutter export: turn the gate tiles into laser-shop-ready SVGs.

The output follows the standard laser-shop **stroke-colour convention**:

* **CUT** — the tile outline, drawn as a pure-red (``#ff0000``) hairline stroke
  (``0.01 mm``) with no fill, so the cutter reads it as a through-cut vector.
* **ENGRAVE** — everything dark: the ArUco marker's black modules, the label /
  symbol artwork and a thin border score. All pure black (``#000000``).

There are exactly two colours in a laser SVG (red cut, black engrave) — no white
fills and no page background, so the natural (light) wood shows through in the
unengraved marker field. Wood grain in that light field is fine for detection;
the engraved dark modules provide the contrast (see ``docs/printing.md``).

The tile geometry is reused verbatim from the colour pipeline: the ArUco module
grid comes from :func:`marker_svg.marker_group` (byte-identical to what the
detector expects), and every dimension comes from ``assets.toml`` via
:mod:`config` (60 mm tile, 36 mm marker). Only the *colours* change — red/black
in place of the gate colour and white — so print and detection never drift.

Two shapes of output (see :mod:`cli`):

* **Sheets** — tiles grid-nested onto a laser bed (``--bed WxH`` mm, default
  300×200), one SVG per bed's worth of tiles. Simple row-major nesting; no clever
  packing.
* **Single tiles** — one SVG per gate for one-off cuts.
"""

from __future__ import annotations

from qamposer_vision.markers import (
    MARKER_TABLE,
    ROTATION_ANGLES,
    pretty_angle,
)

from .config import AssetsConfig
from .marker_svg import marker_group
from .svgbase import esc, fmt, rect, svg_document
from .symbols import control_dot, swap_cross, target_cross, text
from .tile_face import _CAP_TO_EM, _fit_font, _rotated_text, tile_label

__all__ = [
    "CUT_COLOR",
    "CUT_STROKE_MM",
    "ENGRAVE_COLOR",
    "BORDER_STROKE_MM",
    "DEFAULT_BED",
    "DEFAULT_SPACING_MM",
    "DEFAULT_MARGIN_MM",
    "DEFAULT_KERF_MM",
    "laser_tile_body",
    "laser_tile_svg",
    "laser_bed_grid",
    "laser_sheet_svgs",
    "laser_notes_text",
]

#: Pure red hairline = CUT. The laser-shop convention: red vectors are cut lines.
CUT_COLOR = "#ff0000"
#: Hairline stroke width (mm) for cut paths — the shop's cutter ignores the width
#: and cuts the path centre-line; 0.01 mm is the common "hairline" convention.
CUT_STROKE_MM = 0.01
#: Pure black = ENGRAVE (raster fills and score lines both read as engrave).
ENGRAVE_COLOR = "#000000"
#: Thin black score for the tile's border art (frame outline).
BORDER_STROKE_MM = 0.3

#: Default laser bed (width, height) in mm.
DEFAULT_BED: tuple[float, float] = (300.0, 200.0)
#: Default gap between nested tiles (mm). Keep it ≥ kerf so cut outsets can't touch.
DEFAULT_SPACING_MM = 3.0
#: Default clear margin from the bed edge (mm).
DEFAULT_MARGIN_MM = 10.0
#: Default kerf (mm); 0 draws cut paths at nominal size (shop applies its offset).
DEFAULT_KERF_MM = 0.0


# ---------------------------------------------------------------------------
# Engrave: border, marker, symbol (all pure black)
# ---------------------------------------------------------------------------


def _border(cfg: AssetsConfig) -> str:
    """A thin black score tracing the frame — the tile's engraved border art."""
    t = cfg.tile
    inset = t.frame_width
    radius = max(t.corner_radius - t.frame_width, 0.0)
    return rect(
        inset,
        inset,
        t.size - 2 * inset,
        t.size - 2 * inset,
        fill="none",
        stroke=ENGRAVE_COLOR,
        stroke_width=BORDER_STROKE_MM,
        rx=radius,
    )


def _symbol(spec, cfg: AssetsConfig, band_cy: float) -> str:
    """Black label / glyph artwork for a non-dial gate (mirrors ``tile_face``)."""
    t = cfg.tile
    ink = ENGRAVE_COLOR
    family = cfg.typography.font_family
    base_font = cfg.typography.band_cap_height * _CAP_TO_EM
    label = tile_label(spec)

    if spec.gate == "CNOT":
        glyph_r = t.band_height * 0.30
        glyph_cx = t.size * 0.26
        word = "CONTROL" if spec.role == "control" else "TARGET"
        word_font = _fit_font(word, t.size * 0.46, base_font * 0.72)
        if spec.role == "control":
            glyph = control_dot(glyph_cx, band_cy, glyph_r, fill=ink)
        else:
            glyph = target_cross(glyph_cx, band_cy, glyph_r, color=ink)
        caption = text(
            t.size * 0.60,
            band_cy,
            word,
            size=word_font,
            color=ink,
            family=family,
            letter_spacing=word_font * 0.06,
        )
        return glyph + caption

    if spec.gate == "SWAP":
        word_font = _fit_font("SWAP", t.size * 0.50, base_font * 0.72)
        caption = text(
            t.size * 0.40,
            band_cy,
            "SWAP",
            size=word_font,
            color=ink,
            family=family,
            letter_spacing=word_font * 0.06,
        )
        glyph = swap_cross(t.size * 0.76, band_cy, t.band_height * 0.30, color=ink)
        return caption + glyph

    max_w = t.size - 2 * t.frame_width - 3.0
    font = _fit_font(label, max_w, base_font)
    return text(t.size / 2.0, band_cy, label, size=font, color=ink, family=family)


def _dial_symbol(spec, cfg: AssetsConfig) -> str:
    """Black dial artwork: four edge angle labels, ▲ pointer, axis name."""
    t = cfg.tile
    ink = ENGRAVE_COLOR
    family = cfg.typography.font_family
    s = t.size
    axis = spec.dial_axis or spec.gate

    label_font = 4.0
    inset = 8.0
    cx = cy = s / 2.0
    edges = (
        (cx, inset, 0),       # top    → r=0
        (inset, cy, 1),       # left   → r=1
        (cx, s - inset, 2),   # bottom → r=2
        (s - inset, cy, 3),   # right  → r=3
    )
    parts: list[str] = []
    for lx, ly, r in edges:
        theta = ((-90 * r) + 180) % 360 - 180
        parts.append(
            _rotated_text(
                lx,
                ly,
                pretty_angle(ROTATION_ANGLES[r]),
                size=label_font,
                color=ink,
                family=family,
                theta=theta,
            )
        )
    apex_y = t.frame_width + 0.9
    base_y = apex_y + 2.2
    parts.append(
        f'<polygon points="{fmt(cx)},{fmt(apex_y)} '
        f'{fmt(cx - 1.7)},{fmt(base_y)} {fmt(cx + 1.7)},{fmt(base_y)}" '
        f'fill="{ink}" />'
    )
    parts.append(
        text(
            cx,
            s - t.frame_width - 1.6,
            f"{axis} dial",
            size=2.4,
            color=ink,
            family=family,
        )
    )
    return "".join(parts)


# ---------------------------------------------------------------------------
# One tile
# ---------------------------------------------------------------------------


def laser_tile_body(marker_id: int, cfg: AssetsConfig, *, kerf: float = 0.0) -> str:
    """Inner SVG for one laser tile: a ``#cut`` group and an ``#engrave`` group.

    The tile occupies ``(0, 0)`` … ``(size, size)`` in mm. With ``kerf`` > 0 the
    cut outline is **outset by ``kerf / 2``** so the finished piece lands at the
    nominal size after the beam removes half the kerf on each side (rect outlines
    make this exact). ``kerf`` = 0 draws the cut at nominal size and the shop
    applies its own offset.
    """
    spec = MARKER_TABLE[marker_id]
    if spec.kind != "gate":
        raise ValueError(f"marker {marker_id} is not a gate tile ({spec.label})")

    t = cfg.tile
    k2 = kerf / 2.0

    # --- #cut: outset red hairline outline -----------------------------------
    cut = (
        '<g id="cut">'
        + rect(
            -k2,
            -k2,
            t.size + kerf,
            t.size + kerf,
            fill="none",
            stroke=CUT_COLOR,
            stroke_width=CUT_STROKE_MM,
            rx=t.corner_radius + k2,
        )
        + "</g>"
    )

    # --- #engrave: border + ArUco modules + label, all pure black ------------
    if spec.dial_axis is not None:
        ms = t.marker_size
        marker = marker_group(
            marker_id,
            (t.size - ms) / 2.0,
            (t.size - ms) / 2.0,
            ms,
            dictionary=cfg.aruco_dictionary,
            group_id="marker",
            with_background=False,
        )
        symbol = _dial_symbol(spec, cfg)
    else:
        marker = marker_group(
            marker_id,
            t.marker_x,
            t.marker_y,
            t.marker_size,
            dictionary=cfg.aruco_dictionary,
            group_id="marker",
            with_background=False,
        )
        band_cy = t.band_top + t.band_height / 2.0
        symbol = _symbol(spec, cfg, band_cy)

    engrave = f'<g id="engrave">{_border(cfg)}{marker}{symbol}</g>'
    return f'<g id="laser-tile-{marker_id}">{cut}{engrave}</g>'


def laser_tile_svg(marker_id: int, cfg: AssetsConfig, *, kerf: float = 0.0) -> str:
    """A standalone single-tile laser SVG document (for one-off cuts)."""
    spec = MARKER_TABLE[marker_id]
    k2 = kerf / 2.0
    t = cfg.tile
    # Shift by k2 so a kerf-outset cut stays inside the document bounds.
    body = (
        f'<g transform="translate({fmt(k2)},{fmt(k2)})">'
        f"{laser_tile_body(marker_id, cfg, kerf=kerf)}</g>"
    )
    return svg_document(
        t.size + kerf,
        t.size + kerf,
        body,
        title=f"Laser tile {esc(spec.label)}",
    )


# ---------------------------------------------------------------------------
# Sheets (grid nesting onto a laser bed)
# ---------------------------------------------------------------------------


def _paginate(ids: list[int], per_page: int) -> list[list[int]]:
    if per_page <= 0:
        raise ValueError("per_page must be positive")
    return [ids[i : i + per_page] for i in range(0, len(ids), per_page)] or [[]]


def laser_bed_grid(
    cfg: AssetsConfig,
    bed_w: float,
    bed_h: float,
    *,
    spacing: float = DEFAULT_SPACING_MM,
    margin: float = DEFAULT_MARGIN_MM,
) -> tuple[int, int]:
    """(columns, rows) of tiles that fit a ``bed_w`` × ``bed_h`` mm bed.

    Row-major simple grid: ``n`` tiles need ``n·tile + (n-1)·spacing`` within the
    usable extent (bed minus a ``margin`` on each side). No rotation or
    interlocking — just a plain grid.
    """
    tile = cfg.tile.size
    pitch = tile + spacing
    avail_w = bed_w - 2.0 * margin
    avail_h = bed_h - 2.0 * margin
    cols = int((avail_w + spacing) // pitch) if avail_w >= tile else 0
    rows = int((avail_h + spacing) // pitch) if avail_h >= tile else 0
    return max(cols, 0), max(rows, 0)


def laser_sheet_svgs(
    cfg: AssetsConfig,
    marker_ids: list[int],
    bed_w: float = DEFAULT_BED[0],
    bed_h: float = DEFAULT_BED[1],
    *,
    spacing: float = DEFAULT_SPACING_MM,
    margin: float = DEFAULT_MARGIN_MM,
    kerf: float = 0.0,
) -> list[str]:
    """Grid-nest ``marker_ids`` onto one or more ``bed_w`` × ``bed_h`` mm sheets."""
    cols, rows = laser_bed_grid(cfg, bed_w, bed_h, spacing=spacing, margin=margin)
    if cols <= 0 or rows <= 0:
        raise ValueError(
            f"bed {fmt(bed_w)}×{fmt(bed_h)} mm too small for a "
            f"{fmt(cfg.tile.size)} mm tile with {fmt(margin)} mm margin"
        )
    per_sheet = cols * rows
    pages = _paginate(list(marker_ids), per_sheet)
    total = len(pages)
    tile = cfg.tile.size
    pitch = tile + spacing

    svgs: list[str] = []
    for i, page_ids in enumerate(pages):
        parts: list[str] = []
        for idx, marker_id in enumerate(page_ids):
            r, c = divmod(idx, cols)
            x = margin + c * pitch
            y = margin + r * pitch
            parts.append(
                f'<g transform="translate({fmt(x)},{fmt(y)})">'
                f"{laser_tile_body(marker_id, cfg, kerf=kerf)}</g>"
            )
        title = (
            f"Laser sheet {i + 1}/{total} — {fmt(bed_w)}×{fmt(bed_h)} mm bed "
            f"(red=cut, black=engrave)"
        )
        svgs.append(svg_document(bed_w, bed_h, "".join(parts), title=title))
    return svgs


# ---------------------------------------------------------------------------
# Shop notes (emitted alongside the SVGs)
# ---------------------------------------------------------------------------


def laser_notes_text(
    *,
    bed_w: float,
    bed_h: float,
    spacing: float,
    margin: float,
    kerf: float,
    cols: int,
    rows: int,
) -> str:
    """Plain-text README for the laser shop, emitted next to the SVGs."""
    kerf_line = (
        f"Cut paths are OUTSET by kerf/2 = {fmt(kerf / 2.0)} mm "
        f"(kerf = {fmt(kerf)} mm), so finished pieces land at nominal size."
        if kerf > 0
        else "Cut paths are drawn at NOMINAL size (kerf = 0). Apply your kerf "
        "offset in the cutter software."
    )
    return f"""Entangible — laser-cut wood gate-tile kit
============================================

Layer / colour convention (standard laser-shop stroke colours):

  CUT      pure red  {CUT_COLOR}  hairline stroke ({fmt(CUT_STROKE_MM)} mm), no fill
           -> the outer tile outline; cut all the way through.
  ENGRAVE  pure black {ENGRAVE_COLOR}
           -> the ArUco marker's dark modules, the gate label / glyph, and a
              thin border score. Raster- or vector-engrave; both read as black.

There are exactly two colours in every SVG. Everything red is a cut; everything
black is an engrave. The marker FIELD is left bare (no fill) — the natural light
wood is the marker's "white". Do NOT flood-fill or paint the field.

Kerf
----
{kerf_line}
Keep tile spacing >= kerf so neighbouring cut outsets never touch (current
sheet spacing = {fmt(spacing)} mm).

Sheets
------
Bed: {fmt(bed_w)} x {fmt(bed_h)} mm, {fmt(margin)} mm margin, {fmt(spacing)} mm
spacing -> {cols} x {rows} = {cols * rows} tiles per full sheet (simple grid).
Single-tile SVGs (tiles/tile-*.svg) are provided for one-off cuts.

Material & finish
-----------------
Birch or maple plywood, MATTE finish (no gloss / no lacquer that adds glare).
Dimensions come from assets.toml: nominal tile 60 mm, marker 36 mm. Wood grain
in the un-engraved (light) field is fine for detection; the engraved dark
modules give the contrast.

VALIDATE BEFORE BATCH-CUTTING
-----------------------------
Engrave ONE H tile first (tiles/tile-10.svg). Photograph it on the mat and point
the pocket app (https://entangible.org) at it; confirm the marker is detected and
the gate reads as H. Only then cut the full kit. If detection fails, increase
engrave contrast (deeper / darker engrave) or switch to a lighter ply.

Single-faced / flip pieces
--------------------------
Wood tiles are single-faced (v1). For a physical "flip" piece, glue two tiles
back-to-back.

Board mat
---------
The board mat is NOT part of the laser export — it stays printed paper/PDF
(see docs/printing.md). Only gate tiles are laser-cut here.
"""
