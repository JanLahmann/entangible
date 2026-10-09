#!/usr/bin/env bash
# Entangible on Raspberry Pi (RasQberry-style install) — docs/rasqberry.md.
#
# Target: Raspberry Pi OS Bookworm 64-bit, Pi 4 or Pi 5, run as the desktop
# user (NOT root — sudo is used where needed). Idempotent: safe to re-run to
# update an existing install.
#
# What it does:
#   1. apt packages:   python3-picamera2 (Pi camera), libcairo2 (PDF kit),
#                      chromium (kiosk browser), git, curl
#   2. Node.js 20 LTS  (nodesource repo) — builds the pocket app once
#   3. uv              (installed to ~/.local/bin if missing)
#   4. this repo       (used in place when the script runs from a checkout,
#                      else cloned to ~/entangible)
#   5. Python venv     (--system-site-packages so the apt picamera2 is visible)
#                      + `uv sync` + pocket-app build
#   6. systemd unit    entangible-host.service (starts the booth host on boot)
#   7. kiosk autostart entangible-kiosk.desktop (optional, --kiosk)
set -euo pipefail

REPO_URL="https://github.com/JanLahmann/entangible.git"
SERVICE_NAME="entangible-host"
ENV_FILE="/etc/default/entangible"

if [ "$(id -u)" -eq 0 ]; then
  echo "Run this as the desktop user, not root (it uses sudo where needed)." >&2
  exit 1
fi

# --- locate or clone the repo ------------------------------------------------
# When the script runs from inside a checkout, install that checkout in place.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/../../pyproject.toml" ]; then
  REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
else
  REPO_DIR="$HOME/entangible"
fi

KIOSK=0
for arg in "$@"; do
  case "$arg" in
    --kiosk) KIOSK=1 ;;
    *) echo "unknown option: $arg (supported: --kiosk)" >&2; exit 2 ;;
  esac
done

echo "==> Entangible install target: $REPO_DIR"

# --- 1. apt packages ---------------------------------------------------------
sudo apt-get update
# chromium is named `chromium` on current Bookworm, `chromium-browser` earlier.
CHROMIUM_PKG=chromium
apt-cache show chromium >/dev/null 2>&1 || CHROMIUM_PKG=chromium-browser
sudo apt-get install -y git curl libcairo2 python3-picamera2 "$CHROMIUM_PKG"

# --- 2. Node.js 20 LTS (only for the one-time app build) ---------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Installing Node.js 20 (nodesource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# --- 3. uv -------------------------------------------------------------------
if ! command -v uv >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/uv" ]; then
  echo "==> Installing uv"
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"

# --- 4. repo -----------------------------------------------------------------
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
else
  echo "==> Using existing checkout at $REPO_DIR (not pulling — update with git yourself)"
fi
cd "$REPO_DIR"

# --- 5. Python venv + app build ----------------------------------------------
# picamera2 cannot be pip-installed usefully on Pi OS (its libcamera bindings
# are apt-only), so the venv must see the system site-packages.
if [ ! -d .venv ]; then
  uv venv --system-site-packages
fi
uv sync
(cd pocket-app && npm ci && npm run build)

# --- 6. systemd service ------------------------------------------------------
# The service runs the venv's entry point directly (no uv at boot — the booth
# may be offline). Camera/source and flags are set in /etc/default/entangible.
if [ ! -f "$ENV_FILE" ]; then
  sudo tee "$ENV_FILE" >/dev/null <<'EOF'
# Entangible host settings (systemd reads this; see docs/rasqberry.md).
# Source: cv2:0 = first USB camera, picamera2 = the Pi camera module,
#         push = a phone streaming via the staff QR.
QAMPOSER_SOURCE=cv2:0
# Uncomment to pin the hostname/IP printed in QRs and covered by the TLS cert
# (useful on a hotspot): QAMPOSER_ADVERTISE_HOST=entangible.local
EOF
fi

sed -e "s|@USER@|$USER|g" -e "s|@REPO@|$REPO_DIR|g" \
  "$REPO_DIR/deploy/rasqberry/entangible-host.service" \
  | sudo tee "/etc/systemd/system/$SERVICE_NAME.service" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"

# --- 7. optional kiosk autostart ----------------------------------------------
if [ "$KIOSK" -eq 1 ]; then
  mkdir -p "$HOME/.config/autostart"
  sed -e "s|@REPO@|$REPO_DIR|g" \
    "$REPO_DIR/deploy/rasqberry/entangible-kiosk.desktop" \
    > "$HOME/.config/autostart/entangible-kiosk.desktop"
  echo "==> Kiosk autostart installed (chromium opens the booth screen at login)"
fi

echo
echo "==> Done. The host is running:  sudo systemctl status $SERVICE_NAME"
echo "    Booth screen URL + staff debug URL:  journalctl -u $SERVICE_NAME -n 20"
echo "    Camera/source settings:              $ENV_FILE (then: sudo systemctl restart $SERVICE_NAME)"
