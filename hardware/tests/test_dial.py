"""Geometry + kit invariants for the RX/RY/RZ **dial** tiles (IDs 42/43/44).

A dial tile has no fixed angle: its board-frame rotation selects it. The face is
therefore built differently from a classic tile — a full colour frame, a white
inner square, a *centred* ArUco marker, **eight** angle labels (four on the edge
midpoints, four in the corners, 45° apart) each spun so the selected angle reads
upright at board-top, a ▲ pointer at the canonical top edge and the axis caption
in the bottom band. This suite pins that the 3D dial face reproduces
:func:`qamposer_assets.tile_face._dial_body` region-for-region (so print and
object are indistinguishable) and that the dials slot into the single-faced
kit's plate grouping without adding an accent colour.
"""

from __future__ import annotations

import pytest
from build123d import Align, Axis, Box, Pos
from qamposer_assets.config import load_config
from qamposer_vision.markers import DIAL_ANGLES, MARKER_TABLE, pretty_angle

from qamposer_hardware.build import build_tile, footprint_area
from qamposer_hardware.export import single_plate_groups
from qamposer_hardware.face import FACE_DEPTH, face_layout

DIAL_IDS = [42, 43, 44]  # RX / RY / RZ dial
TILE_H = 6.0
AREA_TOL = 0.25  # mm² — looser than classic tiles: curved π-glyph tessellation
VOL_TOL = 0.5  # mm³


@pytest.fixture(scope="module")
def config():
    return load_config()


@pytest.fixture(scope="module")
def tiles(config):
    return {mid: build_tile(mid, config, variant="tile", height=TILE_H) for mid in DIAL_IDS}


# --------------------------------------------------------------------------- #
# Layout: full white square, centred marker, no notches, dial geometry present
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("mid", DIAL_IDS)
def test_dial_layout_is_full_square_and_centred(config, mid):
    t = config.tile
    layout = face_layout(mid, config)
    assert layout.dial is not None
    assert layout.notch_count == 0 and layout.notches == ()
    assert layout.label == ""  # no coloured band caption; caption is on the field
    # White field is the FULL inner square (no bottom band cut out).
    wf = layout.white_field
    assert wf.w == pytest.approx(t.size - 2 * t.frame_width)
    assert wf.h == pytest.approx(t.size - 2 * t.frame_width)
    assert wf.cx == pytest.approx(t.size / 2) and wf.cy == pytest.approx(t.size / 2)
    # Marker centred about the tile centre.
    xs = [c.rect.cx for c in layout.modules]
    ys = [c.rect.cy for c in layout.modules]
    assert (min(xs) + max(xs)) / 2 == pytest.approx(t.size / 2, abs=1e-6)
    assert (min(ys) + max(ys)) / 2 == pytest.approx(t.size / 2, abs=1e-6)


@pytest.mark.parametrize("mid", DIAL_IDS)
def test_dial_labels_match_2d_convention(config, mid):
    """Label text/slot/rotation == ``tile_face.dial_label_slots`` exactly.

    Eight positions at canonical orientation, 45° apart: even r on the edge
    midpoints (r=0 top ``0``, r=2 left ``π/2``, r=4 bottom ``π``, r=6 right
    ``−π/2``), odd r in the corners (r=1 TL ``π/4``, r=3 BL ``3π/4``, r=5 BR
    ``−3π/4``, r=7 TR ``−π/4``). θ=45·r means turning the tile clockwise by r
    eighth-turns brings that label to board-top upright.
    """
    layout = face_layout(mid, config)
    s = layout.size
    labels = {lab.r: lab for lab in layout.dial.labels}
    assert set(labels) == set(range(8))
    # text is the pretty angle for that rotation index; θ = 45·r
    for r, lab in labels.items():
        assert lab.text == pretty_angle(DIAL_ANGLES[r])
        assert lab.theta == pytest.approx((45.0 * r) % 360.0)
    # edge midpoints (3D, y up): top high-Y, bottom low-Y, left low-X, right high-X
    assert labels[0].cx == pytest.approx(s / 2) and labels[0].cy > s / 2  # top
    assert labels[4].cx == pytest.approx(s / 2) and labels[4].cy < s / 2  # bottom
    assert labels[2].cy == pytest.approx(s / 2) and labels[2].cx < s / 2  # left
    assert labels[6].cy == pytest.approx(s / 2) and labels[6].cx > s / 2  # right
    # corners sit off both axes, on the diagonals, and print smaller than the
    # edge labels so a spun "-3π/4" still clears the frame and the marker field.
    for r, (want_x_hi, want_y_hi) in {
        1: (False, True),   # TL  → low X, high Y (3D y up)
        3: (False, False),  # BL
        5: (True, False),   # BR
        7: (True, True),    # TR
    }.items():
        lab = labels[r]
        assert (lab.cx > s / 2) is want_x_hi, r
        assert (lab.cy > s / 2) is want_y_hi, r
        assert abs(lab.cx - s / 2) == pytest.approx(abs(lab.cy - s / 2))
        assert lab.font < layout.dial.label_font
    for r in (0, 2, 4, 6):
        assert labels[r].font == pytest.approx(layout.dial.label_font)


