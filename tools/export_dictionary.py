"""Export the Entangible marker dictionary + board geometry as JSON for the
pocket web app (``pocket-app/src/vision/``).

Two committed artifacts are (re)generated here, both derived from the SAME
sources that drive print and Python detection so the browser detector can never
drift from the printed tiles:

* ``dictionary.json`` — for every ID in
  :data:`qamposer_vision.markers.MARKER_TABLE`, the marker's inner 4x4 bit
  matrix (1 = black module) plus the four rotation *codes* (16-bit packed,
  row-major, one per 90° clockwise turn). The bits come straight from
  ``cv2.aruco`` via :func:`qamposer_assets.marker_bit_matrix`, exactly like the
  SVG print path.
* ``geometry.json`` — the board + tile geometry the TS board/grid ports need,
  read verbatim from ``assets.toml`` (single source of truth).

A pytest (``tests/test_pocket_dictionary_parity.py``) asserts the committed
JSON matches a fresh export — the parity gate. Regenerate with::

    uv run python tools/export_dictionary.py
"""

from __future__ import annotations

import json
import tomllib
from pathlib import Path

from qamposer_assets import marker_bit_matrix
from qamposer_vision.markers import ARUCO_DICT_NAME, CORNER_IDS, CORNER_ROLES, MARKER_TABLE

REPO_ROOT = Path(__file__).resolve().parents[1]
VISION_DIR = REPO_ROOT / "pocket-app" / "src" / "vision"
DICTIONARY_PATH = VISION_DIR / "dictionary.json"
GEOMETRY_PATH = VISION_DIR / "geometry.json"


Matrix = tuple[tuple[int, ...], ...]


def _rotate_cw(matrix: Matrix) -> Matrix:
    """Rotate a square bit matrix 90 degrees clockwise."""
    n = len(matrix)
    return tuple(
        tuple(matrix[n - 1 - j][i] for j in range(n)) for i in range(n)
    )


def _pack(matrix: Matrix) -> int:
    """Pack a bit matrix row-major into an integer code (MSB = first cell)."""
    code = 0
    for row in matrix:
        for bit in row:
            code = (code << 1) | (1 if bit else 0)
    return code


def _inner_4x4(marker_id: int) -> Matrix:
    """The marker's inner (border-stripped) 4x4 module matrix, 1 = black."""
    full = marker_bit_matrix(marker_id, ARUCO_DICT_NAME)  # 6x6 incl. border
    n = len(full)
    return tuple(tuple(full[r][c] for c in range(1, n - 1)) for r in range(1, n - 1))


def build_dictionary() -> dict[str, object]:
    entries: dict[str, object] = {}
    for marker_id in sorted(MARKER_TABLE):
        inner = _inner_4x4(marker_id)
        rotations: list[int] = []
        rot = inner
        for _ in range(4):
            rotations.append(_pack(rot))
            rot = _rotate_cw(rot)
        entries[str(marker_id)] = {
            "bits": [list(row) for row in inner],
            "rotations": rotations,
        }
    return {
        "dictionary": ARUCO_DICT_NAME,
        "markerSize": 4,  # inner module count per side (border excluded)
        "borderBits": 1,
        "markers": entries,
    }


def build_geometry() -> dict[str, object]:
    with open(REPO_ROOT / "assets.toml", "rb") as fh:
        data = tomllib.load(fh)
    board = data["board"]
    tile = data["tile"]
    return {
        "board": {
            "rows": int(board["rows"]),
            "cols": int(board["cols"]),
            "pitch": float(board["pitch"]),
            "cellSize": float(board["cell_size"]),
            "matWidth": float(board["mat_width"]),
            "matHeight": float(board["mat_height"]),
            "cornerMarkerSize": float(board["corner_marker_size"]),
            "cornerMargin": float(board["corner_margin"]),
            "gridOffsetX": float(board["grid_offset_x"]),
            "gridOffsetY": float(board["grid_offset_y"]),
        },
        "tile": {
            "size": float(tile["size"]),
            "markerSize": float(tile["marker_size"]),
        },
        # Corner ID -> role and the canonical clockwise role order, so the TS
        # board port can compute each corner marker's board-mm square.
        "cornerIds": {str(mid): role for mid, role in CORNER_IDS.items()},
        "cornerRoles": list(CORNER_ROLES),
    }


def _dump(path: Path, payload: dict[str, object]) -> str:
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return text


def main() -> None:
    _dump(DICTIONARY_PATH, build_dictionary())
    _dump(GEOMETRY_PATH, build_geometry())
    print(f"wrote {DICTIONARY_PATH.relative_to(REPO_ROOT)}")
    print(f"wrote {GEOMETRY_PATH.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
