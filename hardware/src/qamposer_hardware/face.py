"""Pure-geometry description of a tile's top face — no build123d dependency.

Everything here is derived from ``assets.toml`` (via :mod:`qamposer_assets.config`)
and the marker bit matrix (via :func:`qamposer_assets.marker_svg.marker_bit_matrix`),
so the 3D face can never drift from the printed 2D face. :mod:`build` consumes
this to place solids; the test-suite consumes it to assert geometry invariants
without slicing.

Coordinate convention
---------------------
The 2D face (``qamposer_assets``) uses SVG coordinates: origin top-left, ``y``
increasing *downward*. The 3D tile is built with its footprint in the first
quadrant, ``x`` right, ``y`` up, ``z`` up (top face at ``z = height``). The map
is ``X = x_svg`` and ``Y = size - y_svg`` — a vertical flip so a camera looking
straight down the ``-Z`` axis sees the face exactly as the SVG (marker
orientation preserved).
"""

from __future__ import annotations

from dataclasses import dataclass

from qamposer_assets.config import AssetsConfig
from qamposer_assets.marker_svg import marker_bit_matrix
from qamposer_vision.markers import (
    MARKER_TABLE,
    ROTATION_ANGLES,
    GateSpec,
    pretty_angle,
)

__all__ = [
    "Rect",
    "ModuleCell",
    "FaceLayout",
    "DialLabel",
    "DialFace",
    "accent_color_name",
    "face_layout",
    "notch_count",
    "double_notch_rects",
    "COLOR_NAMES",
]

#: Depth of the coloured top face (last N mm of tile height) — the MMU colour
#: layer. Kept small so the body below stays single-colour white.
FACE_DEPTH = 0.8

#: assets.toml gate hex -> a human filament-slot name (for file names / plates).
COLOR_NAMES: dict[str, str] = {
    "#fa4d56": "red",
    "#002d9c": "blue",
    "#9f1853": "magenta",
    "#33b1ff": "cyan",
}


@dataclass(frozen=True, slots=True)
class Rect:
    """An axis-aligned rectangle in 3D face coordinates (mm), z implied by band."""

    cx: float
    cy: float
    w: float
    h: float

    @property
    def x0(self) -> float:
        return self.cx - self.w / 2.0

    @property
    def x1(self) -> float:
        return self.cx + self.w / 2.0

    @property
    def y0(self) -> float:
        return self.cy - self.h / 2.0

    @property
    def y1(self) -> float:
        return self.cy + self.h / 2.0

    @property
    def area(self) -> float:
        return self.w * self.h


@dataclass(frozen=True, slots=True)
class ModuleCell:
    """One ArUco module: its grid position and its 3D footprint rectangle."""

    row: int
    col: int
    bit: int  # 1 = black module, 0 = white
    rect: Rect


@dataclass(frozen=True, slots=True)
class DialLabel:
    """One per-edge angle label on a dial face, in 3D face coords (mm, y up).

    ``(cx, cy)`` is the label's centre; ``theta`` its CCW rotation (degrees) in
    the 3D face frame; ``text`` the pretty angle (e.g. ``"π/2"``); ``r`` the
    rotation index / edge it belongs to (0 top, 1 left, 2 bottom, 3 right at the
    canonical orientation). ``theta = 90·r``: turning the physical tile clockwise
    by ``r`` quarter-turns brings this edge to board-top reading upright — the
    exact convention of the 2D ``tile_face._dial_body``.
    """

    cx: float
    cy: float
    theta: float
    text: str
    r: int


@dataclass(frozen=True, slots=True)
class DialFace:
    """Dial-specific top-face geometry (edge labels, ▲ pointer, axis caption).

    All coordinates are 3D face coords (mm, origin bottom-left, y up). Present
    only on dial tiles (IDs 42/43/44); ``None`` on every classic tile. Mirrors
    :func:`qamposer_assets.tile_face._dial_body` exactly so the 2D print and the
    3D face are indistinguishable to a camera and a human.
    """

    labels: tuple[DialLabel, ...]  # the four per-edge angle labels
    pointer: tuple[tuple[float, float], ...]  # ▲ solid at canonical top: 3 (x, y)
    caption: str  # axis caption in the bottom band (e.g. "RX dial")
    caption_pos: tuple[float, float]  # caption centre (x, y)
    caption_font: float  # caption font size (mm)
    label_font: float  # edge-label font size (mm)


