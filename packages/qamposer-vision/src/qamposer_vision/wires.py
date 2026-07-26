"""Qubit-wire blocks (task #95) — the qubit count comes off the table.

Marker ID 46 (:data:`~.markers.QUBIT_WIRE_ID`) is board furniture, not a gate:
up to five *identical* blocks sit along the board's left edge between the UL and
LL corner blocks, and each one declares a qubit wire at its own vertical
position. Sorted top-down they become q0..qn-1, the emitted circuit has exactly
that many qubits, and gate tiles snap to the nearest wire instead of a fixed
lattice row. No blocks on the table = the classic behaviour (the model's own
rows).

Measurement blocks (task #97, marker ID 47) are the right-edge counterpart, and
a pure *refinement*: they never create a wire. A wire exists iff its LEFT block
exists; a right block only says where that wire ENDS, which turns the wire from
a horizontal line at the left block's y into the SEGMENT through both block
centres — so a board whose two rows of blocks are slightly out of square gets
tilted wires that still follow the tiles. A right block with no left partner is
ignored and reported.

The pieces here:

* :func:`wire_points` / :func:`wire_positions` — which detected ID-46 markers
  count as wires (they have to be *left of* the grid, in board mm) and where
  they sit;
* :func:`measure_points` — the same question for ID-47, mirrored: a block counts
  only when it falls *right of* the last column;
* :func:`pair_measures` — nearest-by-y matching of right blocks to left blocks,
  within :data:`PAIR_TOLERANCE_FRACTION` of the row pitch;
* :class:`WireStabilizer` — the same asymmetric hysteresis the tile stabilizer
  uses, applied to the wire SET, so a hand crossing the left edge cannot resize
  the circuit frame by frame. Growing the set takes ``appear_min`` of the last
  ``appear_window`` frames; shrinking it (including losing the last block, which
  falls back to the classic rows) takes ``disappear_after`` CONSECUTIVE frames.
  While the count holds steady the positions keep tracking, silently — a block
  nudged a centimetre moves its wire without re-emitting anything;
* :class:`MeasureStabilizer` — the same hysteresis over the right-hand blocks,
  so a hand crossing the *right* edge cannot make paired wires snap back to
  horizontal and out again frame by frame.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any, Iterable, Sequence

from .board_model import MAX_WIRES
from .grid import GridConfig
from .markers import MEASURE_BLOCK_ID, QUBIT_WIRE_ID

__all__ = [
    "PAIR_TOLERANCE_FRACTION",
    "MeasurePairing",
    "MeasureResult",
    "MeasureStabilizer",
    "WireResult",
    "WireStabilizer",
    "measure_points",
    "pair_measures",
    "pair_tolerance",
    "wire_points",
    "wire_positions",
]

#: Half a row pitch: how far a measurement block's centre may sit from a wire
#: block's and still be read as *that* wire's end. Half the pitch is exactly the
#: "closer to this wire than to the next one" boundary, and the blocks are
#: 60 mm squares on a 70 mm pitch, so a correctly placed pair is never near it.
PAIR_TOLERANCE_FRACTION = 0.5


def pair_tolerance(grid: GridConfig) -> float:
    """Vertical tolerance (board mm) for pairing a right block to a left one."""
    return grid.y_pitch * PAIR_TOLERANCE_FRACTION


def _furniture_points(
    markers: Iterable[Any], board: Any, marker_id: int
) -> list[tuple[float, float]]:
    """Board-mm ``(x, y)`` of every marker with ``marker_id``, unfiltered."""
    points: list[tuple[float, float]] = []
    for marker in markers:
        if marker.id != marker_id:
            continue
        x_mm, y_mm = (float(v) for v in board.image_to_board(marker.center)[0])
        points.append((x_mm, y_mm))
    return points


def wire_points(
    markers: Iterable[Any],
    board: Any,
    grid: GridConfig,
    max_wires: int = MAX_WIRES,
) -> list[tuple[float, float]]:
    """Board-mm ``(x, y)`` of every qubit-wire block, sorted top-down.

    A block counts only when its centre falls **left of the grid's first
    column** (``x < grid_offset_x``) — that is where the wires start, and it
    keeps a stray block that wandered onto the lattice from silently becoming a
    wire. At most ``max_wires`` are returned (the topmost ones).
    """
    points = [
        (x, y)
        for x, y in _furniture_points(markers, board, QUBIT_WIRE_ID)
        if x < grid.grid_offset_x
    ]
    points.sort(key=lambda p: p[1])
    return points[:max_wires]


def wire_positions(
    markers: Iterable[Any],
    board: Any,
    grid: GridConfig,
    max_wires: int = MAX_WIRES,
) -> list[float]:
    """Board-mm y of every qubit-wire block, sorted top-down.

    The y half of :func:`wire_points` — what decides how many wires the board
    has and where each one starts.
    """
    return [y for _x, y in wire_points(markers, board, grid, max_wires)]


def grid_right_edge(grid: GridConfig) -> float:
    """Board-mm x of the right edge of the lattice's last column."""
    return grid.grid_offset_x + grid.pitch * (grid.cols - 1) + grid.cell_size


