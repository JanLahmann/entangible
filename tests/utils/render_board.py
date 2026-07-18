"""Synthetic board renderer for CI (no hardware).

Builds a board image straight from ``assets.toml`` geometry: a white mat with
the four ArUco corner fiducials at their exact corner positions and gate-tile
markers placed at chosen ``(row, col)`` cell centres, then optionally warped
with a plausible camera-angle homography, blurred, and jittered with noise.

Deterministic given a seed, so the render -> detect -> golden-JSON tests are
reproducible. Also exposes :data:`SCENARIOS` — the shared list of tile layouts
whose golden ``Circuit`` JSON / QASM live in ``tests/fixtures/circuits/``.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from qamposer_vision.board import BoardConfig
from qamposer_vision.grid import GridConfig
from qamposer_vision.markers import ARUCO_DICT_NAME, CORNER_IDS

# ---------------------------------------------------------------------------
# Scenarios: (marker_id, row, col) tile placements + golden fixture basename.
# ---------------------------------------------------------------------------

# Marker IDs (see markers.MARKER_TABLE):
#   H=10 X=11 Y=12 Z=13   CNOT control=14 target=15
#   RX: pi/4=20 pi/2=21 pi=22 -pi/2=23
#   RY: pi/4=24 pi/2=25 pi=26 -pi/2=27
#   RZ: pi/4=28 pi/2=29 pi=30 -pi/2=31
#   S=40 (emitted as RZ(pi/2))   T=41 (emitted as RZ(pi/4))
#   Dials: RX-dial=42 RY-dial=43 RZ-dial=44 (angle = ROTATION_ANGLES[rotation])
#
# A placement is (marker_id, row, col) or (marker_id, row, col, rotation); the
# optional 4th element is the tile's clockwise 90° turn (0-3, default 0), used by
# the dial tiles to select their angle. The marker image is rotated by that many
# 90° steps before it is pasted, so detection recovers the same rotation.


@dataclass(frozen=True, slots=True)
class Scenario:
    name: str
    #: (marker_id, row, col) or (marker_id, row, col, rotation) placements.
    placements: tuple[tuple[int, ...], ...]


SCENARIOS: list[Scenario] = [
    Scenario("empty", ()),
    Scenario("single_h", ((10, 0, 0),)),
    Scenario("bell", ((10, 0, 0), (14, 0, 1), (15, 1, 1))),
    Scenario(
        "ghz3",
        ((10, 0, 0), (14, 0, 1), (15, 1, 1), (14, 0, 2), (15, 2, 2)),
    ),
    Scenario(
        "all_families",
        (
            (10, 0, 0), (11, 1, 0), (12, 2, 0), (13, 3, 0),   # H X Y Z
            (21, 0, 1), (24, 1, 1), (30, 2, 1),               # RX(pi/2) RY(pi/4) RZ(pi)
            (14, 0, 2), (15, 1, 2),                           # CNOT c0/t1
            (31, 3, 3),                                       # RZ(-pi/2)
        ),
    ),
    Scenario("warn_lone_control", ((10, 0, 0), (14, 1, 1))),
    # S and T tiles on q0: H then S (→ RZ(pi/2)) then T (→ RZ(pi/4)).
    Scenario("s_and_t", ((10, 0, 0), (40, 0, 1), (41, 0, 2))),
    # Dial tiles at mixed rotations: RX-dial r=1 → RX(pi/2), RY-dial r=3 →
    # RY(-pi/2), RZ-dial r=2 → RZ(pi). Emitted byte-identically to classic tiles.
    Scenario("dials", ((42, 0, 0, 1), (43, 1, 1, 3), (44, 2, 2, 2))),
]

SCENARIOS_BY_NAME = {s.name: s for s in SCENARIOS}


# ---------------------------------------------------------------------------
# Renderer
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class RenderOptions:
    px_per_mm: float = 3.0
    pad_mm: float = 30.0
    warp: float | None = None      # 0..~0.2 perspective strength; None = flat
    blur_sigma: float = 0.0
    noise_sigma: float = 0.0
    seed: int = 0
    #: subset of corner IDs to render (default all four).
    corners: tuple[int, ...] = field(default=tuple(sorted(CORNER_IDS)))
    #: extra tiles placed at explicit board-mm centres (marker_id, x_mm, y_mm),
    #: e.g. to drop a tile deliberately off-grid.
    extra_mm: tuple[tuple[int, float, float], ...] = ()


def _aruco_dictionary() -> "cv2.aruco.Dictionary":
    return cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, ARUCO_DICT_NAME))


def _paste_marker(
    canvas: np.ndarray,
    dictionary: "cv2.aruco.Dictionary",
    marker_id: int,
    x0_px: int,
    y0_px: int,
    size_px: int,
    rotation: int = 0,
) -> None:
    marker = cv2.aruco.generateImageMarker(dictionary, marker_id, size_px)
    # np.rot90 turns counter-clockwise; a positive tile rotation is clockwise, so
    # rotate by -rotation (== 4-rotation) to physically turn the printed tile CW.
    if rotation % 4:
        marker = np.rot90(marker, k=-(rotation % 4))
    marker_bgr = cv2.cvtColor(marker, cv2.COLOR_GRAY2BGR)
    canvas[y0_px : y0_px + size_px, x0_px : x0_px + size_px] = marker_bgr


def render_board(
    placements: tuple[tuple[int, int, int], ...] | list[tuple[int, int, int]],
    config: BoardConfig,
    options: RenderOptions | None = None,
) -> np.ndarray:
    """Render a synthetic board image (BGR) from tile placements."""
    opt = options or RenderOptions()
    ppm = opt.px_per_mm
    pad = int(round(opt.pad_mm * ppm))
    dictionary = _aruco_dictionary()

    width = int(round(config.mat_width * ppm)) + 2 * pad
    height = int(round(config.mat_height * ppm)) + 2 * pad
    canvas = np.full((height, width, 3), 255, dtype=np.uint8)

    def mm_to_px(x_mm: float, y_mm: float) -> tuple[int, int]:
        return int(round(x_mm * ppm)) + pad, int(round(y_mm * ppm)) + pad

    # Corner fiducials at their exact board-mm squares.
    corner_size_px = int(round(config.corner_marker_size * ppm))
    for corner_id in opt.corners:
        square = config.corner_marker_square(corner_id)
        x0, y0 = mm_to_px(square[0][0], square[0][1])
        _paste_marker(canvas, dictionary, corner_id, x0, y0, corner_size_px)

    # Gate tiles at their cell centres. A placement may carry a 4th element, the
    # clockwise 90° rotation (0-3) — used by dial tiles to select their angle.
    grid = GridConfig.from_board_config(config)
    tile_size_px = int(round(config.tile_marker_size * ppm))
    for placement in placements:
        marker_id, row, col = placement[0], placement[1], placement[2]
        rotation = placement[3] if len(placement) > 3 else 0
        cx, cy = grid.cell_center(row, col)
        x0, y0 = mm_to_px(cx - config.tile_marker_size / 2.0,
                          cy - config.tile_marker_size / 2.0)
        _paste_marker(canvas, dictionary, marker_id, x0, y0, tile_size_px, rotation)

    # Extra tiles at explicit board-mm centres (e.g. off-grid).
    for marker_id, x_mm, y_mm in opt.extra_mm:
        x0, y0 = mm_to_px(x_mm - config.tile_marker_size / 2.0,
                          y_mm - config.tile_marker_size / 2.0)
        _paste_marker(canvas, dictionary, marker_id, x0, y0, tile_size_px)

    # Optional perspective warp (content shrinks inward → stays in frame).
    if opt.warp:
        canvas = _apply_warp(canvas, opt.warp)

    # Optional blur.
    if opt.blur_sigma > 0:
        canvas = cv2.GaussianBlur(canvas, (0, 0), opt.blur_sigma)

    # Optional noise (seeded, deterministic).
    if opt.noise_sigma > 0:
        rng = np.random.default_rng(opt.seed)
        noise = rng.normal(0.0, opt.noise_sigma, canvas.shape)
        canvas = np.clip(canvas.astype(np.float64) + noise, 0, 255).astype(np.uint8)

    return canvas


def render_scenario(
    name: str, options: RenderOptions | None = None
) -> np.ndarray:
    """Render a named :data:`SCENARIOS` layout (BGR). Convenience for tooling."""
    scenario = SCENARIOS_BY_NAME[name]
    config = BoardConfig.from_toml()
    return render_board(scenario.placements, config, options)


def _apply_warp(image: np.ndarray, strength: float) -> np.ndarray:
    """Apply a plausible, deterministic camera-angle homography."""
    h, w = image.shape[:2]
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
    # Asymmetric inward shift → tilt/keystone as from an angled camera.
    dst = np.array(
        [
            [w * strength, h * strength * 0.5],
            [w * (1.0 - strength * 0.7), h * strength * 0.3],
            [w * (1.0 - strength * 0.4), h * (1.0 - strength * 0.25)],
            [w * strength * 0.3, h * (1.0 - strength * 0.5)],
        ],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(
        image, matrix, (w, h), borderValue=(255, 255, 255)
    )


def _main() -> None:
    """Additive CLI: render one scenario to a PNG (used by the pocket benchmark).

    Example::

        uv run python tests/utils/render_board.py \
            --scenario ghz3 --px-per-mm 3.0 --warp 0.08 --out /tmp/ghz3.png
    """
    import argparse

    parser = argparse.ArgumentParser(description="Render a scenario board PNG.")
    parser.add_argument("--scenario", required=True, choices=sorted(SCENARIOS_BY_NAME))
    parser.add_argument("--out", required=True)
    parser.add_argument("--px-per-mm", type=float, default=3.0)
    parser.add_argument("--pad-mm", type=float, default=30.0)
    parser.add_argument("--warp", type=float, default=None)
    parser.add_argument("--blur-sigma", type=float, default=0.0)
    parser.add_argument("--noise-sigma", type=float, default=0.0)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    opt = RenderOptions(
        px_per_mm=args.px_per_mm,
        pad_mm=args.pad_mm,
        warp=args.warp,
        blur_sigma=args.blur_sigma,
        noise_sigma=args.noise_sigma,
        seed=args.seed,
    )
    image = render_scenario(args.scenario, opt)
    cv2.imwrite(args.out, image)
    print(args.out)


if __name__ == "__main__":  # pragma: no cover - CLI entry for tooling
    import sys
    from pathlib import Path

    _REPO_ROOT = Path(__file__).resolve().parents[2]
    if str(_REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(_REPO_ROOT))
    _main()
