"""Measurement blocks (#97) — the right edge refines the wires, never makes them.

Marker ID 47 is board furniture like ID 46, but with a deliberately weaker role:
a wire exists **iff** its left block exists, and a right block only says where
that wire ends. Everything below defends that asymmetry and the one behaviour it
does buy — a paired wire is the SEGMENT through both block centres, so a board
whose two rows of blocks are out of square still files tiles onto the row the
player meant.

Three things are pinned here that the code cannot express on its own:

* **The left side always wins.** Right blocks never change the qubit count, and
  a right block with no partner is reported and dropped.
* **Pairing is deterministic.** Nearest-by-y, greedy from the closest candidate
  pair, ties broken by index — a pure function of the two ordered lists, so the
  same table gives the same wires on every frame and in every test run.
* **Zero right blocks is the normal case.** Everything #95 did must still
  happen, bit for bit, when nobody prints a measurement block.
"""

from __future__ import annotations

import pytest

from qamposer_vision.board import (
    BOARD_MARGIN_MM,
    BoardConfig,
    BoardRect,
    mat_rect,
    on_board,
)
from qamposer_vision.board_model import build_board_model, mat_board_model
from qamposer_vision.cli import detect_circuit
from qamposer_vision.detector import ArucoDetector
from qamposer_vision.grid import GridConfig, GridMapper
from qamposer_vision.wires import (
    FURNITURE_IDS,
    PAIR_TOLERANCE_FRACTION,
    MeasureStabilizer,
    grid_right_edge,
    measure_points,
    pair_measures,
    pair_tolerance,
    stray_furniture,
    wire_points,
)

from tests.utils.render_board import RenderOptions, render_board


@pytest.fixture(scope="module")
def config() -> BoardConfig:
    return BoardConfig.from_toml()


@pytest.fixture(scope="module")
def detector() -> ArucoDetector:
    return ArucoDetector()


def _rect(config: BoardConfig, scale: float) -> BoardRect:
    return BoardRect(config.mat_width * scale, config.mat_height * scale)


def _wire_ys(config: BoardConfig, height: float, count: int) -> tuple[float, ...]:
    """``count`` evenly spread wire positions inside a board ``height`` mm tall."""
    top = config.grid_offset_y + config.cell_size / 2.0
    bottom = height - top
    if count == 0:
        return ()
    if count == 1:
        return (0.5 * (top + bottom),)
    step = (bottom - top) / (count - 1)
    return tuple(top + step * i for i in range(count))


# ---------------------------------------------------------------------------
# Pairing: nearest by y, deterministic, tolerance = half a row pitch
# ---------------------------------------------------------------------------


def test_tolerance_is_half_the_row_pitch(config: BoardConfig) -> None:
    """Exactly the "closer to this wire than to the next" boundary."""
    grid = GridConfig.from_board_config(config)
    assert PAIR_TOLERANCE_FRACTION == 0.5
    assert pair_tolerance(grid) == pytest.approx(config.pitch / 2.0)


def test_each_right_block_pairs_with_its_own_wire() -> None:
    wires = [(30.0, 100.0), (30.0, 200.0), (30.0, 300.0)]
    measures = [(700.0, 104.0), (700.0, 196.0), (700.0, 301.0)]
    pairing = pair_measures(wires, measures, 35.0)
    assert pairing.paired == 3
    assert pairing.unpaired == ()
    assert pairing.spans == (
        (30.0, 100.0, 700.0, 104.0),
        (30.0, 200.0, 700.0, 196.0),
        (30.0, 300.0, 700.0, 301.0),
    )
    assert pairing.mean_span == pytest.approx(670.0)


def test_a_right_block_out_of_tolerance_is_unpaired() -> None:
    """40 mm off a 35 mm tolerance: nobody's wire end."""
    wires = [(30.0, 100.0)]
    pairing = pair_measures(wires, [(700.0, 140.0)], 35.0)
    assert pairing.paired == 0
    assert pairing.spans == (None,)
    assert pairing.unpaired == ((700.0, 140.0),)