# --------------------------------------------------------------------------- #
# Bounding boxes / colour layer
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("mid", DIAL_IDS)
def test_body_bounding_box_exact(tiles, mid):
    bb = tiles[mid].body.bounding_box()
    assert bb.size.X == pytest.approx(60.0, abs=1e-6)
    assert bb.size.Y == pytest.approx(60.0, abs=1e-6)
    assert bb.size.Z == pytest.approx(TILE_H, abs=1e-6)
    assert bb.min.Z == pytest.approx(0.0, abs=1e-6)


@pytest.mark.parametrize("mid", DIAL_IDS)
def test_colour_layer_is_top_face_depth(tiles, mid):
    for part in (tiles[mid].marker, tiles[mid].accent):
        bb = part.bounding_box()
        assert bb.max.Z == pytest.approx(TILE_H, abs=1e-6)
        assert bb.min.Z == pytest.approx(TILE_H - FACE_DEPTH, abs=1e-6)


@pytest.mark.parametrize("mid", DIAL_IDS)
def test_marker_centred_bbox(config, tiles, mid):
    """Marker footprint is the centred 36 mm square (12..48 mm, ± bleed)."""
    bb = tiles[mid].marker.bounding_box()
    assert bb.min.X >= 12.0 - 0.05 and bb.max.X <= 48.0 + 0.05
    assert bb.min.Y >= 12.0 - 0.05 and bb.max.Y <= 48.0 + 0.05
    # symmetric about centre
    assert (bb.min.X + bb.max.X) / 2 == pytest.approx(30.0, abs=1e-3)
    assert (bb.min.Y + bb.max.Y) / 2 == pytest.approx(30.0, abs=1e-3)


# --------------------------------------------------------------------------- #
# Disjoint colour parts that tile the top face
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("mid", DIAL_IDS)
def test_parts_pairwise_disjoint(tiles, mid):
    p = tiles[mid]
    for a, b in ((p.body, p.marker), (p.body, p.accent), (p.marker, p.accent)):
        inter = a & b
        vol = 0.0 if inter is None else inter.volume
        assert vol == pytest.approx(0.0, abs=VOL_TOL)


@pytest.mark.parametrize("mid", DIAL_IDS)
def test_top_face_fully_covered(tiles, mid):
    p = tiles[mid]
    total = 0.0
    for part in (p.body, p.marker, p.accent):
        top = part.faces().group_by(Axis.Z)[-1]
        total += sum(f.area for f in top)
    assert total == pytest.approx(footprint_area(p.layout), abs=AREA_TOL)


# --------------------------------------------------------------------------- #
# Accent geometry: colour-on-white labels present per edge, correctly oriented
# --------------------------------------------------------------------------- #


def _probe(solid, cx, cy, w, h, z):
    box = Pos(cx, cy, z) * Box(w, h, FACE_DEPTH, align=(Align.CENTER,) * 3)
    inter = solid & box
    return inter if (inter is not None and inter.volume > 1e-6) else None


@pytest.mark.parametrize("mid", DIAL_IDS)
def test_edge_labels_present_and_oriented(tiles, mid):
    """All EIGHT labels are accent material at their slot; the left/right edge
    labels are rotated (taller than wide) and the top/bottom ones upright."""
    p = tiles[mid]
    z = TILE_H - FACE_DEPTH / 2.0
    labels = {lab.r: lab for lab in p.layout.dial.labels}
    assert set(labels) == set(range(8))
    # Tight probe boxes (exclude the ▲ pointer above / caption below / marker);
    # corner labels are spun 45°, so they need a square probe.
    for r, lab in labels.items():
        w, h = (6.8, 4.2) if r % 2 == 0 else (6.0, 6.0)
        inter = _probe(p.accent, lab.cx, lab.cy, w, h, z)
        assert inter is not None, f"label r={r} {lab.text!r} missing from accent"
        bb = inter.bounding_box()
        if r in (2, 6):  # left / right — spun 90°/270°, so taller than wide
            assert bb.size.Y > bb.size.X, f"label r={r} not rotated"
        if r % 2 == 1:  # corners — spun 45°, so the box is close to square
            lo, hi = sorted((bb.size.X, bb.size.Y))
            assert lo / hi > 0.6, f"label r={r} not spun to the diagonal"
        if r in (0, 4):  # top "0" / bottom "π" — single glyphs, centred on x
            assert (bb.min.X + bb.max.X) / 2 == pytest.approx(30.0, abs=0.2)


