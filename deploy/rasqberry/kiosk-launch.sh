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
exec "$BROWSER" --kiosk --noerrdialogs --disable-session-crashed-bubble \
  --ignore-certificate-errors "$URL"
