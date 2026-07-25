"""Gate-name inlays on the four vertical faces of a 60 mm cube.

A cube carries its gate's name on every side face as a **flush** colour plug in
the gate's own accent colour, so the piece is identifiable from across a table.
The suite pins:

* presence/absence — cubes have them, the 6/8 mm flat tiles do not;
* the flush boolean — the plug is exactly the pocket, the body stays one valid,
  manifold, watertight solid and the colour parts stay pairwise disjoint;
* clearance — every label keeps ``side_label_margin`` from every edge of its flat
  side face, and can never meet a tactile notch or a magnet pocket;
* the label *text* rule — family only (``RX``, never ``RX π/2``), and CNOT/SWAP
  drawn from the ``●``/``⊕``/``×`` vector sketches rather than font glyphs;
* the double-faced split and its **flip symmetry** — face B's upside-down lower
  half comes up upright in the upper half when the cube is flipped;
* mono — both single-colour forms render the side names as shallow paint wells
  (a filament swap cannot colour a vertical face; a pen can).
"""

from __future__ import annotations

import math

import pytest
from build123d import Align, Axis, Box, Cylinder, Pos, Rotation
from qamposer_assets.config import load_config

from qamposer_hardware.build import (
    build_double_mono_raised,
    build_double_mono_recessed,
    build_double_tile,
    build_mono_raised,
    build_mono_recessed,
    build_tile,
    has_side_labels,
    side_face_planes,
    side_label_solids,
)
from qamposer_hardware.face import face_layout, side_label_text
from qamposer_hardware.params import HardwareParams
from qamposer_vision.markers import MARKER_TABLE

CUBE_H = 60.0
TILE_H = 6.0
SIZE = 60.0
PARAMS = HardwareParams()
VOL_TOL = 0.5
FACES = ("front", "right", "back", "left")


@pytest.fixture(scope="module")
def config():
    return load_config()


@pytest.fixture(scope="module")
def cubes(config):
    """One cube per label shape: letter, two-glyph family, ●, ⊕, ×, dial."""
    return {
        mid: build_tile(mid, config, variant="cube", height=CUBE_H, params=PARAMS)
        for mid in (10, 21, 14, 15, 45, 42)
    }


@pytest.fixture(scope="module")
def double_cube(config):
    """H | X cross-family flip cube (two accents, two different letters)."""
    return build_double_tile(
        10, 11, config, variant="cube", height=CUBE_H, params=PARAMS
    )


@pytest.fixture(scope="module")
def same_gate_cube(config):
    """H | H flip cube — face A and face B are geometrically identical."""
    return build_double_tile(
        10, None, config, variant="cube", height=CUBE_H, params=PARAMS
    )


def _present(solid, x: float, y: float, z: float, s: float = 0.4) -> bool:
    probe = Pos(x, y, z) * Box(s, s, s, align=(Align.CENTER,) * 3)
    inter = solid & probe
    return inter is not None and inter.volume > 1e-6


def _vol(inter) -> float:
    return 0.0 if inter is None else inter.volume


# --------------------------------------------------------------------------- #
# Presence: cubes carry side names, flat tiles do not
# --------------------------------------------------------------------------- #


def test_flat_tiles_have_no_side_labels(config):
    """The 6 mm / 8 mm tiles are untouched — still exactly three colour parts."""
    assert not has_side_labels(TILE_H, PARAMS)
    tile = build_tile(10, config, variant="tile", height=TILE_H, params=PARAMS)
    assert tile.side_labels == []
    assert len(tile.named_parts()) == 3
    double = build_double_tile(10, 11, config, variant="tile", height=8.0, params=PARAMS)
    assert double.side_labels == []
    assert len(double.named_parts()) == 4  # body, marker, two accents


def test_single_cube_has_four_side_labels(cubes):
    """One inlay per vertical face, all in the gate's own accent colour."""
    assert has_side_labels(CUBE_H, PARAMS)
    for mid, parts in cubes.items():
        labels = parts.side_labels
        assert [sl.face for sl in labels] == list(FACES), mid
        assert [sl.role for sl in labels] == [f"side-{f}" for f in FACES], mid
        # SAME accent hex as the top face → _MaterialPalette dedupes it into the
        # existing slot; a cube never adds a filament.
        assert {sl.hex for sl in labels} == {parts.layout.accent_hex}, mid
        assert {sl.color_name for sl in labels} == {parts.layout.accent_name}, mid
        assert all(sl.solid.volume > 1.0 for sl in labels), mid
    # body, marker, accent + four side names
    assert len(cubes[10].named_parts()) == 7


