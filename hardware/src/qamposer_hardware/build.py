"""Turn a :class:`~qamposer_hardware.face.FaceLayout` into build123d solids.

Produces three MMU colour parts per tile — ``body`` (white), ``marker`` (black)
and ``accent`` (the gate colour) — all in one common coordinate frame so a
slicer merges them by "import as single object with parts". The parts are
manifold and share exact Z planes (the colour layer is the top ``face_depth``
mm of height), which is what per-layer MMU colour needs.

The band's caption glyphs are cut out of the accent part and left standing in
the white body, so they read white-on-colour exactly like the 2D face — there
is no separate glyph part.
"""

from __future__ import annotations

from dataclasses import dataclass

from build123d import (
    Align,
    Axis,
    Box,
    Circle,
    Cylinder,
    FontStyle,
    Location,
    Plane,
    Polygon,
    Pos,
    Rectangle,
    RectangleRounded,
    Solid,
    Text,
    chamfer,
    extrude,
    mirror,
)
from qamposer_assets.config import AssetsConfig

from .face import (
    FaceLayout,
    double_color_name,
    double_notch_rects,
    face_layout,
)
from .params import HardwareParams

__all__ = [
    "TileParts",
    "DoubleTileParts",
    "build_tile",
    "build_double_tile",
    "footprint_area",
    "build_mono_recessed",
    "build_mono_raised",
    "build_double_mono_recessed",
    "build_double_mono_raised",
]

#: Font used for the band caption. IBM Plex Sans (the print font) if the host
#: has it, else the same Helvetica/Arial fallback the 2D face declares.
_FONT = "Helvetica"
_CAP_TO_EM = 1.0 / 0.72


@dataclass(slots=True)
class TileParts:
    """The three colour solids of one tile plus the layout that produced them."""

    layout: FaceLayout
    variant: str
    height: float
    body: Solid  # white
    marker: Solid  # black
    accent: Solid  # gate colour

    def named_parts(self) -> list[tuple[str, str, Solid]]:
        """``(role, colour_name, solid)`` for each part, in print order."""
        return [
            ("body", "white", self.body),
            ("marker", "black", self.marker),
            ("accent", self.layout.accent_name, self.accent),
        ]


# --------------------------------------------------------------------------- #
# Sketch / solid helpers (algebra API)
# --------------------------------------------------------------------------- #


def _footprint(layout: FaceLayout):
    """Rounded 60x60 tile outline with the tactile bottom-edge notches removed."""
    prof = Pos(layout.size / 2.0, layout.size / 2.0) * RectangleRounded(
        layout.size, layout.size, layout.corner_radius
    )
    for nr in layout.notches:
        prof = prof - Pos(nr.cx, nr.cy) * Rectangle(nr.w, nr.h)
    return prof


def footprint_area(layout: FaceLayout) -> float:
    """Planar area (mm²) of the tile footprint (rounded corners, notches removed)."""
    return _footprint(layout).area


def _white_field_sketch(layout: FaceLayout):
    wf = layout.white_field
    if layout.inner_radius > 1e-6:
        shape = RectangleRounded(wf.w, wf.h, layout.inner_radius)
    else:
        shape = Rectangle(wf.w, wf.h)
    return Pos(wf.cx, wf.cy) * shape


def _extrude_top(sketch, height: float, face_depth: float) -> Solid:
    """Extrude a face sketch through the top ``face_depth`` mm of the tile."""
    return Pos(0.0, 0.0, height - face_depth) * extrude(sketch, amount=face_depth)


def _marker_solid(
    layout: FaceLayout, height: float, face_depth: float, bleed: float
) -> Solid:
    m = layout.module_size + 2.0 * bleed
    solid: Solid | None = None
    for cell in layout.modules:
        if cell.bit != 1:
            continue
        box = Box(m, m, face_depth, align=(Align.CENTER, Align.CENTER, Align.MIN))
        box = Pos(cell.rect.cx, cell.rect.cy, height - face_depth) * box
        solid = box if solid is None else solid + box
    if solid is None:  # no black modules should never happen for a real marker
        raise ValueError(f"marker {layout.marker_id} produced no black modules")
    return solid


def _fit_text(label: str, cap: float, max_w: float, max_h: float):
    """A bold text sketch of ~``cap`` cap-height, scaled to fit ``max_w``x``max_h``.

    Returned recentred on its bounding box so it can be placed by centre point.
    """
    fs = cap * _CAP_TO_EM
    sk = Text(label, font_size=fs, font=_FONT, font_style=FontStyle.BOLD)
    bb = sk.bounding_box()
    sw, sh = bb.size.X, bb.size.Y
    factor = 1.0
    if sw > 0:
        factor = min(factor, max_w / sw)
    if sh > 0:
        factor = min(factor, max_h / sh)
    if factor < 1.0:
        sk = Text(label, font_size=fs * factor, font=_FONT, font_style=FontStyle.BOLD)
        bb = sk.bounding_box()
    c = bb.center()
    return Pos(-c.X, -c.Y) * sk