def measure_points(
    markers: Iterable[Any],
    board: Any,
    grid: GridConfig,
    max_wires: int = MAX_WIRES,
) -> list[tuple[float, float]]:
    """Board-mm ``(x, y)`` of every measurement block, sorted top-down.

    The mirror of :func:`wire_points`: a block counts only when its centre falls
    **right of the last column**, so a block that wandered onto the lattice can
    never be read as a wire end. At most ``max_wires`` are returned — a board
    tops out at :data:`~.board_model.MAX_WIRES` wires, so more right blocks than
    that cannot all be ends.
    """
    edge = grid_right_edge(grid)
    points = [
        (x, y)
        for x, y in _furniture_points(markers, board, MEASURE_BLOCK_ID)
        if x > edge
    ]
    points.sort(key=lambda p: p[1])
    return points[:max_wires]


@dataclass(frozen=True, slots=True)
class MeasurePairing:
    """The result of matching measurement blocks to qubit-wire blocks."""

    #: Per wire (same order as the wire list): the segment
    #: ``(x_left, y_left, x_right, y_right)`` in board mm, or ``None`` for a
    #: wire with no measurement block — that one stays horizontal.
    spans: tuple[tuple[float, float, float, float] | None, ...]
    #: Measurement blocks that matched no wire, board-mm ``(x, y)``, top-down.
    #: They are ignored: the left side always wins.
    unpaired: tuple[tuple[float, float], ...]

    @property
    def paired(self) -> int:
        """How many wires have a measured end."""
        return sum(1 for s in self.spans if s is not None)

    @property
    def mean_span(self) -> float | None:
        """Mean left→right horizontal run of the paired wires (mm), or ``None``."""
        runs = [s[2] - s[0] for s in self.spans if s is not None]
        return sum(runs) / len(runs) if runs else None


def pair_measures(
    wires: Sequence[tuple[float, float]],
    measures: Sequence[tuple[float, float]],
    tolerance: float,
) -> MeasurePairing:
    """Match each measurement block to the nearest wire block by y.

    Greedy over every in-tolerance candidate pair sorted by vertical distance,
    so the closest pair always wins and neither side is used twice. Ties are
    broken by index — the pairing is a pure function of the two ordered lists,
    which is what makes it reproducible frame to frame and in tests.

    A right block further than ``tolerance`` from every wire is *unpaired*: it
    is reported and otherwise ignored. Wire count is never derived from here.
    """
    candidates: list[tuple[float, int, int]] = []
    for mi, (_mx, my) in enumerate(measures):
        for wi, (_wx, wy) in enumerate(wires):
            distance = abs(my - wy)
            if distance <= tolerance:
                candidates.append((distance, mi, wi))
    candidates.sort()

    spans: list[tuple[float, float, float, float] | None] = [None] * len(wires)
    used_m: set[int] = set()
    used_w: set[int] = set()
    for _distance, mi, wi in candidates:
        if mi in used_m or wi in used_w:
            continue
        used_m.add(mi)
        used_w.add(wi)
        wx, wy = wires[wi]
        mx, my = measures[mi]
        spans[wi] = (wx, wy, mx, my)

    unpaired = tuple(p for i, p in enumerate(measures) if i not in used_m)
    return MeasurePairing(spans=tuple(spans), unpaired=unpaired)


@dataclass(frozen=True, slots=True)
class WireResult:
    """Outcome of feeding one frame's wire observations to the stabilizer."""

    #: Stable wire positions (board mm, top-down), or ``None`` for "no blocks".
    wires: tuple[float, ...] | None
    #: ``True`` only on frames where the stable wire COUNT changed.
    changed: bool