@dataclass(frozen=True, slots=True)
class FaceLayout:
    """Everything :mod:`build` needs to place the top-face colour regions."""

    marker_id: int
    spec: GateSpec
    size: float
    corner_radius: float
    frame_width: float
    band_height: float
    accent_hex: str
    accent_name: str
    white_field: Rect  # rounded, radius = corner_radius - frame_width
    inner_radius: float
    band: Rect  # the gate-colour label band (frame_width has no effect here)
    module_size: float
    modules: tuple[ModuleCell, ...]
    notch_count: int
    notches: tuple[Rect, ...]  # bottom-edge tactile slots (angle differentiation)
    label: str  # band caption text (e.g. "RX π/2"); "" for CNOT tiles
    dial: DialFace | None = None  # dial-face geometry (IDs 42/43/44), else None

    @property
    def black_cells(self) -> tuple[tuple[int, int], ...]:
        """(row, col) of every black module — mirrors ``marker_bit_matrix``."""
        return tuple((m.row, m.col) for m in self.modules if m.bit == 1)


def _flip_y(size: float, y_svg: float) -> float:
    return size - y_svg


def notch_count(spec: GateSpec) -> int:
    """Tactile-notch count encoding a rotation angle (0 for non-rotation tiles).

    ``1 = π/4, 2 = π/2, 3 = π, 4 = -π/2`` — the index of the angle in
    :data:`qamposer_vision.markers.ROTATION_ANGLES`, plus one. Non-rotation
    gates (no ``parameter``) get 0 notches.
    """
    if spec.parameter is None:
        return 0
    for idx, angle in enumerate(ROTATION_ANGLES):
        if abs(angle - spec.parameter) < 1e-9:
            return idx + 1
    return 0


def accent_color_name(hex_color: str) -> str:
    """Human filament-slot name for a gate hex (falls back to the bare hex)."""
    return COLOR_NAMES.get(hex_color.lower(), hex_color.lstrip("#").lower())


#: Double-faced pieces can carry *both* blues on one piece (e.g. X | Z), so they
#: need names that tell the two blues apart on a filename / plate. Only the two
#: blues are overridden; red and magenta keep their :data:`COLOR_NAMES` names.
DOUBLE_COLOR_NAMES: dict[str, str] = {
    "#002d9c": "darkblue",
    "#33b1ff": "lightblue",
}


def double_color_name(hex_color: str) -> str:
    """Filament-slot name for a double-faced piece (distinguishes the two blues)."""
    return DOUBLE_COLOR_NAMES.get(hex_color.lower(), accent_color_name(hex_color))


def _notch_rects(
    size: float, count: int, *, width: float = 1.6, depth: float = 1.5, pitch: float = 4.0
) -> tuple[Rect, ...]:
    """`count` slots centred on the bottom edge (y = 0), each cut ``depth`` in.

    Represented as rectangles centred on ``y = 0`` with full height ``2*depth``
    so that, when subtracted from the footprint, they always reach the edge and
    leave a clean ``depth``-deep slot inside the band.
    """
    if count <= 0:
        return ()
    rects: list[Rect] = []
    span = (count - 1) * pitch
    x0 = size / 2.0 - span / 2.0
    for i in range(count):
        cx = x0 + i * pitch
        rects.append(Rect(cx=cx, cy=0.0, w=width, h=2.0 * depth))
    return tuple(rects)