def test_no_wires_means_every_right_block_is_unpaired() -> None:
    """The left side always wins: with no wires there is nothing to end."""
    pairing = pair_measures([], [(700.0, 100.0), (700.0, 200.0)], 35.0)
    assert pairing.spans == ()
    assert pairing.paired == 0
    assert len(pairing.unpaired) == 2
    assert pairing.mean_span is None


def test_two_right_blocks_competing_for_one_wire_resolve_by_distance() -> None:
    """The closer block wins the wire; the other is reported, never re-filed."""
    wires = [(30.0, 200.0)]
    pairing = pair_measures(wires, [(700.0, 180.0), (700.0, 205.0)], 35.0)
    assert pairing.spans == ((30.0, 200.0, 700.0, 205.0),)
    assert pairing.unpaired == ((700.0, 180.0),)


def test_pairing_is_a_pure_function_of_the_ordered_lists() -> None:
    """Equidistant candidates must still resolve the same way every time."""
    wires = [(30.0, 100.0), (30.0, 170.0)]
    measures = [(700.0, 135.0)]  # exactly 35 mm from BOTH wires
    first = pair_measures(wires, measures, 35.0)
    for _ in range(20):
        assert pair_measures(wires, measures, 35.0) == first
    # Index order breaks the tie: the first wire takes it, and nothing is lost.
    assert first.spans[0] is not None and first.spans[1] is None
    assert first.unpaired == ()


def test_a_wire_never_takes_two_right_blocks() -> None:
    wires = [(30.0, 100.0)]
    pairing = pair_measures(wires, [(700.0, 99.0), (700.0, 101.0)], 35.0)
    assert pairing.paired == 1
    assert len(pairing.unpaired) == 1


# ---------------------------------------------------------------------------
# The tilted wire: geometry and snapping
# ---------------------------------------------------------------------------


def test_a_paired_wire_is_the_segment_through_both_centres(
    config: BoardConfig,
) -> None:
    spans = ((30.0, 100.0, 700.0, 140.0),)
    model = mat_board_model(config, (100.0,), spans)
    grid = model.grid
    assert grid.wire_spans == spans
    assert model.measure_count == 1
    # Ends, midpoint and an extrapolation past the right block all lie on it.
    assert grid.wire_y_at(0, 30.0) == pytest.approx(100.0)
    assert grid.wire_y_at(0, 700.0) == pytest.approx(140.0)
    assert grid.wire_y_at(0, 365.0) == pytest.approx(120.0)
    assert grid.wire_y_at(0, 1370.0) == pytest.approx(180.0)  # one run further


def test_an_unpaired_wire_stays_horizontal(config: BoardConfig) -> None:
    spans = ((30.0, 100.0, 700.0, 140.0), None)
    model = mat_board_model(config, (100.0, 300.0), spans)
    assert model.measure_count == 1
    assert model.grid.wire_y_at(1, 30.0) == pytest.approx(300.0)
    assert model.grid.wire_y_at(1, 700.0) == pytest.approx(300.0)


def test_a_tilted_wire_carries_its_tiles(config: BoardConfig) -> None:
    """The whole point: a tile that follows the wire is ON the wire.

    Two wires 100 mm apart at the left edge; the top one drops 40 mm across the
    board. A tile sitting on the tilted wire at the last column would be nearer
    the *other* wire's horizontal line — so a detector that ignored the span
    would file it on the wrong qubit, and one that measured to the flat line
    would reject it as off-grid.
    """
    wire_ys = (150.0, 250.0)
    flat = mat_board_model(config, wire_ys)
    tilted = mat_board_model(
        config, wire_ys, ((30.0, 150.0, 700.0, 230.0), None)
    )
    last = flat.grid.cols - 1
    cx, _cy = flat.grid.cell_center(0, last)
    on_the_tilt = tilted.grid.wire_y_at(0, cx)
    assert on_the_tilt > 200.0  # really has moved most of the way over

    assert GridMapper(tilted.grid).assign(cx, on_the_tilt) == (0, last)
    # Without the span the same tile is not on wire 0 at all.
    assert GridMapper(flat.grid).assign(cx, on_the_tilt) != (0, last)


