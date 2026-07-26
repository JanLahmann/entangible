"""Turn a :class:`~qamposer_hardware.face.FaceLayout` into build123d solids.

Produces three MMU colour parts per tile — ``body`` (white), ``marker`` (black)
and ``accent`` (the gate colour) — all in one common coordinate frame so a
slicer merges them by "import as single object with parts". The parts are
manifold and share exact Z planes (the colour layer is the top ``face_depth``
mm of height), which is what per-layer MMU colour needs.

The band's caption glyphs are cut out of the accent part and left standing in
the white body, so they read white-on-colour exactly like the 2D face — there
is no separate glyph part.

A **cube**-height body additionally carries the gate's name on all four vertical
side faces as a flush colour inlay in the gate's own accent colour (see
:func:`side_label_solids`), so a cube is identifiable from across a table
without looking down at it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

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
    scale,
)
from qamposer_assets.config import AssetsConfig

from .face import (
    WIRE_STROKE_MM,
    FaceLayout,
    Rect,
    corner_face_layout,
    double_color_name,
    double_notch_rects,
    face_layout,
    qubit_wire_face_layout,
)
from .params import HardwareParams

__all__ = [
    "TileParts",
    "DoubleTileParts",
    "SideLabel",
    "build_tile",
    "build_corner_block",
    "build_qubit_wire_block",
    "qubit_wire_accent_sketch",
    "qubit_wire_side_labels",
    "build_double_tile",
    "footprint_area",
    "has_side_labels",
    "side_label_solids",
    "double_side_label_solids",
    "side_face_planes",
    "build_mono_recessed",
    "build_mono_raised",
    "build_double_mono_recessed",
    "build_double_mono_raised",
]

#: Font used for the band caption. IBM Plex Sans (the print font) if the host
#: has it, else the same Helvetica/Arial fallback the 2D face declares.
_FONT = "Helvetica"
_CAP_TO_EM = 1.0 / 0.72


@dataclass(frozen=True, slots=True)
class SideLabel:
    """One gate-name inlay on a cube's vertical side face.

    ``solid`` is the flush colour plug that fills the pocket cut into the body;
    ``hex`` is the gate's accent colour (never a new one), so a plate's filament
    slot count is unchanged. ``role`` is the part role used in file names, e.g.
    ``side-front`` (single-faced) or ``side-front-a`` (double-faced).
    """

    face: str  # front | right | back | left
    role: str
    color_name: str
    hex: str
    solid: Solid


@dataclass(slots=True)
class TileParts:
    """The three colour solids of one tile plus the layout that produced them."""

    layout: FaceLayout
    variant: str
    height: float
    body: Solid  # white
    marker: Solid  # black
    accent: Solid  # gate colour
    side_labels: list[SideLabel] = field(default_factory=list)  # cube only

    def named_parts(self) -> list[tuple[str, str, Solid]]:
        """``(role, colour_name, solid)`` for each part, in print order."""
        parts = [
            ("body", "white", self.body),
            ("marker", "black", self.marker),
            ("accent", self.layout.accent_name, self.accent),
        ]
        parts += [(sl.role, sl.color_name, sl.solid) for sl in self.side_labels]
        return parts


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


def _fit_sketch(sk, max_w: float, max_h: float):
    """Scale a vector glyph sketch down to fit ``max_w`` x ``max_h``, recentred.

    The text path uses :func:`_fit_text` (which re-renders at a smaller font
    size); vector glyphs have no font, so they are simply scaled.
    """
    bb = sk.bounding_box()
    factor = 1.0
    if bb.size.X > 0:
        factor = min(factor, max_w / bb.size.X)
    if bb.size.Y > 0:
        factor = min(factor, max_h / bb.size.Y)
    if factor < 1.0:
        sk = scale(sk, by=factor)
    c = sk.bounding_box().center()
    return Pos(-c.X, -c.Y) * sk


def _control_dot_sketch(radius: float):
    """CNOT control ``●`` — a filled disc, origin-centred."""
    return Circle(radius)


def _target_cross_sketch(radius: float):
    """CNOT target ``⊕`` — an open ring with a centred cross, origin-centred."""
    stroke = 0.12 * (2.0 * radius)
    ring = Circle(radius) - Circle(radius - stroke)
    horiz = Rectangle(2.0 * radius, stroke)
    vert = Rectangle(stroke, 2.0 * radius)
    return ring + horiz + vert


def _swap_cross_sketch(radius: float):
    """SWAP ``×`` — two round-capped diagonals spanning a 2·radius box.

    Mirrors :func:`qamposer_assets.symbols.swap_cross`: stroke = 18 % of the
    glyph height, endpoints at the box corners, round caps (drawn here as a disc
    at each endpoint since a sketch has no stroke-linecap).
    """
    stroke = 0.18 * (2.0 * radius)
    bar = Rectangle(2.0 * radius * math.sqrt(2.0), stroke)
    sk = bar.rotate(Axis.Z, 45.0) + bar.rotate(Axis.Z, -45.0)
    for sx in (-radius, radius):
        for sy in (-radius, radius):
            sk = sk + Pos(sx, sy) * Circle(stroke / 2.0)
    return sk


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
            glyph = Pos(glyph_cx, band_cy) * _control_dot_sketch(glyph_r)
        else:
            glyph = Pos(glyph_cx, band_cy) * _target_cross_sketch(glyph_r)
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
# Tall bodies: tactile notches stay a *band-edge* feature
# --------------------------------------------------------------------------- #
#
# A notch is drawn in the 2D footprint (a slot cut into the band edge) and the
# footprint is extruded through the whole body. On a 6/8 mm tile that is exactly
# the intended feature. On a 60 mm cube the same profile becomes a full-height
# groove running down the middle of a side face — which is both not what the
# printed face documents ("shallow slots in the band edge") and squarely in the
# way of the side-face gate name. So on a tall body the slot is *refilled* below
# (or above, for a double piece's underside face) a ``notch_span`` band, leaving
# the slot only on the ``notch_span`` mm nearest the face it belongs to.


def has_side_labels(height: float, params: HardwareParams) -> bool:
    """True for a body tall enough to carry side-face gate names (the cube).

    The same predicate gates the band-limited notch, so the 6 mm / 8 mm flat
    tiles are untouched by both features.
    """
    return height > params.tall_body_min_height


def _notch_fill(
    layout: FaceLayout, rects: tuple[Rect, ...], z0: float, thickness: float
) -> Solid | None:
    """Solid that plugs ``rects``' slots over ``z ∈ [z0, z0+thickness]``, or None."""
    if not rects or thickness <= 1e-9:
        return None
    full = Pos(layout.size / 2.0, layout.size / 2.0) * RectangleRounded(
        layout.size, layout.size, layout.corner_radius
    )
    sketch = None
    for nr in rects:
        piece = full & (Pos(nr.cx, nr.cy) * Rectangle(nr.w, nr.h))
        sketch = piece if sketch is None else sketch + piece
    return Pos(0.0, 0.0, z0) * extrude(sketch, amount=thickness)