def _glyph_sketch(layout: FaceLayout, config: AssetsConfig):
    """Band caption as a face sketch (letters, or CNOT glyph + word); or None."""
    spec = layout.spec
    size = layout.size
    band_cy = layout.band.cy
    cap = config.typography.band_cap_height

    if spec.gate == "CNOT":
        glyph_r = layout.band_height * 0.30
        glyph_cx = size * 0.26
        word = "CONTROL" if spec.role == "control" else "TARGET"
        word_x = size * 0.60
        if spec.role == "control":
            glyph = Pos(glyph_cx, band_cy) * Circle(glyph_r)
        else:
            stroke = 0.12 * (2.0 * glyph_r)
            ring = Circle(glyph_r) - Circle(glyph_r - stroke)
            horiz = Rectangle(2.0 * glyph_r, stroke)
            vert = Rectangle(stroke, 2.0 * glyph_r)
            glyph = Pos(glyph_cx, band_cy) * (ring + horiz + vert)
        word_sk = Pos(word_x, band_cy) * _fit_text(
            word, cap * 0.72, size * 0.46, layout.band_height - 2.0
        )
        return glyph + word_sk

    if not layout.label:
        return None
    max_w = size - 2.0 * layout.frame_width - 3.0
    return Pos(size / 2.0, band_cy) * _fit_text(
        layout.label, cap, max_w, layout.band_height - 2.0
    )


def _dial_text_sketch(label: str, font_size: float, theta: float):
    """A bold text sketch recentred on its bbox, spun ``theta`` degrees (CCW).

    Used for a dial's per-edge angle labels and axis caption; ``theta`` places
    each edge label so it reads upright once the tile is turned to bring that
    edge to board-top (see :class:`~qamposer_hardware.face.DialLabel`).
    """
    sk = Text(label, font_size=font_size, font=_FONT, font_style=FontStyle.BOLD)
    c = sk.bounding_box().center()
    sk = Pos(-c.X, -c.Y) * sk
    if theta % 360.0 != 0.0:
        sk = sk.rotate(Axis.Z, theta)
    return sk


def _dial_accent_sketch(layout: FaceLayout):
    """Dial accent as one face sketch: colour frame + edge labels + ▲ + caption.

    Unlike a classic tile (glyphs *cut out* of a colour band, reading
    white-on-colour), a dial's labels/pointer/caption are colour-**on-white**:
    they are unioned onto the frame ring so they stand proud of the white field
    in the gate colour, exactly like the 2D dial face.
    """
    dial = layout.dial
    assert dial is not None
    # Colour frame ring = full footprint minus the white inner square.
    sketch = _footprint(layout) - _white_field_sketch(layout)
    for lab in dial.labels:
        glyph = Pos(lab.cx, lab.cy) * _dial_text_sketch(
            lab.text, dial.label_font, lab.theta
        )
        sketch = sketch + glyph
    sketch = sketch + Polygon(*dial.pointer, align=None)
    cap = Pos(*dial.caption_pos) * _dial_text_sketch(dial.caption, dial.caption_font, 0.0)
    return sketch + cap


def _chamfer_bottom(body: Solid, amount: float) -> Solid:
    if amount <= 0:
        return body
    bottom_face = body.faces().sort_by(Axis.Z)[0]
    return chamfer(bottom_face.edges(), amount)


def _hollow(body: Solid, layout: FaceLayout, params: HardwareParams, height: float) -> Solid:
    inset = params.wall
    cav_w = layout.size - 2.0 * inset
    cav_r = max(layout.corner_radius - inset, 0.0)
    if cav_r > 1e-6:
        sk = RectangleRounded(cav_w, cav_w, cav_r)
    else:
        sk = Rectangle(cav_w, cav_w)
    sk = Pos(layout.size / 2.0, layout.size / 2.0) * sk
    cavity = Pos(0.0, 0.0, inset) * extrude(sk, amount=height - 2.0 * inset)
    return body - cavity