@pytest.mark.parametrize("mid", DIAL_IDS)
def test_every_label_carries_its_own_spin(config, mid):
    """θ = 45·r is really applied to the glyph sketch, for all eight labels.

    Compared against the same text drawn upright: a quarter turn swaps the
    bounding box, a half turn leaves it, a 45° turn lands between the two.
    """
    from qamposer_hardware.build import _dial_text_sketch

    for lab in face_layout(mid, config).dial.labels:
        upright = _dial_text_sketch(lab.text, lab.font, 0.0).bounding_box()
        spun = _dial_text_sketch(lab.text, lab.font, lab.theta).bounding_box()
        if lab.r in (0, 4):  # 0° / 180° — same box
            assert spun.size.X == pytest.approx(upright.size.X, abs=1e-6)
            assert spun.size.Y == pytest.approx(upright.size.Y, abs=1e-6)
        elif lab.r in (2, 6):  # 90° / 270° — swapped box
            assert spun.size.X == pytest.approx(upright.size.Y, abs=1e-6)
            assert spun.size.Y == pytest.approx(upright.size.X, abs=1e-6)
        else:  # 45° family — the box squares up: the narrow side grows most
            up_lo, up_hi = sorted((upright.size.X, upright.size.Y))
            sp_lo, sp_hi = sorted((spun.size.X, spun.size.Y))
            assert sp_lo > up_lo, lab
            assert sp_lo / sp_hi > up_lo / up_hi, lab


@pytest.mark.parametrize("mid", DIAL_IDS)
def test_labels_never_touch_the_marker_or_the_frame(tiles, mid):
    """The accent's label ink must stay clear of the ArUco field and inside the
    tile: the spun corner labels are the tight ones. Checked as a real solid
    intersection, not an estimate."""
    p = tiles[mid]
    z = TILE_H - FACE_DEPTH / 2.0
    # The centred 36 mm marker field: no accent material may reach into it.
    field = _probe(p.accent, 30.0, 30.0, 36.0, 36.0, z)
    assert field is None, "dial accent ink enters the ArUco marker field"
    # Everything stays on the tile.
    bb = p.accent.bounding_box()
    assert bb.min.X >= 0.0 - 1e-6 and bb.max.X <= 60.0 + 1e-6
    assert bb.min.Y >= 0.0 - 1e-6 and bb.max.Y <= 60.0 + 1e-6


@pytest.mark.parametrize("mid", DIAL_IDS)
def test_pointer_and_caption_present(tiles, mid):
    """▲ pointer sits at the canonical top edge (apex highest-Y); the axis
    caption sits in the bottom band. Both are accent-coloured on the white field."""
    p = tiles[mid]
    z = TILE_H - FACE_DEPTH / 2.0
    # Probe tightly around the pointer (y 54.4-56.6): the r=0 edge label sits
    # just below it, and how close it comes depends on the host font — macOS
    # resolves `Helvetica`, a Linux CI runner substitutes DejaVu/Liberation,
    # whose taller glyph box pushes the label up into a 4 mm-tall probe. 2.8 mm
    # still brackets the whole triangle with clearance either side.
    ptr = _probe(p.accent, 30.0, 55.5, 5.0, 2.8, z)
    assert ptr is not None, "pointer missing"
    pb = ptr.bounding_box()
    # apex is a single point at the top, base is the wide edge below it
    assert pb.max.Y == pytest.approx(56.6, abs=0.1)
    assert pb.min.Y == pytest.approx(54.4, abs=0.1)
    assert (pb.min.X + pb.max.X) / 2 == pytest.approx(30.0, abs=0.05)
    cap = _probe(p.accent, 30.0, 4.1, 12.0, 4.0, z)
    assert cap is not None, "axis caption missing"


# --------------------------------------------------------------------------- #
# Kit composition: dials join the single-faced kit's plate grouping
# --------------------------------------------------------------------------- #


def test_single_kit_includes_three_dials(config):
    groups = single_plate_groups(config)
    placed = [m for g in groups for m in g["pieces"]]
    for mid in DIAL_IDS:
        assert mid in placed, f"dial {mid} not in any plate group"
    # No duplicates and every group still ≤3 accent families.
    assert len(placed) == len(set(placed))
    for g in groups:
        assert len(g["accents"]) <= 3


def test_dials_add_no_new_accent_colour(config):
    """RX/RY dial → magenta (Y family), RZ dial → cyan (Z family): both accents
    already exist, so the dials never force a new plate."""
    magenta = config.colors.for_gate("Y")
    cyan = config.colors.for_gate("Z")
    assert config.colors.for_gate("RX") == magenta
    assert config.colors.for_gate("RY") == magenta
    assert config.colors.for_gate("RZ") == cyan
    groups = single_plate_groups(config)
    for g in groups:
        for mid in (42, 43):
            if mid in g["pieces"]:
                assert magenta in g["accents"]
        if 44 in g["pieces"]:
            assert cyan in g["accents"]


def test_gates_token_resolves_dials():
    from qamposer_hardware.cli import _resolve_gates

    assert _resolve_gates("dials") == [42, 43, 44]
    assert _resolve_gates("dial") == [42, 43, 44]
    assert _resolve_gates("42,43,44") == [42, 43, 44]
    # family selection still sweeps the dial in with its rotation tiles
    assert 42 in _resolve_gates("RX")