# --------------------------------------------------------------------------- #
# Cube side faces: the gate's name as a flush colour inlay
# --------------------------------------------------------------------------- #
#
# Frame convention (see face.py): the footprint sits in the first quadrant,
# +z up, the marker face at z = height. The four vertical faces are therefore
# y = 0 (front, the band edge), x = size (right), y = size (back) and x = 0
# (left). Each gets a plane whose local +x is the direction the label *reads*
# for a viewer standing in front of that face and whose local +y is +z (world
# up), so a label placed at the plane origin is upright with the cube in play
# orientation. A label is extruded ``-depth`` (into the body) and the identical
# prism is cut out of the body, so the colour plug is exactly flush.

_Vec3 = tuple[float, float, float]

#: ``(name, local x_dir, outward normal)`` for the four vertical faces.
_SIDE_FACES: tuple[tuple[str, _Vec3, _Vec3], ...] = (
    ("front", (1.0, 0.0, 0.0), (0.0, -1.0, 0.0)),
    ("right", (0.0, 1.0, 0.0), (1.0, 0.0, 0.0)),
    ("back", (-1.0, 0.0, 0.0), (0.0, 1.0, 0.0)),
    ("left", (0.0, -1.0, 0.0), (-1.0, 0.0, 0.0)),
)


def side_face_planes(size: float, height: float) -> list[tuple[str, Plane]]:
    """``(face_name, plane)`` for each vertical face, origin at the face centre.

    The plane's local ``+y`` is world ``+z`` on every face, so "upright" is one
    convention for all four.
    """
    out: list[tuple[str, Plane]] = []
    for name, x_dir, normal in _SIDE_FACES:
        origin = (
            size / 2.0 + normal[0] * size / 2.0,
            size / 2.0 + normal[1] * size / 2.0,
            height / 2.0,
        )
        out.append((name, Plane(origin=origin, x_dir=x_dir, z_dir=normal)))
    return out


