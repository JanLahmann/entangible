"""Write tile solids to disk: per-colour STL parts, a coloured 3MF, and plates.md.

Per-colour STLs share one coordinate frame so PrusaSlicer's "import as single
object with parts" reassembles the tile with each part on its own filament. The
3MF bundles the same parts with their gate colours baked in (via ``lib3mf``),
which slicers open directly as a multi-material object.
"""

from __future__ import annotations

import datetime as _datetime
import functools
import subprocess
from dataclasses import dataclass
from pathlib import Path

from build123d import Mesher, Pos, export_stl
from qamposer_assets.config import AssetsConfig
from qamposer_vision.markers import MARKER_TABLE, GateSpec, pretty_angle

from .build import (
    DoubleTileParts,
    TileParts,
    build_corner_block,
    build_double_mono_raised,
    build_double_mono_recessed,
    build_double_tile,
    build_mono_raised,
    build_mono_recessed,
    build_tile,
)
from .face import (
    CORNER_LABEL_BY_ROLE,
    accent_color_name,
    corner_block_ids,
    corner_block_label,
    double_color_name,
)
from .pack import FOOTPRINT, Bed, bed_capacity, plan_batches
from .params import DOUBLE_FACED_KIT, HardwareParams

__all__ = [
    "tile_slug",
    "double_slug",
    "export_tile_stls",
    "export_tile_3mf",
    "export_double_tile_stls",
    "export_double_tile_3mf",
    "export_mono_stls",
    "export_double_mono_stls",
    "write_mono_md",
    "write_plates_md",
    "double_plate_assignment",
    "write_double_plates_md",
    "single_plate_groups",
    "double_plate_groups",
    "BatchInfo",
    "MonoBatchInfo",
    "export_single_batches",
    "export_double_batches",
    "export_corner_batches",
    "export_mono_batches",
    "write_batch_plates_md",
    "write_corner_plates_md",
    "write_corners_md",
    "write_mono_batch_md",
    "provenance",
]

#: Named filament slots that are constant across every plate.
WHITE_HEX = "#ffffff"
BLACK_HEX = "#000000"


# --------------------------------------------------------------------------- #
# Provenance — which checkout produced this file
# --------------------------------------------------------------------------- #

#: Repo root, from this module's location (…/hardware/src/qamposer_hardware/).
_REPO_ROOT = Path(__file__).resolve().parents[3]


@functools.lru_cache(maxsize=1)
def provenance() -> str:
    """Repo commit + date this artifact was generated from, e.g. ``a7611f0 · 2026-07-25``.

    Stamped into every generated ``.md`` and 3MF so a user slicing a file found
    on disk can tell *which checkout* built it — a week-old 3MF may predate a
    geometry or palette fix. The commit is ``unknown`` outside a git checkout.

    Cached, so one generator run stamps every one of its outputs identically.
    """
    return f"{_git_short_head()} · {_datetime.date.today().isoformat()}"


def _git_short_head() -> str:
    try:
        done = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=_REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:  # no git binary
        return "unknown"
    head = done.stdout.strip()
    return head if done.returncode == 0 and head else "unknown"


def _md_stamp() -> str:
    """The one-line provenance note that sits under every generated md's H1."""
    commit, _, date = provenance().partition(" · ")
    return (
        f"> Generated from `{commit}` on {date} — regenerate with the matching "
        "checkout before printing."
    )


def _stamp_3mf(mesher: Mesher, stem: str) -> None:
    """Stamp a 3MF's model-level metadata with the generating commit + date.

    lib3mf exposes model metadata via ``model.GetMetaDataGroup()``, whose
    ``AddMetaData(NameSpace, Name, Value, Type, MustPreserve)`` writes a
    ``<metadata name="…">`` element. ``Title``/``Description`` are core 3MF
    names, so they take the **default** namespace (``""``) — a custom namespace
    would prefix them and slicers would stop recognising them.
    """
    commit, _, date = provenance().partition(" · ")
    group = mesher.model.GetMetaDataGroup()
    group.AddMetaData(
        "", "Title", f"{stem} — Entangible {commit}", "xs:string", False
    )
    group.AddMetaData(
        "", "Description", f"Generated from {commit} on {date}", "xs:string", False
    )


def _angle_slug(param: float) -> str:
    label = pretty_angle(param)  # e.g. "π/2", "-π/2", "π"
    return (
        label.replace("π", "pi")
        .replace("/", "")
        .replace("-", "neg")
        .replace(".", "p")
    )


def tile_slug(spec: GateSpec) -> str:
    """Filename-safe identifier for a gate tile or corner block (ASCII, lower)."""
    if spec.kind == "corner":
        return CORNER_LABEL_BY_ROLE[spec.role or ""].lower()
    if spec.gate == "CNOT":
        return f"cnot-{spec.role}"
    if spec.parameter is not None:
        return f"{spec.gate.lower()}-{_angle_slug(spec.parameter)}"
    return spec.gate.lower()


def _compact_angle(param: float) -> str:
    """Short angle code for double-piece filenames: π/2→p2, -π/2→m2, π/4→p4, π→p1."""
    label = pretty_angle(param)  # "π/2", "-π/2", "π", "π/4"
    sign = "m" if label.startswith("-") else "p"
    core = label.lstrip("-")
    denom = core.split("/")[1] if "/" in core else "1"
    return f"{sign}{denom}"


def _face_slug(spec: GateSpec) -> str:
    """Compact per-face identifier used in double-piece filenames."""
    if spec.gate == "CNOT":
        return "cnot-ctrl" if spec.role == "control" else "cnot-tgt"
    if spec.parameter is not None:
        return f"{spec.gate.lower()}-{_compact_angle(spec.parameter)}"
    return spec.gate.lower()


def double_slug(spec_a: GateSpec, spec_b: GateSpec) -> str:
    """Filename stem for a double-faced piece, e.g. ``rx-p2+rx-m2`` or ``h+x``."""
    return f"{_face_slug(spec_a)}+{_face_slug(spec_b)}"


