"""Tile cut-sheets: pack gate tiles onto printable pages for scissors + booth.

Layouts per format (from ``docs/assets-design.md``):

* A4     — 3 × 4 = 12 tiles/page
* A3     — 4 × 6 = 24 tiles/page
* Letter — 3 × 4 = 12 tiles/page

By default tiles are printed **edge-to-edge** (``[sheets] gutter = 0``): adjacent
tiles share a boundary, so each internal grid line is a single cut serving both
neighbours. Instead of per-tile corner crop marks (which would overlap or fall
inside a neighbour), every shared cut line gets a pair of short tick marks that
extend *outside* the tile block — top/bottom ticks for the vertical cuts,
left/right ticks for the horizontal cuts — never printing inside a tile. Setting
``gutter > 0`` restores classic per-tile corner crop marks.

Every page also carries a "print at 100 % scale" warning and a 100 mm
calibration ruler so booth staff can confirm the scale before cutting. Kit
composition (which tiles, how many) comes from ``[kit]`` in ``assets.toml``.
"""

from __future__ import annotations

from qamposer_vision.markers import DIAL_IDS, MARKER_TABLE, ROTATION_GATES

from .config import AssetsConfig
from .paper import calibration_ruler, page_size
from .svgbase import crop_marks, fmt, line, rect, svg_document
from .symbols import text
from .tile_face import gate_marker_ids, tile_body

__all__ = [
    "FORMAT_GRID",
    "kit_tile_ids",
    "one_of_everything_ids",
    "tile_sheet_svgs",
    "kit_sheet_svgs",
    "sample_sheet_svgs",
]

#: (columns, rows) of tiles per page, keyed by paper format.
FORMAT_GRID: dict[str, tuple[int, int]] = {
    "A4": (3, 4),
    "A3": (4, 6),
    "Letter": (3, 4),
}


# ---------------------------------------------------------------------------
# Tile selection
# ---------------------------------------------------------------------------


def _gate_id(gate: str, role: str | None = None) -> int:
    """First marker ID for a plain gate/role (no rotation parameter)."""
    for mid, spec in sorted(MARKER_TABLE.items()):
        if spec.kind != "gate" or spec.gate != gate or spec.parameter is not None:
            continue
        if role is not None and spec.role != role:
            continue
        return mid
    raise KeyError(f"no marker for gate={gate!r} role={role!r}")


def _rotation_ids() -> list[int]:
    """All rotation-variant marker IDs (RX/RY/RZ × each angle), sorted.

    Dial tiles (:data:`DIAL_IDS`) are excluded — they share the RX/RY/RZ gate
    families but carry no fixed angle, and are added to the kit separately.
    """
    return sorted(
        mid
        for mid, spec in MARKER_TABLE.items()
        if spec.kind == "gate"
        and spec.gate in ROTATION_GATES
        and spec.dial_axis is None
    )


def _dial_id(axis: str) -> int:
    """Marker ID of the dial tile for a rotation axis (``RX``/``RY``/``RZ``)."""
    for mid, spec in sorted(MARKER_TABLE.items()):
        if spec.dial_axis == axis:
            return mid
    raise KeyError(f"no dial tile for axis {axis!r}")


def kit_tile_ids(cfg: AssetsConfig) -> list[int]:
    """Expand ``[kit]`` quantities into a flat list of marker IDs to print.

    Standard booth kit: H×6, X×6, Y×4, Z×4, S×2, T×2, ●×4, ⊕×4, ××2 (SWAP),
    ``rotations_each`` of every rotation variant (12 variants), and one RX/RY/RZ
    dial each — 49 tiles by default.
    """
    k = cfg.kit
    ids: list[int] = []
    ids += [_gate_id("H")] * k.H
    ids += [_gate_id("X")] * k.X
    ids += [_gate_id("Y")] * k.Y
    ids += [_gate_id("Z")] * k.Z
    ids += [_gate_id("S")] * k.S
    ids += [_gate_id("T")] * k.T
    ids += [_gate_id("CNOT", "control")] * k.CNOT_control
    ids += [_gate_id("CNOT", "target")] * k.CNOT_target
    ids += [_gate_id("SWAP")] * k.swap
    for mid in _rotation_ids():
        ids += [mid] * k.rotations_each
    ids += [_dial_id("RX")] * k.rx_dial
    ids += [_dial_id("RY")] * k.ry_dial
    ids += [_dial_id("RZ")] * k.rz_dial
    return ids


def one_of_everything_ids() -> list[int]:
    """One tile of every printable gate (sorted by marker ID)."""
    return gate_marker_ids()


# ---------------------------------------------------------------------------
# Page layout
# ---------------------------------------------------------------------------


def _paginate(ids: list[int], per_page: int) -> list[list[int]]:
    return [ids[i : i + per_page] for i in range(0, len(ids), per_page)] or [[]]


def _page_footer(
    cfg: AssetsConfig, page_w: float, page_h: float, note: str
) -> str:
    fam = cfg.typography.font_family
    ink = cfg.colors.neutral.label
    faint = cfg.colors.neutral.faint
    margin = 10.0
    y = page_h - margin
    warning = text(
        page_w / 2.0,
        y - 5.0,
        "PRINT AT 100 % SCALE — no fit-to-page",
        size=4.0,
        color=ink,
        family=fam,
        anchor="middle",
        baseline="alphabetic",
    )
    ruler = calibration_ruler(
        margin, y, length=100.0, color=faint, family=fam
    )
    caption = text(
        page_w - margin,
        y - 5.0,
        note,
        size=3.4,
        color=faint,
        family=fam,
        weight="normal",
        anchor="end",
        baseline="alphabetic",
    )
    return warning + ruler + caption


