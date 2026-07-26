"""Geometry + kit invariants for the double-faced flip pieces.

A double-faced piece carries face A on top and face B (mirrored) on the
underside; flipping the piece over its bottom band edge swaps the visible gate.
The suite's centrepiece is the *mirror-correctness* test: simulate the physical
flip (roll 180° over the front y=0 edge) and assert an overhead camera then
reads face B's ArUco **canonically**. It also checks the 8 mm height, both
colour layers' Z, the left/right notch split, the accent-colour count, and the
kit's piece count / face-degree / plate-grouping rules.
"""

from __future__ import annotations

import pytest
from build123d import Align, Box, Plane, Pos, Rotation, mirror
from qamposer_assets.config import load_config
from qamposer_assets.marker_svg import marker_bit_matrix

from qamposer_hardware.build import build_double_tile
from qamposer_hardware.export import double_plate_assignment, double_slug
from qamposer_hardware.face import FACE_DEPTH, double_notch_rects, face_layout
from qamposer_hardware.params import DOUBLE_FACED_KIT, double_kit_count
from qamposer_vision.markers import MARKER_TABLE

DOUBLE_H = 8.0
SIZE = 60.0
PROBE = 0.6
VOL_TOL = 0.5

# One representative of every pairing shape.
SAMPLE_PAIRS = [
    (17, 15),  # CNOT ctrl | tgt      (same family, no notches)
    (21, 23),  # RX +π/2 | -π/2       (same family, notches 2|4)
    (28, 10),  # RZ π/4  | π          (same family, notches 1|3; RZ(π) = id 10)
    (40, 41),  # S | T                (same family)
    (30, 35),  # H | X                (cross-family)
    (35, 13),  # X | Z                (cross-family)
    (12, 13),  # Y | Z                (cross-family)
]


@pytest.fixture(scope="module")
def config():
    return load_config()


@pytest.fixture(scope="module")
def pieces(config):
    return {
        (a, b): build_double_tile(a, b, config, variant="tile", height=DOUBLE_H)
        for a, b in SAMPLE_PAIRS
    }


def _present(solid, x: float, y: float, z: float) -> bool:
    probe = Pos(x, y, z) * Box(PROBE, PROBE, PROBE, align=(Align.CENTER,) * 3)
    inter = solid & probe
    return inter is not None and inter.volume > 1e-6


# --------------------------------------------------------------------------- #
# THE critical test: flip over the bottom edge → overhead reads face B canonical
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("a,b", SAMPLE_PAIRS)
def test_flip_reads_face_b_canonically(config, pieces, a, b):
    """Roll the piece 180° over its front (y=0) band edge; an overhead camera
    must then read the underside marker as face B's *canonical* bit matrix.

    This proves the mirror convention: the bottom face is built mirrored so that
    the physical flip un-mirrors it. The flip is a 180° rotation about the X axis
    at y=z=0 — ``(x,y,z)→(x,-y,-z)`` — repositioned into the first octant.
    """
    layout_b = face_layout(b, config)
    matrix = marker_bit_matrix(b, config.aruco_dictionary)
    flipped = Pos(0.0, SIZE, DOUBLE_H) * Rotation(180, 0, 0) * pieces[(a, b)].marker
    for cell in layout_b.modules:  # cell.rect.(cx,cy) = face B canonical position
        present = _present(flipped, cell.rect.cx, cell.rect.cy, DOUBLE_H - FACE_DEPTH / 2)
        assert present == bool(matrix[cell.row][cell.col]), (
            f"pair ({a},{b}) cell ({cell.row},{cell.col}) present={present} "
            f"bit={matrix[cell.row][cell.col]}"
        )