def _magnet_pockets(body: Solid, layout: FaceLayout, params: HardwareParams) -> Solid:
    r = params.magnet_diameter / 2.0
    cy = layout.size / 2.0
    for sx in (
        layout.size / 2.0 - params.magnet_offset,
        layout.size / 2.0 + params.magnet_offset,
    ):
        hole = Cylinder(
            radius=r,
            height=params.magnet_depth,
            align=(Align.CENTER, Align.CENTER, Align.MIN),
        )
        body = body - Pos(sx, cy, 0.0) * hole
    return body


# --------------------------------------------------------------------------- #
# Public entry point
# --------------------------------------------------------------------------- #


def build_tile(
    marker_id: int,
    config: AssetsConfig,
    *,
    variant: str,
    height: float,
    params: HardwareParams | None = None,
    magnets: bool = False,
) -> TileParts:
    """Build the three colour solids for one gate tile."""
    params = params or HardwareParams()
    layout = face_layout(marker_id, config)
    fd = params.face_depth

    # --- solid body (white), with relief / hollow / magnets ------------------
    body = extrude(_footprint(layout), amount=height)
    body = _chamfer_bottom(body, params.bottom_chamfer)
    if height > params.hollow_min_height:
        body = _hollow(body, layout, params, height)
    if magnets:
        body = _magnet_pockets(body, layout, params)

    # --- top colour face -----------------------------------------------------
    if layout.dial is not None:
        # Dial: colour frame + edge labels + ▲ + caption, all colour-on-white.
        accent = _extrude_top(_dial_accent_sketch(layout), height, fd)
    else:
        # Classic tile: accent = slab - white-field - glyphs (glyphs read white).
        slab = _extrude_top(_footprint(layout), height, fd)
        white_field = _extrude_top(_white_field_sketch(layout), height, fd)
        accent = slab - white_field
        glyph_sk = _glyph_sketch(layout, config)
        glyph_solid = (
            _extrude_top(glyph_sk, height, fd) if glyph_sk is not None else None
        )
        if glyph_solid is not None:
            accent = accent - glyph_solid

    marker = _marker_solid(layout, height, fd, params.marker_bleed)

    # White body = everything that is neither accent nor marker.
    white_body = body - accent - marker

    return TileParts(
        layout=layout,
        variant=variant,
        height=height,
        body=white_body,
        marker=marker,
        accent=accent,
    )


# --------------------------------------------------------------------------- #
# Double-faced pieces
# --------------------------------------------------------------------------- #


@dataclass(slots=True)
class DoubleTileParts:
    """Colour solids of a double-faced piece (face A on top, face B underneath).

    ``accents`` groups the accent geometry by filament colour: same-family pieces
    (CNOT, rotations, S | T) yield one accent solid; cross-family pieces (the
    mixed H/X/Y/Z pieces) yield two, one per gate colour.
    """

    layout_a: FaceLayout  # top face (as printed / viewed from above)
    layout_b: FaceLayout  # bottom face (mirrored; reads canonically once flipped)
    variant: str
    height: float
    body: Solid  # white
    marker: Solid  # black — both faces' markers
    accents: list[tuple[str, Solid]]  # (accent_hex, solid), grouped by colour

    def named_parts(self) -> list[tuple[str, str, str, Solid]]:
        """``(role, colour_name, colour_hex, solid)`` for each part, print order."""
        out: list[tuple[str, str, str, Solid]] = [
            ("body", "white", "#ffffff", self.body),
            ("marker", "black", "#000000", self.marker),
        ]
        for hexc, solid in self.accents:
            out.append(("accent", double_color_name(hexc), hexc, solid))
        return out


def _extrude_bottom(sketch, face_depth: float) -> Solid:
    """Extrude a face sketch through the bottom ``face_depth`` mm (z ∈ [0, fd])."""
    return extrude(sketch, amount=face_depth)


def _mirror_y(sketch, size: float):
    """Reflect a face sketch about the X axis at ``y = size/2`` (y → size − y).

    This is the "roll over the bottom band edge" flip expressed in the face
    plane: it repositions *and* reflects every region (marker, band, glyphs), so
    that once the physical piece is flipped over its bottom edge the underside
    reads unmirrored, band at the bottom, ArUco decodable.
    """
    return Pos(0.0, size, 0.0) * mirror(sketch, about=Plane.XZ)


def _double_footprint(layout: FaceLayout, notches_a, notches_b):
    """Rounded outline with face A's notches (bottom edge) and face B's (top)."""
    prof = Pos(layout.size / 2.0, layout.size / 2.0) * RectangleRounded(
        layout.size, layout.size, layout.corner_radius
    )
    for nr in (*notches_a, *notches_b):
        prof = prof - Pos(nr.cx, nr.cy) * Rectangle(nr.w, nr.h)
    return prof