def test_snapping_still_rejects_a_tile_that_is_on_no_wire(
    config: BoardConfig,
) -> None:
    """A tilt is not a licence to guess — the half-cell window still applies."""
    model = mat_board_model(config, (150.0, 350.0), ((30.0, 150.0, 700.0, 190.0), None))
    cx, _cy = model.grid.cell_center(0, 0)
    assert GridMapper(model.grid).assign(cx, 260.0) is None


def test_a_mismatched_span_list_is_dropped_not_misapplied(
    config: BoardConfig,
) -> None:
    """A span on the wrong wire would move gate rows — so refuse the whole list."""
    model = mat_board_model(config, (100.0, 200.0), ((30.0, 100.0, 700.0, 140.0),))
    assert model.grid.wire_spans is None
    assert model.measure_count == 0


def test_all_none_spans_leave_the_pre_97_shape(config: BoardConfig) -> None:
    """Nothing measured must be indistinguishable from #95's own output."""
    plain = mat_board_model(config, (100.0, 200.0))
    with_nones = mat_board_model(config, (100.0, 200.0), (None, None))
    assert with_nones.grid == plain.grid
    assert with_nones.grid.wire_spans is None
    assert with_nones.measure_count == 0


def test_measure_count_is_none_without_wires(config: BoardConfig) -> None:
    """It is a refinement counter: no wires, nothing to refine."""
    assert mat_board_model(config).measure_count is None
    assert mat_board_model(config, ()).measure_count is None


# ---------------------------------------------------------------------------
# Which markers count: right of the last column
# ---------------------------------------------------------------------------


def test_the_right_threshold_is_the_last_columns_right_edge(
    config: BoardConfig,
) -> None:
    grid = GridConfig.from_board_config(config)
    edge = grid_right_edge(grid)
    assert edge == pytest.approx(
        config.grid_offset_x + config.pitch * (config.cols - 1) + config.cell_size
    )
    # It really is inside the mat, i.e. a block on the right edge clears it.
    assert grid.grid_offset_x < edge < config.mat_width


# ---------------------------------------------------------------------------
# Hysteresis on the right-hand set
# ---------------------------------------------------------------------------


def test_measure_stabilizer_appears_after_five_of_seven() -> None:
    st = MeasureStabilizer()
    pts = [(700.0, 100.0), (700.0, 200.0)]
    for _ in range(4):
        assert st.update(pts).points == ()
    result = st.update(pts)
    assert result.changed
    assert result.points == ((700.0, 100.0), (700.0, 200.0))


def test_measure_stabilizer_survives_a_hand_over_the_right_edge() -> None:
    """Eleven hidden frames must not drop a wire back to horizontal."""
    st = MeasureStabilizer()
    pts = [(700.0, 100.0), (700.0, 200.0)]
    for _ in range(5):
        st.update(pts)
    for _ in range(11):
        result = st.update([])
        assert not result.changed
        assert result.points == tuple(pts)
    result = st.update([])
    assert result.changed
    assert result.points == ()


def test_measure_stabilizer_tracks_positions_without_re_emitting() -> None:
    st = MeasureStabilizer()
    for _ in range(5):
        st.update([(700.0, 100.0), (700.0, 200.0)])
    result = st.update([(702.0, 104.0), (699.0, 197.0)])
    assert not result.changed
    assert result.points == ((702.0, 104.0), (699.0, 197.0))


def test_measure_stabilizer_resets(config: BoardConfig) -> None:
    st = MeasureStabilizer()
    for _ in range(5):
        st.update([(700.0, 100.0)])
    assert st.stable
    st.reset()
    assert st.stable == ()


