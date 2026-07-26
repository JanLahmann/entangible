"""Qubit-wire blocks (task #95) — the qubit count comes off the table.

Marker ID 46 (:data:`~.markers.QUBIT_WIRE_ID`) is board furniture, not a gate:
up to five *identical* blocks sit along the board's left edge between the UL and
LL corner blocks, and each one declares a qubit wire at its own vertical
position. Sorted top-down they become q0..qn-1, the emitted circuit has exactly
that many qubits, and gate tiles snap to the nearest wire instead of a fixed
lattice row. No blocks on the table = the classic behaviour (the model's own
rows).

The two pieces here:

* :func:`wire_positions` — which detected ID-46 markers count as wires (they
  have to be *left of* the grid, in board mm) and where they sit;
* :class:`WireStabilizer` — the same asymmetric hysteresis the tile stabilizer
  uses, applied to the wire SET, so a hand crossing the left edge cannot resize
  the circuit frame by frame. Growing the set takes ``appear_min`` of the last
  ``appear_window`` frames; shrinking it (including losing the last block, which
  falls back to the classic rows) takes ``disappear_after`` CONSECUTIVE frames.
  While the count holds steady the positions keep tracking, silently — a block
  nudged a centimetre moves its wire without re-emitting anything.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any, Iterable

from .board_model import MAX_WIRES
from .grid import GridConfig
from .markers import QUBIT_WIRE_ID

__all__ = ["WireResult", "WireStabilizer", "wire_positions"]


def wire_positions(
    markers: Iterable[Any],
    board: Any,
    grid: GridConfig,
    max_wires: int = MAX_WIRES,
) -> list[float]:
    """Board-mm y of every qubit-wire block, sorted top-down.

    A block counts only when its centre falls **left of the grid's first
    column** (``x < grid_offset_x``) — that is where the wires start, and it
    keeps a stray block that wandered onto the lattice from silently becoming a
    wire. At most ``max_wires`` are returned (the topmost ones).
    """
    ys: list[float] = []
    for marker in markers:
        if marker.id != QUBIT_WIRE_ID:
            continue
        x_mm, y_mm = (float(v) for v in board.image_to_board(marker.center)[0])
        if x_mm >= grid.grid_offset_x:
            continue
        ys.append(y_mm)
    ys.sort()
    return ys[:max_wires]


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
