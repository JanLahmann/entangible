"""Single-colour (mono) variant invariants — no MMU, no colour.

The mono builders reshape only the Z profile of the existing colour parts:

* **recessed** sinks every colour footprint into the body as a shallow, vertical-
  walled paint-well pocket (``mono_pocket_depth`` deep). One watertight solid.
* **raised** stands every colour footprint proud of the face by a uniform
  ``mono_raise_height`` so one filament swap prints two-tone; a double piece
  raises *both* faces (art at both Z extremes).

The suite pins: single watertightness, pocket depth ≤ 0.6 mm and its floor area
matching the marker footprint, uniform raise height, double-faced art at both Z
extremes, and the CLI's mono file set.
"""

from __future__ import annotations

import pytest
from build123d import Align, Axis, Box, Pos
from qamposer_assets.config import load_config

from qamposer_hardware.build import (
    build_double_mono_raised,
    build_double_mono_recessed,
    build_double_tile,
    build_mono_raised,
    build_mono_recessed,
    build_tile,
)
from qamposer_hardware.face import face_layout
from qamposer_hardware.params import HardwareParams

TILE_H = 6.0
DOUBLE_H = 8.0
AREA_TOL = 0.05
VOL_TOL = 0.5
PARAMS = HardwareParams()


@pytest.fixture(scope="module")
def config():
    return load_config()


@pytest.fixture(scope="module")
def tile(config):
    """H (id 10) single tile + its two mono variants, built once."""
    parts = build_tile(10, config, variant="tile", height=TILE_H)
    return {
        "parts": parts,
        "recessed": build_mono_recessed(parts, PARAMS),
        "raised": build_mono_raised(parts, PARAMS),
    }


@pytest.fixture(scope="module")
def double(config):
    """H|X (10,11) cross-family double + its two mono variants, built once."""
    parts = build_double_tile(10, 11, config, variant="tile", height=DOUBLE_H)
    return {
        "parts": parts,
        "recessed": build_double_mono_recessed(parts, PARAMS),
        "raised": build_double_mono_raised(parts, PARAMS),
    }


def _present(solid, x: float, y: float, z: float, s: float = 0.4) -> bool:
    probe = Pos(x, y, z) * Box(s, s, s, align=(Align.CENTER,) * 3)
    inter = solid & probe
    return inter is not None and inter.volume > 1e-6


def _top_area(solid) -> float:
    return sum(f.area for f in solid.faces().group_by(Axis.Z)[-1])


# --------------------------------------------------------------------------- #
# Recessed: one watertight solid, bounded pocket depth, marker-footprint pockets
# --------------------------------------------------------------------------- #


def test_recessed_is_single_watertight_solid(tile):
    rec = tile["recessed"]
    assert len(rec.solids()) == 1
    assert rec.is_valid and rec.is_manifold
    # No added height: the recessed form is the body outline exactly.
    bb = rec.bounding_box()
    assert bb.size.X == pytest.approx(60.0, abs=1e-6)
    assert bb.size.Y == pytest.approx(60.0, abs=1e-6)
    assert bb.min.Z == pytest.approx(0.0, abs=1e-6)
    assert bb.max.Z == pytest.approx(TILE_H, abs=1e-6)


def test_recessed_pocket_depth_within_bounds(tile):
    """A marker cell is hollow within the top pocket and solid just below it."""
    parts, rec = tile["parts"], tile["recessed"]
    depth = PARAMS.mono_pocket_depth
    assert depth <= 0.6  # oblique-camera shadow constraint
    black = next(c for c in parts.layout.modules if c.bit == 1)
    # inside the pocket band → recessed (no material at the top face)
    assert not _present(rec, black.rect.cx, black.rect.cy, TILE_H - depth / 2)
    # just below the pocket floor → solid body
    assert _present(rec, black.rect.cx, black.rect.cy, TILE_H - depth - 0.15)


def test_recessed_marker_pocket_area_matches_footprint(tile):
    """Material removed over the marker == marker footprint × pocket depth."""
    parts, rec = tile["parts"], tile["recessed"]
    depth = PARAMS.mono_pocket_depth
    whole = parts.body + parts.marker + parts.accent
    removed = whole - rec  # exactly the pockets (recessed = whole − pockets)
    marker_removed = removed & parts.marker  # restrict to the marker footprint
    marker_area = _top_area(parts.marker)
    assert marker_removed.volume == pytest.approx(marker_area * depth, abs=VOL_TOL)
    # And the full pocket set == (marker + accent) footprint × depth.
    total_area = marker_area + _top_area(parts.accent)
    assert removed.volume == pytest.approx(total_area * depth, abs=VOL_TOL)


# --------------------------------------------------------------------------- #
# Raised: single-faced art stands a uniform height above the top face
# --------------------------------------------------------------------------- #


def test_raised_height_is_uniform(tile):
    parts, rai = tile["parts"], tile["raised"]
    r = PARAMS.mono_raise_height
    bb = rai.bounding_box()
    assert bb.min.Z == pytest.approx(0.0, abs=1e-6)
    assert bb.max.Z == pytest.approx(TILE_H + r, abs=1e-6)  # uniform +r everywhere
    assert len(rai.solids()) == 1 and rai.is_valid
    # The added volume above the old top face == colour footprint × r (a prism of
    # uniform height, no taper).
    whole = parts.body + parts.marker + parts.accent
    footprint_area = _top_area(parts.marker) + _top_area(parts.accent)
    assert rai.volume - whole.volume == pytest.approx(footprint_area * r, abs=VOL_TOL)
    # Every raised-art top face sits at exactly h+r (uniform, flat).
    art_top = rai.faces().group_by(Axis.Z)[-1]
    assert all(f.center().Z == pytest.approx(TILE_H + r, abs=1e-6) for f in art_top)


