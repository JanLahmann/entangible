"""Scripted-sequence tests for the asymmetric-hysteresis tile stabilizer."""

from __future__ import annotations

from qamposer_vision.stabilizer import TileStabilizer

T = (10, 0, 0, 0)   # an H tile at (0, 0), rotation 0
U = (14, 0, 1, 0)   # a second, unrelated tile


def _run(seq: list[bool]):
    """Feed a present/absent sequence for tile ``T``; return per-frame results."""
    stab = TileStabilizer()
    return [stab.update({T} if present else set()) for present in seq]


def test_clean_appear_at_exactly_five_of_seven() -> None:
    # Present every frame: count reaches 5 on the 5th frame -> appears then.
    results = _run([True] * 8)
    stable_flags = [T in r.stable for r in results]
    assert stable_flags == [False, False, False, False, True, True, True, True]
    # `changed` fires only on the appearance transition (frame index 4).
    changed_frames = [i for i, r in enumerate(results) if r.changed]
    assert changed_frames == [4]
    assert results[4].added == frozenset({T})


def test_flicker_four_of_seven_never_appears() -> None:
    # Pattern P,P,P,P,A,A,A repeated: any 7-window holds at most 4 present frames.
    pattern = ([True] * 4 + [False] * 3) * 4  # 28 frames
    results = _run(pattern)
    assert all(not r.stable for r in results)
    assert all(not r.changed for r in results)


def test_disappears_only_after_exactly_twelve_absent() -> None:
    stab = TileStabilizer()
    for _ in range(5):  # establish T as stable
        stab.update({T})
    assert T in stab.stable

    # 11 absent frames must NOT drop it.
    for i in range(11):
        res = stab.update(set())
        assert T in res.stable, f"dropped too early at absent frame {i + 1}"
        assert not res.changed

    # The 12th consecutive absent frame drops it, and only then.
    res = stab.update(set())
    assert T not in res.stable
    assert res.changed
    assert res.removed == frozenset({T})


def test_eleven_frame_occlusion_does_not_drop() -> None:
    stab = TileStabilizer()
    for _ in range(5):
        stab.update({T})
    assert T in stab.stable

    # Simulate a hand covering the tile for 11 frames, then lifting.
    for _ in range(11):
        res = stab.update(set())
        assert T in res.stable
        assert not res.changed

    # Tile reappears; still stable, still no transition (never left the set).
    res = stab.update({T})
    assert T in res.stable
    assert not res.changed
    assert stab._absent[T] == 0  # streak reset


def test_changed_flag_only_on_transitions() -> None:
    # Appear (frame 4), hold, disappear after 12 absent, then reappear.
    seq = [True] * 6 + [False] * 12 + [True] * 6
    results = _run(seq)
    changed_frames = [i for i, r in enumerate(results) if r.changed]
    # appear at index 4; disappear at index 6 + 12 - 1 = 17; reappear at 18 + 4 = 22.
    assert changed_frames == [4, 17, 22]


def test_two_tiles_track_independently() -> None:
    stab = TileStabilizer()
    # T present from the start; U joins 3 frames later.
    seq = [
        ({T},),
        ({T},),
        ({T},),
        ({T, U},),
        ({T, U},),  # T hits 5-of-7 here -> T appears
        ({T, U},),
        ({T, U},),
        ({T, U},),  # U hits 5-of-7 here -> U appears
    ]
    results = [stab.update(obs[0]) for obs in seq]
    assert (T in results[4].stable) and (U not in results[4].stable)
    assert results[4].added == frozenset({T})
    assert results[7].added == frozenset({U})
    assert results[7].stable == frozenset({T, U})


# --- Dial rotation-key behaviour ------------------------------------------
# A dial tile's key includes its rotation, so turning it in place is a real
# change (drop old rotation, appear new one — each under the usual hysteresis),
# while a jitter that stays in the same 90° quadrant keeps the same key.

DIAL_R1 = (42, 0, 0, 1)   # RX dial at (0,0), rotation 1
DIAL_R2 = (42, 0, 0, 2)   # same tile & cell, rotation 2


def test_turning_a_dial_in_place_reemits_after_hysteresis() -> None:
    stab = TileStabilizer()
    for _ in range(5):        # establish rotation 1 as stable
        stab.update({DIAL_R1})
    assert DIAL_R1 in stab.stable

    # Turn to rotation 2. The new key must debounce (5-of-7) before appearing,
    # and the old key must persist until its 12-frame disappearance streak.
    r2_stable_at = None
    r1_removed_at = None
    for i in range(12):
        res = stab.update({DIAL_R2})
        if r2_stable_at is None and DIAL_R2 in res.stable:
            r2_stable_at = i
        if r1_removed_at is None and DIAL_R1 in res.removed:
            r1_removed_at = i
    assert r2_stable_at == 4          # appears on the 5th present frame
    assert r1_removed_at == 11        # old rotation drops after 12 absent frames
    assert stab.stable == frozenset({DIAL_R2})


def test_wiggle_within_same_quadrant_keeps_one_key() -> None:
    # Detection snaps to 90° quadrants, so a small wiggle yields the SAME key
    # every frame: the tile stays stable and nothing changes after it appears.
    stab = TileStabilizer()
    changes = 0
    for _ in range(20):
        res = stab.update({DIAL_R1})
        if res.changed:
            changes += 1
    assert changes == 1               # one appearance transition, then quiet
    assert stab.stable == frozenset({DIAL_R1})