def _bottom_marker_solid(
    layout: FaceLayout, size: float, face_depth: float, bleed: float
) -> Solid:
    """Face B marker in the bottom colour layer, mirrored (y → size − y)."""
    m = layout.module_size + 2.0 * bleed
    solid: Solid | None = None
    for cell in layout.modules:
        if cell.bit != 1:
            continue
        box = Box(m, m, face_depth, align=(Align.CENTER, Align.CENTER, Align.MIN))
        box = Pos(cell.rect.cx, size - cell.rect.cy, 0.0) * box
        solid = box if solid is None else solid + box
    if solid is None:
        raise ValueError(f"marker {layout.marker_id} produced no black modules")
    return solid


def build_double_tile(
    marker_a: int,
    marker_b: int | None,
    config: AssetsConfig,
    *,
    variant: str,
    height: float,
    params: HardwareParams | None = None,
) -> DoubleTileParts:
    """Build a double-faced piece: face A on top, face B mirrored underneath.

    ``marker_b is None`` means "same gate both sides" (kept for completeness; the
    shipped kit has no such piece). The two colour faces occupy the top and
    bottom ``face_depth`` mm; the white core fills the middle. No elephant-foot
    chamfer is applied — the underside is now a marker face.
    """
    params = params or HardwareParams()
    fd = params.face_depth
    mb = marker_a if marker_b is None else marker_b
    same = mb == marker_a

    layout_a = face_layout(marker_a, config)
    layout_b = face_layout(mb, config)
    size = layout_a.size

    # Notches: face A on the LEFT half of the bottom edge, face B on the RIGHT
    # half of the top edge (where its mirrored band lands); centred if same-gate.
    notches_a = double_notch_rects(
        size, layout_a.notch_count, edge="bottom", half="center" if same else "left"
    )
    notches_b = double_notch_rects(
        size, layout_b.notch_count, edge="top", half="center" if same else "right"
    )
    footprint = _double_footprint(layout_a, notches_a, notches_b)

    # --- white body (no bottom chamfer; hollow only for tall/cube heights) ----
    body = extrude(footprint, amount=height)
    if height > params.hollow_min_height:
        body = _hollow(body, layout_a, params, height)

    # --- top face A: accent = slab - white-field - glyphs (z ∈ [h-fd, h]) -----
    slab_top = _extrude_top(footprint, height, fd)
    wf_top = _extrude_top(_white_field_sketch(layout_a), height, fd)
    accent_a = slab_top - wf_top
    glyph_a = _glyph_sketch(layout_a, config)
    if glyph_a is not None:
        accent_a = accent_a - _extrude_top(glyph_a, height, fd)
    marker_top = _marker_solid(layout_a, height, fd, params.marker_bleed)

    # --- bottom face B: same construction, mirrored, z ∈ [0, fd] --------------
    slab_bot = _extrude_bottom(footprint, fd)
    wf_bot = _extrude_bottom(_mirror_y(_white_field_sketch(layout_b), size), fd)
    accent_b = slab_bot - wf_bot
    glyph_b = _glyph_sketch(layout_b, config)
    if glyph_b is not None:
        accent_b = accent_b - _extrude_bottom(_mirror_y(glyph_b, size), fd)
    marker_bot = _bottom_marker_solid(layout_b, size, fd, params.marker_bleed)

    marker = marker_top + marker_bot

    # Group accents by filament colour (one part if same-family, else two).
    hex_a = layout_a.accent_hex
    hex_b = layout_b.accent_hex
    if hex_a.lower() == hex_b.lower():
        accents: list[tuple[str, Solid]] = [(hex_a, accent_a + accent_b)]
    else:
        accents = [(hex_a, accent_a), (hex_b, accent_b)]

    white_body = body - marker
    for _hex, acc in accents:
        white_body = white_body - acc

    return DoubleTileParts(
        layout_a=layout_a,
        layout_b=layout_b,
        variant=variant,
        height=height,
        body=white_body,
        marker=marker,
        accents=accents,
    )


# --------------------------------------------------------------------------- #
# Single-colour ("mono") variants for filament printers without an MMU
# --------------------------------------------------------------------------- #
#
# The colour parts of a tile (marker + accent) already carry the exact art
# footprint as vertical prisms occupying the top ``face_depth`` mm (and, on a
# double piece, also the bottom ``face_depth`` mm). The mono builders reuse
# those solids verbatim — never re-deriving the artwork — and only reshape the
# Z profile:
#
#   * **recessed** — the default form: sink each colour footprint into the body
#     as a shallow paint-well pocket (``mono_pocket_depth`` deep, vertical
#     walls). One merged solid; paint the wells with acrylic pens.
#   * **raised** — the filament-swap form: stand each colour footprint proud of
#     the face by a uniform ``mono_raise_height`` so one M600 colour change at
#     that Z prints two-tone. A double piece raises both faces, so it prints
#     dark → light → dark with two swaps.