class _MaterialPalette:
    """The one shared base-material group of a 3MF, in canonical slot order.

    PrusaSlicer maps a 3MF's base materials to filament slots in the order they
    appear, so this order *is* the slot order: white (slot 1), black (slot 2),
    then the plate's accents in plates.md table order. Deduped by hex — a colour
    never claims two slots — and named by colour, not by part, so a logical
    colour lands on the same slot on every plate. lib3mf assigns property ids
    1, 2, 3… in add order, so white=1 and black=2 by construction.
    """

    def __init__(self, mesher: Mesher, accents: list[str], name_accent) -> None:
        self._mesher = mesher
        self._group = mesher.model.AddBaseMaterialGroup()
        self._resource_id = self._group.GetResourceID()
        self._pid_by_hex: dict[str, int] = {}
        self._coloured = 0
        self._add(WHITE_HEX, "white")
        self._add(BLACK_HEX, "black")
        for hexc in accents:
            self._add(hexc, name_accent(hexc))

    def _add(self, hex_color: str, name: str) -> None:
        key = hex_color.lower()
        if key in self._pid_by_hex:
            return
        r, g, b = _hex_rgb01(hex_color)
        color = self._mesher.wrapper.FloatRGBAToColor(r, g, b, 1.0)
        self._pid_by_hex[key] = self._group.AddMaterial(Name=name, DisplayColor=color)

    def apply(self, hex_color: str, name: str) -> int:
        """Point **every** mesh added since the last call at this palette's colour.

        Works on the lib3mf model directly (the ``Mesher.model``/``.wrapper``/
        ``.meshes`` handles build123d exposes) so the colour lands on the real
        mesh objects rather than the throwaway copy ``add_shape`` colours
        internally.

        ``add_shape`` emits **one mesh per solid**, and a colour part is very
        often more than one solid: the accent of any tile whose caption has a
        closed counter (the ``R`` of ``RX``, the ``O``/``A``/``R`` of
        ``CONTROL``/``TARGET``/``SWAP``) leaves that counter standing as an
        island, a double piece's marker spans two disconnected faces, and a
        multi-glyph cube side label (``RX``) is one solid per glyph. Colouring
        only the *last* of them left every other one with no material assignment
        — i.e. printed on slot 1 (white). Returns the number of meshes coloured,
        which is the number of coloured objects this part contributes.
        """
        meshes = self._mesher.meshes
        pid = self._pid_by_hex[hex_color.lower()]
        fresh = meshes[self._coloured :]
        for mesh_obj in fresh:
            mesh_obj.SetObjectLevelProperty(self._resource_id, pid)
            mesh_obj.SetName(name)
        self._coloured = len(meshes)
        return len(fresh)