@pytest.mark.parametrize("a,b", SAMPLE_PAIRS)
def test_bottom_marker_is_y_mirror_of_canonical(config, pieces, a, b):
    """Equivalent framing: mirror the bottom marker (y→size−y) and it reproduces
    face B's canonical top-face marker exactly — no rotation, no X flip."""
    layout_b = face_layout(b, config)
    matrix = marker_bit_matrix(b, config.aruco_dictionary)
    unmirrored = Pos(0.0, SIZE, 0.0) * mirror(pieces[(a, b)].marker, about=Plane.XZ)
    for cell in layout_b.modules:
        present = _present(unmirrored, cell.rect.cx, cell.rect.cy, FACE_DEPTH / 2)
        assert present == bool(matrix[cell.row][cell.col])


@pytest.mark.parametrize("a,b", SAMPLE_PAIRS)
def test_top_marker_reads_face_a_canonically(config, pieces, a, b):
    """Sanity: the top face is unchanged — an overhead camera reads face A."""
    layout_a = face_layout(a, config)
    matrix = marker_bit_matrix(a, config.aruco_dictionary)
    marker = pieces[(a, b)].marker
    for cell in layout_a.modules:
        present = _present(marker, cell.rect.cx, cell.rect.cy, DOUBLE_H - FACE_DEPTH / 2)
        assert present == bool(matrix[cell.row][cell.col])


# --------------------------------------------------------------------------- #
# 8 mm height and both colour layers at the right Z
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("a,b", SAMPLE_PAIRS)
def test_height_is_8mm(pieces, a, b):
    bb = pieces[(a, b)].body.bounding_box()
    assert bb.size.X == pytest.approx(SIZE, abs=1e-6)
    assert bb.size.Y == pytest.approx(SIZE, abs=1e-6)
    assert bb.size.Z == pytest.approx(DOUBLE_H, abs=1e-6)
    assert bb.min.Z == pytest.approx(0.0, abs=1e-6)


@pytest.mark.parametrize("a,b", SAMPLE_PAIRS)
def test_colour_layers_at_top_and_bottom(pieces, a, b):
    """Marker spans both faces; each accent lives in one 0.8 mm colour layer."""
    p = pieces[(a, b)]
    mb = p.marker.bounding_box()
    assert mb.min.Z == pytest.approx(0.0, abs=1e-6)  # bottom face marker
    assert mb.max.Z == pytest.approx(DOUBLE_H, abs=1e-6)  # top face marker
    for _hex, acc in p.accents:
        ab = acc.bounding_box()
        # Accent geometry lives only in the two 0.8 mm colour layers: its
        # bottom sits on z=0 or z=H-fd, its top on z=fd or z=H (a same-family
        # piece's single accent spans both; cross-family accents each span one).
        assert ab.min.Z in (
            pytest.approx(0.0, abs=1e-6),
            pytest.approx(DOUBLE_H - FACE_DEPTH, abs=1e-6),
        )
        assert ab.max.Z in (
            pytest.approx(FACE_DEPTH, abs=1e-6),
            pytest.approx(DOUBLE_H, abs=1e-6),
        )
        # No accent material in the white core.
        assert not _present(acc, p.layout_a.band.cx, p.layout_a.band.cy, DOUBLE_H / 2)


# --------------------------------------------------------------------------- #
# Accent-colour count: one for same-family, two for cross-family
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("a,b", SAMPLE_PAIRS)
def test_accent_count_matches_family_span(config, pieces, a, b):
    ha = config.colors.for_gate(MARKER_TABLE[a].gate)
    hb = config.colors.for_gate(MARKER_TABLE[b].gate)
    expected = 1 if ha.lower() == hb.lower() else 2
    assert len(pieces[(a, b)].accents) == expected


def test_cross_family_accents_are_disjoint_colours(config, pieces):
    """A cross-family piece has two accent solids in two distinct colour layers."""
    p = pieces[(30, 35)]  # H (red, top) | X (dark blue, bottom)
    assert len(p.accents) == 2
    hexes = {h.lower() for h, _ in p.accents}
    assert hexes == {"#fa4d56", "#002d9c"}
    zmins = sorted(acc.bounding_box().min.Z for _h, acc in p.accents)
    assert zmins[0] == pytest.approx(0.0, abs=1e-6)
    assert zmins[1] == pytest.approx(DOUBLE_H - FACE_DEPTH, abs=1e-6)


