#!/usr/bin/env bash
# Launch Chromium in kiosk mode on the booth screen once the host answers.
# Installed via entangible-kiosk.desktop (XDG autostart); also fine to run by
# hand. The cert is self-signed, hence --ignore-certificate-errors — the page
# is served by this same machine over localhost.
set -u

URL="https://localhost:8443/?kiosk&connect=1"

# Wait for the host (fresh boots race the systemd service; cap at ~60 s).
for _ in $(seq 60); do
  curl -ksf "https://localhost:8443/api/health" >/dev/null 2>&1 && break
  sleep 1
done

BROWSER=$(command -v chromium || command -v chromium-browser)
exec "$BROWSER" --kiosk --noerrdialogs --disable-session-crashed-bubble \
  --ignore-certificate-errors "$URL"