def _side_max_width(layout: FaceLayout, params: HardwareParams) -> float:
    """Usable label width: the *flat* part of a side face, less both margins.

    The footprint is a rounded square, so only ``size - 2·corner_radius`` of each
    side face is flat — the corner fillets are not a place to put a letter.
    """
    flat = layout.size - 2.0 * layout.corner_radius
    return flat - 2.0 * params.side_label_margin


def _side_label_sketch(layout: FaceLayout, cap: float, max_w: float, max_h: float):
    """The side-face glyph for a gate, origin-centred, or ``None`` if it has none.

    Letters go through :func:`_fit_text` (bold ``_FONT``); CNOT and SWAP reuse the
    printed face's ``●`` / ``⊕`` / ``×`` **vector** sketches.
    """
    spec = layout.spec
    if spec.gate == "CNOT":
        radius = cap / 2.0
        glyph = (
            _control_dot_sketch(radius)
            if spec.role == "control"
            else _target_cross_sketch(radius)
        )
        return _fit_sketch(glyph, max_w, max_h)
    if spec.gate == "SWAP":
        return _fit_sketch(_swap_cross_sketch(cap / 2.0), max_w, max_h)
    if not layout.side_label:
        return None
    return _fit_text(layout.side_label, cap, max_w, max_h)


def _clip_to_body(labels: list[SideLabel], body: Solid) -> list[SideLabel]:
    """Trim each plug to the body, so it can never carry material outside it."""
    return [
        SideLabel(
            face=sl.face,
            role=sl.role,
            color_name=sl.color_name,
            hex=sl.hex,
            solid=sl.solid & body,
        )
        for sl in labels
    ]


def _side_prism(sketch, plane: Plane, v: float, theta: float, depth: float) -> Solid:
    """Extrude an origin-centred face sketch ``depth`` mm *into* the body.

    ``v`` shifts it along the face's up axis and ``theta`` spins it in the face
    plane (180° for a double piece's lower half).
    """
    sk = sketch
    if theta % 360.0 != 0.0:
        sk = sk.rotate(Axis.Z, theta)
    sk = Pos(0.0, v) * sk
    return plane * extrude(sk, amount=-depth)


def side_label_solids(
    layout: FaceLayout,
    height: float,
    params: HardwareParams,
    *,
    depth: float | None = None,
) -> list[SideLabel]:
    """The gate's name on all four vertical faces of a single-faced cube.

    One inlay per face, centred, upright with the marker face up, in the gate's
    own accent colour. Cap height targets ``side_label_cap`` × height and is
    auto-shrunk by :func:`_fit_text` so the glyph keeps ``side_label_margin``
    clear of every edge of the flat side face. Returns ``[]`` for a flat tile.
    """
    if not has_side_labels(height, params):
        return []
    cap = params.side_label_cap * height
    max_w = _side_max_width(layout, params)
    max_h = height - 2.0 * params.side_label_margin
    sketch = _side_label_sketch(layout, cap, max_w, max_h)
    if sketch is None:
        return []
    d = params.side_label_depth if depth is None else depth
    out: list[SideLabel] = []
    for name, plane in side_face_planes(layout.size, height):
        out.append(
            SideLabel(
                face=name,
                role=f"side-{name}",
                color_name=layout.accent_name,
                hex=layout.accent_hex,
                solid=_side_prism(sketch, plane, 0.0, 0.0, d),
            )
        )
    return out


