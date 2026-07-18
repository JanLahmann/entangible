# QAMPoser-physical

**Entangible** — the QAMPoser physical quantum circuit composer. Visitors at
events, fairs, and booths build real quantum circuits on a table from printed
gate tiles laid out on a printed board mat; a camera recognizes the layout
(ArUco fiducial markers → OpenCV) and a big screen shows the live circuit and
its simulation results via the existing [`@qamposer/react`](https://github.com/QAMP-62)
editor (controlled mode, in-browser `localAdapter`, OpenQASM 2 export). Hosts:
Raspberry Pi 4/5 and macOS; cameras: USB / Pi Camera / Continuity Camera /
iPhone browser streaming.

## Repo layout

A uv workspace (three Python packages) plus one npm app. See
[`docs/design.md`](docs/design.md) for the full approved design and milestones,
and [`docs/marker-ids.md`](docs/marker-ids.md) for the marker/gate ID scheme.

```
pyproject.toml            # uv workspace root
packages/
  qamposer-vision/        # OpenCV/ArUco pipeline; markers.py = single source of truth
  qamposer-assets/        # printable tile/board PDF generator (SVG -> PDF)
  qamposer-physical-host/ # FastAPI kiosk host (M2)
display-app/              # Vite + React + @qamposer/react (M2)
docs/                     # design, protocol, marker-ids, printing, rasqberry
tests/                    # fixtures + unit suites
```

## Development

```sh
uv sync                                  # create .venv, install all workspace members
uv run pytest packages/qamposer-vision   # run the vision test suite
```

## Test without a printer

`examples/test-boards/` contains ready-made board images (empty → Bell → GHZ →
warning cases): open one fullscreen on a monitor and point a camera at it —
the [pocket app](https://entangible.org), the booth `/capture` page, or
`uv run qamposer-vision detect --image …`. See the folder README.