def _cut_marks(
    origin_x: float,
    origin_y: float,
    cols: int,
    rows: int,
    tile: float,
    count: int,
    *,
    length: float = 3.0,
    gap: float = 1.0,
    stroke: str = "#000000",
    stroke_width: float = 0.2,
) -> str:
    """Shared cut-line ticks for an edge-to-edge (gutter-0) tile block.

    ``count`` tiles fill the ``cols`` × ``rows`` grid row-major, left to right,
    so the last row may be partial. Every shared/outer grid line gets a pair of
    short ticks that extend *outside* the occupied region — vertical cut lines
    get ticks above the top and below the bottom, horizontal cut lines get ticks
    left of the left edge and right of the right edge. Ragged bottom/right edges
    of a partial last row are followed exactly, so no tick ever lands inside a
    tile.
    """
    if count <= 0:
        return ""
    # Tiles per row and rows per column for a row-major, left-filled grid.
    cols_in_row = [min(max(count - r * cols, 0), cols) for r in range(rows)]
    rows_in_col = [sum(1 for r in range(rows) if r * cols + c < count) for c in range(cols)]

    segs: list[str] = []

    def vtick(x: float, y1: float, y2: float) -> None:
        segs.append(line(x, y1, x, y2, stroke=stroke, stroke_width=stroke_width))

    def htick(x1: float, x2: float, y: float) -> None:
        segs.append(line(x1, y, x2, y, stroke=stroke, stroke_width=stroke_width))

    # --- Vertical cut lines (column boundaries) ---
    # Top ticks: only for boundaries present in the (full or partial) first row.
    for i in range(cols_in_row[0] + 1):
        x = origin_x + i * tile
        vtick(x, origin_y - gap - length, origin_y - gap)
    # Bottom ticks: each boundary extends to the deepest adjacent column.
    for i in range(cols + 1):
        depth = 0
        if i - 1 >= 0:
            depth = max(depth, rows_in_col[i - 1])
        if i < cols:
            depth = max(depth, rows_in_col[i])
        if depth == 0:
            continue
        x = origin_x + i * tile
        y = origin_y + depth * tile
        vtick(x, y + gap, y + gap + length)

    # --- Horizontal cut lines (row boundaries) ---
    # Left ticks: only for boundaries present in the first column.
    for j in range(rows_in_col[0] + 1):
        y = origin_y + j * tile
        htick(origin_x - gap - length, origin_x - gap, y)
    # Right ticks: each boundary extends to the widest adjacent row.
    for j in range(rows + 1):
        width = 0
        if j - 1 >= 0:
            width = max(width, cols_in_row[j - 1])
        if j < rows:
            width = max(width, cols_in_row[j])
        if width == 0:
            continue
        x = origin_x + width * tile
        y = origin_y + j * tile
        htick(x + gap, x + gap + length, y)

    return "".join(segs)


def _layout_page(
    cfg: AssetsConfig,
    ids: list[int],
    page_format: str,
    cols: int,
    rows: int,
    note: str,
) -> str:
    page_w, page_h = page_size(page_format)
    tile = cfg.tile.size
    gutter = cfg.sheets.gutter

    block_w = cols * tile + (cols - 1) * gutter
    block_h = rows * tile + (rows - 1) * gutter
    origin_x = (page_w - block_w) / 2.0
    # Leave room at the bottom for the footer/ruler (~20 mm).
    top_margin = max((page_h - block_h - 20.0) / 2.0, 12.0)

    parts: list[str] = [rect(0, 0, page_w, page_h, fill="#ffffff")]
    for idx, marker_id in enumerate(ids):
        r, c = divmod(idx, cols)
        x = origin_x + c * (tile + gutter)
        y = top_margin + r * (tile + gutter)
        if gutter > 0:
            # Tiles are separated — classic per-tile corner crop marks.
            parts.append(crop_marks(x, y, tile, tile, length=3.0, gap=1.0))
        parts.append(
            f'<g transform="translate({fmt(x)},{fmt(y)})">'
            f"{tile_body(marker_id, cfg)}</g>"
        )
    if gutter <= 0:
        # Edge-to-edge: one shared cut per boundary, ticks outside the block.
        parts.append(_cut_marks(origin_x, top_margin, cols, rows, tile, len(ids)))
    parts.append(_page_footer(cfg, page_w, page_h, note))
    return svg_document(page_w, page_h, "".join(parts), title=note)


def tile_sheet_svgs(
    cfg: AssetsConfig,
    marker_ids: list[int],
    page_format: str = "A4",
    *,
    note: str = "Entangible tiles",
) -> list[str]:
    """Lay ``marker_ids`` onto one or more cut-sheet pages of ``page_format``."""
    try:
        cols, rows = FORMAT_GRID[page_format]
    except KeyError as exc:
        raise ValueError(f"unsupported sheet format {page_format!r}") from exc
    per_page = cols * rows
    pages = _paginate(list(marker_ids), per_page)
    total = len(pages)
    return [
        _layout_page(
            cfg,
            page_ids,
            page_format,
            cols,
            rows,
            f"{note} — page {i + 1}/{total} ({page_format})",
        )
        for i, page_ids in enumerate(pages)
    ]


def kit_sheet_svgs(cfg: AssetsConfig, page_format: str = "A4") -> list[str]:
    """The standard booth kit cut-sheet set."""
    return tile_sheet_svgs(
        cfg, kit_tile_ids(cfg), page_format, note="Entangible booth kit"
    )


def sample_sheet_svgs(cfg: AssetsConfig, page_format: str = "A4") -> list[str]:
    """A "one of everything" cut-sheet set."""
    return tile_sheet_svgs(
        cfg,
        one_of_everything_ids(),
        page_format,
        note="Entangible sample (one of each)",
    )