def double_side_label_solids(
    layout_a: FaceLayout,
    layout_b: FaceLayout,
    height: float,
    params: HardwareParams,
    *,
    depth: float | None = None,
) -> list[SideLabel]:
    """Both gates' names on all four vertical faces of a double-faced cube.

    Each side face splits horizontally: the **upper** half carries face A (the
    gate currently facing up), upright; the **lower** half carries face B rotated
    180°, at the point reflection of A's position about the face centre.

    That placement *is* the flip symmetry. The physical flip (roll 180° over the
    front edge: ``(x, y, z) → (x, size − y, height − z)``) maps every vertical
    face onto a vertical face and acts on it as a 180° in-plane rotation about
    the face centre — so B's lower-half, upside-down label comes up upright in
    the new upper half, exactly where A's was.
    """
    if not has_side_labels(height, params):
        return []
    cap = params.side_label_half_cap * height
    max_w = _side_max_width(layout_a, params)
    gap = params.side_label_split_gap
    # Each half owns everything between the mid-line gap and the edge margin.
    max_h = (height - 2.0 * params.side_label_margin - gap) / 2.0
    offset = (gap + max_h) / 2.0
    sk_a = _side_label_sketch(layout_a, cap, max_w, max_h)
    sk_b = _side_label_sketch(layout_b, cap, max_w, max_h)
    d = params.side_label_depth if depth is None else depth
    out: list[SideLabel] = []
    for name, plane in side_face_planes(layout_a.size, height):
        for tag, sketch, layout, v, theta in (
            ("a", sk_a, layout_a, offset, 0.0),
            ("b", sk_b, layout_b, -offset, 180.0),
        ):
            if sketch is None:
                continue
            out.append(
                SideLabel(
                    face=name,
                    role=f"side-{name}-{tag}",
                    color_name=double_color_name(layout.accent_hex),
                    hex=layout.accent_hex,
                    solid=_side_prism(sketch, plane, v, theta, d),
                )
            )
    return out


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
    if has_side_labels(height, params):
        # Keep the tactile slot a band-edge feature: refill it below the top
        # notch_span mm instead of letting it groove the whole side face.
        fill = _notch_fill(layout, layout.notches, 0.0, height - params.notch_span)
        if fill is not None:
            body = body + fill
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

    # --- cube side faces: the gate's name, flush, in the accent colour --------
    # Clipped to the body, then cut out of it — the same flush-inlay boolean the
    # top face uses, so plug and pocket are the same volume by construction.
    side_labels = _clip_to_body(side_label_solids(layout, height, params), body)

    # White body = everything that is neither accent nor marker nor side label.
    white_body = body - accent - marker
    for sl in side_labels:
        white_body = white_body - sl.solid

    return TileParts(
        layout=layout,
        variant=variant,
        height=height,
        body=white_body,
        marker=marker,
        accent=accent,
        side_labels=side_labels,
    )


# --------------------------------------------------------------------------- #
# Board-corner blocks — the printable stand-in for the mat's corner markers
# --------------------------------------------------------------------------- #


def corner_label_sketch(layout: FaceLayout, config: AssetsConfig):
    """The UL/UR/LL/LR label as a top-face sketch, centred in its strip.

    Cap height is the gate band's, shrunk to the strip (the strip is whatever
    the mat geometry leaves outside the marker's quiet zone — see
    :func:`~qamposer_hardware.face.corner_label_band`).
    """
    band = layout.band
    cap = min(config.typography.band_cap_height, band.h - 2.0)
    return Pos(band.cx, band.cy) * _fit_text(layout.label, cap, band.w, band.h - 1.0)


def build_corner_block(
    marker_id: int,
    config: AssetsConfig,
    *,
    variant: str,
    height: float,
    params: HardwareParams | None = None,
    magnets: bool = False,
) -> TileParts:
    """Build one board-corner block (marker IDs 0-3) as :class:`TileParts`.

    Same three-part colour split as a gate tile — but the "accent" is the black
    block label, not a gate colour, so a corner block never adds a filament
    slot. There is no colour band and no frame: the top face is plain white
    with the mat's 40 mm corner marker and the label, so a camera sees exactly
    what the printed mat shows. A cube-height block additionally carries the
    label on all four vertical faces (the #62 side-letter inlay, in black).
    """
    params = params or HardwareParams()
    layout = corner_face_layout(marker_id, config)
    fd = params.face_depth

    body = extrude(_footprint(layout), amount=height)
    body = _chamfer_bottom(body, params.bottom_chamfer)
    if height > params.hollow_min_height:
        body = _hollow(body, layout, params, height)
    if magnets:
        body = _magnet_pockets(body, layout, params)

    accent = _extrude_top(corner_label_sketch(layout, config), height, fd)
    marker = _marker_solid(layout, height, fd, params.marker_bleed)
    side_labels = _clip_to_body(side_label_solids(layout, height, params), body)

    white_body = body - accent - marker
    for sl in side_labels:
        white_body = white_body - sl.solid

    return TileParts(
        layout=layout,
        variant=variant,
        height=height,
        body=white_body,
        marker=marker,
        accent=accent,
        side_labels=side_labels,
    )


