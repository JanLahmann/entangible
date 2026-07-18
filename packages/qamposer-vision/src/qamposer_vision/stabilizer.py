"""Temporal stabilization — asymmetric hysteresis so hands don't cause flicker.

A tile is a ``(marker_id, row, col, rotation)`` observation already resolved to
a grid cell. ``rotation`` is the tile's board-frame 90° step (0-3); it is ``0``
for every orientation-free tile and only varies for **dial** tiles, whose angle
is chosen by how they are turned — so turning a dial in place changes the key
and is treated as a real change (re-emitted, subject to the same hysteresis),
while a wiggle that stays within one 90° quadrant keeps the same key and emits
nothing. Frame to frame the raw detection set jitters: a hand sweeps over a tile,
a marker is missed for a frame, a tile is momentarily half-occluded. Emitting a
new circuit on every such blip would make the display strobe.

The stabilizer applies **asymmetric hysteresis** (design.md):

* a tile *appears* in the stable set only after it is present in at least
  :attr:`appear_min` of the last :attr:`appear_window` frames (default 5 of 7,
  ~0.5 s at 10-15 fps) — a debounce against spurious single-frame detections;
* a tile *disappears* only after :attr:`disappear_after` **consecutive** absent
  frames (default 12, ~1 s) — so a hand briefly covering the board does not drop
  tiles that are really still there.

:meth:`update` returns the current stable set plus a ``changed`` flag that is
``True`` only on frames where the stable set actually gained or lost a tile, so
the pipeline rebuilds/emits a circuit only on real transitions.

Pure logic — no OpenCV, no numpy — so it is fully unit-testable with scripted
frame sequences.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Iterable

__all__ = ["Tile", "StabilizerResult", "TileStabilizer"]

#: A grid-resolved tile observation: ``(marker_id, row, col, rotation)``.
#: ``rotation`` is 0 for orientation-free tiles; only dial tiles vary it.
Tile = tuple[int, int, int, int]


@dataclass(frozen=True, slots=True)
class StabilizerResult:
    """Outcome of feeding one frame's observations to the stabilizer."""

    #: The full set of tiles currently considered stable.
    stable: frozenset[Tile]
    #: ``True`` only when :attr:`stable` changed on this frame.
    changed: bool
    #: Tiles that entered the stable set on this frame.
    added: frozenset[Tile]
    #: Tiles that left the stable set on this frame.
    removed: frozenset[Tile]


class TileStabilizer:
    """Asymmetric-hysteresis stabilizer over per-frame tile observation sets."""

    def __init__(
        self,
        appear_window: int = 7,
        appear_min: int = 5,
        disappear_after: int = 12,
    ) -> None:
        if appear_min > appear_window:
            raise ValueError("appear_min cannot exceed appear_window")
        self.appear_window = appear_window
        self.appear_min = appear_min
        self.disappear_after = disappear_after
        self._window: deque[frozenset[Tile]] = deque(maxlen=appear_window)
        self._absent: dict[Tile, int] = {}
        self._stable: set[Tile] = set()

    @property
    def stable(self) -> frozenset[Tile]:
        return frozenset(self._stable)

    def reset(self) -> None:
        """Forget all history and the stable set (e.g. on a camera swap)."""
        self._window.clear()
        self._absent.clear()
        self._stable.clear()

    def update(self, observed: Iterable[Tile]) -> StabilizerResult:
        """Advance one frame with the tiles observed on it.

        Args:
            observed: the ``(marker_id, row, col)`` tiles seen this frame
                (order irrelevant; duplicates collapse).
        """
        obs: frozenset[Tile] = frozenset(observed)
        self._window.append(obs)

        removed: set[Tile] = set()
        added: set[Tile] = set()

        # Disappearance: only after `disappear_after` *consecutive* absent frames.
        for tile in list(self._stable):
            if tile in obs:
                self._absent[tile] = 0
            else:
                streak = self._absent.get(tile, 0) + 1
                self._absent[tile] = streak
                if streak >= self.disappear_after:
                    self._stable.discard(tile)
                    self._absent.pop(tile, None)
                    removed.add(tile)

        # Appearance: present in >= appear_min of the last appear_window frames.
        candidates = set().union(*self._window) - self._stable
        for tile in candidates:
            count = sum(1 for frame in self._window if tile in frame)
            if count >= self.appear_min:
                self._stable.add(tile)
                self._absent[tile] = 0
                added.add(tile)

        changed = bool(added or removed)
        return StabilizerResult(
            stable=frozenset(self._stable),
            changed=changed,
            added=frozenset(added),
            removed=frozenset(removed),
        )
