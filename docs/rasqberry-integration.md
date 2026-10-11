# RasQberry integration contract

This is the interface between Entangible and RasQberry Two: what RasQberry
calls, what it gets back, where things live on the Pi, and how to test it on
the rig. Operator-facing setup (cameras, hotspots) is in
[`rasqberry.md`](rasqberry.md).

> **Status:** written against Raspberry Pi OS Trixie but **not yet validated
> on Pi hardware**. Where a number depends on the rig it says "to be measured
> on the rig" — the [test checklist](#rig-test-checklist) is how those get
> filled in.

## Purpose

Entangible is a tangible quantum-circuit composer: visitors lay printed gate
tiles on a printed board, a camera reads them, and the booth screen shows the
live circuit and its simulation. On a RasQberry Pi it runs as one systemd
service (`entangible-host`, an HTTPS server on port 8443) plus, optionally,
Chromium in kiosk mode on the Pi's own screen. Visitors' phones join over the
LAN.

RasQberry runs it as an **internal demo**: its menu launcher calls the
`entangible` command below. RasQberry's Docker runner is not used — the booth
needs `/dev/video*`, the Pi camera and a LAN-reachable port, none of which
that runner provides.

## Supported platform

- Raspberry Pi OS **Trixie** (Debian 13, Python 3.13), **arm64**.
- **Pi 4 and Pi 5**, both supported. Nothing assumes a Pi 5; Pi 4 performance
  is to be measured on the rig.
- Other Debian releases: a warning, then it carries on (untested). Not Linux,
  or not arm64/x86_64: exit 5.
- The desktop user is whoever was set in Raspberry Pi Imager. Nothing is
  hard-coded to `rasqberry` or `pi`. The user is resolved as `$SUDO_USER` (if
  set and not root), else the calling user if not root, else the uid-1000
  user. The home directory comes from the passwd entry, or from `USER_HOME` if
  that is set.

## The command

```
<checkout>/deploy/rasqberry/entangible <command> [options]
```

The checkout's usual location is `~/RasQberry-Two/demos/entangible`, but every
path resolves relative to the script, so any location works. Symlinking the
script (e.g. into `/usr/local/bin`) also works.