# --------------------------------------------------------------------------- #
# Qubit-wire blocks — board furniture that declares one wire (marker ID 46)
# --------------------------------------------------------------------------- #


def qubit_wire_accent_sketch(layout: FaceLayout, config: AssetsConfig):
    """The wire block's top-face art as one sketch: the wire runs + the ``q``.

    The runs come straight from :attr:`FaceLayout.wires` (derived once in
    :mod:`qamposer_assets.qubit_wire_block`) and are intersected with the tile
    footprint so ink can never sit outside the body; the ``q`` is fitted into
    :attr:`FaceLayout.band`, the strip along the block's inner edge.
    """
    band = layout.band
    cap = min(config.typography.band_cap_height, band.h - 2.0)
    sketch = Pos(band.cx, band.cy) * _fit_text(
        layout.label, cap, band.w, band.h - 1.0
    )
    footprint = _footprint(layout)
    for wr in layout.wires:
        sketch = sketch + (footprint & (Pos(wr.cx, wr.cy) * Rectangle(wr.w, wr.h)))
    return sketch


def qubit_wire_side_labels(
    layout: FaceLayout,
    height: float,
    params: HardwareParams,
    *,
    depth: float | None = None,
) -> list[SideLabel]:
    """The wire + ``q`` repeated on all four vertical faces of a cube block.

    The top face answers "which wire?" only to someone looking down; a wire
    block sitting in a row of five needs to say "I am a wire" from any seat. So
    each vertical face carries the same two marks as the top: a bar spanning the
    face's **flat** width (the rounded corners are not a place for art) at the
    block's mid-height, and a ``q`` centred above it. Black, like every other
    mark on the piece — no filament slot. Returns ``[]`` for a flat tile.
    """
    if not has_side_labels(height, params):
        return []
    flat = layout.size - 2.0 * layout.corner_radius
    bar = Rectangle(flat, WIRE_STROKE_MM)
    # Everything above the bar, less the edge margin, belongs to the glyph.
    max_h = height / 2.0 - WIRE_STROKE_MM / 2.0 - params.side_label_margin
    max_w = _side_max_width(layout, params)
    sketch = bar
    if max_h > 1.0 and layout.label:
        glyph = _fit_text(layout.label, params.side_label_cap * height, max_w, max_h)
        gh = glyph.bounding_box().size.Y
        v = WIRE_STROKE_MM / 2.0 + (max_h - gh) / 2.0 + gh / 2.0
        sketch = sketch + Pos(0.0, v) * glyph
    d = params.side_label_depth if depth is None else depth
    return [
        SideLabel(
            face=name,
            role=f"side-{name}",
            color_name=layout.accent_name,
            hex=layout.accent_hex,
            solid=_side_prism(sketch, plane, 0.0, 0.0, d),
        )
        for name, plane in side_face_planes(layout.size, height)
    ]


