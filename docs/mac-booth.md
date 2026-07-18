# Running the Entangible booth on a Mac

The kiosk host runs on macOS as well as on a Raspberry Pi. A Mac is the easiest
way to demo Entangible: a built-in or USB webcam works out of the box, an iPhone
can stream to it over the LAN (see [`iphone-capture.md`](iphone-capture.md)), and
Continuity Camera turns an iPhone into a wired-quality overhead camera with no
streaming at all.

This guide covers the Mac-specific setup: TLS, the macOS Application Firewall
(which blocks LAN access until you allow it), and the camera options.

## Quick start

```bash
# From the repo root, once:
uv sync
(cd display-app && npm ci && npm run build)

# Run the host (self-signed HTTPS on :8443 by default):
uv run qamposer-physical run --source cv2:0        # a Mac/USB webcam
# or, with no camera at all (recorded fixtures loop forever):
uv run qamposer-physical run --source replay:tests/fixtures/recordings/bell-sequence
```

On start the host prints the URLs:

```
Entangible host → https://192.168.178.107:8443/   (source: cv2:0, backend: off)
  capture page:  https://192.168.178.107:8443/capture
  debug preview: https://192.168.178.107:8443/debug/snapshot.jpg
```

Open `https://<that-ip>:8443/` on the booth screen. `/debug` shows the annotated
camera preview, the marker table, and a **Phone camera** card with the QR code
and cert-tap-through steps.

## TLS: on by default, `--no-tls` for local dev

An iPhone's `getUserMedia` only runs on a **secure context** (HTTPS or
`localhost`), so the host serves HTTPS from a self-signed certificate by default.
The cert is generated on first run into `~/.qamposer-physical/certs/`, with SANs
covering the hostname + every LAN IPv4 (it is regenerated automatically after you
change networks). See [`certs.py`](../packages/qamposer-physical-host/src/qamposer_host/certs.py).

- **Default (TLS):** phones and other LAN browsers can use the camera; each device
  taps through the self-signed-cert warning once (documented in
  [`iphone-capture.md`](iphone-capture.md)).
- **`--no-tls`:** plain HTTP. Fine when the *only* client is the Mac itself
  (`https://localhost` / `http://localhost` are both secure contexts) or when you
  run the Vite dev server. Phones cannot use their camera over plain `http://<ip>`.

```bash
uv run qamposer-physical run --no-tls          # http://<ip>:8443, dev only
```

Print the phone-capture QR straight to the terminal without opening `/debug`:

```bash
uv run qamposer-physical qr                    # https URL + ASCII QR
uv run qamposer-physical qr --no-tls           # http URL variant
```

## macOS Application Firewall — allow LAN access

If the macOS firewall is on (System Settings → Network → Firewall), incoming LAN
connections to the host are **blocked until you approve them** — the booth screen
on the Mac still works via `localhost`, but phones and other machines on the LAN
time out. Approve it once:

### The reliable path: System Settings GUI

1. Open **System Settings → Network → Firewall → Options…**
2. The **first time** the host binds the port, macOS pops up
   *"Do you want the application 'python…' to accept incoming network
   connections?"* — click **Allow**. If you clicked *Deny*, or no prompt appeared,
   continue below.
3. In **Options…**, click **+**, and add the **exact Python binary** that runs the
   host (the venv's real interpreter, see below). Set it to **Allow incoming
   connections**.
4. Make sure **"Block all incoming connections"** is **off** and
   **"Automatically allow downloaded/ signed software"** does not override your
   rule.

### Find the venv's real Python binary

The firewall keys on the real executable, not the `python` symlink in the venv.
Resolve it:

```bash
readlink -f "$(uv run python -c 'import sys; print(sys.executable)')"
# e.g. /Users/you/.../.venv/bin/python3.12  →  a real Framework python binary
```

Add **that** resolved path in the firewall Options list.

### Why not `socketfilterfw --add`?

The command-line `socketfilterfw --add /path/to/python` is **unreliable for
unsigned interpreter binaries**: unsigned/ad-hoc-signed Python often gets silently
re-prompted or ignored, and the rule may not stick across runs. The GUI
Allow-on-prompt (or the manual **+** in Options) is the dependable path on current
macOS. If you script it anyway, verify with:

```bash
/usr/libexec/ApplicationFirewall/socketfilterfw --listapps | grep -i python
```

and expect to still confirm the GUI prompt at least once.

## Continuity Camera — an overhead iPhone camera without streaming

On a Mac you often **don't need** the iPhone-browser streaming path at all. With
Continuity Camera, a nearby iPhone appears to the Mac as an ordinary AVFoundation
video device — Entangible sees it through the same `cv2.VideoCapture` source as
any webcam. Mount the iPhone overhead (see [`iphone-capture.md`](iphone-capture.md)
for mounting) and pick it by index:

```bash
uv run qamposer-vision list-cameras     # print openable camera indices
uv run qamposer-physical run --source cv2:1   # whichever index is the iPhone
```

Trade-offs:

- **Continuity Camera** = best image quality, no cert/firewall dance, no browser
  battery drain — but Mac-only and the iPhone must be near the Mac.
- **iPhone-browser streaming** (`/capture`, push source) = works with any host
  (Mac *or* Pi), any phone on the LAN — but needs the HTTPS cert tap-through and
  drains phone battery. This is the M4 path documented in
  [`iphone-capture.md`](iphone-capture.md).

You can switch sources live from a `capture-ui` client or by restarting with a
different `--source`; the booth screen follows.
