"""Generate the ``bell-sequence`` replay fixture for M2 pipeline tests.

Writes a deterministic ~48-frame recording that drives the live pipeline through
its full state machine and, crucially, exercises the asymmetric hysteresis in
:mod:`qamposer_vision.stabilizer`:

    frames  0-11  empty board                       -> circuit: empty
    frames 12-23  H tile at (0,0)                    -> circuit: single H
    frames 24-35  H + CNOT pair in column 1          -> circuit: Bell pair
    frames 36-47  Bell held, but a flesh-toned "hand"
                  occludes the CNOT tiles for 3 frames
                  (frames 39-41), then lifts          -> circuit: Bell (unchanged)

The 3-frame occlusion is well under the 12-consecutive-absent disappearance
threshold, so a correct stabilizer must NOT drop the CNOT during it — the
pipeline test asserts exactly that (no circuit change across the occlusion).

Frames are rendered from ``assets.toml`` geometry via
:func:`tests.utils.render_board.render_board` (flat, lightly blurred + seeded
noise) so the recording is reproducible bit-for-bit.

The PNG frames are **not** checked in (see ``tests/fixtures/recordings/.gitignore``).
Regenerate them before running the replay/pipeline tests with::

    uv run python tests/utils/make_recording.py

Only this generator script is version-controlled; anything under
``recordings/*/`` is disposable and rebuilt on demand.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

# Allow running as a plain script (`uv run python tests/utils/make_recording.py`):
# put the repo root on sys.path so `tests.utils.*` resolves like it does in pytest.
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from qamposer_vision.board import BoardConfig
from qamposer_vision.grid import GridConfig

from tests.utils.render_board import RenderOptions, render_board

__all__ = ["OUTPUT_DIR", "make_recording"]

OUTPUT_DIR = _REPO_ROOT / "tests" / "fixtures" / "recordings" / "bell-sequence"

# Marker IDs (see markers.MARKER_TABLE): H=10, CNOT control=14, target=15.
_H = (10, 0, 0)
_CNOT_CONTROL = (14, 0, 1)
_CNOT_TARGET = (15, 1, 1)

_EMPTY: tuple[tuple[int, int, int], ...] = ()
_WITH_H = (_H,)
_BELL = (_H, _CNOT_CONTROL, _CNOT_TARGET)

_SEGMENT_LEN = 12
#: Frame indices within the final (Bell) segment that are occluded by a "hand".
_OCCLUDED_LOCAL = (3, 4, 5)  # -> global frames 39, 40, 41

# Rendering knobs (smaller than the default 3 px/mm to keep the fixture light
# while staying well above the ArUco legibility floor).
_PX_PER_MM = 2.0
_PAD_MM = 20.0
_RENDER = RenderOptions(
    px_per_mm=_PX_PER_MM,
    pad_mm=_PAD_MM,
    blur_sigma=0.5,
    noise_sigma=2.0,
    seed=7,
)

# A skin-ish BGR fill for the simulated hand.
_HAND_BGR = (120, 150, 200)


def _mm_to_px(x_mm: float, y_mm: float) -> tuple[int, int]:
    pad = int(round(_PAD_MM * _PX_PER_MM))
    return int(round(x_mm * _PX_PER_MM)) + pad, int(round(y_mm * _PX_PER_MM)) + pad


def _draw_hand_over_cnot(frame: np.ndarray, config: BoardConfig) -> np.ndarray:
    """Cover the column-1 CNOT tiles (rows 0-1) with a flesh-toned blob."""
    grid = GridConfig.from_board_config(config)
    top_cx, top_cy = grid.cell_center(0, 1)
    bot_cx, bot_cy = grid.cell_center(1, 1)
    half = config.cell_size / 2.0 + 6.0  # a little overhang so tiles are fully hidden

    x0, y0 = _mm_to_px(top_cx - half, top_cy - half)
    x1, y1 = _mm_to_px(bot_cx + half, bot_cy + half)

    # An irregular hand-like polygon rather than a clean rectangle.
    polygon = np.array(
        [
            [x0 - 8, y0 + 10],
            [x0 + 12, y0 - 6],
            [x1 + 4, y0 + 4],
            [x1 + 10, y1 - 12],
            [x1 - 10, y1 + 8],
            [x0 + 6, y1 + 2],
        ],
        dtype=np.int32,
    )
    out = frame.copy()
    cv2.fillConvexPoly(out, polygon, _HAND_BGR, lineType=cv2.LINE_AA)
    return out


def make_recording(output_dir: Path | str = OUTPUT_DIR) -> list[Path]:
    """Render the bell-sequence recording; returns the written frame paths."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    # Clear any stale PNGs so a re-run is idempotent.
    for stale in out.glob("frame_*.png"):
        stale.unlink()

    config = BoardConfig.from_toml()

    segments: list[tuple[tuple[int, int, int], ...]] = [
        _EMPTY,
        _WITH_H,
        _BELL,
        _BELL,  # final segment: Bell with a transient occlusion
    ]

    # Pre-render one image per distinct placement set (deterministic).
    rendered: dict[tuple[tuple[int, int, int], ...], np.ndarray] = {}
    for placements in segments:
        if placements not in rendered:
            rendered[placements] = render_board(placements, config, _RENDER)
    occluded_bell = _draw_hand_over_cnot(rendered[_BELL], config)

    written: list[Path] = []
    frame_index = 0
    for seg_idx, placements in enumerate(segments):
        is_final = seg_idx == len(segments) - 1
        base = rendered[placements]
        for local in range(_SEGMENT_LEN):
            if is_final and local in _OCCLUDED_LOCAL:
                frame = occluded_bell
            else:
                frame = base
            path = out / f"frame_{frame_index:04d}.png"
            cv2.imwrite(str(path), frame)
            written.append(path)
            frame_index += 1

    return written


if __name__ == "__main__":
    paths = make_recording()
    print(f"wrote {len(paths)} frames to {OUTPUT_DIR}")