# ---------------------------------------------------------------------------
# End to end on synthetic renders
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "label,scale,ppm", [("mat", 1.0, 3.0), ("1.5x", 1.5, 2.0)], ids=["mat", "1.5x"]
)
@pytest.mark.parametrize("left,right", [(0, 0), (0, 3), (3, 0), (3, 3), (5, 5)])
def test_end_to_end_left_and_right_block_counts(
    config: BoardConfig,
    detector: ArucoDetector,
    label: str,
    scale: float,
    ppm: float,
    left: int,
    right: int,
) -> None:
    """The sweep: the LEFT count is the qubit count, whatever the right side does."""
    rect = _rect(config, scale)
    wires = _wire_ys(config, rect.height, left)
    measures = _wire_ys(config, rect.height, right)
    model = build_board_model(config, rect, "grid", wires or None)

    placements = ((10, 0, 0), (14, 0, 1), (15, 1, 1))
    img = render_board(
        placements,
        config,
        RenderOptions(
            rect=(rect.width, rect.height),
            grid=model.grid,
            wire_mm=wires,
            measure_mm=measures,
            px_per_mm=ppm,
        ),
    )
    result = detect_circuit(img, config, detector=detector, board_layout="grid")
    assert result.has_board
    assert result.model is not None

    # The qubit count is the LEFT count, or the model's rows when there is none.
    if left:
        assert result.model.wire_count == left
        assert result.circuit["qubits"] == left
    else:
        assert result.model.wire_count is None
        assert result.circuit["qubits"] == model.rows

    # Right blocks refine only where there is a wire to refine.
    expected_paired = min(left, right)
    assert (result.model.measure_count or 0) == expected_paired
    unpaired = [w for w in result.warnings if w.kind == "unpaired_measure"]
    assert len(unpaired) == right - expected_paired

    # The Bell pair reads the same in all nine cells of the sweep.
    assert [(g["type"], g["position"]) for g in result.circuit["gates"]] == [
        ("H", 0),
        ("CNOT", 1),
    ]
    assert result.circuit["gates"][1]["control"] == 0
    assert result.circuit["gates"][1]["target"] == 1
    assert [w for w in result.warnings if w.kind == "off_grid"] == []


def test_end_to_end_unpaired_right_block_warns_and_changes_nothing(
    config: BoardConfig, detector: ArucoDetector
) -> None:
    """A right block a whole row away from every wire: reported, then ignored."""
    wires = (150.0, 290.0)
    stray = (150.0 + config.pitch,)  # squarely between the two wires
    model = build_board_model(config, None, "grid", wires)
    img = render_board(
        ((10, 0, 0),),
        config,
        RenderOptions(grid=model.grid, wire_mm=wires, measure_mm=stray, px_per_mm=3.0),
    )
    result = detect_circuit(img, config, detector=detector)
    assert result.model is not None
    assert result.model.wire_count == 2  # unchanged by the stray block
    assert result.model.measure_count == 0
    unpaired = [w for w in result.warnings if w.kind == "unpaired_measure"]
    assert len(unpaired) == 1
    assert unpaired[0].marker_ids == (47,)
    assert "ignored" in unpaired[0].message
    assert result.circuit["qubits"] == 2


def test_end_to_end_a_tilted_board_still_files_its_tiles(
    config: BoardConfig, detector: ArucoDetector
) -> None:
    """Blocks deliberately +/-8 mm out of square: the tiles must still land.

    The wires are rendered on the *tilted* lattice — i.e. exactly where a player
    who lined their tiles up with the two blocks would put them — so a detector
    that ignored the measurement blocks would be measuring to the wrong line.
    """
    left_ys = (150.0, 290.0)
    right_ys = (158.0, 282.0)  # +8 mm / -8 mm
    wire_x = config.corner_margin + config.corner_marker_size / 2.0
    measure_x = config.mat_width - config.corner_margin - config.corner_marker_size / 2.0
    spans = tuple(
        (wire_x, ly, measure_x, ry) for ly, ry in zip(left_ys, right_ys)
    )
    tilted = mat_board_model(config, left_ys, spans)
    assert tilted.measure_count == 2

    placements = ((10, 0, 0), (11, 0, tilted.grid.cols - 1), (12, 1, 3))
    img = render_board(
        placements,
        config,
        RenderOptions(
            grid=tilted.grid,
            wire_mm=left_ys,
            measure_mm=right_ys,
            px_per_mm=3.0,
        ),
    )
    result = detect_circuit(img, config, detector=detector)
    assert result.model is not None
    assert result.model.wire_count == 2
    assert result.model.measure_count == 2
    assert [w.kind for w in result.warnings] == []
    gates = {(g["type"], g["position"], g.get("qubit")) for g in result.circuit["gates"]}
    assert gates == {
        ("H", 0, 0),
        ("X", tilted.grid.cols - 1, 0),
        ("Y", 3, 1),
    }