def _z_slab(size: float, z0: float, thickness: float) -> Solid:
    """A generous XY box spanning ``z ∈ [z0, z0+thickness]`` (for Z-band clipping).

    Wider than the tile footprint so intersecting a colour prism with it yields
    exactly that prism's XY footprint over the requested Z band.
    """
    return Pos(size / 2.0, size / 2.0, z0) * Box(
        3.0 * size, 3.0 * size, thickness, align=(Align.CENTER, Align.CENTER, Align.MIN)
    )


def _mono_colored(parts) -> Solid:
    """Union of every colour footprint of a piece (marker + all accents)."""
    if isinstance(parts, DoubleTileParts):
        solid = parts.marker
        for _hex, acc in parts.accents:
            solid = solid + acc
        return solid
    return parts.marker + parts.accent


def _mono_whole(parts) -> Solid:
    """The body with its colour footprints fused flush — one plain footprint prism.

    ``body`` already carries the hollow/chamfer/magnet features; adding the
    colour prisms back fills the top (and bottom, for a double) colour layer so
    the result is the tile's full outer volume with a flat, single-colour face.
    """
    return parts.body + _mono_colored(parts)


def build_mono_recessed(parts: TileParts, params: HardwareParams | None = None) -> Solid:
    """Single merged solid: the tile body with each colour region cut in as a pocket.

    Every colour footprint becomes a ``mono_pocket_depth``-deep, vertical-walled
    well below the top face; the surrounding white face is the raised rim that
    masks the paint edge. Reuses :class:`TileParts` solids — no artwork is
    re-derived.
    """
    params = params or HardwareParams()
    size = parts.layout.size
    h = parts.height
    depth = params.mono_pocket_depth
    whole = _mono_whole(parts)
    pocket = _mono_colored(parts) & _z_slab(size, h - depth, depth)
    return whole - pocket


def build_mono_raised(parts: TileParts, params: HardwareParams | None = None) -> Solid:
    """Single merged solid: the tile body with each colour region raised proud of it.

    The art stands a uniform ``mono_raise_height`` above the top face, so one
    filament swap at ``Z = height`` prints the body in colour 1 and all art in
    colour 2.
    """
    params = params or HardwareParams()
    size = parts.layout.size
    h = parts.height
    r = params.mono_raise_height
    whole = _mono_whole(parts)
    footprint = _mono_colored(parts) & _z_slab(size, h - r, r)  # z ∈ [h-r, h]
    raised = Pos(0.0, 0.0, r) * footprint  # z ∈ [h, h+r]
    return whole + raised


def build_double_mono_recessed(
    parts: DoubleTileParts, params: HardwareParams | None = None
) -> Solid:
    """Double-faced recessed piece: colour wells cut into **both** faces."""
    params = params or HardwareParams()
    size = parts.layout_a.size
    h = parts.height
    depth = params.mono_pocket_depth
    colored = _mono_colored(parts)
    whole = _mono_whole(parts)
    top_pocket = colored & _z_slab(size, h - depth, depth)  # z ∈ [h-d, h]
    bottom_pocket = colored & _z_slab(size, 0.0, depth)  # z ∈ [0, d]
    return whole - top_pocket - bottom_pocket


def build_double_mono_raised(
    parts: DoubleTileParts, params: HardwareParams | None = None
) -> Solid:
    """Double-faced raised piece: art raised on both faces (bottom art, then top).

    The white core sits in ``z ∈ [r, r+h]``; face-B art is the bottom ``r`` mm
    (``z ∈ [0, r]``) and face-A art the top ``r`` mm (``z ∈ [r+h, 2r+h]``). Print
    bottom-up this is dark → light → dark: swap to the body colour at ``Z = r``
    and back to the art colour at ``Z = r + height`` (two M600s).
    """
    params = params or HardwareParams()
    size = parts.layout_a.size
    h = parts.height
    r = params.mono_raise_height
    colored = _mono_colored(parts)
    core = Pos(0.0, 0.0, r) * _mono_whole(parts)  # z ∈ [r, r+h]
    top_fp = colored & _z_slab(size, h - r, r)  # z ∈ [h-r, h]
    top_art = Pos(0.0, 0.0, 2.0 * r) * top_fp  # z ∈ [r+h, 2r+h]
    bottom_art = colored & _z_slab(size, 0.0, r)  # z ∈ [0, r]
    return core + top_art + bottom_art
