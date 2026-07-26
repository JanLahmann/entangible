"""Geometry of a **board-corner block** — the printed mat's corner, on a tile.

Four blocks (ArUco IDs 0-3) can replace the printed board mat: put one at each
corner of the play area and the vision pipeline gets exactly the four fiducials
the mat would have given it. For that to work a block must be a *literal* crop
of the mat's corner, which is what this module derives — once — for every
consumer (the 3D printed block in ``qamposer_hardware``, the laser-cut wood
block in :mod:`~qamposer_assets.laser`):

* the marker is the mat's ``board.corner_marker_size`` (40 mm — **not** the
  tile's 36 mm gate marker),
* inset ``board.corner_margin`` from the block's two **outer** edges, exactly
  where :meth:`qamposer_vision.board.BoardConfig.corner_marker_square` says the
  mat has it, and
* in the mat's canonical, **unrotated** orientation — which is how
  :func:`qamposer_assets.board.board_body` draws all four.

Rotation is load-bearing. The board homography is fitted from each marker's
four corner *points*, so a block turned 90° silently skews the whole board
transform. Two cues on the face make the right orientation the obvious one:

1. the marker is visibly **off-centre**, pushed toward the block's outer corner
   (``corner_margin`` out, the remainder in), and
2. the ``UL``/``UR``/``LL``/``LR`` label sits in a strip along the block's
   **inner** edge and reads upright.

The label cannot go on the outer side: only ``corner_margin`` mm of face is
there and ``tile.min_quiet_zone`` claims most of it, leaving no legal room for
ink. The inner side is wider by construction, so the strip returned by
:func:`corner_block_label_strip` starts one full quiet zone clear of the marker.

Coordinates here are **SVG** face coordinates (origin top-left, y down, mm) —
the same frame :mod:`~qamposer_assets.tile_face` uses.
"""

from __future__ import annotations

from qamposer_vision.markers import CORNER_IDS

from .config import AssetsConfig

__all__ = [
    "CORNER_BLOCK_LABELS",
    "CORNER_LABEL_BY_ROLE",
    "corner_block_ids",
    "corner_block_label",
    "corner_block_role",
    "corner_block_crop_origin",
    "corner_block_marker_origin",
    "corner_block_label_strip",
]

#: Board-corner marker ID -> the block's printed label, in the kit's naming
#: (left side = circuit start). The detector's own role names are TL/TR/BR/BL
#: (:data:`qamposer_vision.markers.CORNER_IDS`); these name the same four
#: corners the way the physical block is labelled.
CORNER_BLOCK_LABELS: dict[int, str] = {0: "UL", 1: "UR", 2: "LR", 3: "LL"}

#: Detector corner role -> block label, for code that only holds a ``GateSpec``.
CORNER_LABEL_BY_ROLE: dict[str, str] = {
    "TL": "UL",
    "TR": "UR",
    "BR": "LR",
    "BL": "LL",
}

#: Roles whose block sits on the mat's left edge / top edge. Everything else is
#: derived from these two, so "which margin is the outer one" is stated once.
_LEFT_ROLES = ("TL", "BL")
_TOP_ROLES = ("TL", "TR")


def corner_block_ids() -> list[int]:
    """The four board-corner marker IDs, ascending (0-3)."""
    return sorted(CORNER_BLOCK_LABELS)


def corner_block_label(marker_id: int) -> str:
    """Block label (``UL``/``UR``/``LR``/``LL``) for a board-corner marker ID."""
    try:
        return CORNER_BLOCK_LABELS[marker_id]
    except KeyError as exc:
        raise ValueError(f"marker {marker_id} is not a board corner (0-3)") from exc


def corner_block_role(marker_id: int) -> str:
    """Detector corner role (``TL``/``TR``/``BR``/``BL``) for a corner block."""
    corner_block_label(marker_id)  # validates the id
    return CORNER_IDS[marker_id]


def corner_block_crop_origin(
    marker_id: int, cfg: AssetsConfig
) -> tuple[float, float]:
    """Top-left (x, y) of the block's crop **on the mat**, in mat mm.

    Place a block so this point lands on the mat's own coordinate and its marker
    lands exactly on ``BoardConfig.corner_marker_square(marker_id)``.
    """
    role = corner_block_role(marker_id)
    b = cfg.board
    size = cfg.tile.size
    x = 0.0 if role in _LEFT_ROLES else b.mat_width - size
    y = 0.0 if role in _TOP_ROLES else b.mat_height - size
    return (x, y)


def corner_block_marker_origin(
    marker_id: int, cfg: AssetsConfig
) -> tuple[float, float]:
    """Top-left (x, y) of the marker in the block's own SVG frame (y down).

    ``board.corner_margin`` from the two outer edges — i.e. the mat's corner
    square, expressed relative to :func:`corner_block_crop_origin`.
    """
    role = corner_block_role(marker_id)
    b = cfg.board
    inner = cfg.tile.size - b.corner_margin - b.corner_marker_size
    x = b.corner_margin if role in _LEFT_ROLES else inner
    y = b.corner_margin if role in _TOP_ROLES else inner
    return (x, y)


def corner_block_label_strip(
    marker_id: int, cfg: AssetsConfig
) -> tuple[float, float, float, float]:
    """The label strip ``(x, y, w, h)`` on a block's face, SVG coords.

    A strip the marker's width along the block's **inner** horizontal edge,
    starting one ``tile.min_quiet_zone`` clear of the marker so no ink can enter
    the marker's quiet zone. Raises ``ValueError`` if the mat geometry ever
    stops leaving room for it.
    """
    role = corner_block_role(marker_id)
    b = cfg.board
    t = cfg.tile
    mx, my = corner_block_marker_origin(marker_id, cfg)
    if role in _TOP_ROLES:  # upper blocks: inner edge is the block's bottom
        y0, y1 = my + b.corner_marker_size + t.min_quiet_zone, t.size
    else:  # lower blocks: inner edge is the block's top
        y0, y1 = 0.0, my - t.min_quiet_zone
    height = y1 - y0
    if height <= 1.0:
        raise ValueError(
            f"corner block {marker_id}: no room for a label strip "
            f"({height:g} mm outside the {t.min_quiet_zone:g} mm quiet zone)"
        )
    return (mx, y0, b.corner_marker_size, height)
