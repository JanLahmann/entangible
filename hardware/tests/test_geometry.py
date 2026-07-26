"""Geometry invariants for the 3D gate tiles — no slicing, all from solids.

Sampled tiles: H (30), RX(π/2) (21), CNOT control (17), S (40). The suite
asserts bounding boxes, that the black marker part reproduces the ArUco bit
matrix cell-for-cell, that the three colour parts are disjoint and tile the top
face, that band/frame dimensions track ``assets.toml``, and that the hollow cube
uses less material than a solid one.
"""

from __future__ import annotations

import math

import pytest
from build123d import Axis, Box, Align, Pos
from qamposer_assets.config import load_config
from qamposer_assets.marker_svg import marker_bit_matrix

from qamposer_hardware.build import build_tile, footprint_area
from qamposer_hardware.face import FACE_DEPTH, face_layout
from qamposer_hardware.params import HardwareParams

SAMPLE_IDS = [30, 21, 17, 40]  # H, RX(π/2), CNOT control, S
TILE_H = 6.0
AREA_TOL = 0.05  # mm² — tessellation/boolean numerical slack
VOL_TOL = 0.5  # mm³
# mm² — extra slack for the *closure* sum only. The band caption is real glyph
# geometry cut out of the accent, and the host resolves the `Helvetica` family
# differently (macOS has it; a Linux CI runner substitutes DejaVu/Liberation).
# A different outline leaves different hairline slivers where a glyph edge meets
# the band, so the three top faces can miss closure by a fraction of a printed
# extrusion width. 0.25 mm² is < 0.01 % of the face — a gap a nozzle could never
# resolve — while still catching any real hole or overlap.
CLOSURE_TOL = 0.25


@pytest.fixture(scope="module")
def config():
    return load_config()


@pytest.fixture(scope="module")
def tiles(config):
    """Build each sampled tile once (tile variant)."""
    return {
        mid: build_tile(mid, config, variant="tile", height=TILE_H)
        for mid in SAMPLE_IDS
    }


# --------------------------------------------------------------------------- #
# Bounding boxes
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("mid", SAMPLE_IDS)
def test_body_bounding_box_exact(tiles, mid):
    bb = tiles[mid].body.bounding_box()
    assert bb.size.X == pytest.approx(60.0, abs=1e-6)
    assert bb.size.Y == pytest.approx(60.0, abs=1e-6)
    assert bb.size.Z == pytest.approx(TILE_H, abs=1e-6)
    assert bb.min.Z == pytest.approx(0.0, abs=1e-6)


@pytest.mark.parametrize("mid", SAMPLE_IDS)
def test_colour_layer_is_top_face_depth(tiles, mid):
    """Marker and accent live only in the top ``FACE_DEPTH`` mm."""
    for part in (tiles[mid].marker, tiles[mid].accent):
        bb = part.bounding_box()
        assert bb.max.Z == pytest.approx(TILE_H, abs=1e-6)
        assert bb.min.Z == pytest.approx(TILE_H - FACE_DEPTH, abs=1e-6)


# --------------------------------------------------------------------------- #
# Marker == ArUco bit matrix
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("mid", SAMPLE_IDS)
def test_black_cells_match_bit_matrix(config, mid):
    """The layout's black cells reproduce the OpenCV bit matrix exactly."""
    matrix = marker_bit_matrix(mid, config.aruco_dictionary)
    expected = {
        (r, c)
        for r, row in enumerate(matrix)
        for c, bit in enumerate(row)
        if bit == 1
    }
    layout = face_layout(mid, config)
    assert set(layout.black_cells) == expected


@pytest.mark.parametrize("mid", SAMPLE_IDS)
def test_marker_solid_footprint_matches_matrix(config, tiles, mid):
    """Probe every module cell against the black solid: present iff bit == 1.

    This checks the *solid* (not just the layout record) and, via the flipped
    Y mapping, that marker orientation is preserved.
    """
    layout = face_layout(mid, config)
    matrix = marker_bit_matrix(mid, config.aruco_dictionary)
    marker = tiles[mid].marker
    z_mid = TILE_H - FACE_DEPTH / 2.0
    probe = 0.6  # mm cube, well inside a 6 mm module
    for cell in layout.modules:
        probe_box = Pos(cell.rect.cx, cell.rect.cy, z_mid) * Box(
            probe, probe, probe, align=(Align.CENTER, Align.CENTER, Align.CENTER)
        )
        inter = marker & probe_box
        present = inter is not None and inter.volume > 1e-6
        assert present == bool(matrix[cell.row][cell.col]), (
            f"cell ({cell.row},{cell.col}) present={present} "
            f"bit={matrix[cell.row][cell.col]}"
        )