# --------------------------------------------------------------------------- #
# Tactile notches: face A left half (y=0 edge), face B right half (y=size edge)
# --------------------------------------------------------------------------- #


def test_notch_halves_helper():
    left = double_notch_rects(SIZE, 2, edge="bottom", half="left")
    right = double_notch_rects(SIZE, 4, edge="top", half="right")
    assert all(r.cx < SIZE / 2 and r.cy == 0.0 for r in left)
    assert all(r.cx > SIZE / 2 and r.cy == SIZE for r in right)
    assert double_notch_rects(SIZE, 0, edge="bottom", half="left") == ()


def test_notch_halves_cut_into_body(pieces):
    """RX(π/2)=2 notches on the left of the y=0 edge; RX(-π/2)=4 on the right of
    the y=size edge. Body material is removed there and nowhere symmetric."""
    body = pieces[(21, 23)].body
    z = DOUBLE_H / 2
    # face A: left-half slot cut, centre of bottom edge intact
    assert not _present(body, 13.0, 0.5, z)
    assert _present(body, 30.0, 0.5, z)
    # face B: right-half slot cut on the top edge, left of top edge intact
    assert not _present(body, 43.0, SIZE - 0.5, z)
    assert _present(body, 15.0, SIZE - 0.5, z)


# --------------------------------------------------------------------------- #
# Kit composition: 24 pieces, symmetric H=X=Y=Z=6 face degree
# --------------------------------------------------------------------------- #


def test_kit_piece_count_is_24():
    assert double_kit_count() == 24


def test_single_qubit_face_degree_is_symmetric():
    deg: dict[str, int] = {}
    for a, b, qty in DOUBLE_FACED_KIT:
        mb = a if b is None else b
        for m in (a, mb):
            gate = MARKER_TABLE[m].gate
            if gate in ("H", "X", "Y", "Z"):
                deg[gate] = deg.get(gate, 0) + qty
    assert deg == {"H": 6, "X": 6, "Y": 6, "Z": 6}


# --------------------------------------------------------------------------- #
# Plate grouping: piece spans ≤2 families, plate spans ≤3 families
# --------------------------------------------------------------------------- #


def test_every_piece_spans_at_most_two_families(config):
    for a, b, _qty in DOUBLE_FACED_KIT:
        mb = a if b is None else b
        fams = {
            config.colors.for_gate(MARKER_TABLE[a].gate).lower(),
            config.colors.for_gate(MARKER_TABLE[mb].gate).lower(),
        }
        assert len(fams) <= 2


def test_plates_span_at_most_three_families(config):
    plates = double_plate_assignment(config, DOUBLE_FACED_KIT)
    for plate in plates:
        assert len(plate["families"]) <= 3
    # every kit piece lands on exactly one plate
    placed = sum(len(p["pieces"]) for p in plates)
    assert placed == len(DOUBLE_FACED_KIT)
    # this kit's full cross-family mix needs 3 plates (2 is provably impossible)
    assert len(plates) == 3


# --------------------------------------------------------------------------- #
# Filename slugs
# --------------------------------------------------------------------------- #


def test_double_slug_examples():
    assert double_slug(MARKER_TABLE[17], MARKER_TABLE[15]) == "cnot-ctrl+cnot-tgt"
    assert double_slug(MARKER_TABLE[21], MARKER_TABLE[23]) == "rx-p2+rx-m2"
    assert double_slug(MARKER_TABLE[40], MARKER_TABLE[41]) == "s+t"
    assert double_slug(MARKER_TABLE[30], MARKER_TABLE[35]) == "h+x"
