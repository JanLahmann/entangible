#!/usr/bin/env bash
# Launch Chromium in kiosk mode on the booth screen once the host answers.
# Installed via entangible-kiosk.desktop (XDG autostart); also fine to run by
# hand. The cert is self-signed, hence --ignore-certificate-errors — the page
# is served by this same machine over localhost. Port/TLS come from
# /etc/default/entangible (via lib.sh), so a changed QAMPOSER_PORT just works.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

URL="$(ent_kiosk_url)"
HEALTH="$(ent_health_url)"

# Wait for the host (fresh boots race the systemd service; cap at ~60 s).
for _ in $(seq 60); do
  curl -ksf "$HEALTH" >/dev/null 2>&1 && break
  sleep 1
done

# Trixie ships `chromium`; `chromium-browser` covers older images.
BROWSER=$(command -v chromium || command -v chromium-browser)
# A dedicated profile: RasQberry autostarts its own Chromium (default profile)
# at login, and Chromium's singleton would just hand our URL to that window,
# dropping --kiosk and --ignore-certificate-errors. A separate --user-data-dir
# makes this its own browser process. It lives in /home (an A/B update wipes
# it; it is simply recreated). A fresh profile shows first-run UI and the
# keyring unlock prompt on Pi OS, hence --no-first-run --password-store=basic.
PROFILE="${XDG_CONFIG_HOME:-$HOME/.config}/entangible-kiosk"
mkdir -p "$PROFILE"
exec "$BROWSER" --user-data-dir="$PROFILE" --no-first-run \
  --password-store=basic --kiosk --noerrdialogs \
  --disable-session-crashed-bubble --ignore-certificate-errors "$URL"
