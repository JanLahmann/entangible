"""Write tile solids to disk: per-colour STL parts, a coloured 3MF, and plates.md.

Per-colour STLs share one coordinate frame so PrusaSlicer's "import as single
object with parts" reassembles the tile with each part on its own filament. The
3MF needs no such reassembly: every piece is written as **one object whose parts
are already on the right filament slot** — PrusaSlicer reads that from the
``Metadata/Slic3r_PE_model.config`` part, other slicers read the same colours
off the 3MF base materials the triangles point at (see :class:`_ProjectMesher`).
"""

from __future__ import annotations

import copy
import ctypes
import datetime as _datetime
import functools
import subprocess
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

import lib3mf
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
    build_measure_block,
    build_qubit_wire_block,
    build_tile,
)
from .face import (
    CORNER_LABEL_BY_ROLE,
    MEASURE_BLOCK_COPIES,
    MEASURE_BLOCK_ID,
    MEASURE_BLOCK_SLUG,
    QUBIT_WIRE_COPIES,
    QUBIT_WIRE_ID,
    QUBIT_WIRE_SLUG,
    WIRE_STROKE_MM,
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
    "export_tile_bw_3mf",
    "export_double_tile_stls",
    "export_double_tile_3mf",
    "export_double_tile_bw_3mf",
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
    "furniture_ids",
    "export_mono_batches",
    "export_bw_batches",
    "write_batch_plates_md",
    "write_corner_plates_md",
    "write_corners_md",
    "write_mono_batch_md",
    "write_bw_md",
    "write_bw_batch_md",
    "bw_part_color",
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


#: Board-furniture ``GateSpec.gate`` -> plate slug. Furniture carries no gate
#: type, so its ``gate`` field is a bare family name (see
#: :func:`qamposer_assets.qubit_wire_block.qubit_wire_spec` and
#: :func:`qamposer_assets.measure_block.measure_block_spec`); keying on that
#: rather than on the literal ``kind`` string keeps the slugs stable whatever
#: the marker table ends up calling the two families.
_FURNITURE_SLUGS: dict[str, str] = {
    "QWIRE": QUBIT_WIRE_SLUG,
    "QMEASURE": MEASURE_BLOCK_SLUG,
}


def tile_slug(spec: GateSpec) -> str:
    """Filename-safe identifier for a gate tile or board-furniture block.

    ASCII, lower case. Raises ``ValueError`` for a furniture family with no slug
    — a new block must claim its own filename rather than silently land on
    another family's plate.
    """
    if spec.kind == "corner":
        return CORNER_LABEL_BY_ROLE[spec.role or ""].lower()
    if spec.kind != "gate":
        try:
            return _FURNITURE_SLUGS[spec.gate]
        except KeyError:
            raise ValueError(
                f"unknown board-furniture family {spec.gate!r} — add it to "
                "_FURNITURE_SLUGS"
            ) from None
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

    The order the materials are added in *is* the filament-slot order the kit
    documents: white (slot 1), black (slot 2), then the plate's accents in
    plates.md table order. Deduped by hex — a colour never claims two slots —
    and named by colour, not by part, so a logical colour lands on the same slot
    on every plate. lib3mf assigns property ids 1, 2, 3… in add order, so
    white=1 and black=2 by construction and a property id *is* its 1-based
    PrusaSlicer extruder number.

    Base materials alone do **not** assign filaments in PrusaSlicer: it ignores
    a generic 3MF's ``<basematerials>`` for extruder mapping and cycles its
    loaded filaments over the objects instead. The slot assignment is carried by
    the ``Metadata/Slic3r_PE_model.config`` part :class:`_ProjectMesher` writes;
    this group is what *other* slicers (Bambu Studio, OrcaSlicer, the 3MF
    viewers) read to show the piece in its real colours, via the per-triangle
    properties that point back into it.
    """

    def __init__(self, mesher: Mesher, accents: list[str], name_accent) -> None:
        self._mesher = mesher
        self._group = mesher.model.AddBaseMaterialGroup()
        self.resource_id = self._group.GetResourceID()
        self._pid_by_hex: dict[str, int] = {}
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

    def property_id(self, hex_color: str) -> int:
        """lib3mf property id of ``hex_color`` — also its 1-based filament slot."""
        return self._pid_by_hex[hex_color.lower()]


# --------------------------------------------------------------------------- #
# One 3MF object per *piece*, its colour parts as PrusaSlicer "volumes"
# --------------------------------------------------------------------------- #
#
# PrusaSlicer only reads filament assignments out of its own project part,
# ``Metadata/Slic3r_PE_model.config``: one ``<object>`` per logical piece, whose
# parts are consecutive triangle ranges (``<volume firstid=… lastid=…>``) each
# carrying ``<metadata type="volume" key="extruder" value="N"/>``. That shape is
# only expressible if a piece is ONE mesh, so every writer here merges a piece's
# solids into a single lib3mf mesh object and remembers where each part's
# triangles start and end.
#
# Verified against PrusaSlicer 2.9.6 (``--export-3mf`` of a hand-built file,
# re-exported and re-read): it *requires* the ``.config`` part to be named
# exactly ``Metadata/Slic3r_PE_model.config`` and its ``<object id=…>`` to match
# the ``<object id=…>`` in ``3D/3dmodel.model``; it *tolerates* a missing
# ``[Content_Types].xml`` entry for the part (its own packages omit one too), a
# missing ``slic3rpe:Version3mf`` metadata, lib3mf's production-extension
# ``p:UUID`` attributes, and the ``source_file``/``mesh`` bookkeeping it writes
# itself. No print/filament configuration is shipped, on purpose: the file must
# open on the user's own printer and filament presets.

#: The meshing tolerances ``Mesher.add_shape`` applies. Merging a piece's parts
#: into one mesh means calling build123d's meshing helpers directly, so the
#: defaults have to be repeated here — a different value would silently change
#: every exported surface.
_LINEAR_DEFLECTION = 0.001
_ANGULAR_DEFLECTION = 0.1

#: The 3MF part PrusaSlicer reads its per-part filament assignment from.
MODEL_CONFIG_PART = "Metadata/Slic3r_PE_model.config"


@dataclass(slots=True)
class _Volume:
    """One colour part of a piece: a triangle range plus its filament slot."""

    name: str
    extruder: int
    first: int
    last: int


@dataclass(slots=True)
class _ObjectConfig:
    """One logical piece: its 3MF object id, its name and its parts."""

    id: int
    name: str
    volumes: list[_Volume]


class _ProjectMesher:
    """Writes a 3MF that PrusaSlicer opens as a ready-made multi-material project.

    One :meth:`add_piece` call per physical piece: its colour parts become the
    parts ("volumes") of a single object, each pre-assigned to the filament slot
    its colour holds in the shared :class:`_MaterialPalette`. The same colours
    are written as per-triangle 3MF properties, so a slicer that never heard of
    PrusaSlicer's project part still opens the piece in colour.
    """

    def __init__(self, accents: list[str], name_accent) -> None:
        self._mesher = Mesher()
        self._palette = _MaterialPalette(self._mesher, list(accents), name_accent)
        self._objects: list[_ObjectConfig] = []

    def add_piece(
        self,
        name: str,
        parts: list[tuple[str, str, object]],
        offset: tuple[float, float] = (0.0, 0.0),
    ) -> int:
        """Add one piece: ``parts`` is ``(part name, colour hex, solid)`` in print order.

        A part is frequently *several* solids — the accent of a tile whose
        caption has a closed counter (the ``R`` of ``RX``, the ``O`` of
        ``CONTROL``) leaves that counter standing as an island, a double piece's
        marker spans two faces, a multi-glyph cube side label is one solid per
        glyph. All of them belong to one part, so all of them land in one
        triangle range and print on one filament.

        ``offset`` translates the whole piece onto its bed position. Returns the
        number of parts actually written (a part that meshes to nothing — a
        degenerate sliver — contributes no volume and is skipped rather than
        emitting an empty triangle range PrusaSlicer would choke on).
        """
        dx, dy = offset
        vertices: list = []
        triangles: list = []
        volumes: list[_Volume] = []
        for part_name, hex_color, solid in parts:
            shape = Pos(dx, dy, 0.0) * solid if (dx or dy) else solid
            # build123d's own meshing path, called directly: add_shape would
            # emit one *object* per solid, which is exactly what PrusaSlicer
            # then hands to a different filament each.
            ocp_vertices, ocp_triangles = Mesher._mesh_shape(
                copy.deepcopy(shape), _LINEAR_DEFLECTION, _ANGULAR_DEFLECTION
            )
            if len(ocp_vertices) < 3 or not ocp_triangles:
                continue
            verts_3mf, tris_3mf = Mesher._create_3mf_mesh(ocp_vertices, ocp_triangles)
            if not tris_3mf:
                continue
            base = len(vertices)
            for tri in tris_3mf:  # re-index onto the merged vertex list
                indices = tri.Indices
                indices[0] += base
                indices[1] += base
                indices[2] += base
            first = len(triangles)
            vertices.extend(verts_3mf)
            triangles.extend(tris_3mf)
            volumes.append(
                _Volume(
                    name=part_name,
                    extruder=self._palette.property_id(hex_color),
                    first=first,
                    last=len(triangles) - 1,
                )
            )
        if not volumes:
            return 0

        mesh = self._mesher.model.AddMeshObject()
        mesh.SetGeometry(vertices, triangles)
        mesh.SetName(name)
        if not mesh.IsValid():
            raise RuntimeError("3mf mesh is invalid")
        # The object-level property is the piece's first part (its white body):
        # lib3mf then writes a per-triangle ``pid``/``p1`` only where a triangle
        # differs from it, which keeps the file roughly the size it was.
        rid = self._palette.resource_id
        mesh.SetObjectLevelProperty(rid, volumes[0].extruder)
        props = []
        for vol in volumes:
            prop = lib3mf.TriangleProperties(
                rid, (ctypes.c_uint32 * 3)(vol.extruder, vol.extruder, vol.extruder)
            )
            props.extend([prop] * (vol.last - vol.first + 1))
        mesh.SetAllTriangleProperties(props)
        self._mesher.model.AddBuildItem(mesh, self._mesher.wrapper.GetIdentityTransform())
        self._objects.append(
            _ObjectConfig(id=mesh.GetResourceID(), name=name, volumes=volumes)
        )
        return len(volumes)

    def write(self, path: Path) -> int:
        """Write the 3MF and append PrusaSlicer's project part. Returns part count."""
        _stamp_3mf(self._mesher, path.stem)
        self._mesher.write(str(path))
        _inject_model_config(path, self._objects)
        return sum(len(obj.volumes) for obj in self._objects)


def _inject_model_config(path: Path, objects: list[_ObjectConfig]) -> None:
    """Append ``Metadata/Slic3r_PE_model.config`` to an already-written 3MF.

    lib3mf has no notion of PrusaSlicer's project part, so it is added to the
    finished package with :mod:`zipfile`. Volume matrices are the identity: the
    parts are already in their object's coordinates (the bed offset is baked
    into the geometry), so PrusaSlicer has nothing left to transform.
    """
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>"]
    for obj in objects:
        lines.append(f' <object id="{obj.id}" instances_count="1">')
        lines.append(f'  <metadata type="object" key="name" value="{_attr(obj.name)}"/>')
        for vol in obj.volumes:
            lines.append(f'  <volume firstid="{vol.first}" lastid="{vol.last}">')
            lines.append(
                f'   <metadata type="volume" key="name" value="{_attr(vol.name)}"/>'
            )
            lines.append('   <metadata type="volume" key="volume_type" value="ModelPart"/>')
            lines.append(
                '   <metadata type="volume" key="matrix"'
                ' value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>'
            )
            lines.append(
                f'   <metadata type="volume" key="extruder" value="{vol.extruder}"/>'
            )
            lines.append("  </volume>")
        lines.append(" </object>")
    lines.append("</config>")
    with zipfile.ZipFile(path, "a", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(MODEL_CONFIG_PART, "\n".join(lines) + "\n")


def _attr(value: str) -> str:
    """XML-escape a value for an attribute (part names carry ``+`` and ``&``)."""
    return xml_escape(value, {'"': "&quot;"})


def _hex_rgb01(hex_color: str) -> tuple[float, float, float]:
    h = hex_color.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore[return-value]


def _part_color_hex(role: str, layout) -> str:
    if role == "body":
        return WHITE_HEX
    if role == "marker":
        return BLACK_HEX
    return layout.accent_hex


def bw_part_color(role: str) -> tuple[str, str]:
    """``(hex, colour name)`` this part takes in the **black + white** kit.

    The whole point of the b/w route: the geometry is the coloured kit's, but
    only two filaments exist. The white body keeps slot 1 and *everything else*
    — marker, frame, band, cube side letters, a double piece's second-face
    accent — collapses onto the marker black in slot 2. That is exactly two
    filaments, whatever the gate.

    The band caption needs no rule of its own: its glyphs are **cut out** of the
    accent and left standing in the white body (see :mod:`.build`), so mapping
    the accent to black turns the white-on-colour caption into white-on-black
    without touching a single solid.
    """
    if role == "body":
        return WHITE_HEX, "white"
    return BLACK_HEX, "black"


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

    One object, one part per colour, each already on its filament slot. Returns
    the path, or ``None`` if the 3MF backend is unavailable.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = tile_slug(parts.layout.spec)
    path = out_dir / f"{slug}.3mf"
    try:
        # One shared palette: white, black, then this tile's single accent.
        writer = _ProjectMesher([parts.layout.accent_hex], accent_color_name)
        writer.add_piece(
            slug,
            [
                (
                    f"{slug}-{role}-{color_name}",
                    _part_color_hex(role, parts.layout),
                    solid,
                )
                for role, color_name, solid in parts.named_parts()
            ],
        )
        writer.write(path)
    except (RuntimeError, ValueError):
        # lib3mf rejects a mesh it considers non-manifold; the per-colour STLs
        # are still written, so 3MF is genuinely best-effort here.
        if path.exists():
            path.unlink()
        return None
    return path


def _write_piece_bw_3mf(
    slug: str, roles: list[tuple[str, object]], out_dir: Path
) -> Path | None:
    """Write ``<slug>-bw.3mf``: the same solids, on white + black only.

    ``roles`` is ``(role, solid)`` in print order. The palette holds **no**
    accent at all, so the 3MF a slicer opens has exactly two base materials and
    the file can be printed on a two-filament machine with nothing switched off.
    Returns ``None`` if lib3mf rejects the mesh, exactly like the coloured
    writers — the b/w form is an extra file, never a reason for a run to fail.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{slug}-bw.3mf"
    try:
        writer = _ProjectMesher([], accent_color_name)
        parts = []
        for role, solid in roles:
            hexc, cname = bw_part_color(role)
            parts.append((f"{slug}-{role}-{cname}", hexc, solid))
        writer.add_piece(slug, parts)
        writer.write(path)
    except (RuntimeError, ValueError):
        if path.exists():
            path.unlink()
        return None
    return path


def export_tile_bw_3mf(parts: TileParts, out_dir: Path) -> Path | None:
    """Write the black + white twin of a single-faced tile's coloured 3MF.

    Same slug, same geometry, ``-bw`` suffix — the per-colour STLs are not
    duplicated, because the *parts* are identical and only the palette differs.
    """
    slug = tile_slug(parts.layout.spec)
    return _write_piece_bw_3mf(
        slug, [(role, solid) for role, _cn, solid in parts.named_parts()], out_dir
    )


def export_double_tile_bw_3mf(parts: DoubleTileParts, out_dir: Path) -> Path | None:
    """Write the black + white twin of a double-faced piece's coloured 3MF.

    A cross-family double piece is the case that pays: its two accents (one per
    face) both land on the same black, so the piece that needed *four* filaments
    needs two.
    """
    slug = double_slug(parts.layout_a.spec, parts.layout_b.spec)
    return _write_piece_bw_3mf(
        slug, [(role, solid) for role, _cn, _hex, solid in parts.named_parts()], out_dir
    )


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
    try:
        # White, black, then this piece's accents (1 same-family, 2 cross-family)
        # in named_parts order; double_color_name tells the two blues apart.
        writer = _ProjectMesher([h for h, _ in parts.accents], double_color_name)
        writer.add_piece(
            slug,
            [
                (f"{slug}-{role}-{color_name}", hexc, solid)
                for role, color_name, hexc, solid in parts.named_parts()
            ],
        )
        writer.write(path)
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
        "The bundled `<tile>.3mf` needs no assignment at all: it opens as one "
        "object whose parts are **already on the slots above** — load the "
        "filaments in that order and slice. The STL route is the manual one: the "
        "parts (`*-body-white.stl`, `*-marker-black.stl`, `*-accent-<colour>.stl`) "
        "share one coordinate frame, so select them in PrusaSlicer, *Right-click "
        "→ Import as single object / parts*, then assign each part to its slot."
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
        "The bundled `<a>+<b>.3mf` needs no assignment at all: it opens as one "
        "object whose parts are **already on the slots above**, both accents of a "
        "cross-family piece included. The STL route is the manual one: the parts "
        "(`*-body-white.stl`, `*-marker-black.stl`, and one "
        "`*-accent-<colour>.stl` **per accent colour**) share one coordinate "
        "frame, so select them in PrusaSlicer, *Right-click → Import as single "
        "object / parts*, then assign each part to its slot."
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
    object_count: int  # coloured parts in the 3MF (one object per piece)
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
    mid: int,
    config: AssetsConfig,
    variant: str,
    height: float,
    params: HardwareParams,
    *,
    bw: bool = False,
) -> _Piece:
    parts = build_tile(mid, config, variant=variant, height=height, params=params)
    slug = tile_slug(parts.layout.spec)
    cp = []
    for role, cn, solid in parts.named_parts():
        hexc, cn = bw_part_color(role) if bw else (_part_color_hex(role, parts.layout), cn)
        cp.append(_ColoredPart(hexc, f"{slug}-{role}-{cn}", solid))
    return _Piece(slug, cp)


def _double_piece(
    a: int,
    b: int | None,
    config: AssetsConfig,
    variant: str,
    height: float,
    params: HardwareParams,
    *,
    bw: bool = False,
) -> _Piece:
    parts = build_double_tile(a, b, config, variant=variant, height=height, params=params)
    mb = a if b is None else b
    slug = double_slug(MARKER_TABLE[a], MARKER_TABLE[mb])
    cp = []
    for role, cn, hexc, solid in parts.named_parts():
        hexc, cn = bw_part_color(role) if bw else (hexc, cn)
        cp.append(_ColoredPart(hexc, f"{slug}-{role}-{cn}", solid))
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
    ``footprint/2``); it is translated so that centre lands on its bed position,
    and becomes **one** 3MF object whose parts are its colour parts. Every part
    points at the batch's one shared palette — white, black, then the plate's
    ``accents`` (in plates.md order) so a colour keeps its slot across every
    batch of the plate. Returns the number of coloured parts written (one per
    colour part, however many disconnected islands it is made of).
    """
    writer = _ProjectMesher(
        accents if accents is not None else _batch_accents(pieces), name_accent
    )
    for piece, (cx, cy) in zip(pieces, positions):
        writer.add_piece(
            piece.slug,
            [(part.name, part.hex, part.solid) for part in piece.parts],
            offset=(cx - footprint / 2.0, cy - footprint / 2.0),
        )
    return writer.write(path)


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
# Black + white plates — two filaments, so the bed is the only constraint
# --------------------------------------------------------------------------- #
#
# The coloured kit splits into *filament* plates first (white + black + ≤3
# accents per plate) and packs each plate onto beds second, so a plate holding a
# single tile still costs a whole print job. The b/w kit has no accent slots to
# compete over — every piece is the same two filaments — so the filament plate
# stops existing and the pieces pack straight onto beds. That is where the
# "fewer print jobs" comes from: nothing rounds up to a plate boundary any more.


def _bw_members(
    *,
    faces: str,
    kit: list[tuple[int, int | None, int]] | None,
    ids: list[int] | None,
) -> list:
    """Every physical piece of the kit, in one flat list — no plate grouping.

    Double quantities are expanded here (a ``qty`` of 4 is four pieces on the
    beds), exactly as the mono beds do it.
    """
    if faces == "double":
        source = kit if kit is not None else DOUBLE_FACED_KIT
        return [(a, b) for a, b, qty in source for _ in range(qty)]
    return [mid for mid, _spec in _gate_tiles()] if ids is None else list(ids)


def export_bw_batches(
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
) -> list[BatchInfo]:
    """Write bed-ready ``bw-batch*.3mf`` — the whole kit on two filaments.

    Every piece of the kit appears **exactly once**, packed purely by bed
    capacity (and ``max_per_bed``, which still applies: a two-filament print
    purges too, just far less than an MMU one). Board furniture is deliberately
    absent — it is already white + black and ships on its own ``corners-batch*``
    plate, so a b/w duplicate of it would be the same file under another name.
    """
    params = params or HardwareParams()
    members = _bw_members(faces=faces, kit=kit, ids=ids)

    def build(member):
        if faces == "double":
            a, b = member
            return _double_piece(a, b, config, variant, height, params, bw=True)
        return _single_piece(member, config, variant, height, params, bw=True)

    return _export_batches(
        build,
        [members],
        bed,
        spacing,
        out_dir,
        plate_accents=[[]],
        max_per_bed=max_per_bed,
        stem_fmt="bw-batch{batch}",
    )


# --------------------------------------------------------------------------- #
# Board furniture — an opt-in extra plate (white + black only)
# --------------------------------------------------------------------------- #
#
# One family, one plate, one ``--corners`` flag: the four corner blocks (IDs
# 0-3), the five identical qubit-wire blocks (all ID 46) and the five identical
# measurement blocks (all ID 47) are the pieces that make a bare table into a
# board. Fourteen pieces, none of them carrying a gate colour — every mark is
# the marker black that slot 2 already holds — so the plate needs no accent
# filament and can never disturb the gate plates' slots.


def furniture_ids() -> list[int]:
    """Every board-furniture piece, one entry per **physical block**.

    The four corner blocks, then :data:`QUBIT_WIRE_COPIES` copies of the one
    wire-block design and :data:`MEASURE_BLOCK_COPIES` copies of the one
    measurement-block design — both families are identical by design (their
    *count* and position are the signal), so each ID simply repeats.
    """
    return (
        corner_block_ids()
        + [QUBIT_WIRE_ID] * QUBIT_WIRE_COPIES
        + [MEASURE_BLOCK_ID] * MEASURE_BLOCK_COPIES
    )


def _furniture_parts(
    mid: int, config: AssetsConfig, variant: str, height: float, params: HardwareParams
) -> TileParts:
    """Build one board-furniture block — a corner, wire or measurement block."""
    if mid == QUBIT_WIRE_ID:
        return build_qubit_wire_block(
            config, variant=variant, height=height, params=params
        )
    if mid == MEASURE_BLOCK_ID:
        return build_measure_block(
            config, variant=variant, height=height, params=params
        )
    return build_corner_block(
        mid, config, variant=variant, height=height, params=params
    )


def _corner_piece(
    mid: int, config: AssetsConfig, variant: str, height: float, params: HardwareParams
) -> _Piece:
    parts = _furniture_parts(mid, config, variant, height, params)
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
    """Write bed-ready batch 3MFs for the board-furniture set.

    Fourteen blocks by default (:func:`furniture_ids`: four corners + five wire
    blocks + five measurement blocks), which at the default 8-piece wipe-tower
    cap is two beds — ``corners-batch1`` (8) and ``corners-batch2`` (6). Their
    own plate: every mark prints in the marker black that slot 2 already holds,
    so the plate needs **no accent filament** and can never disturb the gate
    plates' slot assignment.
    """
    params = params or HardwareParams()
    members = furniture_ids() if ids is None else list(ids)
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
        # One entry per physical furniture block, so the five identical wire
        # blocks really do get five pieces on the mono beds.
        for mid in furniture_ids():
            parts = _furniture_parts(mid, config, variant, height, params)
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
        "multi-piece coloured 3MF — one object per piece, every part already on "
        "the plate's slot above, so it opens ready to slice. "
        f"{len(infos)} batch file(s), {total_pieces} pieces total.",
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
            f"{len(info.slugs)} piece(s), {info.object_count} coloured parts: "
            + ", ".join(f"`{s}`" for s in info.slugs)
        )
        lines.append("")
        lines.extend(_ascii_layout(info))
        lines.append("")

    with base_md.open("a", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    return base_md


def write_corner_plates_md(base_md: Path, infos: list[BatchInfo]) -> Path:
    """Append the **board-furniture** plate section to an existing ``plates.md``.

    Its own plate because it needs no accent filament at all — white bodies,
    black markers, black art. Appended (never inserted) so the numbered gate
    plates above keep the exact slot assignment they had without ``--corners``.
    """
    lines: list[str] = [
        "",
        "---",
        "",
        "## Plate — board furniture: corner, qubit-wire + measurement blocks (opt-in)",
        "",
        "| Slot | Filament | Hex |",
        "| ---- | -------- | --- |",
        f"| 1 | white (bodies) | `{WHITE_HEX}` |",
        f"| 2 | black (markers + art) | `{BLACK_HEX}` |",
        "",
        f"{len(corner_block_ids())} corner blocks replace the printed board mat, "
        f"{QUBIT_WIRE_COPIES} identical qubit-wire blocks (`{QUBIT_WIRE_SLUG}`) "
        "set how many qubits the board plays, and "
        f"{MEASURE_BLOCK_COPIES} identical measurement blocks "
        f"(`{MEASURE_BLOCK_SLUG}`) mark where those wires end. They carry **no "
        "gate colour**: the UL/UR/LL/LR labels, the wire lines, the gauges and "
        "the side art all print in the same black as the marker, so this plate "
        "needs only two filaments and the gate plates above keep their slots "
        "unchanged.",
        "",
        "See `corners.md` for which block goes where and which way up.",
        "",
    ]
    for info in infos:
        lines.append(f"### `{info.path.name}` — board furniture, batch {info.batch}")
        lines.append("")
        lines.append(
            f"{len(info.slugs)} block(s), {info.object_count} coloured parts: "
            + ", ".join(f"`{s}`" for s in info.slugs)
        )
        lines.append("")
        lines.extend(_ascii_layout(info))
        lines.append("")
    with base_md.open("a", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    return base_md


# --------------------------------------------------------------------------- #
# plates.md — the black + white section
# --------------------------------------------------------------------------- #

#: One heading for both b/w writers, so `generate --bw` and `plates --bw`
#: contribute to the *same* section of plates.md rather than two rival ones.
_BW_HEADING = "## Black + white kit — two filaments"


def _bw_intro_lines(faces: str) -> list[str]:
    """The prose both ``--bw`` writers share: what it is, who it is for, the cost."""
    piece = "double-faced piece" if faces == "double" else "tile"
    accents = (
        "a cross-family double piece needs two accent filaments on top of white "
        "and black, and the kit as a whole needs every gate family's colour"
        if faces == "double"
        else "the coloured kit needs one accent filament per gate family on top "
        "of white and black"
    )
    return [
        "| Slot | Filament | Hex |",
        "| ---- | -------- | --- |",
        f"| 1 | white (bodies + band captions) | `{WHITE_HEX}` |",
        f"| 2 | black (markers, frame, band, side letters) | `{BLACK_HEX}` |",
        "",
        f"Every `<piece>-bw.3mf` is the coloured {piece}'s **exact geometry** "
        "with one palette change: the accent — frame, band, cube side letters, "
        "and both faces of a double piece — is mapped onto the same black as the "
        f"marker. Two filaments, whatever the gate, where {accents}.",
        "",
        "**The band caption still reads.** Its glyphs are cut *out* of the accent "
        "and left standing in the white body, so mapping the accent to black "
        "turns white-on-colour into **white-out-of-black** — no geometry changes, "
        "and the gate name stays legible across the table.",
        "",
        "### Which printers this is for",
        "",
        "- **Two material slots is the whole requirement**: a dual-extruder or "
        "IDEX machine, a toolchanger, or an MMU/AMS with just two filaments "
        "loaded. You never need the 5-slot MMU, and you never buy the gate "
        "palette's accent filaments to print one kit.",
        "- **White and black share the top layers** (the marker sits next to the "
        "white field, the caption stands inside the black band), so this is not a "
        "single-filament route: a colour change at one Z cannot produce it. A "
        "printer with one nozzle and one filament wants the mono forms in "
        "`mono.md` instead — recessed paint wells, or raised art with a swap.",
        "",
        "### What it costs you",
        "",
        "Colour is one of the kit's two ways of telling gate families apart, and "
        "the b/w kit spends it: H, X, Y, Z and the rotations all print in the "
        "same black. What still distinguishes them is everything the camera uses "
        "anyway — the **marker** (the detector never reads colour), the **band "
        "caption**, the **cube side letters** and the rotation **notches**. So "
        "sorting a heap of tiles by eye is slower, and the board reads exactly as "
        "well.",
        "",
        "Board furniture is **not** duplicated here: the corner, qubit-wire and "
        "measurement blocks are already white + black in the coloured kit (their "
        "labels, wires and gauges print in marker black), so their existing files "
        "are the b/w files — a `-bw` twin would be the same solid under a second "
        "name.",
        "",
    ]


def write_bw_md(base_md: Path, *, faces: str) -> Path:
    """Append the **Black + white kit** section to a generated ``plates.md``.

    The ``generate --bw`` half: it documents the per-piece ``<slug>-bw.3mf``
    files that sit beside the coloured ones. No provenance stamp — the base
    writer already put one under the H1.
    """
    lines = ["", "---", "", _BW_HEADING, "", *_bw_intro_lines(faces)]
    lines += [
        "Every piece ships a `<piece>-bw.3mf` next to its coloured `<piece>.3mf`, "
        "with its parts already on slot 1 (white) and slot 2 (black). The "
        "per-colour STL parts are **not** duplicated: the parts are identical and "
        "only the palette differs, so if you assemble from STLs simply send the "
        "accent part to the black slot.",
        "",
        "Run `plates --bw` for bed-ready `bw-batch*.3mf` files.",
        "",
    ]
    with base_md.open("a", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    return base_md


def write_bw_batch_md(
    base_md: Path,
    infos: list[BatchInfo],
    *,
    bed: Bed,
    spacing: float,
    faces: str,
    variant: str,
    max_per_bed: int | None = None,
    colored_jobs: int | None = None,
) -> Path:
    """Append the **Black + white kit** section, with its print jobs, to ``plates.md``.

    The ``plates --bw`` half. ``colored_jobs`` is how many batch files the
    coloured kit needed for the same pieces; when it is given (and larger) the
    section says so with the actual numbers, because "fewer print jobs" is the
    reason to choose this route and it should not be a claim the reader has to
    count out by hand.
    """
    cols = infos[0].cols if infos else 0
    rows = infos[0].rows if infos else 0
    total_pieces = sum(len(i.slugs) for i in infos)
    lines = ["", "---", "", _BW_HEADING, "", *_bw_intro_lines(faces)]
    lines += [
        "### Print jobs (black + white)",
        "",
        f"Bed **{bed.width:g} × {bed.height:g} mm**, piece footprint "
        f"**{FOOTPRINT:g} × {FOOTPRINT:g} mm** + **{spacing:g} mm** spacing → "
        f"**{cols} × {rows} = {cols * rows}** pieces per bed. There are no accent "
        "slots to compete over, so the filament plates above do not apply: the "
        f"kit packs straight onto beds. {len(infos)} job(s), {total_pieces} "
        "pieces total.",
        "",
    ]
    if colored_jobs is not None and colored_jobs > len(infos):
        lines += [
            f"> **Fewer jobs.** The same {total_pieces} pieces need "
            f"**{colored_jobs}** coloured batch files but only **{len(infos)}** "
            "here. A coloured filament plate is packed on its own, so a plate "
            "holding one leftover tile still costs a whole print job; with two "
            "filaments nothing rounds up to a plate boundary.",
            "",
        ]
    if max_per_bed is not None and max_per_bed < cols * rows:
        lines += [
            f"> Beds are capped at **{max_per_bed}** pieces and anchored "
            "front-left, matching the coloured plates. A two-filament print "
            "purges far less than a 5-slot MMU one but still purges, so the free "
            "rear/right corner is the tower's — raise the cap "
            "(`--max-per-plate 0`) only if your machine wipes elsewhere.",
            "",
        ]
    if variant == "cube":
        lines += [
            "> **Cube kit:** the side letters are black here rather than a gate "
            "accent, so a b/w cube bed purges **one** colour boundary per layer "
            "band instead of several — the variant where two filaments save the "
            "most time and material.",
            "",
        ]
    for info in infos:
        lines.append(f"### `{info.path.name}` — black + white, batch {info.batch}")
        lines.append("")
        lines.append(
            f"{len(info.slugs)} piece(s), {info.object_count} coloured parts: "
            + ", ".join(f"`{s}`" for s in info.slugs)
        )
        lines.append("")
        lines.extend(_ascii_layout(info))
        lines.append("")
    with base_md.open("a", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    return base_md


def _qubit_wire_md_lines(config: AssetsConfig) -> list[str]:
    """The qubit-wire-block section of ``corners.md``.

    Everything a user needs to turn a pile of identical blocks into a qubit
    count: how many to print, where they go, which one is ``q1``, and how far
    apart. The numbers are read from ``assets.toml`` (the row pitch, the tile
    size) so this text can never quote a stale spacing.
    """
    b = config.board
    size = config.tile.size
    return [
        "---",
        "",
        "## Qubit-wire blocks — how many qubits the board plays",
        "",
        f"All {QUBIT_WIRE_COPIES} wire blocks are the **same piece** "
        f"(`{QUBIT_WIRE_SLUG}`, marker ID {QUBIT_WIRE_ID}) — one design, printed "
        "up to five times. They are not gates and they are not corners: they are "
        "furniture, and it is *how many you lay down* that matters.",
        "",
        f"- **Print 3-5 copies** (five is the full set — the board tops out at "
        f"{b.rows} qubits).",
        "- Lay them along the board's **left edge**, between the `UL` and `LL` "
        "corner blocks, one per qubit you want. Lay **none** and the board falls "
        f"back to the classic {b.rows} wires.",
        "- The blocks are read **top → bottom**: the topmost block is **q1**, "
        "the next one down q2, and so on. Their vertical positions are what set "
        "the wire heights, so put each block at the height you want its wire.",
        f"- Keep block centres **at least {b.pitch:g} mm apart** — the board's "
        f"own row pitch. The blocks are {size:g} mm square, so {b.pitch:g} mm "
        f"centres leave a {b.pitch - size:g} mm gap and no two wires can be "
        "mistaken for one.",
        "",
        "### Reading the face",
        "",
        f"The marker is the standard {config.tile.marker_size:g} mm tile marker "
        "and it is centred, so the **marker's centre is the block's centre** — "
        "and that is exactly the height of the wire the block declares. Centre "
        "the block on the row and the wire is on the row; there is no offset to "
        "remember, and a block turned 180° still declares the same wire.",
        "",
        f"The **wire line** is the {WIRE_STROKE_MM:g} mm black bar at "
        "mid-height. It runs into both edges of the block and passes behind the "
        "marker (ink cannot enter the marker's quiet zone, exactly as on a "
        "circuit diagram where the wire disappears into a gate box) — so line up "
        "the *bar*, edge to edge, with the row's wire. The small **q** sits just "
        "above the bar on the block's inner (right) edge, the side the circuit "
        "runs off towards. On a cube-height block the bar and the q are repeated "
        "on all four vertical faces, so the wire reads from any seat.",
        "",
    ]


def _measure_block_md_lines(config: AssetsConfig) -> list[str]:
    """The measurement-block section of ``corners.md``.

    The right-edge counterpart of :func:`_qubit_wire_md_lines`, and the section
    that has to make one thing unmistakable: these blocks are **optional**, and
    they never create a wire. Numbers are read from ``assets.toml`` so the text
    can never quote a stale pitch or tile size.
    """
    b = config.board
    size = config.tile.size
    return [
        "---",
        "",
        "## Measurement blocks — where the wires end (optional)",
        "",
        f"All {MEASURE_BLOCK_COPIES} measurement blocks are the **same piece** "
        f"(`{MEASURE_BLOCK_SLUG}`, marker ID {MEASURE_BLOCK_ID}) — one design, "
        "printed up to five times. They are the mirror of the qubit-wire "
        "blocks: lay them along the board's **right edge**, between the `UR` "
        "and `LR` corner blocks, and the table reads like a circuit diagram — "
        "state prep on the left, measurement on the right.",
        "",
        "- **They are optional.** A wire exists because its *left* block "
        "exists; a measurement block only says where that wire **ends**. Lay "
        "none and nothing changes.",
        "- **Pair them by height.** Put each measurement block level with the "
        "wire block it belongs to. The app pairs each right block with the "
        "nearest left block and then runs that wire as the straight line "
        "through both — so if your two rows of blocks are a little out of "
        "square, the wire tilts to follow them instead of drifting off the "
        "tiles.",
        "- A measurement block with **no** wire block across from it is "
        "ignored (the app says so in its warnings). The right side never "
        "changes how many qubits the board plays.",
        f"- Keep block centres **at least {b.pitch:g} mm apart**, exactly as on "
        f"the left edge; the blocks are the same {size:g} mm square.",
        "",
        "### Reading the face",
        "",
        "It is the wire block's face mirrored. The marker is the same centred "
        f"{config.tile.marker_size:g} mm tile marker, so the **marker's centre "
        "is the block's centre** is the height at which the wire ends — and a "
        "block turned 180° still reports the same point.",
        "",
        f"The **wire line** is the same {WIRE_STROKE_MM:g} mm black bar at "
        "mid-height, running into both edges and passing behind the marker; "
        "line the bar up with the row's wire. Where a wire block carries a "
        "small **q**, this one carries a **measurement gauge** — a half dial "
        "with a needle, the symbol a circuit diagram puts at the end of a wire "
        "— engraved just above the bar on the block's inner (left) edge, "
        "facing the board the wire comes from. On a cube-height block the bar "
        "and a much larger gauge are repeated on all four vertical faces.",
        "",
    ]


def write_corners_md(config: AssetsConfig, out_dir: Path) -> Path:
    """Emit ``corners.md``: the board-furniture blocks, and how to place them.

    Covers all three families the ``--corners`` flag emits — the four corner
    blocks, the qubit-wire blocks and the measurement blocks. Placement and
    *rotation* are load-bearing for the corners: the board homography is fitted
    from each marker's four corner points, so a block turned by 90° skews the
    whole board transform. This documents both cues that make the correct
    orientation obvious on the printed part, then each block family's own
    placement rules.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    b = config.board
    size = config.tile.size
    inner = size - b.corner_margin - b.corner_marker_size

    lines: list[str] = [
        "# Board furniture — the printed mat, in loose blocks",
        "",
        _md_stamp(),
        "",
        "Four blocks carrying the board's ArUco corner markers (IDs 0-3). Put "
        "one at each corner of the play area and the vision pipeline gets "
        "exactly the fiducials the printed mat would have given it — no mat "
        "needed. They are **opt-in**: generate them with `--corners`, which also "
        "emits the qubit-wire blocks documented at the bottom of this file.",
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
        "Corner blocks do not draw the grid or the qubit labels — only the "
        "corners. The circuit still reads left → right from the UL/LL side. If "
        "you want the printed guides, use the mat (`qamposer-assets board`).",
        "",
    ]
    lines += _qubit_wire_md_lines(config)
    lines += _measure_block_md_lines(config)
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