def _hex_rgb01(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore[return-value]


def _part_color_hex(role: str, layout) -> str:
    if role == "body":
        return WHITE_HEX
    if role == "marker":
        return BLACK_HEX
    return layout.accent_hex


def export_tile_stls(parts: TileParts, out_dir: Path) -> list[Path]:
    """Write ``<slug>-<role>-<colour>.stl`` for each colour part."""
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = tile_slug(parts.layout.spec)
    written: list[Path] = []
    for role, color_name, solid in parts.named_parts():
        path = out_dir / f"{slug}-{role}-{color_name}.stl"
        export_stl(solid, str(path))
        written.append(path)
    return written


def export_tile_3mf(parts: TileParts, out_dir: Path) -> Path | None:
    """Write a single coloured ``<slug>.3mf`` with each part on its gate colour.

    Returns the path, or ``None`` if the 3MF backend is unavailable.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = tile_slug(parts.layout.spec)
    path = out_dir / f"{slug}.3mf"
    mesher = Mesher()
    try:
        # One shared palette: white, black, then this tile's single accent. Its
        # apply() sets the base-material colour directly on each mesh object,
        # because build123d 0.11.1 drops a Solid's `.color` inside add_shape (it
        # re-iterates the Solid into a fresh, colour-less copy).
        palette = _MaterialPalette(mesher, [parts.layout.accent_hex], accent_color_name)
        for role, color_name, solid in parts.named_parts():
            mesher.add_shape(solid)
            palette.apply(
                _part_color_hex(role, parts.layout),
                f"{slug}-{role}-{color_name}",
            )
        _stamp_3mf(mesher, slug)
        mesher.write(str(path))
    except (RuntimeError, ValueError):
        # lib3mf rejects a mesh it considers non-manifold; the per-colour STLs
        # are still written, so 3MF is genuinely best-effort here.
        if path.exists():
            path.unlink()
        return None
    return path


def export_double_tile_stls(parts: DoubleTileParts, out_dir: Path) -> list[Path]:
    """Write ``<a>+<b>-<role>-<colour>.stl`` for each colour part of a double piece."""
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = double_slug(parts.layout_a.spec, parts.layout_b.spec)
    written: list[Path] = []
    for role, color_name, _hex, solid in parts.named_parts():
        path = out_dir / f"{slug}-{role}-{color_name}.stl"
        export_stl(solid, str(path))
        written.append(path)
    return written


def export_double_tile_3mf(parts: DoubleTileParts, out_dir: Path) -> Path | None:
    """Write a single coloured ``<a>+<b>.3mf`` (3 or 4 parts by colour count)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = double_slug(parts.layout_a.spec, parts.layout_b.spec)
    path = out_dir / f"{slug}.3mf"
    mesher = Mesher()
    try:
        # White, black, then this piece's accents (1 same-family, 2 cross-family)
        # in named_parts order; double_color_name tells the two blues apart.
        palette = _MaterialPalette(mesher, [h for h, _ in parts.accents], double_color_name)
        for role, color_name, hexc, solid in parts.named_parts():
            mesher.add_shape(solid)
            palette.apply(hexc, f"{slug}-{role}-{color_name}")
        _stamp_3mf(mesher, slug)
        mesher.write(str(path))
    except (RuntimeError, ValueError):
        if path.exists():
            path.unlink()
        return None
    return path


# --------------------------------------------------------------------------- #
# Single-colour ("mono") STL variants — no MMU / no colour needed
# --------------------------------------------------------------------------- #


def export_mono_stls(
    parts: TileParts, out_dir: Path, params: HardwareParams | None = None
) -> list[Path]:
    """Write the two single-colour variants of a single-faced tile.

    ``<slug>-mono-recessed.stl`` (paint-well pockets, the default form) and
    ``<slug>-mono-raised.stl`` (art raised for a single filament swap). Geometry
    only — STL carries no colour, which is the whole point of the mono form.
    """
    params = params or HardwareParams()
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = tile_slug(parts.layout.spec)
    recessed = out_dir / f"{slug}-mono-recessed.stl"
    raised = out_dir / f"{slug}-mono-raised.stl"
    export_stl(build_mono_recessed(parts, params), str(recessed))
    export_stl(build_mono_raised(parts, params), str(raised))
    return [recessed, raised]


def export_double_mono_stls(
    parts: DoubleTileParts, out_dir: Path, params: HardwareParams | None = None
) -> list[Path]:
    """Write the two single-colour variants of a double-faced piece.

    Recessed cuts wells into *both* faces; raised stands art proud of both faces
    (a two-swap, dark→light→dark print).
    """
    params = params or HardwareParams()
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = double_slug(parts.layout_a.spec, parts.layout_b.spec)
    recessed = out_dir / f"{slug}-mono-recessed.stl"
    raised = out_dir / f"{slug}-mono-raised.stl"
    export_stl(build_double_mono_recessed(parts, params), str(recessed))
    export_stl(build_double_mono_raised(parts, params), str(raised))
    return [recessed, raised]


def write_mono_md(
    out_dir: Path,
    *,
    faces: str,
    height: float,
    params: HardwareParams | None = None,
) -> Path:
    """Emit ``mono.md``: the single-colour recipe + filament-swap Z heights.

    ``height`` is the coloured piece height for this variant (the raised form is
    taller by the raise amount — one raise for a single tile, two for a double).
    """
    params = params or HardwareParams()
    depth = params.mono_pocket_depth
    r = params.mono_raise_height
    cube = height > params.tall_body_min_height
    lines: list[str] = [
        "# Single-colour (mono) variants — printers without an MMU",
        "",
        _md_stamp(),
        "",
        "Two extra STLs per piece let a single-material printer make a usable "
        "tile. They carry **no colour** (STL is geometry only); which colour goes "
        "where is in `plates.md`'s table.",
        "",
        "## Recessed (default — acrylic-pen paint wells)",
        "",
        f"Every colour region is a **{depth:g} mm** deep pocket with vertical "
        "walls; the surrounding face is the raised rim that masks the paint edge. "
        "Print in white, then fill the wells with acrylic paint pens. Only the "
        "**marker** must be painted (black) for detection — symbols are optional, "
        f"the gate identity is already in the glyph. Pocket depth is kept ≤ 0.6 mm "
        "so an oblique camera's pocket shadow can't degrade marker detection.",
        "",
    ]
    if cube:
        lines += [
            "### Cube side faces",
            "",
            "A cube also carries its gate's name on all four **vertical** faces. "
            f"**Both** mono forms render those as **{depth:g} mm** paint wells — a "
            "filament swap changes whole layers and so cannot colour a vertical "
            "face, but an acrylic pen can. Use the gate's accent colour from "
            "`plates.md`, or leave them white: the recess alone still reads.",
            "",
        ]
    lines += [
        "## Raised (filament-swap two-tone)",
        "",
        f"All art stands **{r:g} mm** proud of the face, so a single filament "
        "swap (M600 / colour change) prints the body in colour 1 and the art in "
        "colour 2 — no MMU needed. Load white, add a colour-change at the Z below.",
        "",
        "| Swap | Z height (mm) | From → To |",
        "| ---- | ------------- | --------- |",
    ]
    if faces == "double":
        # bottom art [0, r] · white core [r, r+h] · top art [r+h, 2r+h]
        lines.append(f"| start | 0.000 | print in **colour 2** (bottom-face art) |")
        lines.append(f"| 1 | {r:.3f} | colour 2 → **colour 1** (white core) |")
        lines.append(f"| 2 | {r + height:.3f} | colour 1 → **colour 2** (top-face art) |")
        total = 2.0 * r + height
        lines += [
            "",
            f"A double-faced raised piece is **{total:.3f} mm** tall (body "
            f"{height:g} mm + {r:g} mm art on each face) and prints "
            "**dark → light → dark** with the two swaps above.",
        ]
    else:
        lines.append(f"| start | 0.000 | print in **colour 1** (body) |")
        lines.append(f"| 1 | {height:.3f} | colour 1 → **colour 2** (raised art) |")
        total = r + height
        lines += [
            "",
            f"A single-faced raised piece is **{total:.3f} mm** tall (body "
            f"{height:g} mm + {r:g} mm raised art) with one swap at the top face.",
        ]
    lines.append("")
    path = out_dir / "mono.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


# --------------------------------------------------------------------------- #
# plates.md — MMU plate groupings
# --------------------------------------------------------------------------- #


def _gate_tiles() -> list[tuple[int, GateSpec]]:
    return sorted(
        ((mid, spec) for mid, spec in MARKER_TABLE.items() if spec.kind == "gate"),
        key=lambda kv: kv[0],
    )


def write_plates_md(config: AssetsConfig, out_dir: Path) -> Path:
    """Emit ``plates.md``: two MMU plates (≤5 slots) with per-slot hex + tiles."""
    out_dir.mkdir(parents=True, exist_ok=True)

    # accent hex -> [tile labels]
    by_accent: dict[str, list[str]] = {}
    accent_order: list[str] = []
    for _mid, spec in _gate_tiles():
        hexc = config.colors.for_gate(spec.gate)
        if hexc not in by_accent:
            by_accent[hexc] = []
            accent_order.append(hexc)
        by_accent[hexc].append(spec.label)

    # Fixed slots white + black leave 3 free MMU slots per plate → chunk accents.
    free_slots = 3
    chunks = [
        accent_order[i : i + free_slots]
        for i in range(0, len(accent_order), free_slots)
    ]

    lines: list[str] = [
        "# MMU plate groupings — Entangible gate tiles",
        "",
        _md_stamp(),
        "",
        "Prusa Core One MMU has 5 filament slots. Every plate reserves slot 1",
        "for **white** (bodies) and slot 2 for **black** (markers), leaving 3",
        "slots for gate accent colours. The gate set uses "
        f"{len(accent_order)} accent colours, so tiles split across "
        f"{len(chunks)} plate(s) below.",
        "",
        "Load filaments into these slots, then print the listed tiles on that",
        "plate (any height variant). Hex values come straight from `assets.toml`.",
        "",
    ]

    for pi, chunk in enumerate(chunks, start=1):
        lines.append(f"## Plate {pi}")
        lines.append("")
        lines.append("| Slot | Filament | Hex |")
        lines.append("| ---- | -------- | --- |")
        lines.append(f"| 1 | white (bodies) | `{WHITE_HEX}` |")
        lines.append(f"| 2 | black (markers) | `{BLACK_HEX}` |")
        for si, hexc in enumerate(chunk, start=3):
            lines.append(f"| {si} | {accent_color_name(hexc)} | `{hexc}` |")
        lines.append("")
        lines.append("Tiles on this plate:")
        lines.append("")
        for hexc in chunk:
            tiles = ", ".join(by_accent[hexc])
            lines.append(f"- **{accent_color_name(hexc)}** (`{hexc}`): {tiles}")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append(
        "Each tile's STL parts (`*-body-white.stl`, `*-marker-black.stl`, "
        "`*-accent-<colour>.stl`) share one coordinate frame — in PrusaSlicer, "
        "select them and *Right-click → Import as single object / parts*, then "
        "assign each part to its slot above. The bundled `<tile>.3mf` already "
        "carries these colours."
    )
    lines.append("")

    path = out_dir / "plates.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


# --------------------------------------------------------------------------- #
# plates.md — double-faced kit (pieces may span two accent families)
# --------------------------------------------------------------------------- #

#: Max accent filaments per plate (5 MMU slots − white − black).
_DOUBLE_FREE_SLOTS = 3


def _piece_families(a: int, b: int | None, config: AssetsConfig) -> list[str]:
    """Ordered, de-duplicated accent hexes a double piece needs (face A, then B)."""
    mb = a if b is None else b
    ha = config.colors.for_gate(MARKER_TABLE[a].gate)
    hb = config.colors.for_gate(MARKER_TABLE[mb].gate)
    fams = [ha]
    if hb.lower() != ha.lower():
        fams.append(hb)
    return fams


def double_plate_assignment(
    config: AssetsConfig, kit: list[tuple[int, int | None, int]]
) -> list[dict]:
    """Greedy first-fit packing of double pieces into ≤3-accent-family plates.

    Every piece (≤2 families) is placed on the first plate whose family union
    stays ≤ :data:`_DOUBLE_FREE_SLOTS`; otherwise a new plate opens. The
    invariant "plate accent-family count ≤ 3" therefore holds by construction.
    Returns a list of ``{"families": [hex...], "pieces": [(a, b, qty)]}``.
    """
    plates: list[dict] = []
    for a, b, qty in kit:
        fams = _piece_families(a, b, config)
        placed = False
        for plate in plates:
            union = list(plate["families"])
            lowered = {f.lower() for f in union}
            for f in fams:
                if f.lower() not in lowered:
                    union.append(f)
                    lowered.add(f.lower())
            if len(union) <= _DOUBLE_FREE_SLOTS:
                plate["families"] = union
                plate["pieces"].append((a, b, qty))
                placed = True
                break
        if not placed:
            plates.append({"families": list(fams), "pieces": [(a, b, qty)]})
    return plates


def _piece_label(a: int, b: int | None, qty: int) -> str:
    mb = a if b is None else b
    slug = double_slug(MARKER_TABLE[a], MARKER_TABLE[mb])
    return f"{slug} ×{qty}"


def write_double_plates_md(
    config: AssetsConfig,
    kit: list[tuple[int, int | None, int]],
    out_dir: Path,
) -> Path:
    """Emit ``plates.md`` for the double-faced kit (pieces may span two families)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    plates = double_plate_assignment(config, kit)
    total = sum(qty for _a, _b, qty in kit)

    lines: list[str] = [
        "# MMU plate groupings — double-faced Entangible pieces",
        "",
        _md_stamp(),
        "",
        f"The double-faced kit has **{total} pieces**. Each piece carries two "
        "gate faces (flip to switch); a cross-family piece (mixed H/X/Y/Z) needs "
        "**two** accent filaments, one per face.",
        "",
        "Prusa Core One MMU has 5 filament slots. Every plate reserves slot 1 for "
        "**white** (bodies) and slot 2 for **black** (markers), leaving 3 slots "
        "for accent colours — so a plate can host any pieces whose **combined** "
        f"accent families number ≤ 3. Greedy packing uses **{len(plates)} plate(s)**.",
        "",
    ]

    for pi, plate in enumerate(plates, start=1):
        fams = plate["families"]
        lines.append(f"## Plate {pi}")
        lines.append("")
        lines.append("| Slot | Filament | Hex |")
        lines.append("| ---- | -------- | --- |")
        lines.append(f"| 1 | white (bodies) | `{WHITE_HEX}` |")
        lines.append(f"| 2 | black (markers) | `{BLACK_HEX}` |")
        for si, hexc in enumerate(fams, start=3):
            lines.append(f"| {si} | {double_color_name(hexc)} | `{hexc}` |")
        lines.append("")
        lines.append("Pieces on this plate:")
        lines.append("")
        for a, b, qty in plate["pieces"]:
            mb = a if b is None else b
            names = " | ".join(
                double_color_name(config.colors.for_gate(MARKER_TABLE[m].gate))
                for m in (a, mb)
            )
            lines.append(f"- `{_piece_label(a, b, qty)}` — accents: {names}")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append(
        "Each piece's STL parts (`*-body-white.stl`, `*-marker-black.stl`, and "
        "one `*-accent-<colour>.stl` **per accent colour** — two for a "
        "cross-family piece) share one coordinate frame. In PrusaSlicer select "
        "them and *Right-click → Import as single object / parts*, then assign "
        "each part to its slot above. The bundled `<a>+<b>.3mf` already carries "
        "these colours."
    )
    lines.append("")

    path = out_dir / "plates.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


# --------------------------------------------------------------------------- #
# Bed-ready print batches — multi-piece coloured 3MFs, one per physical job
# --------------------------------------------------------------------------- #


@dataclass(slots=True)
class _ColoredPart:
    """One coloured solid ready to translate onto the bed: (hex, name, solid)."""

    hex: str
    name: str
    solid: object  # build123d Solid


@dataclass(slots=True)
class _Piece:
    """A single physical piece: its filename slug and its coloured parts."""

    slug: str
    parts: list[_ColoredPart]


@dataclass(slots=True)
class BatchInfo:
    """Metadata for one written batch 3MF (a single physical print job)."""

    plate: int
    batch: int
    path: Path
    slugs: list[str]  # piece slug per placed piece, row-major
    positions: list[tuple[float, float]]  # bed centre point per piece
    object_count: int  # coloured objects in the 3MF
    cols: int
    rows: int


def single_plate_groups(config: AssetsConfig) -> list[dict]:
    """Filament plates for the single kit, as ``{"accents": [hex], "pieces": [mid]}``.

    Same membership rule as :func:`write_plates_md`: white + black + ≤3 accent
    families per plate, accents chunked in table order, tiles grouped by accent.
    """
    by_accent: dict[str, list[int]] = {}
    accent_order: list[str] = []
    for mid, spec in _gate_tiles():
        hexc = config.colors.for_gate(spec.gate)
        if hexc not in by_accent:
            by_accent[hexc] = []
            accent_order.append(hexc)
        by_accent[hexc].append(mid)

    free_slots = 3
    plates: list[dict] = []
    for i in range(0, len(accent_order), free_slots):
        chunk = accent_order[i : i + free_slots]
        pieces = [mid for hexc in chunk for mid in by_accent[hexc]]
        plates.append({"accents": chunk, "pieces": pieces})
    return plates


def double_plate_groups(
    config: AssetsConfig, kit: list[tuple[int, int | None, int]]
) -> list[dict]:
    """Filament plates for the double kit with quantities expanded to pieces.

    Wraps :func:`double_plate_assignment` and flattens each ``(a, b, qty)`` into
    ``qty`` copies of ``(a, b)`` — one physical piece each.
    """
    plates = double_plate_assignment(config, kit)
    out: list[dict] = []
    for plate in plates:
        pieces = [(a, b) for a, b, qty in plate["pieces"] for _ in range(qty)]
        out.append({"families": plate["families"], "pieces": pieces})
    return out


def _single_piece(
    mid: int, config: AssetsConfig, variant: str, height: float, params: HardwareParams
) -> _Piece:
    parts = build_tile(mid, config, variant=variant, height=height, params=params)
    slug = tile_slug(parts.layout.spec)
    cp = [
        _ColoredPart(_part_color_hex(role, parts.layout), f"{slug}-{role}-{cn}", solid)
        for role, cn, solid in parts.named_parts()
    ]
    return _Piece(slug, cp)


def _double_piece(
    a: int,
    b: int | None,
    config: AssetsConfig,
    variant: str,
    height: float,
    params: HardwareParams,
) -> _Piece:
    parts = build_double_tile(a, b, config, variant=variant, height=height, params=params)
    mb = a if b is None else b
    slug = double_slug(MARKER_TABLE[a], MARKER_TABLE[mb])
    cp = [
        _ColoredPart(hexc, f"{slug}-{role}-{cn}", solid)
        for role, cn, hexc, solid in parts.named_parts()
    ]
    return _Piece(slug, cp)


def _batch_accents(pieces: list[_Piece]) -> list[str]:
    """Accent hexes a batch uses, deduped in piece/part encounter order.

    Fallback when a caller does not pass its plate's accent order; the real
    exporters pass ``single_plate_groups``/``double_plate_groups`` order so the
    batch 3MFs and plates.md share one ordering source.
    """
    order: list[str] = []
    seen: set[str] = set()
    for piece in pieces:
        for part in piece.parts:
            key = part.hex.lower()
            if key in (WHITE_HEX, BLACK_HEX) or key in seen:
                continue
            seen.add(key)
            order.append(part.hex)
    return order


def _write_batch_3mf(
    pieces: list[_Piece],
    positions: list[tuple[float, float]],
    path: Path,
    *,
    accents: list[str] | None = None,
    name_accent=accent_color_name,
    footprint: float = FOOTPRINT,
) -> int:
    """Write one batch: every piece's coloured parts translated onto the bed.

    Each piece is built with its footprint in the first quadrant (centre at
    ``footprint/2``); it is translated so that centre lands on its bed position.
    Every part points at the batch's one shared palette — white, black, then the
    plate's ``accents`` (in plates.md order) so a colour keeps its slot across
    every batch of the plate. Returns the number of coloured objects written —
    one per *solid*, not per part, since a disconnected part (a caption counter,
    a two-glyph cube side label, a double piece's two markers) becomes one 3MF
    object per island.
    """
    mesher = Mesher()
    palette = _MaterialPalette(
        mesher, accents if accents is not None else _batch_accents(pieces), name_accent
    )
    n_obj = 0
    for piece, (cx, cy) in zip(pieces, positions):
        dx = cx - footprint / 2.0
        dy = cy - footprint / 2.0
        for part in piece.parts:
            mesher.add_shape(Pos(dx, dy, 0.0) * part.solid)
            n_obj += palette.apply(part.hex, part.name)
    _stamp_3mf(mesher, path.stem)
    mesher.write(str(path))
    return n_obj


def _cols_rows(bed: Bed, spacing: float) -> tuple[int, int]:
    return bed_capacity(bed, FOOTPRINT, spacing)


def _export_batches(
    build_pieces,
    plate_pieces: list[list],
    bed: Bed,
    spacing: float,
    out_dir: Path,
    *,
    plate_accents: list[list[str]] | None = None,
    name_accent=accent_color_name,
    max_per_bed: int | None = None,
    stem_fmt: str = "plate{plate}-batch{batch}",
) -> list[BatchInfo]:
    """Shared driver: build each filament plate's pieces, pack, write batch 3MFs.

    ``plate_accents[i]`` is plate ``i``'s accent order (from the same
    plate-grouping source plates.md uses); every batch of that plate reuses it so
    a colour keeps its slot across the plate's batches. Defaults to per-batch
    encounter order when omitted. ``stem_fmt`` names the files (``{plate}`` /
    ``{batch}``); the corner-block plate uses its own stem so it can never be
    confused with a numbered gate plate.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    cols, rows = _cols_rows(bed, spacing)
    infos: list[BatchInfo] = []
    for pi, members in enumerate(plate_pieces, start=1):
        accents = plate_accents[pi - 1] if plate_accents is not None else None
        pieces = [build_pieces(m) for m in members]
        batches = plan_batches(
            len(pieces), bed, FOOTPRINT, spacing, max_per_bed=max_per_bed
        )
        idx = 0
        for bi, positions in enumerate(batches, start=1):
            take = len(positions)
            batch = pieces[idx : idx + take]
            idx += take
            path = out_dir / f"{stem_fmt.format(plate=pi, batch=bi)}.3mf"
            n_obj = _write_batch_3mf(
                batch, positions, path, accents=accents, name_accent=name_accent
            )
            infos.append(
                BatchInfo(
                    plate=pi,
                    batch=bi,
                    path=path,
                    slugs=[p.slug for p in batch],
                    positions=positions,
                    object_count=n_obj,
                    cols=cols,
                    rows=rows,
                )
            )
    return infos


def export_single_batches(
    config: AssetsConfig,
    *,
    variant: str,
    height: float,
    bed: Bed,
    spacing: float,
    out_dir: Path,
    params: HardwareParams | None = None,
    max_per_bed: int | None = None,
) -> list[BatchInfo]:
    """Write bed-ready batch 3MFs for the single-faced kit."""
    params = params or HardwareParams()
    groups = single_plate_groups(config)
    return _export_batches(
        lambda mid: _single_piece(mid, config, variant, height, params),
        [g["pieces"] for g in groups],
        bed,
        spacing,
        out_dir,
        plate_accents=[g["accents"] for g in groups],
        name_accent=accent_color_name,
        max_per_bed=max_per_bed,
    )


def export_double_batches(
    config: AssetsConfig,
    kit: list[tuple[int, int | None, int]],
    *,
    variant: str,
    height: float,
    bed: Bed,
    spacing: float,
    out_dir: Path,
    params: HardwareParams | None = None,
    max_per_bed: int | None = None,
) -> list[BatchInfo]:
    """Write bed-ready batch 3MFs for the double-faced kit."""
    params = params or HardwareParams()
    groups = double_plate_groups(config, kit)
    return _export_batches(
        lambda ab: _double_piece(ab[0], ab[1], config, variant, height, params),
        [g["pieces"] for g in groups],
        bed,
        spacing,
        out_dir,
        plate_accents=[g["families"] for g in groups],
        name_accent=double_color_name,
        max_per_bed=max_per_bed,
    )


# --------------------------------------------------------------------------- #
# Board-corner blocks — an opt-in extra plate (white + black only)
# --------------------------------------------------------------------------- #


def _corner_piece(
    mid: int, config: AssetsConfig, variant: str, height: float, params: HardwareParams
) -> _Piece:
    parts = build_corner_block(
        mid, config, variant=variant, height=height, params=params
    )
    slug = tile_slug(parts.layout.spec)
    cp = [
        _ColoredPart(_part_color_hex(role, parts.layout), f"{slug}-{role}-{cn}", solid)
        for role, cn, solid in parts.named_parts()
    ]
    return _Piece(slug, cp)


def export_corner_batches(
    config: AssetsConfig,
    *,
    variant: str,
    height: float,
    bed: Bed,
    spacing: float,
    out_dir: Path,
    params: HardwareParams | None = None,
    max_per_bed: int | None = None,
    ids: list[int] | None = None,
) -> list[BatchInfo]:
    """Write bed-ready batch 3MFs for the four board-corner blocks.

    Their own plate: the label and side letters print in the marker black that
    slot 2 already holds, so the plate needs **no accent filament** and can
    never disturb the gate plates' slot assignment.
    """
    params = params or HardwareParams()
    members = corner_block_ids() if ids is None else list(ids)
    return _export_batches(
        lambda mid: _corner_piece(mid, config, variant, height, params),
        [members],
        bed,
        spacing,
        out_dir,
        plate_accents=[[]],
        name_accent=accent_color_name,
        max_per_bed=max_per_bed,
        stem_fmt="corners-batch{batch}",
    )


# --------------------------------------------------------------------------- #
# Single-colour ("mono") plates — separate beds per form
# --------------------------------------------------------------------------- #
#
# A mono piece is ONE solid with no colour, so the filament-plate grouping that
# drives the coloured batches is meaningless here: what matters is the *form*.
# A recessed bed is printed in one filament and painted; a raised bed prints
# two-tone off a single filament swap at the top of the body — one swap for the
# whole bed, which only works if every piece on it is the same form and height.
# The two forms therefore never share a bed.


@dataclass(slots=True)
class MonoBatchInfo:
    """Metadata for one written mono batch 3MF (a single physical print job)."""

    form: str  # recessed | raised
    batch: int
    path: Path
    slugs: list[str]
    positions: list[tuple[float, float]]
    object_count: int
    cols: int
    rows: int


#: The two mono forms, in the order their beds are written.
MONO_FORMS: tuple[str, str] = ("recessed", "raised")


def _mono_forms(parts, params: HardwareParams) -> dict[str, object]:
    """Both single-colour solids of a piece, keyed by form."""
    if isinstance(parts, DoubleTileParts):
        return {
            "recessed": build_double_mono_recessed(parts, params),
            "raised": build_double_mono_raised(parts, params),
        }
    return {
        "recessed": build_mono_recessed(parts, params),
        "raised": build_mono_raised(parts, params),
    }


def _write_mono_batch_3mf(
    pieces: list[tuple[str, object]],
    positions: list[tuple[float, float]],
    path: Path,
    *,
    footprint: float = FOOTPRINT,
) -> int:
    """Write one mono bed: each piece's single solid translated onto the bed.

    No material group at all — a mono piece carries no colour by construction
    (that is the whole point of the form), and inventing one would put a
    misleading filament assignment in the slicer. Meshes are named by slug so a
    piece is still identifiable in the object list. Returns the mesh count.
    """
    mesher = Mesher()
    n_obj = 0
    for (slug, solid), (cx, cy) in zip(pieces, positions):
        dx = cx - footprint / 2.0
        dy = cy - footprint / 2.0
        before = len(mesher.meshes)
        mesher.add_shape(Pos(dx, dy, 0.0) * solid)
        for mesh_obj in mesher.meshes[before:]:
            mesh_obj.SetName(slug)
            n_obj += 1
    _stamp_3mf(mesher, path.stem)
    mesher.write(str(path))
    return n_obj


def _mono_entries(
    config: AssetsConfig,
    *,
    faces: str,
    variant: str,
    height: float,
    params: HardwareParams,
    kit: list[tuple[int, int | None, int]] | None,
    ids: list[int] | None,
    corners: bool,
) -> list[tuple[str, dict[str, object]]]:
    """``(slug, {form: solid})`` for every physical piece of the mono kit.

    One entry per *piece*, so a double-faced design with ``qty`` 4 contributes
    four entries (the same two solids, placed four times).
    """
    entries: list[tuple[str, dict[str, object]]] = []
    if faces == "double":
        for a, b, qty in kit if kit is not None else DOUBLE_FACED_KIT:
            parts = build_double_tile(
                a, b, config, variant=variant, height=height, params=params
            )
            slug = double_slug(parts.layout_a.spec, parts.layout_b.spec)
            forms = _mono_forms(parts, params)
            entries.extend((slug, forms) for _ in range(qty))
    else:
        members = [mid for mid, _spec in _gate_tiles()] if ids is None else list(ids)
        for mid in members:
            parts = build_tile(
                mid, config, variant=variant, height=height, params=params
            )
            entries.append((tile_slug(parts.layout.spec), _mono_forms(parts, params)))
    if corners:
        for mid in corner_block_ids():
            parts = build_corner_block(
                mid, config, variant=variant, height=height, params=params
            )
            entries.append((tile_slug(parts.layout.spec), _mono_forms(parts, params)))
    return entries


def export_mono_batches(
    config: AssetsConfig,
    *,
    faces: str,
    variant: str,
    height: float,
    bed: Bed,
    spacing: float,
    out_dir: Path,
    params: HardwareParams | None = None,
    max_per_bed: int | None = None,
    kit: list[tuple[int, int | None, int]] | None = None,
    ids: list[int] | None = None,
    corners: bool = False,
) -> list[MonoBatchInfo]:
    """Write bed-ready batch 3MFs for the **mono** kit, one set of beds per form.

    Every piece of the kit appears exactly once on the recessed beds and exactly
    once on the raised beds; the two forms never share a bed, so a raised bed is
    a single filament swap (at ``Z = height``) for the whole plate.
    """
    params = params or HardwareParams()
    out_dir.mkdir(parents=True, exist_ok=True)
    entries = _mono_entries(
        config,
        faces=faces,
        variant=variant,
        height=height,
        params=params,
        kit=kit,
        ids=ids,
        corners=corners,
    )
    cols, rows = bed_capacity(bed, FOOTPRINT, spacing)
    infos: list[MonoBatchInfo] = []
    for form in MONO_FORMS:
        batches = plan_batches(
            len(entries), bed, FOOTPRINT, spacing, max_per_bed=max_per_bed
        )
        idx = 0
        for bi, positions in enumerate(batches, start=1):
            take = len(positions)
            chunk = entries[idx : idx + take]
            idx += take
            path = out_dir / f"mono-{form}-batch{bi}.3mf"
            n_obj = _write_mono_batch_3mf(
                [(slug, forms[form]) for slug, forms in chunk], positions, path
            )
            infos.append(
                MonoBatchInfo(
                    form=form,
                    batch=bi,
                    path=path,
                    slugs=[slug for slug, _f in chunk],
                    positions=positions,
                    object_count=n_obj,
                    cols=cols,
                    rows=rows,
                )
            )
    return infos


def _ascii_layout(info: BatchInfo, cell_w: int = 8) -> list[str]:
    """A tiny boxed grid of the batch's piece slugs, row-major."""
    cols = max(info.cols, 1)
    n = len(info.slugs)
    rule = "+" + ("-" * cell_w + "+") * cols

    def cell(text: str) -> str:
        return text[:cell_w].ljust(cell_w)

    lines: list[str] = ["```", rule]
    for r in range((n + cols - 1) // cols):
        row_slugs = info.slugs[r * cols : (r + 1) * cols]
        row = "|" + "|".join(cell(s) for s in row_slugs) + "|"
        lines.append(row)
        lines.append(rule)
    lines.append("```")
    return lines


def write_batch_plates_md(
    base_md: Path,
    infos: list[BatchInfo],
    *,
    bed: Bed,
    spacing: float,
    faces: str,
    variant: str,
    max_per_bed: int | None = None,
) -> Path:
    """Append a **Print jobs** section (batch files + ASCII layouts) to ``base_md``.

    ``base_md`` is the plate-grouping ``plates.md`` already written by
    :func:`write_plates_md` / :func:`write_double_plates_md`; this adds one entry
    per batch 3MF. Returns ``base_md``.

    No provenance stamp here — the base writer already put one under the H1, and
    a second one mid-document would just be a contradictory-looking duplicate.
    """
    cols = infos[0].cols if infos else 0
    rows = infos[0].rows if infos else 0
    total_pieces = sum(len(i.slugs) for i in infos)
    lines: list[str] = [
        "",
        "---",
        "",
        "## Print jobs",
        "",
        f"Bed **{bed.width:g} × {bed.height:g} mm**, piece footprint "
        f"**{FOOTPRINT:g} × {FOOTPRINT:g} mm** + **{spacing:g} mm** spacing → "
        f"**{cols} × {rows} = {cols * rows}** pieces per bed. Each filament plate "
        "above is split into numbered **batches**; every batch below is one "
        "multi-piece coloured 3MF (open it, print the whole bed on that plate's "
        f"filaments). {len(infos)} batch file(s), {total_pieces} pieces total.",
        "",
    ]
    if max_per_bed is not None and max_per_bed < cols * rows:
        lines.append(
            f"> **Wipe tower:** batches are capped at **{max_per_bed}** pieces "
            "and the grid is anchored in the front-left corner, so all free "
            "bed area is one connected region at the rear/right — drop the "
            "MMU wipe tower there in the slicer."
        )
        lines.append("")
    if variant == "cube":
        lines.append(
            "> **Cube kit:** pieces are 60 mm tall — a tall, long print. "
            "Same 3 × 3 bed packing; expect a long job and watch bed adhesion. "
            "The gate name is inlaid on all four side faces, so the accent "
            "colour is in play across most of the 60 mm rather than only the "
            "top 0.8 mm — budget for **more wipe-tower purge** than a flat "
            "tile plate. The 8-piece cap already leaves the rear/right corner "
            "free for a taller tower."
        )
        lines.append("")

    for info in infos:
        lines.append(
            f"### `{info.path.name}` — plate {info.plate}, batch {info.batch}"
        )
        lines.append("")
        lines.append(
            f"{len(info.slugs)} piece(s), {info.object_count} coloured objects: "
            + ", ".join(f"`{s}`" for s in info.slugs)
        )
        lines.append("")
        lines.extend(_ascii_layout(info))
        lines.append("")

    with base_md.open("a", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    return base_md


def write_corner_plates_md(base_md: Path, infos: list[BatchInfo]) -> Path:
    """Append the **corner blocks** plate section to an existing ``plates.md``.

    Their own plate because they need no accent filament at all — white bodies,
    black markers, black labels. Appended (never inserted) so the numbered gate
    plates above keep the exact slot assignment they had without ``--corners``.
    """
    lines: list[str] = [
        "",
        "---",
        "",
        "## Plate — board-corner blocks (opt-in)",
        "",
        "| Slot | Filament | Hex |",
        "| ---- | -------- | --- |",
        f"| 1 | white (bodies) | `{WHITE_HEX}` |",
        f"| 2 | black (markers + labels) | `{BLACK_HEX}` |",
        "",
        "The four corner blocks replace the printed board mat. They carry **no "
        "gate colour**: the UL/UR/LL/LR label and the side letters print in the "
        "same black as the marker, so this plate needs only two filaments and "
        "the gate plates above keep their slots unchanged.",
        "",
        "See `corners.md` for which block goes where and which way up.",
        "",
    ]
    for info in infos:
        lines.append(f"### `{info.path.name}` — corner blocks, batch {info.batch}")
        lines.append("")
        lines.append(
            f"{len(info.slugs)} block(s), {info.object_count} coloured objects: "
            + ", ".join(f"`{s}`" for s in info.slugs)
        )
        lines.append("")
        lines.extend(_ascii_layout(info))
        lines.append("")
    with base_md.open("a", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    return base_md


def write_corners_md(config: AssetsConfig, out_dir: Path) -> Path:
    """Emit ``corners.md``: what the four blocks are, and how to place them.

    Placement and *rotation* are load-bearing: the board homography is fitted
    from each marker's four corner points, so a block turned by 90° skews the
    whole board transform. This documents both cues that make the correct
    orientation obvious on the printed part.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    b = config.board
    size = config.tile.size
    inner = size - b.corner_margin - b.corner_marker_size

    lines: list[str] = [
        "# Board-corner blocks — the printed mat, in four pieces",
        "",
        _md_stamp(),
        "",
        "Four blocks carrying the board's ArUco corner markers (IDs 0-3). Put "
        "one at each corner of the play area and the vision pipeline gets "
        "exactly the fiducials the printed mat would have given it — no mat "
        "needed. They are **opt-in**: generate them with `--corners`.",
        "",
        "| Block | Marker ID | Detector role | Corner of the board |",
        "| ----- | --------- | ------------- | ------------------- |",
    ]
    where = {
        0: "upper left — the circuit **start** side",
        1: "upper right — the circuit **end** side",
        2: "lower right",
        3: "lower left",
    }
    for mid in corner_block_ids():
        spec = MARKER_TABLE[mid]
        lines.append(
            f"| **{corner_block_label(mid)}** | {mid} | {spec.role} | {where[mid]} |"
        )
    lines += [
        "",
        "## Which way up (read this before printing labels off)",
        "",
        "The board transform is fitted from each marker's **four corner "
        "points**, so a block placed at the right corner but turned 90° does "
        "not just look wrong — it skews the whole board and every tile lands in "
        "the wrong cell. Each block's top face therefore carries two cues, and "
        "they agree:",
        "",
        f"1. **The marker is off-centre.** It sits "
        f"**{b.corner_margin:g} mm** from the block's two *outer* edges and "
        f"**{inner:g} mm** from the two *inner* ones — exactly where the mat "
        "has it. The short margins point out of the board, the long ones point "
        "into it.",
        "2. **The label reads upright.** `UL` / `UR` / `LL` / `LR` sits in the "
        "strip along the block's *inner* edge (the label always faces the "
        "middle of the board) and reads the right way up when the block is "
        "correctly placed. On a cube-height block the same label is repeated on "
        "all four vertical faces, so it is readable from any seat.",
        "",
        "The marker artwork itself is the mat's, unrotated and byte-identical "
        "(same ArUco dictionary, same bit matrix) — the label is the only thing "
        "telling the four blocks apart at a glance.",
        "",
        "## Placement",
        "",
        f"Each block is a **{size:g} × {size:g} mm crop of the mat's corner**. "
        f"Line the block's outer corner up with the corner of your play area "
        f"and the marker lands where the mat's does. The mat is "
        f"**{b.mat_width:g} × {b.mat_height:g} mm** measured over the outer "
        "corners of the four blocks, so:",
        "",
        f"- outer edges of UL↔UR (and LL↔LR): **{b.mat_width:g} mm** apart;",
        f"- outer edges of UL↔LL (and UR↔LR): **{b.mat_height:g} mm** apart;",
        "- keep all four blocks flat and coplanar (the homography assumes a "
        "plane), and keep the whole rectangle in frame.",
        "",
        "Blocks do not draw the grid, the wires or the qubit labels — only the "
        "corners. The circuit still reads left → right from the UL/LL side. If "
        "you want the printed guides, use the mat (`qamposer-assets board`).",
        "",
    ]
    path = out_dir / "corners.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def write_mono_batch_md(
    mono_md: Path,
    infos: list[MonoBatchInfo],
    *,
    bed: Bed,
    spacing: float,
    faces: str,
    height: float,
    params: HardwareParams | None = None,
    max_per_bed: int | None = None,
) -> Path:
    """Append a **Print jobs (mono)** section to ``mono.md`` — one bed per form.

    No provenance stamp here: :func:`write_mono_md` already put one under the
    H1, and a second would read as a contradiction.
    """
    params = params or HardwareParams()
    r = params.mono_raise_height
    cols = infos[0].cols if infos else 0
    rows = infos[0].rows if infos else 0
    swap_z = r + height if faces == "double" else height
    lines: list[str] = [
        "",
        "---",
        "",
        "## Print jobs (mono)",
        "",
        f"Bed **{bed.width:g} × {bed.height:g} mm**, piece footprint "
        f"**{FOOTPRINT:g} × {FOOTPRINT:g} mm** + **{spacing:g} mm** spacing → "
        f"**{cols} × {rows} = {cols * rows}** pieces per bed. The two forms "
        "**never share a bed**: each is packed onto its own numbered beds, so a "
        "whole bed is one recipe.",
        "",
        f"- `mono-recessed-batch*.3mf` — print in one filament, then paint the "
        f"{params.mono_pocket_depth:g} mm wells.",
        f"- `mono-raised-batch*.3mf` — **one filament swap at Z = "
        f"{swap_z:.3f} mm** switches every piece on the bed from the body "
        f"colour to the art colour. That is the accent layer height: the art "
        f"stands a uniform {r:g} mm proud of the "
        f"{height:g} mm body, so a single M600 does the whole plate.",
        "",
    ]
    if faces == "double":
        lines += [
            f"> Double-faced raised pieces have art on **both** faces, so they "
            f"take the two-swap recipe above ({r:.3f} mm and {swap_z:.3f} mm) — "
            "still the same two swaps for every piece on the bed.",
            "",
        ]
    if max_per_bed is not None and max_per_bed < cols * rows:
        lines += [
            f"> Beds are capped at **{max_per_bed}** pieces and anchored "
            "front-left, matching the coloured plates. Mono needs no wipe "
            "tower, so raise the cap (`--max-per-plate 0`) to fill the bed.",
            "",
        ]
    for info in infos:
        lines.append(
            f"### `{info.path.name}` — {info.form}, batch {info.batch}"
        )
        lines.append("")
        lines.append(
            f"{len(info.slugs)} piece(s), {info.object_count} object(s): "
            + ", ".join(f"`{s}`" for s in info.slugs)
        )
        lines.append("")
        lines.extend(_ascii_layout(info))
        lines.append("")
    with mono_md.open("a", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    return mono_md
