"""``qamposer-hardware`` CLI — generate 3D-printable multi-colour gate tiles.

    qamposer-hardware generate [--variant tile|cube|all] [--gates H,X,...|all]
                               [--magnets] [--mono] [--corners] [--out DIR]
    qamposer-hardware plates   [--variant tile|cube] [--bed WxH] [--mono]
                               [--corners] [--out DIR]

Writes, per variant, ``out/hardware/<variant>/`` containing per-colour STL
parts and a coloured 3MF for every requested tile, plus a ``plates.md`` MMU
guide. ``--mono`` adds the single-colour (no-MMU) forms and ``--corners`` the
four board-corner blocks that replace the printed mat — both opt-in, so the
default kit is exactly what it was.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from qamposer_assets.config import AssetsConfig, load_config
from qamposer_vision.markers import MARKER_TABLE, GateSpec

from .build import build_corner_block, build_double_tile, build_tile
from .export import (
    double_slug,
    export_corner_batches,
    export_double_batches,
    export_double_mono_stls,
    export_double_tile_3mf,
    export_double_tile_stls,
    export_mono_batches,
    export_mono_stls,
    export_single_batches,
    export_tile_3mf,
    export_tile_stls,
    tile_slug,
    write_batch_plates_md,
    write_corner_plates_md,
    write_corners_md,
    write_double_plates_md,
    write_mono_batch_md,
    write_mono_md,
    write_plates_md,
)
from .face import corner_block_ids
from .pack import parse_bed
from .params import (
    DOUBLE_FACED_KIT,
    HardwareParams,
    variant_height,
    variant_names,
)

__all__ = ["main"]

_DEFAULT_OUT = Path("out/hardware")


def _all_gate_ids() -> list[int]:
    return sorted(mid for mid, spec in MARKER_TABLE.items() if spec.kind == "gate")


def _dial_ids() -> list[int]:
    return sorted(
        mid for mid, spec in MARKER_TABLE.items() if spec.dial_axis is not None
    )


def _gate_family(spec: GateSpec) -> str:
    """The ``--gates`` token that selects this tile (e.g. ``H``, ``RX``, ``CNOT``)."""
    return spec.gate


def _resolve_gates(arg: str) -> list[int]:
    """Map a ``--gates`` value to marker IDs.

    ``all`` → every gate tile. Otherwise a comma list of gate families
    (``H,X,RX,CNOT,S``) and/or explicit marker IDs (``10,21``).
    """
    if arg.strip().lower() == "all":
        return _all_gate_ids()
    wanted_families: set[str] = set()
    wanted_ids: set[int] = set()
    want_dials = False
    for tok in arg.split(","):
        tok = tok.strip()
        if not tok:
            continue
        if tok.isdigit():
            wanted_ids.add(int(tok))
        elif tok.upper() in ("DIAL", "DIALS"):
            want_dials = True
        else:
            wanted_families.add(tok.upper())
    if want_dials:
        wanted_ids.update(_dial_ids())
    ids: list[int] = []
    for mid in _all_gate_ids():
        spec = MARKER_TABLE[mid]
        if mid in wanted_ids or _gate_family(spec).upper() in wanted_families:
            ids.append(mid)
    unknown_ids = wanted_ids - set(_all_gate_ids())
    if unknown_ids:
        raise SystemExit(f"unknown marker id(s): {sorted(unknown_ids)}")
    if not ids:
        raise SystemExit(f"no gate tiles matched --gates {arg!r}")
    return ids


def _resolve_double_kit(arg: str) -> list[tuple[int, int | None, int]]:
    """Filter :data:`DOUBLE_FACED_KIT` by ``--gates`` (matches either face)."""
    if arg.strip().lower() == "all":
        return list(DOUBLE_FACED_KIT)
    wanted_families: set[str] = set()
    wanted_ids: set[int] = set()
    for tok in arg.split(","):
        tok = tok.strip()
        if not tok:
            continue
        if tok.isdigit():
            wanted_ids.add(int(tok))
        else:
            wanted_families.add(tok.upper())
    out: list[tuple[int, int | None, int]] = []
    for a, b, qty in DOUBLE_FACED_KIT:
        mb = a if b is None else b
        ids = {a, mb}
        fams = {MARKER_TABLE[a].gate.upper(), MARKER_TABLE[mb].gate.upper()}
        if (ids & wanted_ids) or (fams & wanted_families):
            out.append((a, b, qty))
    if not out:
        raise SystemExit(f"no double-faced pieces matched --gates {arg!r}")
    return out


def _resolve_variants(arg: str) -> list[str]:
    if arg == "all":
        return variant_names()
    if arg not in variant_names():
        raise SystemExit(
            f"unknown --variant {arg!r}; choose tile|cube|all"
        )
    return [arg]


def _emit_corner_blocks(
    config: AssetsConfig,
    variant: str,
    height: float,
    vdir: Path,
    params: HardwareParams,
    *,
    mono: bool,
    magnets: bool = False,
) -> tuple[int, int]:
    """Write the four board-corner blocks into ``vdir``; return (files, bytes).

    Corner blocks are single-faced by nature (one marker face), so they are the
    same four pieces whether the run is a single- or double-faced kit — only the
    body height follows the kit.
    """
    total_files = 0
    total_bytes = 0
    for mid in corner_block_ids():
        t0 = time.time()
        parts = build_corner_block(
            mid, config, variant=variant, height=height,
            params=params, magnets=magnets,
        )
        stls = export_tile_stls(parts, vdir)
        tmf = export_tile_3mf(parts, vdir)
        mono_stls = export_mono_stls(parts, vdir, params) if mono else []
        dt = time.time() - t0
        files = list(stls) + ([tmf] if tmf else []) + list(mono_stls)
        nbytes = sum(p.stat().st_size for p in files)
        total_files += len(files)
        total_bytes += nbytes
        print(
            f"    {tile_slug(parts.layout.spec):16s} id={mid:<3d} "
            f"{len(files)} files {nbytes/1024:7.1f} KiB  {dt:4.2f}s  (corner)"
        )
    return total_files, total_bytes


def _generate(
    config: AssetsConfig,
    variants: list[str],
    ids: list[int],
    out_root: Path,
    *,
    magnets: bool,
    mono: bool,
    corners: bool = False,
) -> int:
    params = HardwareParams()
    total_files = 0
    total_bytes = 0
    grand_t0 = time.time()

    for variant in variants:
        height = variant_height(variant)
        vdir = out_root / variant
        vdir.mkdir(parents=True, exist_ok=True)
        print(f"[{variant}] height={height:g} mm -> {vdir}"
              + ("  (+mono)" if mono else "")
              + ("  (+corners)" if corners else ""))
        for mid in ids:
            spec = MARKER_TABLE[mid]
            t0 = time.time()
            parts = build_tile(
                mid, config, variant=variant, height=height,
                params=params, magnets=magnets,
            )
            stls = export_tile_stls(parts, vdir)
            tmf = export_tile_3mf(parts, vdir)
            mono_stls = export_mono_stls(parts, vdir, params) if mono else []
            dt = time.time() - t0
            files = list(stls) + ([tmf] if tmf else []) + list(mono_stls)
            nbytes = sum(p.stat().st_size for p in files)
            total_files += len(files)
            total_bytes += nbytes
            print(
                f"    {tile_slug(spec):16s} id={mid:<3d} "
                f"{len(files)} files {nbytes/1024:7.1f} KiB  {dt:4.2f}s"
            )
        if corners:
            n, nb = _emit_corner_blocks(
                config, variant, height, vdir, params, mono=mono, magnets=magnets
            )
            total_files += n
            total_bytes += nb
        write_plates_md(config, vdir)
        total_files += 1
        if corners:
            write_corners_md(config, vdir)
            total_files += 1
        if mono:
            write_mono_md(vdir, faces="single", height=height, params=params)
            total_files += 1

    dt = time.time() - grand_t0
    print(
        f"\nDone: {total_files} files, {total_bytes/1024/1024:.2f} MiB, "
        f"{dt:.1f}s total."
    )
    return 0


def _generate_double(
    config: AssetsConfig,
    variants: list[str],
    kit: list[tuple[int, int | None, int]],
    out_root: Path,
    *,
    mono: bool,
    corners: bool = False,
) -> int:
    params = HardwareParams()
    total_files = 0
    total_bytes = 0
    grand_t0 = time.time()

    for variant in variants:
        height = variant_height(variant, faces="double")
        vdir = out_root / f"{variant}-double"
        vdir.mkdir(parents=True, exist_ok=True)
        n_pieces = sum(qty for _a, _b, qty in kit)
        print(
            f"[{variant}-double] height={height:g} mm  "
            f"{len(kit)} designs / {n_pieces} pieces -> {vdir}"
            + ("  (+mono)" if mono else "")
            + ("  (+corners)" if corners else "")
        )
        for a, b, qty in kit:
            mb = a if b is None else b
            slug = double_slug(MARKER_TABLE[a], MARKER_TABLE[mb])
            t0 = time.time()
            parts = build_double_tile(
                a, b, config, variant=variant, height=height, params=params
            )
            stls = export_double_tile_stls(parts, vdir)
            tmf = export_double_tile_3mf(parts, vdir)
            mono_stls = export_double_mono_stls(parts, vdir, params) if mono else []
            dt = time.time() - t0
            files = list(stls) + ([tmf] if tmf else []) + list(mono_stls)
            nbytes = sum(p.stat().st_size for p in files)
            total_files += len(files)
            total_bytes += nbytes
            print(
                f"    {slug:20s} ×{qty}  "
                f"{len(files)} files {nbytes/1024:7.1f} KiB  {dt:4.2f}s"
            )
        if corners:
            n, nb = _emit_corner_blocks(config, variant, height, vdir, params, mono=mono)
            total_files += n
            total_bytes += nb
        write_double_plates_md(config, kit, vdir)
        total_files += 1
        if corners:
            write_corners_md(config, vdir)
            total_files += 1
        if mono:
            write_mono_md(vdir, faces="double", height=height, params=params)
            total_files += 1

    dt = time.time() - grand_t0
    print(
        f"\nDone: {total_files} files, {total_bytes/1024/1024:.2f} MiB, "
        f"{dt:.1f}s total."
    )
    return 0


def _plates(
    config: AssetsConfig,
    *,
    faces: str,
    variant: str,
    bed_text: str,
    spacing: float,
    max_per_plate: int,
    out_root: Path,
    mono: bool = False,
    corners: bool = False,
) -> int:
    """Generate bed-ready multi-piece batch 3MFs + a Print jobs plates.md."""
    bed = parse_bed(bed_text)
    height = variant_height(variant, faces=faces)
    subdir = f"{variant}-double" if faces == "double" else variant
    vdir = out_root / subdir
    vdir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()

    cap = max_per_plate if max_per_plate > 0 else None
    cap_note = f"  cap {cap}/plate (wipe tower)" if cap else ""
    print(
        f"[{subdir}] bed {bed.width:g}x{bed.height:g} mm  spacing {spacing:g} mm  "
        f"height {height:g} mm{cap_note} -> {vdir}"
        + ("  (+mono)" if mono else "")
        + ("  (+corners)" if corners else "")
    )

    if faces == "double":
        base_md = write_double_plates_md(config, DOUBLE_FACED_KIT, vdir)
        infos = export_double_batches(
            config, DOUBLE_FACED_KIT, variant=variant, height=height,
            bed=bed, spacing=spacing, out_dir=vdir, max_per_bed=cap,
        )
    else:
        base_md = write_plates_md(config, vdir)
        infos = export_single_batches(
            config, variant=variant, height=height,
            bed=bed, spacing=spacing, out_dir=vdir, max_per_bed=cap,
        )

    write_batch_plates_md(
        base_md, infos, bed=bed, spacing=spacing, faces=faces, variant=variant,
        max_per_bed=cap,
    )

    corner_infos: list = []
    if corners:
        corner_infos = export_corner_batches(
            config, variant=variant, height=height,
            bed=bed, spacing=spacing, out_dir=vdir, max_per_bed=cap,
        )
        write_corner_plates_md(base_md, corner_infos)
        write_corners_md(config, vdir)

    mono_infos: list = []
    if mono:
        mono_md = write_mono_md(vdir, faces=faces, height=height)
        mono_infos = export_mono_batches(
            config, faces=faces, variant=variant, height=height,
            bed=bed, spacing=spacing, out_dir=vdir, max_per_bed=cap,
            corners=corners,
        )
        write_mono_batch_md(
            mono_md, mono_infos, bed=bed, spacing=spacing, faces=faces,
            height=height, max_per_bed=cap,
        )

    total_bytes = 0
    for info in infos:
        nbytes = info.path.stat().st_size
        total_bytes += nbytes
        print(
            f"    {info.path.name:24s} plate{info.plate} batch{info.batch}  "
            f"{len(info.slugs)} pieces  {info.object_count} objs  "
            f"{nbytes/1024:7.1f} KiB"
        )
    for info in corner_infos:
        nbytes = info.path.stat().st_size
        total_bytes += nbytes
        print(
            f"    {info.path.name:24s} corners  batch{info.batch}  "
            f"{len(info.slugs)} pieces  {info.object_count} objs  "
            f"{nbytes/1024:7.1f} KiB"
        )
    for minfo in mono_infos:
        nbytes = minfo.path.stat().st_size
        total_bytes += nbytes
        print(
            f"    {minfo.path.name:24s} mono-{minfo.form} batch{minfo.batch}  "
            f"{len(minfo.slugs)} pieces  {minfo.object_count} objs  "
            f"{nbytes/1024:7.1f} KiB"
        )

    n_files = len(infos) + len(corner_infos) + len(mono_infos)
    dt = time.time() - t0
    print(
        f"\nDone: {n_files} batch 3MF(s) + plates.md, "
        f"{total_bytes/1024/1024:.2f} MiB, {dt:.1f}s."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="qamposer-hardware",
        description="Generate 3D-printable multi-colour Entangible gate tiles.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate", help="generate STL/3MF tiles")
    gen.add_argument(
        "--faces", default="single", choices=("single", "double"),
        help="single-faced tiles (default) | double-faced flip pieces",
    )
    gen.add_argument(
        "--variant", default="tile",
        help="tile (single 6 mm / double 8 mm) | cube (60 mm) | all (default: tile)",
    )
    gen.add_argument(
        "--gates", default="all",
        help="comma list of gate families/IDs, 'dials', or 'all' (default: all)",
    )
    gen.add_argument(
        "--magnets", action="store_true",
        help="add two magnet pockets to the underside (default: off)",
    )
    gen.add_argument(
        "--mono", action="store_true",
        help="also emit single-colour STLs (recessed paint-wells + raised "
             "filament-swap) for printers without an MMU (default: off)",
    )
    gen.add_argument(
        "--corners", action="store_true",
        help="also emit the four board-corner blocks (UL/UR/LL/LR, marker IDs "
             "0-3) that replace the printed mat (default: off)",
    )
    gen.add_argument(
        "--out", default=str(_DEFAULT_OUT), type=Path,
        help=f"output root (default: {_DEFAULT_OUT})",
    )

    plates = sub.add_parser(
        "plates", help="generate bed-ready multi-piece batch 3MFs + plates.md"
    )
    plates.add_argument(
        "--faces", default="single", choices=("single", "double"),
        help="single-faced tiles (default) | double-faced flip pieces",
    )
    plates.add_argument(
        "--variant", default="tile", choices=("tile", "cube"),
        help="tile (default) | cube (60 mm, tall print)",
    )
    plates.add_argument(
        "--bed", default="250x220",
        help="print bed WIDTHxHEIGHT in mm (default: 250x220, Prusa Core One)",
    )
    plates.add_argument(
        "--spacing", default=8.0, type=float,
        help="gap between pieces in mm (default: 8)",
    )
    plates.add_argument(
        "--max-per-plate", default=8, type=int, dest="max_per_plate",
        help="max pieces per plate, leaving bed space for the MMU wipe tower "
             "(default: 8; 0 = fill the bed)",
    )
    plates.add_argument(
        "--mono", action="store_true",
        help="also emit mono batch 3MFs — separate beds per form (all-recessed "
             "beds, all-raised beds) for printers without an MMU (default: off)",
    )
    plates.add_argument(
        "--corners", action="store_true",
        help="also pack the four board-corner blocks onto their own plate "
             "(white + black only, no accent slot) (default: off)",
    )
    plates.add_argument(
        "--out", default=str(_DEFAULT_OUT), type=Path,
        help=f"output root (default: {_DEFAULT_OUT})",
    )

    args = parser.parse_args(argv)
    if args.command == "generate":
        config = load_config()
        variants = _resolve_variants(args.variant)
        if args.faces == "double":
            kit = _resolve_double_kit(args.gates)
            return _generate_double(
                config, variants, kit, args.out, mono=args.mono,
                corners=args.corners,
            )
        ids = _resolve_gates(args.gates)
        return _generate(
            config, variants, ids, args.out, magnets=args.magnets, mono=args.mono,
            corners=args.corners,
        )
    if args.command == "plates":
        config = load_config()
        return _plates(
            config,
            faces=args.faces,
            variant=args.variant,
            bed_text=args.bed,
            spacing=args.spacing,
            max_per_plate=args.max_per_plate,
            out_root=args.out,
            mono=args.mono,
            corners=args.corners,
        )
    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    sys.exit(main())