@pytest.mark.parametrize("mid", SAMPLE_IDS)
def test_marker_area_and_extent(config, tiles, mid):
    """Black top-face area ≈ (#black cells)·module² and marker sits in-field."""
    layout = face_layout(mid, config)
    n_black = len(layout.black_cells)
    marker = tiles[mid].marker
    top = marker.faces().group_by(Axis.Z)[-1]
    area = sum(f.area for f in top)
    module = layout.module_size
    # Allow bleed growth (each cell +2·bleed per side) as an upper tolerance.
    lo = n_black * module**2
    hi = n_black * (module + 2 * HardwareParams().marker_bleed) ** 2
    assert lo - AREA_TOL <= area <= hi + AREA_TOL
    bb = marker.bounding_box()
    assert bb.min.X >= 12.0 - 0.05 and bb.max.X <= 48.0 + 0.05
    assert bb.min.Y >= 15.0 - 0.05 and bb.max.Y <= 51.0 + 0.05


# --------------------------------------------------------------------------- #
# Disjoint colour parts that tile the top face
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("mid", SAMPLE_IDS)
def test_parts_pairwise_disjoint(tiles, mid):
    p = tiles[mid]
    for a, b in ((p.body, p.marker), (p.body, p.accent), (p.marker, p.accent)):
        inter = a & b
        vol = 0.0 if inter is None else inter.volume
        assert vol == pytest.approx(0.0, abs=VOL_TOL)


@pytest.mark.parametrize("mid", SAMPLE_IDS)
def test_top_face_fully_covered(config, tiles, mid):
    """The three parts' top faces tile the footprint with no gaps/overlaps."""
    p = tiles[mid]
    total = 0.0
    for part in (p.body, p.marker, p.accent):
        top = part.faces().group_by(Axis.Z)[-1]
        total += sum(f.area for f in top)
    assert total == pytest.approx(footprint_area(p.layout), abs=CLOSURE_TOL)


# --------------------------------------------------------------------------- #
# Band / frame dimensions track assets.toml
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("mid", SAMPLE_IDS)
def test_band_and_frame_dimensions(config, mid):
    t = config.tile
    layout = face_layout(mid, config)
    # Band: full width, band_height tall, at the bottom edge.
    assert layout.band.w == pytest.approx(t.size)
    assert layout.band.h == pytest.approx(t.band_height)
    assert layout.band.y0 == pytest.approx(0.0)
    # Frame: white field inset by frame_width on left/right/top.
    assert layout.white_field.w == pytest.approx(t.size - 2 * t.frame_width)
    assert layout.white_field.x0 == pytest.approx(t.frame_width)
    assert layout.white_field.x1 == pytest.approx(t.size - t.frame_width)
    assert layout.white_field.y1 == pytest.approx(t.size - t.frame_width)
    # White field bottom meets the band top.
    assert layout.white_field.y0 == pytest.approx(t.band_height)


def test_accent_spans_full_footprint(tiles):
    """The gate-colour frame reaches all four tile edges."""
    bb = tiles[30].accent.bounding_box()
    assert bb.size.X == pytest.approx(60.0, abs=1e-6)
    assert bb.size.Y == pytest.approx(60.0, abs=1e-6)


# --------------------------------------------------------------------------- #
# Notches encode the rotation angle
# --------------------------------------------------------------------------- #


def test_rotation_notches(config):
    from qamposer_hardware.face import notch_count

    # RX(π/4)=20, RX(π/2)=21, RX(π)=22, RX(-π/2)=23 -> 1,2,3,4 notches.
    assert [notch_count(face_layout(m, config).spec) for m in (20, 21, 22, 23)] == [
        1, 2, 3, 4,
    ]
    # Non-rotation tiles carry no notches.
    assert notch_count(face_layout(30, config).spec) == 0


# --------------------------------------------------------------------------- #
# Cube hollow uses less material than solid
# --------------------------------------------------------------------------- #


def test_cube_hollow_less_than_solid(config):
    hollow = build_tile(30, config, variant="cube", height=60.0)
    solid = build_tile(
        10, config, variant="cube", height=60.0,
        params=HardwareParams(hollow_min_height=math.inf),
    )
    assert hollow.body.volume < solid.body.volume
    # Sanity: hollow removed a substantial fraction (thin 3 mm shell of a 60 mm cube).
    assert hollow.body.volume < 0.5 * solid.body.volume
