# Entangible

**Entangible** — the QAMPoser physical quantum circuit composer. Visitors at
events, fairs, and booths build real quantum circuits on a table from printed
gate tiles laid out on a printed board mat; a camera recognizes the layout
(ArUco fiducial markers → OpenCV) and a big screen shows the live circuit and
its simulation results via the existing [`@qamposer/react`](https://github.com/QAMP-62)
editor (controlled mode, in-browser `localAdapter`, OpenQASM 2 export). An
optional in-browser noise model pairs realistic results beside the ideal ones
with zero infrastructure — presets are calibration snapshots of four IBM chip
generations (Falcon → Eagle → Heron → Nighthawk), so the "why quantum is hard"
contrast works offline. Hosts: Raspberry Pi 4/5 and macOS; cameras: USB / Pi
Camera / Continuity Camera / iPhone browser streaming.

**One app, every role** ("Entangible One"): the same React app is the
standalone composer at [entangible.org](https://entangible.org) (on-device
camera + TS detection, no install), the booth big screen (`/?kiosk`), the
visitor's read-only follow-along view (scan the booth QR), the staff phone
camera (operator QR), and the staff `/debug` panel.

## Quick start

```sh
make demo    # build the app + serve a no-camera replay loop,
             # then open http://localhost:8443/?kiosk&connect=1
```

## Repo layout

A uv workspace (three Python packages) plus one npm app. See
[`docs/design.md`](docs/design.md) for the full approved design and milestones,
and [`docs/marker-ids.md`](docs/marker-ids.md) for the marker/gate ID scheme.

```
pyproject.toml            # uv workspace root
packages/
  qamposer-vision/        # OpenCV/ArUco pipeline; markers.py = single source of truth
  qamposer-assets/        # printable tile/board PDF generator (SVG -> PDF)
  qamposer-physical-host/ # FastAPI kiosk host (M2); serves the app at /, /?kiosk, /debug
pocket-app/               # Vite + React + @qamposer/react — the ONE app (Entangible One)
shared/                   # neutral @quantum engine + @shared display/ws/capture logic
docs/                     # design, protocol, marker-ids, printing, pocket, booth-ux
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
the [pocket app](https://entangible.org), a phone in the booth camera role, or
`uv run qamposer-vision detect --image …`. See the folder README.

## Part of the Fun with Quantum family

Entangible is part of [**Fun with Quantum**](https://fun-with-quantum.org), a
family of open-source quantum outreach projects:
[RasQberry Two](https://rasqberry.org) ·
[RasQberry One](https://rasqberry.one) ·
[Quantego](https://quantego.org) ·
[Qutie](https://qutie.org) ·
[Qoffee-Maker](https://qoffee-maker.org).

## Trademarks

Entangible is an independent community project inspired by the
[IBM Quantum Composer](https://quantum.cloud.ibm.com/composer). It is not
affiliated with, endorsed by, or sponsored by IBM. IBM, IBM Quantum and Qiskit
are trademarks of International Business Machines Corporation.