class WireStabilizer:
    """Asymmetric-hysteresis stabilizer over per-frame wire-block positions."""

    def __init__(
        self,
        appear_window: int = 7,
        appear_min: int = 5,
        disappear_after: int = 12,
        max_wires: int = MAX_WIRES,
    ) -> None:
        if appear_min > appear_window:
            raise ValueError("appear_min cannot exceed appear_window")
        self.appear_window = appear_window
        self.appear_min = appear_min
        self.disappear_after = disappear_after
        self.max_wires = max_wires
        self._window: deque[int] = deque(maxlen=appear_window)
        self._stable: tuple[float, ...] | None = None
        self._shrink_streak = 0

    @property
    def stable(self) -> tuple[float, ...] | None:
        return self._stable

    def reset(self) -> None:
        """Forget all history (e.g. on a camera swap)."""
        self._window.clear()
        self._stable = None
        self._shrink_streak = 0

    def update(self, observed: Iterable[float]) -> WireResult:
        """Advance one frame with the wire y positions seen on it."""
        ys = sorted(float(y) for y in observed)[: self.max_wires]
        n = len(ys)
        self._window.append(n)
        current = 0 if self._stable is None else len(self._stable)
        changed = False

        if n < current:
            # Shrinking (a block removed, or a hand over the left edge) is slow:
            # only after `disappear_after` consecutive frames short of the count.
            self._shrink_streak += 1
            if self._shrink_streak >= self.disappear_after:
                self._stable = tuple(ys) if ys else None
                self._shrink_streak = 0
                changed = True
        else:
            self._shrink_streak = 0
            if n > current:
                # Growing is a debounce: seen in `appear_min` of the last
                # `appear_window` frames.
                seen = sum(1 for count in self._window if count >= n)
                if seen >= self.appear_min:
                    self._stable = tuple(ys)
                    changed = True
            elif n > 0:
                # Same count: track the positions, emit nothing.
                self._stable = tuple(ys)

        return WireResult(wires=self._stable, changed=changed)


@dataclass(frozen=True, slots=True)
class MeasureResult:
    """Outcome of feeding one frame's measurement-block observations."""

    #: Stable measurement-block positions (board mm, top-down). Empty = none.
    points: tuple[tuple[float, float], ...]
    #: ``True`` only on frames where the stable block COUNT changed.
    changed: bool


class MeasureStabilizer:
    """Hysteresis over the measurement-block set — the wire stabilizer's mirror.

    A right block only refines a wire, so a flickering one cannot change the
    qubit count; what it *can* do is make a paired wire snap between tilted and
    horizontal, which would move gate rows on a boundary tile. So the right side
    gets exactly the same asymmetric hysteresis as the left: the count is
    delegated to a :class:`WireStabilizer` over the blocks' y positions, and the
    x positions ride along with it.

    While the stable count holds, the most recent observation *of that count* is
    what is reported — so a block hidden for a frame keeps its last known place
    rather than dropping its wire back to horizontal. Because both of the
    stabilizer's transitions re-seed the stable set from the very frame that
    triggered them, an observation matching the stable count always arrives on
    the frame the count changes.
    """

    def __init__(
        self,
        appear_window: int = 7,
        appear_min: int = 5,
        disappear_after: int = 12,
        max_wires: int = MAX_WIRES,
    ) -> None:
        self._inner = WireStabilizer(
            appear_window=appear_window,
            appear_min=appear_min,
            disappear_after=disappear_after,
            max_wires=max_wires,
        )
        self.max_wires = max_wires
        self._points: tuple[tuple[float, float], ...] = ()

    @property
    def stable(self) -> tuple[tuple[float, float], ...]:
        return self._points

    def reset(self) -> None:
        """Forget all history (e.g. on a camera swap)."""
        self._inner.reset()
        self._points = ()

    def update(
        self, observed: Iterable[tuple[float, float]]
    ) -> MeasureResult:
        """Advance one frame with the measurement-block points seen on it."""
        points = sorted(
            ((float(x), float(y)) for x, y in observed), key=lambda p: p[1]
        )[: self.max_wires]
        result = self._inner.update(y for _x, y in points)
        stable_n = 0 if result.wires is None else len(result.wires)
        if stable_n == 0:
            self._points = ()
        elif len(points) == stable_n:
            self._points = tuple(points)
        return MeasureResult(points=self._points, changed=result.changed)