def test_side_label_part_names_are_unique(cubes):
    """Roles differ per face, so the four STLs never overwrite each other."""
    names = [f"h-{role}-{cn}" for role, cn, _s in cubes[10].named_parts()]
    assert len(names) == len(set(names))
    assert "h-side-front-red" in names and "h-side-left-red" in names


# --------------------------------------------------------------------------- #
# Flush inlay: pocket == plug, body stays one watertight solid
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("mid", [10, 21, 14, 45])
def test_body_is_watertight_after_pocketing(cubes, mid):
    parts = cubes[mid]
    assert len(parts.body.solids()) == 1
    assert parts.body.is_valid and parts.body.is_manifold
    assert parts.body.volume > 0.0
    # A 3 mm-walled hollow cube is far lighter than the 216 cm³ solid block.
    assert parts.body.volume < 0.5 * SIZE**3


@pytest.mark.parametrize("mid", [10, 21, 14, 45])
def test_side_labels_sit_in_the_wall_flush_with_the_face(cubes, mid):
    """Each plug spans exactly ``side_label_depth`` inward from its own face."""
    depth = PARAMS.side_label_depth
    for sl in cubes[mid].side_labels:
        bb = sl.solid.bounding_box()
        if sl.face == "front":
            span, outer = (bb.min.Y, bb.max.Y), 0.0
        elif sl.face == "back":
            span, outer = (bb.min.Y, bb.max.Y), SIZE
        elif sl.face == "left":
            span, outer = (bb.min.X, bb.max.X), 0.0
        else:
            span, outer = (bb.min.X, bb.max.X), SIZE
        lo, hi = span
        assert hi - lo == pytest.approx(depth, abs=1e-6), sl.role
        # flush with the face, and no protrusion outside the 60 mm footprint
        assert min(abs(lo - outer), abs(hi - outer)) == pytest.approx(0.0, abs=1e-6)
        assert lo >= -1e-6 and hi <= SIZE + 1e-6
        # and it stays inside the 3 mm hollow-shell wall
        assert depth < PARAMS.wall


@pytest.mark.parametrize("mid", [10, 21, 14])
def test_colour_parts_stay_pairwise_disjoint(cubes, mid):
    parts = cubes[mid]
    solids = [parts.body, parts.marker, parts.accent] + [
        sl.solid for sl in parts.side_labels
    ]
    for i in range(len(solids)):
        for j in range(i + 1, len(solids)):
            assert _vol(solids[i] & solids[j]) == pytest.approx(0.0, abs=VOL_TOL)


def test_cube_footprint_bounding_box_unchanged(cubes):
    """Inlays are recesses — the 60 x 60 x 60 envelope is untouched."""
    bb = cubes[10].body.bounding_box()
    assert bb.size.X == pytest.approx(SIZE, abs=1e-6)
    assert bb.size.Y == pytest.approx(SIZE, abs=1e-6)
    assert bb.size.Z == pytest.approx(CUBE_H, abs=1e-6)


# --------------------------------------------------------------------------- #
# Clearance: face edges, tactile notches, magnet pockets
# --------------------------------------------------------------------------- #


def _flat_half_extent(layout) -> float:
    """Half-width of the *flat* part of a side face (fillets excluded)."""
    return layout.size / 2.0 - layout.corner_radius