def test_raised_marker_reads_at_new_top(tile):
    """A black marker cell is present at the raised top; a white cell is not."""
    parts, rai = tile["parts"], tile["raised"]
    r = PARAMS.mono_raise_height
    z = TILE_H + r / 2  # inside the raised band
    black = next(c for c in parts.layout.modules if c.bit == 1)
    white = next(c for c in parts.layout.modules if c.bit == 0)
    assert _present(rai, black.rect.cx, black.rect.cy, z)
    assert not _present(rai, white.rect.cx, white.rect.cy, z)


# --------------------------------------------------------------------------- #
# Double-faced mono: recessed both faces; raised has art at both Z extremes
# --------------------------------------------------------------------------- #


def test_double_recessed_watertight_both_faces(double):
    parts, rec = double["parts"], double["recessed"]
    assert len(rec.solids()) == 1 and rec.is_valid and rec.is_manifold
    bb = rec.bounding_box()
    assert bb.min.Z == pytest.approx(0.0, abs=1e-6)
    assert bb.max.Z == pytest.approx(DOUBLE_H, abs=1e-6)
    depth = PARAMS.mono_pocket_depth
    # top face A marker cell recessed from the top; bottom face B marker cell
    # recessed from the bottom (bottom marker is mirrored: y → size − y).
    la = parts.layout_a
    lb = parts.layout_b
    ta = next(c for c in la.modules if c.bit == 1)
    tb = next(c for c in lb.modules if c.bit == 1)
    assert not _present(rec, ta.rect.cx, ta.rect.cy, DOUBLE_H - depth / 2)
    assert _present(rec, ta.rect.cx, ta.rect.cy, DOUBLE_H - depth - 0.15)
    assert not _present(rec, tb.rect.cx, 60.0 - tb.rect.cy, depth / 2)
    assert _present(rec, tb.rect.cx, 60.0 - tb.rect.cy, depth + 0.15)


def test_double_raised_art_at_both_z_extremes(double):
    parts, rai = double["parts"], double["raised"]
    r = PARAMS.mono_raise_height
    bb = rai.bounding_box()
    assert len(rai.solids()) == 1 and rai.is_valid
    assert bb.min.Z == pytest.approx(0.0, abs=1e-6)
    assert bb.max.Z == pytest.approx(2.0 * r + DOUBLE_H, abs=1e-6)
    la, lb = parts.layout_a, parts.layout_b
    ta = next(c for c in la.modules if c.bit == 1)
    tb = next(c for c in lb.modules if c.bit == 1)
    # top-face art near the max extreme
    assert _present(rai, ta.rect.cx, ta.rect.cy, 2.0 * r + DOUBLE_H - r / 2)
    # bottom-face art near z=0 (mirrored bottom marker position)
    assert _present(rai, tb.rect.cx, 60.0 - tb.rect.cy, r / 2)
    # the white core between the two art bands has no art footprint at its middle,
    # only the body — a spot outside any marker cell is solid body, not raised.
    assert _present(rai, la.band.cx, la.band.cy, r + DOUBLE_H / 2)


# --------------------------------------------------------------------------- #
# CLI emits the expected mono file set alongside the coloured exports
# --------------------------------------------------------------------------- #


def test_cli_single_emits_mono_file_set(tmp_path):
    from qamposer_hardware.cli import main

    rc = main(
        ["generate", "--variant", "tile", "--gates", "H", "--mono",
         "--out", str(tmp_path)]
    )
    assert rc == 0
    vdir = tmp_path / "tile"
    expected = {
        "h-body-white.stl",
        "h-marker-black.stl",
        "h-accent-red.stl",
        "h.3mf",
        "h-mono-recessed.stl",
        "h-mono-raised.stl",
        "plates.md",
        "mono.md",
    }
    present = {p.name for p in vdir.iterdir()}
    assert expected <= present, f"missing: {expected - present}"
    # mono.md documents the single-faced one-swap recipe at Z = height.
    text = (vdir / "mono.md").read_text(encoding="utf-8")
    assert "Recessed" in text and "Raised" in text
    assert f"{TILE_H:.3f}" in text  # the swap Z for a single tile


def test_cli_double_emits_mono_file_set(tmp_path):
    from qamposer_hardware.cli import main

    rc = main(
        ["generate", "--faces", "double", "--variant", "tile", "--gates", "S",
         "--mono", "--out", str(tmp_path)]
    )
    assert rc == 0
    vdir = tmp_path / "tile-double"
    names = {p.name for p in vdir.iterdir()}
    assert "s+t-mono-recessed.stl" in names
    assert "s+t-mono-raised.stl" in names
    assert "mono.md" in names
    text = (vdir / "mono.md").read_text(encoding="utf-8")
    # two-swap dark→light→dark recipe for a double piece
    assert "dark → light → dark" in text
    r = PARAMS.mono_raise_height
    assert f"{r:.3f}" in text and f"{r + DOUBLE_H:.3f}" in text