def build_qubit_wire_block(
    config: AssetsConfig,
    *,
    variant: str,
    height: float,
    params: HardwareParams | None = None,
    magnets: bool = False,
) -> TileParts:
    """Build the one qubit-wire block design (marker ID 46) as :class:`TileParts`.

    Same three-part split as a corner block — white body, black marker, black
    "accent" (here the wire line and the ``q``) — so a wire block never adds a
    filament slot. One design: the kit prints it up to five times, and it is the
    *count* and vertical position of the placed blocks that declare the wires.
    A cube-height block repeats the wire and the ``q`` on all four vertical
    faces (the #62 side-inlay technique, in black).
    """
    params = params or HardwareParams()
    layout = qubit_wire_face_layout(config)
    fd = params.face_depth

    body = extrude(_footprint(layout), amount=height)
    body = _chamfer_bottom(body, params.bottom_chamfer)
    if height > params.hollow_min_height:
        body = _hollow(body, layout, params, height)
    if magnets:
        body = _magnet_pockets(body, layout, params)

    accent = _extrude_top(qubit_wire_accent_sketch(layout, config), height, fd)
    marker = _marker_solid(layout, height, fd, params.marker_bleed)
    side_labels = _clip_to_body(
        qubit_wire_side_labels(layout, height, params), body
    )

    white_body = body - accent - marker
    for sl in side_labels:
        white_body = white_body - sl.solid

    return TileParts(
        layout=layout,
        variant=variant,
        height=height,
        body=white_body,
        marker=marker,
        accent=accent,
        side_labels=side_labels,
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
    side_labels: list[SideLabel] = field(default_factory=list)  # cube only

    def named_parts(self) -> list[tuple[str, str, str, Solid]]:
        """``(role, colour_name, colour_hex, solid)`` for each part, print order."""
        out: list[tuple[str, str, str, Solid]] = [
            ("body", "white", "#ffffff", self.body),
            ("marker", "black", "#000000", self.marker),
        ]
        for hexc, solid in self.accents:
            out.append(("accent", double_color_name(hexc), hexc, solid))
        for sl in self.side_labels:
            out.append((sl.role, sl.color_name, sl.hex, sl.solid))
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
    if has_side_labels(height, params):
        # Each face's tactile slot stays a band-edge feature of *its own* face:
        # face A's (bottom edge) only within notch_span of the top, face B's
        # (top edge) only within notch_span of the bottom. See _notch_fill.
        span = params.notch_span
        for rects, z0 in ((notches_a, 0.0), (notches_b, span)):
            fill = _notch_fill(layout_a, rects, z0, height - span)
            if fill is not None:
                body = body + fill
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

    # --- cube side faces: A upright in the upper half, B rotated in the lower --
    side_labels = _clip_to_body(
        double_side_label_solids(layout_a, layout_b, height, params), body
    )

    white_body = body - marker
    for _hex, acc in accents:
        white_body = white_body - acc
    for sl in side_labels:
        white_body = white_body - sl.solid

    return DoubleTileParts(
        layout_a=layout_a,
        layout_b=layout_b,
        variant=variant,
        height=height,
        body=white_body,
        marker=marker,
        accents=accents,
        side_labels=side_labels,
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
#
# A cube's **side** gate names are a special case: a filament swap changes whole
# layers and so cannot colour a vertical face, but a pen can. Both mono forms
# therefore render the side names the *same* way — as ``mono_pocket_depth``
# paint wells — rather than raising them.


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
    colour prisms back fills the top (and bottom, for a double) colour layer —
    and, on a cube, the side-face gate-name inlays — so the result is the piece's
    full outer volume with flat, single-colour faces.
    """
    whole = parts.body + _mono_colored(parts)
    for sl in parts.side_labels:
        whole = whole + sl.solid
    return whole


def _mono_side_wells(parts, params: HardwareParams) -> Solid | None:
    """The cube's side gate names re-cut as shallow ``mono_pocket_depth`` wells.

    Rebuilt from the same generator at the mono depth rather than reusing the
    (deeper) colour plugs, so a pen-fillable well is all that is left of the
    inlay. ``None`` for a flat tile, which has no side labels.
    """
    depth = params.mono_pocket_depth
    if isinstance(parts, DoubleTileParts):
        labels = double_side_label_solids(
            parts.layout_a, parts.layout_b, parts.height, params, depth=depth
        )
    elif parts.layout.wires:  # qubit-wire block: a wire bar, not a gate name
        labels = qubit_wire_side_labels(
            parts.layout, parts.height, params, depth=depth
        )
    else:
        labels = side_label_solids(parts.layout, parts.height, params, depth=depth)
    if not labels:
        return None
    wells = labels[0].solid
    for sl in labels[1:]:
        wells = wells + sl.solid
    return wells


def _sink_side_wells(solid: Solid, parts, params: HardwareParams) -> Solid:
    """Subtract the side-name paint wells from a finished mono solid."""
    wells = _mono_side_wells(parts, params)
    return solid if wells is None else solid - wells


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
    return _sink_side_wells(whole - pocket, parts, params)


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
    return _sink_side_wells(whole + raised, parts, params)


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
    return _sink_side_wells(whole - top_pocket - bottom_pocket, parts, params)


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
    whole = core + top_art + bottom_art
    wells = _mono_side_wells(parts, params)
    # The core is lifted by r, so the side wells must ride with it.
    return whole if wells is None else whole - Pos(0.0, 0.0, r) * wells
