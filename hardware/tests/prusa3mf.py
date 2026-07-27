"""Read an exported 3MF the way the two families of slicer read it.

Pure standard library — ``zipfile`` + ``ElementTree``, no build123d, no lib3mf —
so the assertions are about the *bytes we ship*, not about what our own writer
believes it wrote:

* ``3D/3dmodel.model`` — the generic 3MF every slicer understands: one
  ``<basematerials>`` group (the filament-slot list, in order) and one
  ``<object>`` per **piece**, whose triangles point back into that group.
* ``Metadata/Slic3r_PE_model.config`` — PrusaSlicer's project part, the *only*
  place it takes filament assignments from: one ``<object>`` per piece, whose
  parts are triangle ranges carrying ``extruder``.

Both views must agree, which is what :func:`Model.part_colors` and the
partition checks in ``test_prusa_project.py`` are for.
"""

from __future__ import annotations

import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree

CORE_NS = "{http://schemas.microsoft.com/3dmanufacturing/core/2015/02}"
MODEL_PART = "3D/3dmodel.model"
CONFIG_PART = "Metadata/Slic3r_PE_model.config"


@dataclass(slots=True)
class Volume:
    """One part of a piece: a triangle range plus the filament slot it prints on."""

    name: str
    extruder: int
    first: int
    last: int

    @property
    def count(self) -> int:
        return self.last - self.first + 1


@dataclass(slots=True)
class Object:
    """One piece: a 3MF mesh object plus the parts PrusaSlicer will show for it."""

    id: int
    name: str
    #: base-material index (0-based, = slot - 1) of every triangle, in file order
    triangle_material: list[int] = field(default_factory=list)
    volumes: list[Volume] = field(default_factory=list)
    #: raw geometry, for comparing two files' meshes exactly
    vertices: list[tuple[str, str, str]] = field(default_factory=list)
    triangles: list[tuple[str, str, str]] = field(default_factory=list)

    @property
    def triangle_count(self) -> int:
        return len(self.triangle_material)


@dataclass(slots=True)
class Model:
    """A parsed 3MF: its filament slots, its pieces and its build items."""

    path: Path
    #: ``(name, '#rrggbb')`` per base material, in slot order — slot = index + 1
    materials: list[tuple[str, str]]
    objects: list[Object]
    build_items: list[int]
    has_config: bool

    def slot(self, hex_color: str) -> int:
        """1-based filament slot of a colour."""
        for i, (_name, hexc) in enumerate(self.materials):
            if hexc == hex_color.lower():
                return i + 1
        raise AssertionError(f"{hex_color} is not a slot of {self.path.name}")

    def part_colors(self) -> list[tuple[str, str]]:
        """``(part name, '#rrggbb')`` per part, from the *triangle* properties.

        The generic-slicer view: what Bambu Studio / OrcaSlicer / a 3MF viewer
        paints. Asserts each part's triangles all carry one colour.
        """
        out: list[tuple[str, str]] = []
        for obj in self.objects:
            for vol in obj.volumes:
                indices = set(obj.triangle_material[vol.first : vol.last + 1])
                assert len(indices) == 1, f"{vol.name} spans materials {indices}"
                out.append((vol.name, self.materials[indices.pop()][1]))
        return out

    def extruders(self) -> set[int]:
        """Every filament slot the file assigns a part to."""
        return {vol.extruder for obj in self.objects for vol in obj.volumes}


def read(path: Path) -> Model:
    """Parse a 3MF into its generic model + PrusaSlicer project view."""
    path = Path(path)
    with zipfile.ZipFile(path) as zf:
        names = set(zf.namelist())
        model_xml = ElementTree.fromstring(zf.read(MODEL_PART))
        config_xml = (
            ElementTree.fromstring(zf.read(CONFIG_PART))
            if CONFIG_PART in names
            else None
        )

    resources = model_xml.find(f"{CORE_NS}resources")
    assert resources is not None, f"{path.name} has no <resources>"

    groups = resources.findall(f"{CORE_NS}basematerials")
    assert len(groups) <= 1, f"{path.name} has {len(groups)} material groups"
    materials: list[tuple[str, str]] = []
    group_id = None
    if groups:
        group_id = groups[0].get("id")
        for base in groups[0].findall(f"{CORE_NS}base"):
            materials.append((base.get("name", ""), base.get("displaycolor", "")[:7].lower()))

    objects: dict[int, Object] = {}
    order: list[int] = []
    for node in resources.findall(f"{CORE_NS}object"):
        mesh = node.find(f"{CORE_NS}mesh")
        if mesh is None:  # a components wrapper, not a piece
            continue
        oid = int(node.get("id", "0"))
        default = int(node.get("pindex", "0")) if node.get("pid") else 0
        if node.get("pid") is not None and group_id is not None:
            assert node.get("pid") == group_id, f"{path.name}: object {oid} off-group"
        obj = Object(id=oid, name=node.get("name", ""))
        for vertex in mesh.find(f"{CORE_NS}vertices"):
            obj.vertices.append((vertex.get("x"), vertex.get("y"), vertex.get("z")))
        for tri in mesh.find(f"{CORE_NS}triangles"):
            obj.triangles.append((tri.get("v1"), tri.get("v2"), tri.get("v3")))
            if tri.get("pid") is not None:
                assert tri.get("pid") == group_id, f"{path.name}: triangle off-group"
                obj.triangle_material.append(int(tri.get("p1", "0")))
            else:
                obj.triangle_material.append(default)
        objects[oid] = obj
        order.append(oid)

    build = model_xml.find(f"{CORE_NS}build")
    build_items = [
        int(item.get("objectid", "0")) for item in build.findall(f"{CORE_NS}item")
    ] if build is not None else []

    if config_xml is not None:
        for node in config_xml.findall("object"):
            oid = int(node.get("id", "0"))
            assert oid in objects, f"{path.name}: config object {oid} has no mesh"
            obj = objects[oid]
            obj.name = _meta(node, "object", "name") or obj.name
            for vol in node.findall("volume"):
                obj.volumes.append(
                    Volume(
                        name=_meta(vol, "volume", "name") or "",
                        extruder=int(_meta(vol, "volume", "extruder") or 0),
                        first=int(vol.get("firstid", "-1")),
                        last=int(vol.get("lastid", "-1")),
                    )
                )

    return Model(
        path=path,
        materials=materials,
        objects=[objects[oid] for oid in order],
        build_items=build_items,
        has_config=config_xml is not None,
    )


def _meta(node, kind: str, key: str) -> str | None:
    for meta in node.findall("metadata"):
        if meta.get("type") == kind and meta.get("key") == key:
            return meta.get("value")
    return None