| Command | What it does | Needs root? |
|---|---|---|
| `install [--kiosk] [--build-web] [--no-enable]` | Install or update. Idempotent: run it again after every A/B update. By default the service is enabled (starts at boot) and (re)started. `--no-enable` installs it **disabled** and does not start it: it runs only after `entangible start`. An earlier enabled install becomes disabled, and a service that is already running is restarted so it runs the new code. A kiosk autostart left by an earlier `--kiosk` install is removed. `--kiosk` autostarts the booth screen at desktop login; it needs the service at boot, so `--kiosk` with `--no-enable` is a usage error (exit 2). `--build-web` builds the web app with npm (it installs Node 20) instead of downloading it. | uses `sudo` for apt/systemd/`/etc`; may also run as root via sudo |
| `uninstall [--purge] [--purge-cache]` | Stops, disables and removes the unit and the kiosk autostart. `--purge` also removes everything else install or the booth created, see [Uninstall](#uninstall). `--purge-cache` also removes the cache on `/data`. Prints every path it removes. | uses `sudo` |
| `start` / `stop` / `restart` | `systemctl <action> entangible-host` | uses `sudo` |
| `status` | Prints **one line of JSON** on stdout (see below). Exits 0 whether or not the booth is running. | no |
| `url` | Prints the booth-screen (kiosk) URL as one line. | no |
| `url --visitor` | Prints the URL phones open as one line. | no |
| `doctor` | The host's preflight checklist (app build, camera, port, TLS, token), run as the desktop user with `/etc/default/entangible` loaded. Exits 0 only when every row is green. Works with the service stopped or running, see [doctor](#doctor). | no |
| `--version` | `entangible <git describe> (bundle <installed tag>, expects <BUNDLE_TAG>)` | no |
| `-h`, `--help` | Usage | no |

`--help`, `url`, `status` and usage errors need neither systemd nor an
install.

### On demand: `install --no-enable` (recommended for the RasQberry launcher)

RasQberry starts a demo only when it is opened. A default install enables
`entangible-host`, so it runs from every boot and holds port 8443, the camera
and RAM even when nobody uses it. For the RasQberry menu, install with
`entangible install --no-enable`, then call `entangible start` when the demo is
opened and `entangible stop` when it is closed. `status` reports
`"enabled":false` for such an install. A dedicated booth Pi keeps the default
(or `--kiosk`), so the booth comes back on its own after a reboot.

### Uninstall

| What | `uninstall` | `--purge` adds | Kept by both |
|---|---|---|---|
| systemd unit (stopped, disabled) | removed | | |
| Kiosk autostart | removed | | |
| `/etc/default/entangible` | | removed | |
| `<checkout>/.venv` | | removed | |
| `pocket-app/dist` | | removed, only when install put it there (it carries the `.entangible-bundle` stamp) | a hand-built `dist` |
| `pocket-app/node_modules` | | removed, only when the stamp says `local` (`install --build-web` ran npm) | otherwise (a developer's) |
| `pocket-app/dist.new`, `dist.old` (an interrupted bundle swap) | | removed | |
| TLS cert + operator token (`~/.qamposer-physical/certs`) | | removed; `~/.qamposer-physical` too if that leaves it empty | |
| Kiosk Chromium profile `~/.config/entangible-kiosk` | kept (reused on a reinstall) | removed. Close the kiosk window first: a still-open kiosk is reported and may recreate it. | |
| Booth config in `~/.qamposer-physical` (layout/branding `.toml`, `menu/` packs, Home Connect token) | | | kept: the operator's |
| `uv` (`~/.local/bin/uv`, `uvx`) and its wheel cache `~/.cache/uv` | | | kept: shared tools, see below |
| apt packages (Chromium, picamera2, …; Node 20 + the nodesource apt source after `--build-web`) | | | kept: shared |
| The log `~/.cache/rasqberry/entangible.log`, the checkout | | | kept |
| The cache on `/data` | | | only `--purge-cache` removes it |

`uv` and its cache (about 200 MB on a Pi) are shared tools that other
demos may use, so `--purge` leaves them and prints how to remove them. If
nothing else needs them:

```bash
rm -rf ~/.cache/uv ~/.local/bin/uv ~/.local/bin/uvx
```

(Install puts uv in `~/.local/bin` only when no `uv` was already on `PATH`;
with a usable `/data` cache, its wheel cache is on `/data` instead of
`~/.cache/uv`.)

### doctor

`entangible doctor` runs the host's own `qamposer-physical doctor` and tells
it, through `QAMPOSER_DOCTOR_CONTEXT`, that it runs under this command and
whether `entangible-host` is running. The output then depends on the service:

| | Service stopped (`rasqberry`) | Service running (`rasqberry-running`) |
|---|---|---|
| port row | ✓ when free. ✗ when taken, since the holder is not the booth; the hint names `sudo ss -ltnp 'sport = :<port>'`. | ✓ "held by the running entangible-host service". |
| camera row (`cv2`, `picamera2`) | Probes the device. | Not probed (the service holds it): read from the service's `/api/health`. ✗ when the camera is not connected, or the service does not answer. |
| camera row (`replay`, `push`) | Static check (frames present / nothing to check). | same |
| fixes | Name `entangible install` and `/etc/default/entangible` instead of npm, `uv sync` or CLI flags. | same |
| closing line | `READY — start with: entangible start` | `READY — entangible-host is running (after a settings change: entangible restart)` |

Without the variable (plain `qamposer-physical doctor` on a dev machine) the
output is as before and ends with `start with: qamposer-physical run`. An
unknown value counts as unset. The wrapper sets it after the env file's
values, so the env file cannot override it.

### Exit codes

These are Entangible's own codes. RasQberry's convention is 0 = ok, 130 =
Ctrl+C, anything else = failure. Every code below except 0 and 130 counts as
"failure" there; the finer codes exist to help diagnosis.

| Code | Meaning |
|---|---|
| 0 | ok |
| 1 | generic failure (apt, systemd, venv, build …) |
| 2 | usage error (unknown command or option) |
| 3 | not installed (`start`/`stop`/`restart`/`doctor` before `install`) |
| 4 | download or checksum failure: no network and no usable cached or existing web bundle, a sha256 mismatch, or `uv`/wheels unreachable with a cold cache |
| 5 | unsupported OS/architecture (not Linux, not arm64/x86_64, no systemd) |
| 130 | interrupted (Ctrl+C / SIGTERM). Partial downloads and extractions are removed and the previous install is left intact. |

### `status` JSON

One line on stdout, nothing else on stdout:

```json
{"installed":true,"running":true,"version":"booth-v1-3-g1a2b3c4","bundle":"booth-v1","urls":{"kiosk":"https://localhost:8443/?kiosk&connect=1","visitor":"https://192.168.4.1:8443/?connect=1"},"source":"cv2:0","ready":false,"health":"ok","enabled":true}
```

| Key | Type | Meaning |
|---|---|---|
| `installed` | bool | systemd present, the unit file exists, and the venv entry point exists |
| `running` | bool | `systemctl is-active entangible-host` |
| `version` | string | `git describe --tags --match 'booth-v*' --always --dirty` of the checkout; `BUNDLE_TAG` if it is not a git checkout |
| `bundle` | string or null | Tag of the installed web bundle (from `pocket-app/dist/.entangible-bundle`), `"local"` after `--build-web`, `null` if none is stamped |
| `urls.kiosk` | string | The booth-screen URL. Always `localhost`, since the screen is on the Pi itself and this keeps working with no network. Uses `QAMPOSER_PORT`. |
| `urls.visitor` | string | The URL phones open: `QAMPOSER_ADVERTISE_HOST`, else the LAN IPv4 of the default route |
| `source` | string | `QAMPOSER_SOURCE` from the env file (default `cv2:0`) |
| `ready` | bool or null | Comes from `GET /api/health` (the host returns `{"status":"ok","backend":{…},"camera":{"kind","name","connected","lost","missing"},"clients":N}`). `true` when the host answers and the camera is connected and not lost, which are the server-side rows of the `/debug` READY light. A `cv2` / `picamera2` camera counts as connected only once the host has opened it and received a frame; with no camera attached `camera.missing` is `true` (with a `reason`) from the first answer, so `ready` is `false` from the start. The frames and board rows exist only in the browser. `null` when the host did not answer. |
| `health` | string | `"ok"` when `/api/health` answered with `status: ok`. `"down"` when installed or running but not answering (still starting, or crashed). `"unknown"` when not installed and not answering, or when `curl` is missing. |
| `enabled` | bool | The service starts at boot: the unit file exists and `systemctl is-enabled entangible-host` says `enabled`. `false` after `install --no-enable`, when not installed, or without systemd. |

Fields are only ever added, at the end; parse the line as JSON rather than by
position.

`status` reads `/etc/default/entangible` and never needs root. It probes
`https://localhost:<port>/api/health` with `curl -ks --max-time 2`.

## Where things live

| What | Where | Survives an A/B update? |
|---|---|---|
| Checkout | `$USER_HOME/RasQberry-Two/demos/entangible` (by convention) | no (`/home` is wiped) |
| Version pin for the web app | `deploy/rasqberry/BUNDLE_TAG`, committed (e.g. `booth-v1`) | — |
| Web app | `pocket-app/dist/` + stamp `pocket-app/dist/.entangible-bundle` (`<tag> <sha256>`) | no |
| Python venv | `<checkout>/.venv` (system python3, `--system-site-packages`) | no |
| `uv` | `$USER_HOME/.local/bin/uv`, unless already on `PATH` | no |
| systemd unit | `/etc/systemd/system/entangible-host.service` | no (root fs) |
| Settings | `/etc/default/entangible`. Seeded only if missing (with `QAMPOSER_SOURCE` picked from the cameras found, see [Cameras](#cameras)) and never overwritten. | no (root fs) |
| TLS cert + operator token | `$USER_HOME/.qamposer-physical/certs/` | no |
| Booth layout/branding (optional) | `$USER_HOME/.qamposer-physical/{layout,branding}.toml` | no |
| Kiosk autostart (`--kiosk`) | `$USER_HOME/.config/autostart/entangible-kiosk.desktop` | no |
| Kiosk Chromium profile (made at the first kiosk start) | `$USER_HOME/.config/entangible-kiosk` | no |
| Log of `install`/`uninstall`/`start`/`stop`/`restart`/`doctor` | `$USER_HOME/.cache/rasqberry/entangible.log` (appended, rotated once at ~1 MB) | no |
| Service log | journald: `journalctl -u entangible-host` | — |
| **Cache** | `/data/rasqberry/cache/entangible/` (`web/<tag>/` bundle tarball + `.sha256`, `uv/` wheel cache, `bin/uv`) | **yes** |

### The cache

- It is set in one variable at the top of `deploy/rasqberry/lib.sh`:
  `ENT_CACHE_DIR_DEFAULT="/data/rasqberry/cache/entangible"`. It can be
  overridden per call with `ENTANGIBLE_CACHE_DIR=/some/dir`.
- **Switch it off** with an empty value: `ENTANGIBLE_CACHE_DIR=""` in the
  environment, or set the variable to `""` in `lib.sh`.
- The cache only speeds things up. Install works normally when it is missing,
  cannot be created, or is not writable by the desktop user. The install
  creates the directory as the desktop user and never as root.
- `/data` is small (about 10% of the card). Install writes to the cache only
  while at least `ENTANGIBLE_CACHE_MIN_FREE_MB` (default 1024) MB are free
  there. Below that it still reads what is already cached.
- Only `uninstall --purge-cache` deletes it.

## A/B updates: what `install` repeats

An A/B update wipes the root filesystem and `/home` of the slot. Only `/data`
survives. RasQberry therefore re-runs `entangible install` (from a fresh
checkout) after an update. Each step and its cost on a repeat:

| Step | Cold (first install, empty cache) | Warm (after an update, cache on `/data` filled) |
|---|---|---|
| apt `libcairo2 chromium curl ca-certificates python3-picamera2` | Only the missing packages are installed. Skipped entirely if the image already has them. | same; no `apt-get update` when nothing is missing |
| web bundle | download + sha256 check from the GitHub release | from the cache; no network |
| `uv` | official installer download | copied from the cache |
| venv + `uv sync --frozen` (host + vision only) | wheel downloads (opencv-python-headless, numpy, fastapi …) | from the uv cache; offline retry with `--offline` |
| unit, env file, kiosk entry, `systemctl enable` + `restart` (with `--no-enable`: `disable`, restart only if running) | seconds | seconds |

Expected durations are to be measured on the rig, for Pi 4 and Pi 5, cold and
warm. With a warm cache, no step needs the network and no step builds
anything. Node/npm is never used unless you pass `--build-web`, which on a
Pi 4 takes on the order of 20 minutes. The kit-generator package (CAD,
build123d/OpenCASCADE) is never installed on a booth.

## Versions and pins

- **Git SHA pin:** RasQberry pins the Entangible checkout to a commit or tag.
  That commit fixes the Python code and `deploy/rasqberry/BUNDLE_TAG`.
- **`BUNDLE_TAG`** names the GitHub release whose
  `entangible-web-<tag>.tar.gz` (+ `.sha256`) is the matching prebuilt web app.
  Install downloads it when `pocket-app/dist` is missing or carries a
  different tag. A wrong checksum is refused (exit 4).
- **Releases** are cut by the `booth-release` workflow on a `booth-v*` tag.
  The workflow fails if `BUNDLE_TAG` at the tagged commit is not that tag, so
  a tag and its bundle always match. `booth-vN` is a full release;
  `booth-vN-<suffix>` (e.g. `booth-v2-rc1`) is a prerelease. Booth releases are
  never marked "latest", because the printable-kit `kit-*` releases own the
  `releases/latest/download/…` links.
- **When to bump:** when the web app changes in a way a booth should get,
  commit `BUNDLE_TAG=booth-vN+1` and push that tag on the same commit. A
  checkout between two bumps runs the previous bundle with newer Python code.
  The host↔app protocol is additive, but pin to tagged commits for events.
- Re-running the workflow for an existing tag replaces the assets. Pis that
  already installed it keep their copy, because the stamp matches by tag.
  Prefer a new tag over rebuilding an old one.

## Network

- HTTPS on **port 8443** (`QAMPOSER_PORT`). The certificate is self-signed and
  generated on first start. Its SANs cover the hostname, `<hostname>.local`,
  `localhost`, 127.0.0.1, every LAN IPv4 and the advertised host. It is
  regenerated when the network, the hostname or the advertised host changes
  (the operator token is kept).
- The host binds `0.0.0.0`, so it is LAN-reachable. That is required: visitors'
  phones join it, and a phone can be the camera. A phone's camera needs a
  secure context, which is why TLS is on.
- Hotspot or fixed address: set `QAMPOSER_ADVERTISE_HOST` in
  `/etc/default/entangible`. Printed URLs, QR codes, the TLS cert and
  `entangible url --visitor` then all use it.
- Visitors tap through a certificate warning once. The kiosk Chromium uses
  `--ignore-certificate-errors` on `localhost`. It runs with its own profile
  (`~/.config/entangible-kiosk`), so it is a separate browser process from
  RasQberry's own Chromium and its kiosk and certificate flags take effect.
- **Offline:** everything runs locally (the app, the simulation, golf,
  Quantina). Install with a warm cache is offline too. Only "Transfer to IBM
  Composer" needs the visitor's own internet.

## Cameras

Set `QAMPOSER_SOURCE` in `/etc/default/entangible` and then run
`entangible restart`. Staff can also switch live on `/debug`.

**Auto-pick on the first install.** When `install` seeds the env file (only
then; an existing file is never rewritten), it picks the source from the
hardware: a USB camera → `cv2:0`; else a Pi Camera Module → `picamera2`; else
`cv2:0`. The choice is printed and logged. A USB camera is a video4linux node
whose sysfs device sits on a USB bus (any `/dev/video*` is not enough: a Pi 5
always has ISP/CSI nodes, a Pi 4 codec/ISP nodes). A Pi Camera Module is a
non-USB entry in `rpicam-hello --list-cameras` (or `libcamera-hello`), probed
with a 10 s time limit; missing tools just mean "not detected".
`entangible doctor` prints a one-line hint when the configured source
disagrees with the hardware (e.g. `cv2:0` on a Pi with only a camera module);
it never edits the file. `ENT_SYSFS_ROOT` and `ENT_LIBCAMERA_LIST_CMD` in
`lib.sh` are test hooks only.

| Source | Value |
|---|---|
| USB webcam | `cv2:0` (default), `cv2:1`, … |
| Pi Camera Module | `picamera2` (needs the apt `python3-picamera2`; installed when the archive has it) |
| Phone as camera | `push`. The phone scans the staff QR on `/debug` and streams over the LAN. |
| Recorded demo loop (no camera) | `replay:examples/recordings/bell-sequence` (see below) |

The demo loop is committed in the checkout (48 small JPEG frames, under
1 MB), so it works on a fresh, offline install with nothing generated. The
path is relative to the checkout, which is the service's working directory.
`/debug` lists it as `bell-sequence` (the host's replay directory defaults to
`examples/recordings`). To rebuild it: `uv run python
tests/utils/make_recording.py --example` on a dev machine.

## Resources

To be measured on the rig: RAM and CPU of the host process per source, the
detection fps on Pi 4 vs Pi 5, and the Chromium kiosk's footprint. The vision
pipeline is plain OpenCV/ArUco on the CPU, with no GPU or ML model. The
`/debug` READY panel shows live fps.

## Rig test checklist

Record the time, result and any numbers for each row on **Pi 4 and Pi 5**.
"Simulated wipe" means: `entangible uninstall --purge` (venv, web bundle,
certs, kiosk profile), then
`rm -rf ~/.local/bin/uv ~/.local/bin/uvx ~/.cache/uv ~/.qamposer-physical`
(what `--purge` keeps on purpose), then re-clone the checkout. This leaves
`/data` alone.

### Phase 1: no webcam (replay demo loop + a phone as camera)

1. **Install, cold:** start with an empty `/data/rasqberry/cache/entangible`,
   then run `entangible install --kiosk`. Expect exit 0; note the duration; `status` shows
   `installed:true, running:true, bundle:"<BUNDLE_TAG>"`.
2. **Install, warm after a simulated wipe**, with networking **off**. Expect
   exit 0; note the duration; no downloads in the log.
3. **Repeat install** with nothing changed. Expect a quick no-op apart from the
   restart.
4. **`entangible doctor`** after `entangible stop`. All rows green except the
   camera row (no webcam yet); the last line names `entangible start`. Then
   `entangible start` and run `doctor` again: the port row is ✓ "held by the
   running entangible-host service" and the last line names `entangible restart`.
5. **Replay source:** set `QAMPOSER_SOURCE=replay:examples/recordings/bell-sequence`
   and `entangible restart`. `status` shows `health:"ok", ready:true`. The
   kiosk shows the demo loop.
6. **Phone over the LAN:** open `entangible url --visitor` on a phone and tap
   through the cert warning. The phone follows the booth live.
7. **`/debug` READY:** open the staff debug URL (`journalctl -u entangible-host -n 20`).
   The READY light is green with the replay source.
8. **Camera switch replay ↔ push** on `/debug`: the phone scans the staff QR
   and streams, and detection follows the phone. Switch back to replay.
9. **fps:** read the fps on `/debug` with replay and with push, on Pi 4 and
   on Pi 5. Note RAM/CPU (`systemctl status entangible-host`, `top`).
10. **Kiosk on the touchscreen** (Pi 5 touchscreen; also a Pi 4 with an HDMI
    screen): after login Chromium opens fullscreen on the booth screen and
    touch works.
11. **Hotspot:** set `QAMPOSER_ADVERTISE_HOST` to the AP address and restart.
    A phone on the hotspot joins via the visitor URL and the QR.
12. **Reboot recovery:** reboot. The service comes back on its own, the kiosk
    opens, and `status` shows `ready:true` with the replay source.
13. **Ctrl+C during install** (during the bundle download or `uv sync`, after
    a simulated wipe): exit code 130, no `entangible.*` dirs left in `/tmp`,
    no `pocket-app/dist.new`. A following `install` succeeds.
14. **Uninstall:** `entangible uninstall --purge --purge-cache` (kiosk
    window closed). No unit, no autostart, no `/etc/default/entangible`, no
    `.venv`, no `pocket-app/dist`, no certs, no `~/.config/entangible-kiosk`,
    no cache. `systemctl list-units | grep entangible` is empty. The checkout,
    the log and uv remain; the output prints the command that removes uv.
15. **Log:** `~/.cache/rasqberry/entangible.log` contains the runs above.

### Phase 2: USB webcam (when it arrives)

16. `QAMPOSER_SOURCE=cv2:0`, then `entangible restart`. `entangible doctor`
    (service stopped) shows the camera row green.
17. `/debug` READY is green with the board in view, and tiles are detected.
18. fps with the webcam on Pi 4 vs Pi 5, at 720p and 1080p.
19. Camera switch webcam ↔ push ↔ replay on `/debug`.
20. Unplug the webcam while running: `status` shows `ready:false`. Replug it
    and it recovers.
21. (Optional) Pi Camera Module: `QAMPOSER_SOURCE=picamera2`. This checks that
    the apt picamera2 imports in the venv.
22. **Camera auto-pick:** `uninstall --purge`, then `install` with only a Pi
    Camera Module connected: the log says `QAMPOSER_SOURCE=picamera2` and the
    env file has it. Repeat with a USB webcam plugged in: `cv2:0`. With the
    env file set to `cv2:0` and only the module connected, `doctor` prints
    the hint.

### On-demand install (`--no-enable`)

23. After a default install, run `entangible install --no-enable` while the
    service runs: it is restarted (running, new code), and `status` shows
    `"enabled":false`. Reboot: the service stays down until `entangible start`.
24. `entangible install --no-enable` with the service stopped: it stays
    stopped, and the closing message says so and names `entangible start`.

## Known unknowns (need the rig)

- Install durations, cold and warm, on Pi 4 and Pi 5.
- Whether the Trixie RasQberry image already ships `chromium` and
  `python3-picamera2`. If so, apt is skipped entirely.
- Whether the venv's numpy (from the lock) works with the apt `picamera2`/
  `simplejpeg` built against Debian's numpy. Only matters for the CSI camera.
- Detection fps and RAM/CPU per source on Pi 4 vs Pi 5.
- Kiosk behaviour on the Pi 5 touchscreen under Wayland (labwc).