@pytest.mark.parametrize("mid", [10, 21, 14, 15, 45, 42])
def test_side_labels_keep_the_edge_margin(cubes, mid):
    """≥ ``side_label_margin`` from every edge of the flat side face."""
    parts = cubes[mid]
    margin = PARAMS.side_label_margin
    lateral = _flat_half_extent(parts.layout)
    for sl in parts.side_labels:
        bb = sl.solid.bounding_box()
        horiz = sl.face in ("front", "back")
        across = (bb.min.X, bb.max.X) if horiz else (bb.min.Y, bb.max.Y)
        lo = SIZE / 2.0 - lateral  # first flat millimetre of the face
        hi = SIZE / 2.0 + lateral
        assert across[0] - lo >= margin - 1e-6, (mid, sl.role)
        assert hi - across[1] >= margin - 1e-6, (mid, sl.role)
        assert bb.min.Z >= margin - 1e-6, (mid, sl.role)
        assert CUBE_H - bb.max.Z >= margin - 1e-6, (mid, sl.role)


def test_notch_is_confined_to_a_band_at_its_own_face(cubes):
    """On a cube the tactile slot no longer grooves the whole side face.

    RX(π/2) = 2 notches, pitch 4, centred on the front edge, so x = 28 and 32.
    The slot exists only within ``notch_span`` of the marker face it documents.
    """
    body = cubes[21].body
    span = PARAMS.notch_span
    for nx in (28.0, 32.0):
        assert not _present(body, nx, 0.4, CUBE_H - span / 2.0)  # slot, inside band
        assert _present(body, nx, 0.4, CUBE_H - span - 1.0)  # solid, below band
        assert _present(body, nx, 0.4, CUBE_H / 2.0)  # solid at mid-height
        assert _present(body, nx, 0.4, 3.0)  # solid at the base


def test_notch_band_lies_inside_the_label_margin():
    """The reason a label can never meet a notch, stated as a param invariant."""
    assert PARAMS.notch_span < PARAMS.side_label_margin


@pytest.mark.parametrize("mid", [21, 42])
def test_side_labels_clear_the_notch_band(cubes, mid):
    """Geometric check: no label reaches into the notch band on any face."""
    span = PARAMS.notch_span
    for sl in cubes[mid].side_labels:
        assert sl.solid.bounding_box().max.Z <= CUBE_H - span - 1e-6


def test_side_labels_clear_the_magnet_pockets(config):
    """``--magnets`` cuts two Ø6.2 x 2.1 pockets into the base; labels miss them."""
    parts = build_tile(
        21, config, variant="cube", height=CUBE_H, params=PARAMS, magnets=True
    )
    assert len(parts.side_labels) == 4
    assert parts.body.is_valid and parts.body.is_manifold
    r = PARAMS.magnet_diameter / 2.0
    pockets = [
        Pos(SIZE / 2.0 + dx, SIZE / 2.0, 0.0)
        * Cylinder(
            radius=r,
            height=PARAMS.magnet_depth,
            align=(Align.CENTER, Align.CENTER, Align.MIN),
        )
        for dx in (-PARAMS.magnet_offset, PARAMS.magnet_offset)
    ]
    for sl in parts.side_labels:
        for pocket in pockets:
            assert _vol(sl.solid & pocket) == pytest.approx(0.0, abs=1e-9)
        # and the pockets are a base feature well below the label anyway
        assert sl.solid.bounding_box().min.Z > PARAMS.magnet_depth


# --------------------------------------------------------------------------- #
# What the side face says: family only, vector glyphs for CNOT / SWAP
# --------------------------------------------------------------------------- #


def test_side_label_text_is_family_only():
    """The angle stays top-face information (band caption + tactile notches)."""
    for mid in range(20, 32):
        spec = MARKER_TABLE[mid]
        assert side_label_text(spec) == spec.gate
        assert "π" not in side_label_text(spec)
    for mid, axis in ((42, "RX"), (43, "RY"), (44, "RZ")):
        assert side_label_text(MARKER_TABLE[mid]) == axis  # dials: axis only
    for mid, text in ((10, "H"), (11, "X"), (12, "Y"), (13, "Z"), (40, "S"), (41, "T")):
        assert side_label_text(MARKER_TABLE[mid]) == text


def test_cnot_and_swap_carry_no_text(config):
    """Those three code points tofu in fonts — they are drawn as vectors."""
    for mid in (14, 15, 45):
        assert side_label_text(MARKER_TABLE[mid]) == ""
        assert face_layout(mid, config).side_label == ""