def test_end_to_end_zero_right_blocks_is_the_pre_97_result(
    config: BoardConfig, detector: ArucoDetector
) -> None:
    """The regression that matters most: printing none must change nothing."""
    wires = (150.0, 250.0, 350.0)
    model = build_board_model(config, None, "grid", wires)
    placements = ((10, 0, 0), (14, 0, 1), (15, 2, 1))
    opts = dict(grid=model.grid, wire_mm=wires, px_per_mm=3.0)
    img = render_board(placements, config, RenderOptions(**opts))
    result = detect_circuit(img, config, detector=detector)
    assert result.model is not None
    assert result.model.grid.wire_spans is None
    assert result.model.measure_count == 0
    assert result.circuit["qubits"] == 3
    assert [(g["type"], g["position"]) for g in result.circuit["gates"]] == [
        ("H", 0),
        ("CNOT", 1),
    ]
    assert result.warnings == []


# ---------------------------------------------------------------------------
# Off the board entirely: the kit lying on the table beside it
# ---------------------------------------------------------------------------
#
# Every rule above is about pieces ON the board. This section is about the ones
# that are not, and it exists because of one booth fact: the unused kit sits on
# the table right next to the play area, in frame, all evening. Those pieces must
# be invisible to the pipeline — not warned about per piece, not fed to a
# stabilizer, not filed as off-grid — or a booth's warning list is unreadable and
# a spare block rolling into and out of view churns the wire hysteresis.


class _FakeMarker:
    """Minimal stand-in for a detected marker (id + centre)."""

    def __init__(self, marker_id: int, x: float, y: float) -> None:
        self.id = marker_id
        self.center = (x, y)


class _IdentityBoard:
    """A board whose image frame *is* the board frame, so tests state mm."""

    @staticmethod
    def image_to_board(center):  # noqa: ANN001 - test double
        return [(float(center[0]), float(center[1]))]


def test_the_margin_is_half_a_printed_piece(config: BoardConfig) -> None:
    """30 mm — half the 60 mm piece every tile and every block is cut to.

    A piece whose centre is within the margin still physically overlaps the
    board, which is the worst a flush-laid piece can look after a nudge; beyond
    it the piece is not touching the play area at all. Derived, not magic — this
    pins the derivation so a change to the tile size fails visibly.
    """
    assert BOARD_MARGIN_MM == pytest.approx(config.tile_size / 2.0)
    rect = mat_rect(config)
    # Just inside on every side, and just outside on every side.
    for x, y in ((-29.0, 250.0), (749.0, 250.0), (360.0, -29.0), (360.0, 529.0)):
        assert on_board(x, y, rect)
    for x, y in ((-31.0, 250.0), (751.0, 250.0), (360.0, -31.0), (360.0, 531.0)):
        assert not on_board(x, y, rect)


def test_furniture_ids_are_the_two_blocks() -> None:
    assert FURNITURE_IDS == {46, 47}


def test_a_wire_block_above_the_board_is_not_a_wire(config: BoardConfig) -> None:
    """Left of the grid AND above the UL corner: today's x rule is not enough."""
    grid = GridConfig.from_board_config(config)
    rect = mat_rect(config)
    good = _FakeMarker(46, 28.0, 150.0)
    stray = _FakeMarker(46, 28.0, -90.0)  # x passes the old rule, y does not
    points = wire_points([good, stray], _IdentityBoard(), grid, rect)
    assert points == [(28.0, 150.0)]
    strays = stray_furniture([good, stray], _IdentityBoard(), rect)
    assert strays == [(46, 28.0, -90.0)]