def double_notch_rects(
    size: float,
    count: int,
    *,
    edge: str,
    half: str,
    width: float = 1.6,
    depth: float = 1.5,
    pitch: float = 4.0,
) -> tuple[Rect, ...]:
    """Tactile notches for one face of a *double*-faced piece.

    ``edge`` selects the band edge the slots are cut into: ``"bottom"`` (y = 0,
    the top face's band edge) or ``"top"`` (y = size, where the mirrored bottom
    face's band lands). ``half`` places the cluster along that edge:
    ``"left"`` (centred on x = size/4), ``"right"`` (x = 3·size/4) or
    ``"center"`` (x = size/2). On a double-faced piece face A takes the LEFT
    half and face B the RIGHT half so the two faces' notches never collide or
    confuse; same-gate pieces would use ``"center"`` on both (the shipped kit
    has no same-gate pieces, but the option is kept).
    """
    if count <= 0:
        return ()
    cy = 0.0 if edge == "bottom" else size
    centres = {"left": size * 0.25, "right": size * 0.75, "center": size * 0.5}
    if half not in centres:
        raise ValueError(f"half must be left|right|center, got {half!r}")
    cluster_cx = centres[half]
    span = (count - 1) * pitch
    x0 = cluster_cx - span / 2.0
    rects: list[Rect] = []
    for i in range(count):
        cx = x0 + i * pitch
        rects.append(Rect(cx=cx, cy=cy, w=width, h=2.0 * depth))
    return tuple(rects)


def face_layout(marker_id: int, config: AssetsConfig) -> FaceLayout:
    """Build the :class:`FaceLayout` for a gate tile.

    Raises ``ValueError`` if ``marker_id`` is not a gate tile (corners 0-3 have
    no printable gate face).
    """
    spec = MARKER_TABLE[marker_id]
    if spec.kind != "gate":
        raise ValueError(f"marker {marker_id} is not a gate tile ({spec.label})")

    if spec.dial_axis is not None:
        return _dial_layout(marker_id, spec, config)

    t = config.tile
    size = t.size
    accent_hex = config.colors.for_gate(spec.gate)
    inner_radius = max(t.corner_radius - t.frame_width, 0.0)

    # White field (SVG: x=frame_width, y=frame_width, w=size-2fw, h=band_top-fw).
    field_w = size - 2 * t.frame_width
    field_h = t.band_top - t.frame_width
    field_cx = size / 2.0
    field_cy = _flip_y(size, t.frame_width + field_h / 2.0)
    white_field = Rect(cx=field_cx, cy=field_cy, w=field_w, h=field_h)

    # Label band (SVG: y in [band_top, size], full width).
    band_cx = size / 2.0
    band_cy = _flip_y(size, t.band_top + t.band_height / 2.0)
    band = Rect(cx=band_cx, cy=band_cy, w=size, h=t.band_height)

    # Marker modules from the exact OpenCV bit matrix.
    matrix = marker_bit_matrix(marker_id, config.aruco_dictionary)
    n = len(matrix)
    module = t.marker_size / n
    cells: list[ModuleCell] = []
    for r, row in enumerate(matrix):
        for c, bit in enumerate(row):
            x0 = t.marker_x + c * module
            y_svg_top = t.marker_y + r * module
            cx = x0 + module / 2.0
            cy = _flip_y(size, y_svg_top + module / 2.0)
            cells.append(
                ModuleCell(
                    row=r,
                    col=c,
                    bit=int(bit),
                    rect=Rect(cx=cx, cy=cy, w=module, h=module),
                )
            )

    nc = notch_count(spec)
    notches = _notch_rects(size, nc)

    label = "" if spec.gate == "CNOT" else _band_label(spec)

    return FaceLayout(
        marker_id=marker_id,
        spec=spec,
        size=size,
        corner_radius=t.corner_radius,
        frame_width=t.frame_width,
        band_height=t.band_height,
        accent_hex=accent_hex,
        accent_name=accent_color_name(accent_hex),
        white_field=white_field,
        inner_radius=inner_radius,
        band=band,
        module_size=module,
        modules=tuple(cells),
        notch_count=nc,
        notches=notches,
        label=label,
    )


def _band_label(spec: GateSpec) -> str:
    """Reuse the 2D face's caption logic so 3D and print never diverge."""
    from qamposer_assets.tile_face import tile_label

    return tile_label(spec)


