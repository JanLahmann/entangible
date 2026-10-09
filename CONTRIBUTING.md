# Contributing to Entangible

## Prerequisites

- [uv](https://docs.astral.sh/uv/) — manages the Python workspace (`uv sync`
  creates `.venv` and installs all three packages).
- Node.js with npm — CI builds and tests on **Node 20 LTS**; newer versions
  work for local development.
- libcairo — only for the printable-kit PDF generator
  (`brew install cairo` / `apt install libcairo2`).
- PrusaSlicer (optional) — a few hardware tests round-trip 3MFs through its
  CLI and skip cleanly when it is absent.

## Where things live

| Path | What |
| ---- | ---- |
| `packages/qamposer-vision/` | OpenCV/ArUco detection pipeline; `markers.py` is the single source of truth for marker IDs |
| `packages/qamposer-assets/` | printable tiles/board/cheat-sheet (SVG → PDF) |
| `packages/qamposer-physical-host/` | FastAPI booth host (serves the app, WS hub, vision loop) |
| `pocket-app/` | the one React app (standalone, kiosk, viewer, camera, `/debug`) |
| `shared/` | framework-neutral `@quantum` engine + `@shared` display/ws logic |
| `hardware/` | 3D-printable tiles (build123d), bed-ready plates |
| `docs/` | design, protocol, marker IDs, printing, booth UX |

Task numbers (`#NNN`) in commits and docs are the internal task list, not
GitHub PR numbers.

Adding a new gate tile touches most of these at once — follow the checklist in
[`docs/extending.md`](docs/extending.md).

## The parity rule

The vision pipeline exists twice — Python (`qamposer-vision`, the booth host)
and TypeScript (`pocket-app/src/vision`, in-browser detection) — and the two
must stay numerically identical. A change to grid mapping, stabilization, or
marker semantics lands in **both** languages in the same commit, with the same
test numbers on both sides. The same applies to face art: the printed kit, the
laser kit and the 3D tiles derive from shared geometry in `qamposer-assets`;
never fork a copy.

## Quality gates (run all three before pushing)

```sh
uv run pytest -q                 # Python suites
cd pocket-app && npx vitest run  # TS suites (includes shared/)
cd pocket-app && npx tsc --noEmit
```

CI (`ci.yml`) runs the same gates on every push and PR.

## Printable artifacts

Generated artifacts (kits, example boards, the print PDF) must never go stale
against the detector: after changing tile/board art, the marker table or kit
composition, regenerate the committed examples (`tools/make_example_boards.py`,
`tools/make_print_kit.py`) in the same change, and cut a new `kit-*` release
tag so the download links serve matching files (see the header of
`.github/workflows/artifacts.yml`).