def test_a_wire_block_far_left_of_the_board_is_not_a_wire(
    config: BoardConfig,
) -> None:
    grid = GridConfig.from_board_config(config)
    rect = mat_rect(config)
    stray = _FakeMarker(46, -150.0, 200.0)
    assert wire_points([stray], _IdentityBoard(), grid, rect) == []
    assert stray_furniture([stray], _IdentityBoard(), rect) == [(46, -150.0, 200.0)]


def test_a_measure_block_below_the_board_is_not_a_wire_end(
    config: BoardConfig,
) -> None:
    grid = GridConfig.from_board_config(config)
    rect = mat_rect(config)
    good = _FakeMarker(47, 692.0, 150.0)
    stray = _FakeMarker(47, 692.0, config.mat_height + 120.0)
    points = measure_points([good, stray], _IdentityBoard(), grid, rect)
    assert points == [(692.0, 150.0)]
    assert [mid for mid, _x, _y in stray_furniture(
        [good, stray], _IdentityBoard(), rect
    )] == [47]


def test_a_block_on_the_board_but_on_the_lattice_is_not_a_stray(
    config: BoardConfig,
) -> None:
    """Misplaced is not the same as absent — only the bounds rule makes a stray."""
    grid = GridConfig.from_board_config(config)
    rect = mat_rect(config)
    on_lattice = _FakeMarker(46, 300.0, 200.0)
    assert wire_points([on_lattice], _IdentityBoard(), grid, rect) == []
    assert stray_furniture([on_lattice], _IdentityBoard(), rect) == []


def test_strays_are_reported_in_a_stable_order(config: BoardConfig) -> None:
    """A frame's report is a function of the table, not of detector ordering."""
    rect = mat_rect(config)
    markers = [
        _FakeMarker(47, 900.0, 400.0),
        _FakeMarker(46, -120.0, 100.0),
        _FakeMarker(46, -200.0, 100.0),
    ]
    expected = stray_furniture(markers, _IdentityBoard(), rect)
    assert expected == [(46, -200.0, 100.0), (46, -120.0, 100.0), (47, 900.0, 400.0)]
    for order in ([2, 0, 1], [1, 2, 0], [0, 2, 1]):
        shuffled = [markers[i] for i in order]
        assert stray_furniture(shuffled, _IdentityBoard(), rect) == expected


def test_stray_blocks_never_reach_the_wire_hysteresis(config: BoardConfig) -> None:
    """A block flickering off-board must not move the stabilizer at all.

    ``wire_points`` is what feeds the stabilizer, so the guarantee is structural:
    the stray is filtered before the stabilizer is told anything. Twenty frames
    of it appearing and disappearing leave the wire set exactly where two real
    blocks put it.
    """
    from qamposer_vision.wires import WireStabilizer

    grid = GridConfig.from_board_config(config)
    rect = mat_rect(config)
    real = [_FakeMarker(46, 28.0, 150.0), _FakeMarker(46, 28.0, 290.0)]
    stray = _FakeMarker(46, 28.0, -90.0)
    st = WireStabilizer()
    for _ in range(5):
        st.update(y for _x, y in wire_points(real, _IdentityBoard(), grid, rect))
    assert st.stable == (150.0, 290.0)
    for i in range(20):
        frame = real + ([stray] if i % 2 == 0 else [])
        result = st.update(
            y for _x, y in wire_points(frame, _IdentityBoard(), grid, rect)
        )
        assert not result.changed
        assert result.wires == (150.0, 290.0)