def _dial_layout(marker_id: int, spec: GateSpec, config: AssetsConfig) -> FaceLayout:
    """:class:`FaceLayout` for a dial tile (IDs 42/43/44).

    Mirrors :func:`qamposer_assets.tile_face._dial_body` region-for-region so the
    2D print and the 3D face read identically. Differences from a classic tile:

    * the white field is the **full** inner square (no colour band) — a dial is
      turned about its own centre;
    * the ArUco marker is centred in that square (not pushed up under a band);
    * there are no tactile notches (the *orientation*, not a notch count, sets
      the angle); and
    * the accent carries a :class:`DialFace`: four per-edge angle labels, a ▲
      pointer at the canonical top edge, and the axis caption in the bottom band.

    Every position is the vertical flip (``Y = size − y_svg``) of the exact SVG
    coordinate the 2D face uses, so a camera looking down ``−Z`` sees the SVG.
    """
    t = config.tile
    size = t.size
    accent_hex = config.colors.for_gate(spec.gate)
    inner_radius = max(t.corner_radius - t.frame_width, 0.0)

    # Full inner white square (SVG: frame_width..size-frame_width both axes).
    field_w = size - 2 * t.frame_width
    centre = size / 2.0
    white_field = Rect(cx=centre, cy=centre, w=field_w, h=field_w)

    # Bottom band region — kept for structural parity with FaceLayout; it is NOT
    # a coloured band on a dial (the whole field is white), only the caption sits
    # there. The axis caption lives in DialFace.
    band = Rect(
        cx=centre,
        cy=_flip_y(size, t.band_top + t.band_height / 2.0),
        w=size,
        h=t.band_height,
    )

    # Centred ArUco marker (marker_x == marker_y == (size - marker_size) / 2).
    matrix = marker_bit_matrix(marker_id, config.aruco_dictionary)
    n = len(matrix)
    module = t.marker_size / n
    m0 = (size - t.marker_size) / 2.0
    cells: list[ModuleCell] = []
    for r, row in enumerate(matrix):
        for c, bit in enumerate(row):
            x0 = m0 + c * module
            y_svg_top = m0 + r * module
            cx = x0 + module / 2.0
            cy = _flip_y(size, y_svg_top + module / 2.0)
            cells.append(
                ModuleCell(
                    row=r,
                    col=c,
                    bit=int(bit),
                    rect=Rect(cx=cx, cy=cy, w=module, h=module),
                )
            )

    # Four per-edge angle labels. SVG edge midpoints (x, y_svg, r) exactly as in
    # _dial_body; flip y to 3D. theta = 90·r (CCW) is the 3D equivalent of the
    # SVG spin θ_svg = ((-90·r)+180) mod 360 − 180 under the y-flip.
    label_font = 4.0
    inset = 8.0
    svg_edges = (
        (centre, inset, 0),          # top    → r=0 (π/4, upright)
        (inset, centre, 1),          # left   → r=1 (π/2)
        (centre, size - inset, 2),   # bottom → r=2 (π)
        (size - inset, centre, 3),   # right  → r=3 (−π/2)
    )
    labels = tuple(
        DialLabel(
            cx=lx,
            cy=_flip_y(size, ly_svg),
            theta=(90.0 * r) % 360.0,
            text=pretty_angle(ROTATION_ANGLES[r]),
            r=r,
        )
        for lx, ly_svg, r in svg_edges
    )

    # ▲ pointer at the canonical (r=0) top edge, inside the frame.
    apex_y = t.frame_width + 0.9
    base_y = apex_y + 2.2
    pointer = (
        (centre, _flip_y(size, apex_y)),
        (centre - 1.7, _flip_y(size, base_y)),
        (centre + 1.7, _flip_y(size, base_y)),
    )

    caption = f"{spec.dial_axis} dial"
    caption_pos = (centre, _flip_y(size, size - t.frame_width - 1.6))
    dial = DialFace(
        labels=labels,
        pointer=pointer,
        caption=caption,
        caption_pos=caption_pos,
        caption_font=2.4,
        label_font=label_font,
    )

    return FaceLayout(
        marker_id=marker_id,
        spec=spec,
        size=size,
        corner_radius=t.corner_radius,
        frame_width=t.frame_width,
        band_height=t.band_height,
        accent_hex=accent_hex,
        accent_name=accent_color_name(accent_hex),
        white_field=white_field,
        inner_radius=inner_radius,
        band=band,
        module_size=module,
        modules=tuple(cells),
        notch_count=0,
        notches=(),
        label="",
        dial=dial,
    )