def test_cnot_control_side_glyph_is_a_disc(cubes):
    """● = a filled circle of the target cap height, not a font glyph."""
    cap = PARAMS.side_label_cap * CUBE_H
    expected = math.pi * (cap / 2.0) ** 2 * PARAMS.side_label_depth
    for sl in cubes[14].side_labels:
        bb = sl.solid.bounding_box()
        assert len(sl.solid.solids()) == 1
        assert max(bb.size.X, bb.size.Y, bb.size.Z) == pytest.approx(cap, abs=0.05)
        assert sl.solid.volume == pytest.approx(expected, rel=1e-3)


def test_cnot_target_side_glyph_is_an_open_ring_and_cross(cubes):
    """⊕ = ring + cross: same 27 mm box as ●, far less material, still one solid."""
    cap = PARAMS.side_label_cap * CUBE_H
    disc = math.pi * (cap / 2.0) ** 2 * PARAMS.side_label_depth
    for sl in cubes[15].side_labels:
        bb = sl.solid.bounding_box()
        assert len(sl.solid.solids()) == 1
        assert max(bb.size.X, bb.size.Y, bb.size.Z) == pytest.approx(cap, abs=0.05)
        assert 0.3 * disc < sl.solid.volume < 0.8 * disc
        # hollow centre: nothing in a quadrant between the ring and the cross arms
        c = bb.center()
        off = 0.22 * cap  # diagonal radius ≈ 8.4 mm: clear of both arm and ring
        if sl.face in ("front", "back"):
            assert not _present(sl.solid, c.X + off, c.Y, c.Z + off)
        else:
            assert not _present(sl.solid, c.X, c.Y + off, c.Z + off)


def test_swap_side_glyph_is_a_connected_cross(cubes):
    """× = two crossing round-capped diagonals — one solid, square bounding box."""
    for sl in cubes[45].side_labels:
        bb = sl.solid.bounding_box()
        assert len(sl.solid.solids()) == 1
        across = bb.size.X if sl.face in ("front", "back") else bb.size.Y
        assert across == pytest.approx(bb.size.Z, abs=0.05)
        # the arms meet at the centre
        c = bb.center()
        assert _present(sl.solid, c.X, c.Y, c.Z)


def test_two_glyph_family_label_shrinks_to_fit(cubes):
    """``RX`` is wider than tall, so _fit_text trades cap height for width."""
    parts = cubes[21]
    assert parts.layout.side_label == "RX"
    max_w = SIZE - 2 * parts.layout.corner_radius - 2 * PARAMS.side_label_margin
    for sl in parts.side_labels:
        bb = sl.solid.bounding_box()
        across = bb.size.X if sl.face in ("front", "back") else bb.size.Y
        assert across == pytest.approx(max_w, abs=0.05)  # pinned by the margin
        assert bb.size.Z < PARAMS.side_label_cap * CUBE_H  # shrunk from 27 mm
        assert len(sl.solid.solids()) == 2  # one solid per glyph


# --------------------------------------------------------------------------- #
# Double-faced flip cube: the split layout and its flip symmetry
# --------------------------------------------------------------------------- #


def test_double_cube_has_eight_side_labels(double_cube):
    """Four faces x two halves, each half in its own face's accent colour."""
    labels = double_cube.side_labels
    assert len(labels) == 8
    assert [sl.role for sl in labels] == [
        f"side-{f}-{t}" for f in FACES for t in ("a", "b")
    ]
    hex_a = double_cube.layout_a.accent_hex
    hex_b = double_cube.layout_b.accent_hex
    assert {sl.hex for sl in labels if sl.role.endswith("-a")} == {hex_a}
    assert {sl.hex for sl in labels if sl.role.endswith("-b")} == {hex_b}
    # both accents were already on the plate — no new filament slot
    assert {h for h, _s in double_cube.accents} == {hex_a, hex_b}
    # body, marker, two accents + eight side names
    assert len(double_cube.named_parts()) == 12


def test_double_cube_halves_split_upper_and_lower(double_cube):
    """A above the mid-line, B below it, both inside the edge margin."""
    margin = PARAMS.side_label_margin
    for sl in double_cube.side_labels:
        bb = sl.solid.bounding_box()
        if sl.role.endswith("-a"):
            assert bb.min.Z >= CUBE_H / 2.0
            assert CUBE_H - bb.max.Z >= margin - 1e-6
        else:
            assert bb.max.Z <= CUBE_H / 2.0
            assert bb.min.Z >= margin - 1e-6


