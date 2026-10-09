# Running the Entangible booth on a Raspberry Pi (RasQberry)

The kiosk host runs on a Raspberry Pi 4 or 5 with Raspberry Pi OS — the same
`uv` workspace and `qamposer-physical run` as on a Mac
([`mac-booth.md`](mac-booth.md)). This guide covers the Pi-specific setup: the
install script, the systemd service, camera choices, and running offline on a
hotspot.

> **Status:** the install path below is complete but has not yet been
> validated end-to-end on Pi hardware; a prebuilt flashable RasQberry image is
> still to come. If something fails on a real Pi, please open an issue.

## What you need

- Raspberry Pi 4 (4 GB+) or Pi 5, Raspberry Pi OS **Bookworm 64-bit**
  (Desktop image — the kiosk uses Chromium).
- A camera: the Pi Camera Module (any version), a USB webcam, or a phone
  streaming over the LAN ([`iphone-capture.md`](iphone-capture.md)).
- A screen for the booth kiosk, and the printed board + tiles
  ([`printing.md`](printing.md)).

## Install

On the Pi, in a terminal:

```bash
git clone https://github.com/JanLahmann/entangible.git ~/entangible
~/entangible/deploy/rasqberry/install.sh --kiosk
```

The script ([`deploy/rasqberry/install.sh`](../deploy/rasqberry/install.sh))
is idempotent and does, in order: apt packages (`python3-picamera2`,
`libcairo2`, Chromium), Node 20 (one-time app build), `uv`, the Python venv
(`--system-site-packages`, so the apt-installed `picamera2` is importable),
`uv sync`, the pocket-app build, a systemd service, and — with `--kiosk` — a
desktop autostart entry that opens the booth screen fullscreen at login.
Expect the first run to take a while on a Pi 4 (the `npm ci && npm run build`
step dominates).

Without `--kiosk` the host still starts on boot; open
`https://localhost:8443/?kiosk&connect=1` in any browser yourself.

## The service

```bash
.venv/bin/qamposer-physical doctor        # preflight: build, camera, port, TLS, token
sudo systemctl status entangible-host     # is it running?
journalctl -u entangible-host -n 20       # the printed URLs (kiosk, staff debug)
sudo systemctl restart entangible-host    # after changing settings
```

Settings live in `/etc/default/entangible` (environment variables, same
`QAMPOSER_*` set the CLI flags map to):

```bash
# /etc/default/entangible
QAMPOSER_SOURCE=cv2:0          # first USB camera (the default)
# QAMPOSER_SOURCE=picamera2    # the Pi Camera Module
# QAMPOSER_SOURCE=push         # a phone streams via the staff QR
```

## Cameras on a Pi

- **Pi Camera Module** → `QAMPOSER_SOURCE=picamera2`. Needs the apt
  `python3-picamera2` (the install script handles it) and the
  `--system-site-packages` venv it sets up.
- **USB webcam** → `cv2:0` (or `cv2:1`, …). List what is openable with
  `uv run qamposer-vision list-cameras`.
- **Phone camera** → `push`, then scan the staff QR
  (`uv run qamposer-physical qr`, or the Phone camera card on `/debug`). A Pi
  cannot use Continuity Camera — the phone-browser streaming path is the Pi's
  overhead-iPhone option ([`iphone-capture.md`](iphone-capture.md)).

Staff can also switch cameras live from the `/debug` page.

## Offline / hotspot booths

Fair WLANs are unreliable; a Pi can carry the whole booth with no internet:

- Everything is served locally — the app, the simulation, golf, Quantina. No
  cloud calls happen at runtime. (Only "Transfer to IBM Composer" needs the
  visitor's own internet.)
- Run the Pi as a Wi-Fi access point (Pi OS network settings or RaspAP) and
  put the booth screen, staff phone, and visitor phones on it.
- Set `QAMPOSER_ADVERTISE_HOST` in `/etc/default/entangible` to the address
  clients should use (e.g. the AP's IP), so the printed URLs, the QR codes,
  and the TLS certificate all carry it.

## Performance expectations

Detection is tuned to run on a Pi 4 (the vision pipeline is plain
OpenCV/ArUco, no GPU). Lower the camera resolution before blaming the Pi:
720p is plenty for a 60 cm board. The `/debug` READY panel shows the live
fps. On-device validation (M5 sign-off) is still pending — treat stutters as
bugs worth reporting, not as the Pi's ceiling.
