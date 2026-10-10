# Running the Entangible booth on a Raspberry Pi (RasQberry)

The kiosk host runs on a Raspberry Pi 4 or 5 with Raspberry Pi OS — the same
`uv` workspace and `qamposer-physical run` as on a Mac
([`mac-booth.md`](mac-booth.md)). This guide covers the Pi-specific setup: the
install script, the systemd service, camera choices, and running offline on a
hotspot.

> **Status:** the install path below is complete but has not yet been
> validated end-to-end on Pi hardware (the rig checklist is in
> [`rasqberry-integration.md`](rasqberry-integration.md#rig-test-checklist));
> a prebuilt flashable RasQberry image is still to come. If something fails on
> a real Pi, please open an issue.

## What you need

- Raspberry Pi 4 (4 GB+) or Pi 5, Raspberry Pi OS **Trixie 64-bit**
  (Desktop image — the kiosk uses Chromium). Older releases are not supported.
- A camera: the Pi Camera Module (any version), a USB webcam, or a phone
  streaming over the LAN ([`iphone-capture.md`](iphone-capture.md)).
- A screen for the booth kiosk, and the printed board + tiles
  ([`printing.md`](printing.md)).

## Install

Everything goes through one command,
[`deploy/rasqberry/entangible`](../deploy/rasqberry/entangible). It is the
same interface RasQberry's menu calls; the full contract, exit codes and
status JSON are in [`rasqberry-integration.md`](rasqberry-integration.md). On
the Pi, in a terminal, as the desktop user:

```bash
git clone https://github.com/JanLahmann/entangible.git ~/RasQberry-Two/demos/entangible
~/RasQberry-Two/demos/entangible/deploy/rasqberry/entangible install --kiosk
```

Any checkout location works; that one is the RasQberry convention.

`install` is idempotent and quick to repeat. It does, in order:

- apt packages: `python3-picamera2` (when the archive has it), `libcairo2`
  and Chromium; skipped when already present
- the **prebuilt web app** from the GitHub release named in
  `deploy/rasqberry/BUNDLE_TAG`, sha256-verified, so no Node/npm is needed on
  the Pi
- `uv`
- the Python venv with `--system-site-packages` (so the apt `picamera2` is
  importable), then `uv sync --frozen`
- a systemd service
- with `--kiosk`, a desktop autostart entry that opens the booth screen
  fullscreen at login, in a Chromium with its own profile (separate from
  RasQberry's own Chromium window)

Downloads are cached on `/data` when it exists, so a reinstall after a
RasQberry system update needs no network. `--build-web` builds the web app
locally with npm instead; it installs Node 20 and is slow on a Pi 4.

Without `--kiosk` the host still starts on boot; open the address that
`entangible url` prints in any browser.

`--no-enable` installs the service without starting it at boot, so it holds
no port, camera or RAM until you run `entangible start` (and `entangible
stop` when done). This is how the RasQberry menu should run it, as a demo
started on demand. It cannot be combined with `--kiosk`, which needs the
service at boot.

## The service

`entangible` below means `<checkout>/deploy/rasqberry/entangible`.

```bash
entangible doctor          # preflight: build, camera, port, TLS, token (stop the service first)
entangible status          # one-line JSON: installed, running, health, URLs
entangible restart         # after changing settings
entangible url --visitor   # the URL phones open
journalctl -u entangible-host -n 20   # the printed URLs (kiosk, staff debug)
entangible uninstall       # --purge also removes settings, venv, certs
```

Settings live in `/etc/default/entangible`. They are environment variables,
the same `QAMPOSER_*` set the CLI flags map to. Install never overwrites this
file. When it first creates it, install picks `QAMPOSER_SOURCE` from the
cameras it finds: a USB webcam gives `cv2:0`, otherwise a Pi Camera Module
gives `picamera2`, otherwise `cv2:0`.

```bash
# /etc/default/entangible
QAMPOSER_SOURCE=cv2:0          # first USB camera (the default)
# QAMPOSER_SOURCE=picamera2    # the Pi Camera Module
# QAMPOSER_SOURCE=push         # a phone streams via the staff QR
# QAMPOSER_SOURCE=replay:tests/fixtures/recordings/bell-sequence   # demo loop, no camera
```

## Cameras on a Pi

- **Pi Camera Module** → `QAMPOSER_SOURCE=picamera2`. Needs the apt
  `python3-picamera2` (`entangible install` handles it) and the
  `--system-site-packages` venv it sets up.
- **USB webcam** → `cv2:0` (or `cv2:1`, …). List what is openable with
  `.venv/bin/qamposer-vision list-cameras` from the checkout. Use the venv
  binaries rather than `uv run` on the Pi: `uv run` would sync the whole
  workspace, including the CAD kit generator a booth does not need.
- **Phone camera** → `push`, then scan the staff QR
  (`.venv/bin/qamposer-physical qr`, or the Phone camera card on `/debug`). A Pi
  cannot use Continuity Camera — the phone-browser streaming path is the Pi's
  overhead-iPhone option ([`iphone-capture.md`](iphone-capture.md)).

Staff can also switch cameras live from the `/debug` page. If the camera
changes later (say, the webcam is replaced by a camera module),
`entangible doctor` prints a hint with the value to set.

## Offline / hotspot booths

Fair WLANs are unreliable; a Pi can carry the whole booth with no internet:

- Everything is served locally — the app, the simulation, golf, Quantina. No
  cloud calls happen at runtime. (Only "Transfer to IBM Composer" needs the
  visitor's own internet.)
- Run the Pi as a Wi-Fi access point (Pi OS network settings or RaspAP) and
  put the booth screen, staff phone, and visitor phones on it.
- Set `QAMPOSER_ADVERTISE_HOST` in `/etc/default/entangible` to the address
  clients should use (e.g. the AP's IP), so the printed URLs, the QR codes,
  `entangible url --visitor` and the TLS certificate all carry it.

## Performance expectations

Detection is tuned to run on a Pi 4 (the vision pipeline is plain
OpenCV/ArUco, no GPU). Lower the camera resolution before blaming the Pi:
720p is plenty for a 60 cm board. The `/debug` READY panel shows the live
fps. On-device validation (M5 sign-off) is still pending — treat stutters as
bugs worth reporting, not as the Pi's ceiling.