def _flip(shape):
    """The physical flip: roll 180° over the front edge, back into the octant.

    ``(x, y, z) → (x, size − y, height − z)`` — the same transform
    ``test_double.test_flip_reads_face_b_canonically`` uses on the marker.
    """
    return Pos(0.0, SIZE, CUBE_H) * Rotation(180, 0, 0) * shape


#: The flip maps each vertical face onto a vertical face (front ↔ back, left and
#: right onto themselves) and acts on it as a 180° in-plane spin.
_FLIP_FACE = {"front": "back", "back": "front", "left": "left", "right": "right"}


def test_flip_brings_face_b_upright_into_the_upper_half(double_cube):
    """After the flip, every B label occupies the A label's place on its face."""
    by_role = {sl.role: sl for sl in double_cube.side_labels}
    for face in FACES:
        flipped = _flip(by_role[f"side-{face}-b"].solid).bounding_box()
        target = by_role[f"side-{_FLIP_FACE[face]}-a"].solid.bounding_box()
        assert flipped.center().X == pytest.approx(target.center().X, abs=1e-6)
        assert flipped.center().Y == pytest.approx(target.center().Y, abs=1e-6)
        assert flipped.center().Z == pytest.approx(target.center().Z, abs=1e-6)
        # ...and now sits in the (new) upper half, clear of the top edge
        assert flipped.min.Z >= CUBE_H / 2.0
        assert CUBE_H - flipped.max.Z >= PARAMS.side_label_margin - 1e-6


def test_flip_symmetry_is_exact_for_a_same_gate_cube(same_gate_cube):
    """With the same gate on both faces the flipped B label *is* the A label.

    Bounding boxes alone cannot see a mirrored or upside-down letter; this
    compares the solids themselves, so a wrong rotation would fail.
    """
    labels = same_gate_cube.side_labels
    assert len(labels) == 8
    by_role = {sl.role: sl for sl in labels}
    for face in FACES:
        flipped = _flip(by_role[f"side-{face}-b"].solid)
        target = by_role[f"side-{_FLIP_FACE[face]}-a"].solid
        assert _vol(flipped - target) == pytest.approx(0.0, abs=VOL_TOL), face
        assert _vol(target - flipped) == pytest.approx(0.0, abs=VOL_TOL), face


def test_double_cube_body_stays_watertight(double_cube):
    assert len(double_cube.body.solids()) == 1
    assert double_cube.body.is_valid and double_cube.body.is_manifold
    solids = [double_cube.body, double_cube.marker]
    solids += [s for _h, s in double_cube.accents]
    solids += [sl.solid for sl in double_cube.side_labels]
    for i in range(len(solids)):
        for j in range(i + 1, len(solids)):
            assert _vol(solids[i] & solids[j]) == pytest.approx(0.0, abs=VOL_TOL)


def test_double_cube_notches_stay_at_their_own_face(config):
    """RX(π/2) | RX(−π/2): A's slot near the top, B's near the bottom, never both."""
    parts = build_double_tile(
        21, 23, config, variant="cube", height=CUBE_H, params=PARAMS
    )
    body = parts.body
    span = PARAMS.notch_span
    # face A: 2 notches on the LEFT half of the front (y=0) edge, cluster at x=15
    assert not _present(body, 13.0, 0.4, CUBE_H - span / 2.0)
    assert _present(body, 13.0, 0.4, CUBE_H / 2.0)
    assert _present(body, 13.0, 0.4, 3.0)
    # face B: 4 notches on the RIGHT half of the back (y=size) edge, cluster at
    # x=45 → slots at x = 39, 43, 47, 51
    assert not _present(body, 43.0, SIZE - 0.4, span / 2.0)
    assert _present(body, 43.0, SIZE - 0.4, CUBE_H / 2.0)
    assert _present(body, 43.0, SIZE - 0.4, CUBE_H - 3.0)