def test_end_to_end_a_stray_block_leaves_the_wires_alone(
    config: BoardConfig, detector: ArucoDetector
) -> None:
    """A wire block above the board and one below: warned once, never a wire."""
    wires = (150.0, 250.0, 350.0)
    model = build_board_model(config, None, "grid", wires)
    loose = (
        (46, 28.0, -80.0),
        (47, 692.0, config.mat_height + 80.0),
    )
    img = render_board(
        ((10, 0, 0),),
        config,
        RenderOptions(
            grid=model.grid,
            wire_mm=wires,
            pad_mm=140.0,
            px_per_mm=2.5,
            furniture_mm=loose,
        ),
    )
    result = detect_circuit(img, config, detector=detector, board_layout="grid")
    assert result.model is not None
    assert result.model.wire_count == 3  # the strays changed nothing
    assert result.model.measure_count == 0
    kinds = [w.kind for w in result.warnings]
    assert kinds.count("stray_furniture") == 1  # ONE line, not one per block
    assert "unpaired_measure" not in kinds  # a stray never enters pairing
    stray = next(w for w in result.warnings if w.kind == "stray_furniture")
    assert "2 board-furniture block(s)" in stray.message
    assert stray.marker_ids == (46, 47)
    assert result.circuit["qubits"] == 3


def test_end_to_end_a_tile_beside_the_board_is_dropped_silently(
    config: BoardConfig, detector: ArucoDetector
) -> None:
    """150 mm right of the board: counted, never ``off_grid``, never a gate."""
    loose = ((11, config.mat_width + 150.0, 200.0),)
    img = render_board(
        ((10, 0, 0),),
        config,
        RenderOptions(pad_mm=220.0, px_per_mm=2.0, extra_mm=loose),
    )
    result = detect_circuit(img, config, detector=detector)
    kinds = [w.kind for w in result.warnings]
    assert "off_grid" not in kinds  # the whole point of the change
    assert kinds.count("stray_tiles") == 1
    assert "1 gate tile(s)" in next(
        w for w in result.warnings if w.kind == "stray_tiles"
    ).message
    # ... and it is nowhere near the circuit.
    assert [(g["type"], g["position"]) for g in result.circuit["gates"]] == [("H", 0)]


def test_end_to_end_a_tile_inside_the_board_still_warns_off_grid(
    config: BoardConfig, detector: ArucoDetector
) -> None:
    """The signal we keep: on the board, between cells, genuinely misplaced."""
    grid = GridConfig.from_board_config(config)
    cx3, cy2 = grid.cell_center(2, 3)
    cx4, _cy = grid.cell_center(2, 4)
    # Squarely in the gutter between two cells, and well clear of the H tile so
    # the two markers cannot overlap in the render.
    between = ((11, (cx3 + cx4) / 2.0, cy2),)
    img = render_board(
        ((10, 0, 0),),
        config,
        RenderOptions(px_per_mm=3.0, extra_mm=between),
    )
    result = detect_circuit(img, config, detector=detector)
    kinds = [w.kind for w in result.warnings]
    assert kinds.count("off_grid") == 1
    assert "stray_tiles" not in kinds
    assert [(g["type"], g["position"]) for g in result.circuit["gates"]] == [("H", 0)]


def test_end_to_end_booth_inventory_beside_the_board(
    config: BoardConfig, detector: ArucoDetector
) -> None:
    """Five spare tiles heaped below the board: one counted line, no churn.

    Before this change each one of them raised its own ``off_grid`` warning —
    five lines of noise for a table that is behaving perfectly normally.
    """
    heap = tuple(
        (11 + (i % 3), 120.0 + 70.0 * i, config.mat_height + 150.0) for i in range(5)
    )
    img = render_board(
        ((10, 0, 0), (14, 0, 1), (15, 1, 1)),
        config,
        RenderOptions(pad_mm=220.0, px_per_mm=2.5, extra_mm=heap),
    )
    result = detect_circuit(img, config, detector=detector)
    kinds = [w.kind for w in result.warnings]
    assert "off_grid" not in kinds
    assert kinds.count("stray_tiles") == 1
    assert "5 gate tile(s)" in next(
        w for w in result.warnings if w.kind == "stray_tiles"
    ).message
    # The circuit is exactly the Bell pair on the board, heap or no heap.
    assert [(g["type"], g["position"]) for g in result.circuit["gates"]] == [
        ("H", 0),
        ("CNOT", 1),
    ]
    assert result.circuit["qubits"] == config.rows