# --------------------------------------------------------------------------- #
# Mono: both single-colour forms recess the side names as paint wells
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def mono_cube(cubes):
    parts = cubes[21]
    return {
        "parts": parts,
        "recessed": build_mono_recessed(parts, PARAMS),
        "raised": build_mono_raised(parts, PARAMS),
    }


def test_mono_cube_forms_are_single_watertight_solids(mono_cube):
    for form in ("recessed", "raised"):
        solid = mono_cube[form]
        assert len(solid.solids()) == 1, form
        assert solid.is_valid and solid.is_manifold, form


def test_mono_cube_side_names_are_wells_in_both_forms(mono_cube):
    """0.5 mm deep, pen-fillable, in the recessed *and* the raised form.

    A filament swap changes whole layers, so it cannot colour a vertical face —
    the raised form therefore keeps the side names recessed like the other one.
    """
    parts = mono_cube["parts"]
    wells = side_label_solids(
        parts.layout, CUBE_H, PARAMS, depth=PARAMS.mono_pocket_depth
    )
    assert len(wells) == 4
    plug_volume = sum(sl.solid.volume for sl in parts.side_labels)
    assert sum(w.solid.volume for w in wells) == pytest.approx(
        plug_volume * PARAMS.mono_pocket_depth / PARAMS.side_label_depth, rel=1e-6
    )
    for form in ("recessed", "raised"):
        solid = mono_cube[form]
        # nothing inside the 0.5 mm well ...
        assert sum(_vol(solid & w.solid) for w in wells) == pytest.approx(
            0.0, abs=VOL_TOL
        ), form
        # ... and solid material behind it, so the well floor is at 0.5 mm exactly
        assert sum(_vol(solid & sl.solid) for sl in parts.side_labels) == pytest.approx(
            plug_volume * PARAMS.mono_pocket_depth / PARAMS.side_label_depth,
            abs=VOL_TOL,
        ), form


def test_mono_cube_side_names_never_stand_proud(mono_cube):
    """The raised form raises only the *top* art; the sides keep the envelope."""
    bb = mono_cube["raised"].bounding_box()
    assert bb.min.X >= -1e-6 and bb.max.X <= SIZE + 1e-6
    assert bb.min.Y >= -1e-6 and bb.max.Y <= SIZE + 1e-6
    assert bb.max.Z == pytest.approx(CUBE_H + PARAMS.mono_raise_height, abs=1e-6)


def test_double_mono_cube_wells(same_gate_cube):
    """The double-mono forms follow the same split layout, wells on both halves."""
    rec = build_double_mono_recessed(same_gate_cube, PARAMS)
    rai = build_double_mono_raised(same_gate_cube, PARAMS)
    r = PARAMS.mono_raise_height
    for form, solid, lift in (("recessed", rec, 0.0), ("raised", rai, r)):
        assert len(solid.solids()) == 1, form
        assert solid.is_valid and solid.is_manifold, form
        for sl in same_gate_cube.side_labels:
            lifted = Pos(0.0, 0.0, lift) * sl.solid
            filled = _vol(solid & lifted)
            # half of the 1 mm plug is material → a 0.5 mm well at the surface
            assert filled == pytest.approx(
                sl.solid.volume * PARAMS.mono_pocket_depth / PARAMS.side_label_depth,
                abs=VOL_TOL,
            ), (form, sl.role)
    assert rec.bounding_box().max.Z == pytest.approx(CUBE_H, abs=1e-6)
    assert rai.bounding_box().max.Z == pytest.approx(CUBE_H + 2.0 * r, abs=1e-6)


# --------------------------------------------------------------------------- #
# Face planes: "upright" means the same thing on all four faces
# --------------------------------------------------------------------------- #


def test_side_face_planes_share_one_up_axis():
    """Every face plane's local +y is world +z, so one placement fits all four."""
    planes = side_face_planes(SIZE, CUBE_H)
    assert [name for name, _p in planes] == list(FACES)
    for _name, plane in planes:
        assert tuple(round(v, 9) for v in plane.y_dir) == (0.0, 0.0, 1.0)
        assert plane.origin.Z == pytest.approx(CUBE_H / 2.0)
        # x_dir (the reading direction) is perpendicular to the outward normal
        assert plane.x_dir.dot(plane.z_dir) == pytest.approx(0.0, abs=1e-9)
