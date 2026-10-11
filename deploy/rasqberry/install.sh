#!/usr/bin/env bash
# Entangible on Raspberry Pi (RasQberry) — install / update / uninstall.
# Contract: docs/rasqberry-integration.md · Guide: docs/rasqberry.md.
# Normally called through `deploy/rasqberry/entangible install|uninstall`.
#
# Target: Raspberry Pi OS Trixie (Debian 13, Python 3.13), arm64, Pi 4 or Pi 5.
# Run it as the desktop user (sudo is used for the privileged steps) or as root
# via sudo (user-owned steps then drop to $SUDO_USER / the uid-1000 user).
#
# Built to be repeated: a RasQberry A/B update wipes / and /home, so the whole
# install is redone after every update. It therefore needs no Node/npm (the web
# app comes prebuilt from the GitHub release named in BUNDLE_TAG), skips apt
# when the packages are already there, and caches downloads on /data (the only
# thing that survives an update) so a warm reinstall needs no network.
#
#   install.sh [--kiosk] [--build-web] [--no-enable]
#   install.sh --uninstall [--purge] [--purge-cache]
#
# What install does, in order:
#   1. platform check      Linux arm64/x86_64 (exit 5 otherwise), warn if not trixie
#   2. apt packages        libcairo2 chromium curl ca-certificates (+ python3-picamera2
#                          when the archive has it) — only when something is missing
#   3. web bundle          pocket-app/dist from the BUNDLE_TAG release asset (sha256
#                          verified), or --build-web: npm build locally (Node 20)
#   4. uv + Python venv    --system-site-packages (apt picamera2 must be importable),
#                          `uv sync --frozen` of the booth packages only
#   5. systemd unit        entangible-host.service; /etc/default/entangible seeded
#                          only if missing (the operator may have edited it), with
#                          QAMPOSER_SOURCE auto-picked (USB camera > Pi camera > cv2:0);
#                          enabled + restarted, or with --no-enable disabled and
#                          only restarted if it was already running
#   6. kiosk autostart     with --kiosk: Chromium opens the booth screen at login
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

# Where release bundles are downloaded from (override for a mirror / tests).
BUNDLE_BASE_URL="${ENTANGIBLE_BUNDLE_BASE_URL:-https://github.com/$ENT_GITHUB_REPO/releases/download}"
SYSTEM_PYTHON="${ENTANGIBLE_PYTHON:-/usr/bin/python3}"
AUTOSTART_NAME="entangible-kiosk.desktop"

usage() {
  cat <<'EOF'
usage: install.sh [--kiosk] [--build-web] [--no-enable]
       install.sh --uninstall [--purge] [--purge-cache]

  --kiosk        also autostart Chromium on the booth screen at desktop login
  --no-enable    do not start the service at boot (disable it); start it on
                 demand with `entangible start`. Not with --kiosk.
  --build-web    build pocket-app locally with npm (installs Node 20) instead of
                 downloading the prebuilt release bundle
  --uninstall    stop + remove the service and the kiosk autostart
  --purge        with --uninstall: also remove /etc/default/entangible, the venv,
                 the downloaded web bundle, the generated TLS certs/token and the
                 kiosk Chromium profile (not uv or its cache: shared tools)
  --purge-cache  with --uninstall: also remove the download cache on /data
EOF
}

KIOSK=0; BUILD_WEB=0; NO_ENABLE=0; UNINSTALL=0; PURGE=0; PURGE_CACHE=0
for arg in "$@"; do
  case "$arg" in
    --kiosk) KIOSK=1 ;;
    --build-web) BUILD_WEB=1 ;;
    --no-enable) NO_ENABLE=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --purge) PURGE=1 ;;
    --purge-cache) PURGE_CACHE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "install.sh: unknown option: $arg" >&2; usage >&2; exit "$ENT_EXIT_USAGE" ;;
  esac
done
if [ "$UNINSTALL" -eq 0 ] && { [ "$PURGE" -eq 1 ] || [ "$PURGE_CACHE" -eq 1 ]; }; then
  echo "install.sh: --purge / --purge-cache only go with --uninstall" >&2
  exit "$ENT_EXIT_USAGE"
fi
if [ "$UNINSTALL" -eq 1 ] && [ "$NO_ENABLE" -eq 1 ]; then
  echo "install.sh: --no-enable only goes with an install" >&2
  exit "$ENT_EXIT_USAGE"
fi
if [ "$KIOSK" -eq 1 ] && [ "$NO_ENABLE" -eq 1 ]; then
  echo "install.sh: --no-enable cannot go with --kiosk (the kiosk needs the service at boot)" >&2
  exit "$ENT_EXIT_USAGE"
fi

if [ ! -f "$ENT_REPO_DIR/pyproject.toml" ] || [ ! -d "$ENT_REPO_DIR/pocket-app" ]; then
  echo "install.sh must run from inside an Entangible checkout (looked in $ENT_REPO_DIR)" >&2
  exit "$ENT_EXIT_FAIL"
fi

ent_resolve_user || exit "$ENT_EXIT_FAIL"
if [ -z "${ENT_LOG_STARTED:-}" ]; then
  ent_start_log "install.sh $*"
fi

# --- Ctrl+C: drop partial downloads/extractions, exit 130 ---------------------
# Everything half-written lives in TMP_PATHS until it is atomically moved into
# place, so removing them leaves the previous install intact.
TMP_PATHS=()
cleanup_tmp() {
  local p
  for p in "${TMP_PATHS[@]+"${TMP_PATHS[@]}"}"; do
    [ -n "$p" ] && rm -rf -- "$p" 2>/dev/null || true
  done
}
on_interrupt() {
  trap - INT TERM
  echo >&2
  echo "==> Interrupted — removing partial downloads; the previous install is untouched." >&2
  cleanup_tmp
  exit "$ENT_EXIT_INTERRUPTED"
}
trap on_interrupt INT TERM
trap cleanup_tmp EXIT

say() { echo "==> $*"; }

# --- cache on /data (optional accelerator) -------------------------------------
# CACHE_OK=1 only when the dir is (or can be made) user-owned + writable and has
# at least ENT_CACHE_MIN_FREE_MB free. Reading a cached file needs only CACHE_RO.
CACHE_OK=0; CACHE_RO=0
setup_cache() {
  if [ -z "$ENT_CACHE_DIR" ]; then
    say "Cache disabled (ENTANGIBLE_CACHE_DIR is empty)"
    return 0
  fi
  [ -d "$ENT_CACHE_DIR" ] && [ -r "$ENT_CACHE_DIR" ] && CACHE_RO=1
  if [ ! -d "$ENT_CACHE_DIR" ]; then
    # Created as the user, so a missing/root-owned /data parent just means no cache.
    ent_as_user mkdir -p "$ENT_CACHE_DIR" 2>/dev/null || {
      say "No cache: cannot create $ENT_CACHE_DIR as $ENT_USER (continuing without)"
      return 0
    }
    CACHE_RO=1
  fi
  if ! ent_as_user test -w "$ENT_CACHE_DIR"; then
    say "Cache $ENT_CACHE_DIR is not writable by $ENT_USER — using it read-only"
    return 0
  fi
  local free_mb
  free_mb="$(df -Pm "$ENT_CACHE_DIR" 2>/dev/null | awk 'NR==2{print $4}')"
  if [ -z "$free_mb" ] || [ "$free_mb" -lt "$ENT_CACHE_MIN_FREE_MB" ]; then
    say "Cache $ENT_CACHE_DIR: only ${free_mb:-?} MB free (< $ENT_CACHE_MIN_FREE_MB) — not writing to it"
    return 0
  fi
  CACHE_OK=1
  say "Cache: $ENT_CACHE_DIR (${free_mb} MB free)"
}

# =============================================================================
# uninstall
# =============================================================================
do_uninstall() {
  local unit_file removed=0
  unit_file="$(ent_unit_file)"
  say "Uninstalling Entangible (checkout $ENT_REPO_DIR is kept)"
  if [ -f "$unit_file" ]; then
    if command -v systemctl >/dev/null 2>&1; then
      ent_as_root systemctl disable --now "$ENT_UNIT" 2>/dev/null || true
    fi
    ent_as_root rm -f "$unit_file"
    command -v systemctl >/dev/null 2>&1 && ent_as_root systemctl daemon-reload || true
    echo "    removed  $unit_file (service stopped + disabled)"; removed=1
  fi
  local autostart="$ENT_HOME/.config/autostart/$AUTOSTART_NAME"
  if [ -f "$autostart" ]; then
    ent_as_user rm -f "$autostart"
    echo "    removed  $autostart"; removed=1
  fi
  if [ "$PURGE" -eq 1 ]; then
    # Read the cert dir BEFORE the env file goes; default as in the host config.
    local cert_dir
    cert_dir="$(ent_env_get QAMPOSER_CERT_DIR)"
    if [ -z "$cert_dir" ]; then
      local cfg; cfg="$(ent_env_get QAMPOSER_CONFIG_DIR)"
      cert_dir="${cfg:-$ENT_HOME/.qamposer-physical}/certs"
    fi
    if [ -f "$ENT_ENV_FILE" ]; then
      ent_as_root rm -f "$ENT_ENV_FILE"; echo "    removed  $ENT_ENV_FILE"; removed=1
    fi
    if [ -d "$ENT_VENV_DIR" ]; then
      ent_as_user rm -rf "$ENT_VENV_DIR"; echo "    removed  $ENT_VENV_DIR"; removed=1
    fi
    # Only a bundle we installed (stamped); a hand-made dist is the developer's.
    # A "local" stamp means install --build-web ran npm here: its
    # node_modules (hundreds of MB, rebuilt by npm ci) goes too.
    if [ -f "$ENT_STAMP_FILE" ]; then
      local built_here=0
      [ "$(ent_installed_bundle 2>/dev/null || true)" = "local" ] && built_here=1
      ent_as_user rm -rf "$ENT_DIST_DIR"; echo "    removed  $ENT_DIST_DIR"; removed=1
      if [ "$built_here" -eq 1 ] && [ -d "$ENT_REPO_DIR/pocket-app/node_modules" ]; then
        ent_as_user rm -rf "$ENT_REPO_DIR/pocket-app/node_modules"
        echo "    removed  $ENT_REPO_DIR/pocket-app/node_modules (from --build-web)"
      fi
    fi
    # Leftovers of an interrupted bundle swap (normally cleaned on exit).
    local p
    for p in "$ENT_DIST_DIR.new" "$ENT_DIST_DIR.old"; do
      if [ -d "$p" ]; then ent_as_user rm -rf "$p"; echo "    removed  $p"; removed=1; fi
    done
    if [ -d "$cert_dir" ]; then
      ent_as_user rm -rf "$cert_dir"; echo "    removed  $cert_dir (TLS cert + operator token)"; removed=1
    fi
    # ~/.qamposer-physical keeps the operator's booth config (layout/branding,
    # menu packs); only an empty dir left by the certs goes.
    local cfg_dir="$ENT_HOME/.qamposer-physical"
    if [ -d "$cfg_dir" ] && ent_as_user rmdir "$cfg_dir" 2>/dev/null; then
      echo "    removed  $cfg_dir (empty)"
    fi
    # The kiosk Chromium's own profile (kiosk-launch.sh; history, cache,
    # cert exceptions). Plain uninstall keeps it: harmless, reused on reinstall.
    local profile="$ENT_HOME/.config/entangible-kiosk"
    if [ -d "$profile" ]; then
      if command -v pgrep >/dev/null 2>&1 && pgrep -f -- "--user-data-dir=$profile" >/dev/null 2>&1; then
        echo "    WARNING: the kiosk Chromium is still open; close it (it may recreate $profile)" >&2
      fi
      ent_as_user rm -rf "$profile"; echo "    removed  $profile (kiosk Chromium profile)"; removed=1
    fi
  fi
  if [ "$PURGE_CACHE" -eq 1 ] && [ -n "$ENT_CACHE_DIR" ] && [ -d "$ENT_CACHE_DIR" ]; then
    ent_as_user rm -rf "$ENT_CACHE_DIR" 2>/dev/null || ent_as_root rm -rf "$ENT_CACHE_DIR"
    echo "    removed  $ENT_CACHE_DIR (download cache)"; removed=1
  fi
  [ "$removed" -eq 1 ] || echo "    nothing to remove"
  echo "    kept: the checkout, apt packages (shared), ~/.qamposer-physical booth config, the log"
  if [ "$PURGE" -eq 1 ]; then
    # Shared tools, never purged (other demos may use them). ~200 MB on a Pi.
    echo "    kept (shared tools, ~200 MB): uv and its wheel cache; if nothing else uses them:"
    echo "      rm -rf $ENT_HOME/.cache/uv $ENT_HOME/.local/bin/uv $ENT_HOME/.local/bin/uvx"
  else
    echo "    kept (--purge removes them): settings, venv, web bundle, TLS certs, kiosk profile"
  fi
  return 0
}

if [ "$UNINSTALL" -eq 1 ]; then
  do_uninstall
  exit 0
fi

# =============================================================================
# install
# =============================================================================
rc=0; ent_check_platform || rc=$?
[ "$rc" -eq 0 ] || exit "$rc"

say "Entangible install: $ENT_REPO_DIR (user $ENT_USER, home $ENT_HOME)"
if [ "$(stat -c %U "$ENT_REPO_DIR" 2>/dev/null || echo "$ENT_USER")" != "$ENT_USER" ]; then
  echo "WARNING: $ENT_REPO_DIR is not owned by $ENT_USER — user-owned steps may fail." >&2
fi
setup_cache

# --- 2. apt packages ---------------------------------------------------------
pkg_installed() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed"
}
install_apt() {
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "WARNING: no apt-get — install libcairo2, chromium, curl yourself." >&2
    return 0
  fi
  local pkgs=(libcairo2 chromium curl ca-certificates)
  # python3-picamera2 comes from the Raspberry Pi archive; a plain Debian/x86
  # box has none — then the Pi camera source is simply unavailable.
  if apt-cache show python3-picamera2 >/dev/null 2>&1; then
    pkgs+=(python3-picamera2)
  else
    say "python3-picamera2 not in the apt archive — skipping (Pi camera source unavailable)"
  fi
  local missing=() p
  for p in "${pkgs[@]}"; do pkg_installed "$p" || missing+=("$p"); done
  if [ "${#missing[@]}" -eq 0 ]; then
    say "apt packages already installed"
    return 0
  fi
  say "apt install: ${missing[*]}"
  ent_as_root apt-get update
  ent_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}"
}
install_apt

# --- 3. web bundle -------------------------------------------------------------
# A fresh temp dir owned by the user, in $TMP_DIR; registered for cleanup on
# any exit. (Sets a global rather than echoing: a $(...) subshell would lose
# the TMP_PATHS registration.)
TMP_DIR=""
user_tmpdir() {
  TMP_DIR="$(ent_as_user mktemp -d "${TMPDIR:-/tmp}/entangible.XXXXXX")" || return 1
  TMP_PATHS+=("$TMP_DIR")
}

# Swap a freshly extracted dir into pocket-app/dist atomically-enough: the old
# dist stays usable until the very last rename.
install_dist_from() {
  local tarball="$1" stamp="$2" new="$ENT_DIST_DIR.new" old="$ENT_DIST_DIR.old"
  TMP_PATHS+=("$new" "$old")
  # Called from an `|| rc=$?` context, where set -e is off: check each step.
  ent_as_user rm -rf "$new" "$old" || return 1
  ent_as_user mkdir -p "$new" || return 1
  ent_as_user tar -xzf "$tarball" -C "$new" --no-same-owner || return 1
  if [ ! -f "$new/index.html" ]; then
    echo "ERROR: $tarball has no index.html — not a web bundle" >&2
    return 1
  fi
  printf '%s\n' "$stamp" | ent_as_user tee "$new/.entangible-bundle" >/dev/null || return 1
  if [ -d "$ENT_DIST_DIR" ]; then ent_as_user mv "$ENT_DIST_DIR" "$old" || return 1; fi
  ent_as_user mv "$new" "$ENT_DIST_DIR" || return 1
  ent_as_user rm -rf "$old"
}

# Verify <tarball> against the hash in <sha-file> ("<hex>  <name>").
verify_sha() {
  local tarball="$1" shafile="$2" want got
  want="$(awk 'NR==1{print $1}' "$shafile" 2>/dev/null || true)"
  got="$(ent_sha256 "$tarball")"
  [ -n "$want" ] && [ "$want" = "$got" ]
}

fetch_bundle() {
  local tag="$1" name="entangible-web-$1.tar.gz"
  local cdir="" tmp tarball shafile
  [ -n "$ENT_CACHE_DIR" ] && cdir="$ENT_CACHE_DIR/web/$tag"

  # Warm cache: no network needed.
  if [ "$CACHE_RO" -eq 1 ] && [ -f "$cdir/$name" ] && [ -f "$cdir/$name.sha256" ]; then
    if verify_sha "$cdir/$name" "$cdir/$name.sha256"; then
      say "Web bundle $tag from cache"
      install_dist_from "$cdir/$name" "$tag $(ent_sha256 "$cdir/$name")" || return "$ENT_EXIT_FAIL"
      return 0
    fi
    say "Cached bundle $tag fails its checksum — downloading again"
  fi

  user_tmpdir || return "$ENT_EXIT_FAIL"
  tmp="$TMP_DIR"; tarball="$tmp/$name"; shafile="$tmp/$name.sha256"
  say "Downloading web bundle $tag"
  if ! ent_as_user curl -fL --retry 3 --connect-timeout 15 -sS \
        -o "$shafile" "$BUNDLE_BASE_URL/$tag/$name.sha256" \
     || ! ent_as_user curl -fL --retry 3 --connect-timeout 15 -sS \
        -o "$tarball" "$BUNDLE_BASE_URL/$tag/$name"; then
    echo "ERROR: could not download $BUNDLE_BASE_URL/$tag/$name" >&2
    return "$ENT_EXIT_DOWNLOAD"
  fi
  if ! verify_sha "$tarball" "$shafile"; then
    echo "ERROR: $name does not match its published sha256 — refusing to install it" >&2
    return "$ENT_EXIT_DOWNLOAD"
  fi
  install_dist_from "$tarball" "$tag $(ent_sha256 "$tarball")" || return "$ENT_EXIT_FAIL"
  if [ "$CACHE_OK" -eq 1 ]; then
    if ent_as_user mkdir -p "$cdir" && ent_as_user cp "$tarball" "$shafile" "$cdir/"; then
      say "Cached bundle in $cdir"
    else
      ent_as_user rm -f "$cdir/$name" "$cdir/$name.sha256" 2>/dev/null || true
      say "Could not write the bundle cache (continuing)"
    fi
  fi
}

build_web_locally() {
  if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
    say "Installing Node.js 20 (nodesource) for --build-web"
    curl -fsSL https://deb.nodesource.com/setup_20.x | ent_as_root bash - || return "$ENT_EXIT_DOWNLOAD"
    ent_as_root apt-get install -y nodejs || return "$ENT_EXIT_FAIL"
  fi
  say "Building pocket-app locally (npm ci && npm run build — slow on a Pi 4)"
  ent_as_user bash -c 'cd "$1/pocket-app" && npm ci && npm run build' _ "$ENT_REPO_DIR" \
    || { echo "ERROR: local web build failed" >&2; return "$ENT_EXIT_FAIL"; }
  local sha
  sha="$(git -c safe.directory="$ENT_REPO_DIR" -C "$ENT_REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
  printf 'local %s\n' "$sha" | ent_as_user tee "$ENT_STAMP_FILE" >/dev/null
}

ensure_web() {
  if [ "$BUILD_WEB" -eq 1 ]; then
    build_web_locally || return $?
    return 0
  fi
  local want have=""
  if ! want="$(ent_bundle_tag)" || [ -z "$want" ]; then
    echo "ERROR: $ENT_LIB_DIR/BUNDLE_TAG is missing — cannot pick a web bundle (or use --build-web)" >&2
    return "$ENT_EXIT_FAIL"
  fi
  [ -f "$ENT_DIST_DIR/index.html" ] && have="$(ent_installed_bundle || true)"
  if [ "$have" = "$want" ]; then
    say "Web bundle $want already installed"
    return 0
  fi
  if [ "$have" = "local" ]; then
    say "Keeping the locally built web app (--build-web); delete pocket-app/dist to switch to $want"
    return 0
  fi
  local rc=0
  fetch_bundle "$want" || rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ -f "$ENT_DIST_DIR/index.html" ]; then
      echo "WARNING: keeping the existing pocket-app/dist (${have:-unversioned}); expected $want." >&2
      return 0
    fi
    echo "ERROR: no usable web app. Check the network and re-run, or build it with --build-web." >&2
    return "$rc"
  fi
}
rc=0; ensure_web || rc=$?
[ "$rc" -eq 0 ] || exit "$rc"

# --- 4. uv + Python venv ---------------------------------------------------------
UV=""
find_uv() {
  if command -v uv >/dev/null 2>&1 && ent_as_user uv --version >/dev/null 2>&1; then
    UV="$(command -v uv)"
  elif [ -x "$ENT_HOME/.local/bin/uv" ]; then
    UV="$ENT_HOME/.local/bin/uv"
  fi
}
find_uv
if [ -z "$UV" ] && [ "$CACHE_RO" -eq 1 ] && [ -x "$ENT_CACHE_DIR/bin/uv" ]; then
  # ~/.local is wiped by an A/B update; the cached binary saves a download.
  say "uv from cache"
  ent_as_user mkdir -p "$ENT_HOME/.local/bin"
  ent_as_user cp "$ENT_CACHE_DIR/bin/uv" "$ENT_HOME/.local/bin/uv"
  find_uv
fi
if [ -z "$UV" ]; then
  say "Installing uv (official installer, to $ENT_HOME/.local/bin)"
  ent_as_user env UV_NO_MODIFY_PATH=1 sh -c 'curl -LsSf https://astral.sh/uv/install.sh | sh' || {
    echo "ERROR: could not install uv (network?)" >&2; exit "$ENT_EXIT_DOWNLOAD"; }
  find_uv
  [ -n "$UV" ] || { echo "ERROR: uv not found after install" >&2; exit "$ENT_EXIT_FAIL"; }
fi
if [ "$CACHE_OK" -eq 1 ] && [ "$UV" = "$ENT_HOME/.local/bin/uv" ] \
   && ! cmp -s "$UV" "$ENT_CACHE_DIR/bin/uv" 2>/dev/null; then
  ent_as_user mkdir -p "$ENT_CACHE_DIR/bin" && ent_as_user cp "$UV" "$ENT_CACHE_DIR/bin/uv" || true
fi

# uv's own cache on /data when usable (wheels survive the update); copy mode
# because /data and /home are different filesystems (no hardlinks).
UV_ENV=(UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never UV_PYTHON="$SYSTEM_PYTHON")
[ "$CACHE_OK" -eq 1 ] && UV_ENV+=(UV_CACHE_DIR="$ENT_CACHE_DIR/uv")

# The venv must be built on the SYSTEM python with --system-site-packages:
# picamera2's libcamera bindings are apt-only. Recreate it if it is broken or
# was made without system site-packages.
venv_ok() {
  [ -x "$ENT_VENV_DIR/bin/python" ] \
    && "$ENT_VENV_DIR/bin/python" -c 'import sys' >/dev/null 2>&1 \
    && grep -q '^include-system-site-packages *= *true' "$ENT_VENV_DIR/pyvenv.cfg" 2>/dev/null
}
if ! venv_ok; then
  say "Creating the venv (system python, --system-site-packages)"
  ent_as_user rm -rf "$ENT_VENV_DIR"
  ent_as_user env "${UV_ENV[@]}" "$UV" venv --system-site-packages --python "$SYSTEM_PYTHON" "$ENT_VENV_DIR"
fi
# Only the booth packages: the workspace also holds the CAD kit generator
# (build123d/OpenCASCADE), which a booth never needs.
sync_cmd=(env "${UV_ENV[@]}" "$UV" sync --frozen --no-dev
          --package qamposer-physical-host --package qamposer-vision)
say "uv sync (host + vision)"
if ! ent_as_user bash -c 'cd "$1" && shift && "$@"' _ "$ENT_REPO_DIR" "${sync_cmd[@]}"; then
  say "uv sync failed — retrying offline from the cache"
  ent_as_user bash -c 'cd "$1" && shift && "$@" --offline' _ "$ENT_REPO_DIR" "${sync_cmd[@]}" || {
    echo "ERROR: uv sync failed (no network and no warm cache?)" >&2; exit "$ENT_EXIT_DOWNLOAD"; }
fi

# --- 5. systemd service ------------------------------------------------------
if ! command -v systemctl >/dev/null 2>&1; then
  echo "ERROR: systemctl not found — the service cannot be installed" >&2
  exit "$ENT_EXIT_UNSUPPORTED"
fi
if [ ! -f "$ENT_ENV_FILE" ]; then
  # Only when seeding: an existing file is the operator's (doctor hints instead).
  SEED_SOURCE="$(ent_detect_source)"
  if [ "$SEED_SOURCE" = "picamera2" ]; then
    say "Pi camera module found — QAMPOSER_SOURCE=picamera2"
  elif ent_has_usb_camera; then
    say "USB camera found — QAMPOSER_SOURCE=$SEED_SOURCE"
  else
    say "No camera detected — QAMPOSER_SOURCE=$SEED_SOURCE (the default; see the env file for others)"
  fi
  say "Seeding $ENT_ENV_FILE"
  ent_as_root tee "$ENT_ENV_FILE" >/dev/null <<EOF
# Entangible host settings (systemd reads this; docs/rasqberry-integration.md).
# Never overwritten by install — edit freely, then: entangible restart
#
# Source: cv2:0 = first USB camera, picamera2 = the Pi camera module,
#         push = a phone streaming via the staff QR,
#         replay:examples/recordings/bell-sequence = the recorded demo loop.
# (Picked at install from the cameras found: USB > Pi camera module > cv2:0.)
QAMPOSER_SOURCE=$SEED_SOURCE
# Pin the hostname/IP printed in QRs and covered by the TLS cert (hotspots):
# QAMPOSER_ADVERTISE_HOST=10.42.0.1
# QAMPOSER_PORT=8443
EOF
else
  say "Keeping existing $ENT_ENV_FILE"
fi

UNIT_FILE="$(ent_unit_file)"
user_tmpdir
unit_tmp="$TMP_DIR/unit"
sed -e "s|@USER@|$ENT_USER|g" -e "s|@REPO@|$ENT_REPO_DIR|g" \
    -e "s|/etc/default/entangible|$ENT_ENV_FILE|g" \
    "$SCRIPT_DIR/entangible-host.service" >"$unit_tmp"
if ! cmp -s "$unit_tmp" "$UNIT_FILE"; then
  say "Installing $UNIT_FILE"
  ent_as_root install -m 0644 "$unit_tmp" "$UNIT_FILE"
  ent_as_root systemctl daemon-reload
fi
# Restart (not just start) so a re-install always runs the new code/bundle.
RUNNING=1
if [ "$NO_ENABLE" -eq 1 ]; then
  # On demand only (RasQberry starts demos when opened): not at boot, so it
  # holds no port/camera/RAM until asked. Disabling is idempotent and turns an
  # earlier default install into an on-demand one.
  ent_as_root systemctl disable --quiet "$ENT_UNIT"
  if systemctl is-active --quiet "$ENT_UNIT" 2>/dev/null; then
    say "Service was running — restarting it on the new code (not started at boot)"
    ent_as_root systemctl restart "$ENT_UNIT"
  else
    RUNNING=0
  fi
  # A kiosk autostart from an earlier --kiosk install would open a dead page
  # at login now that nothing starts the service at boot.
  if [ -f "$ENT_HOME/.config/autostart/$AUTOSTART_NAME" ]; then
    ent_as_user rm -f "$ENT_HOME/.config/autostart/$AUTOSTART_NAME"
    say "Removed the kiosk autostart (it needs the service at boot)"
  fi
else
  ent_as_root systemctl enable --quiet "$ENT_UNIT"
  ent_as_root systemctl restart "$ENT_UNIT"
fi

# --- 6. optional kiosk autostart ---------------------------------------------
if [ "$KIOSK" -eq 1 ]; then
  ent_as_user mkdir -p "$ENT_HOME/.config/autostart"
  sed -e "s|@REPO@|$ENT_REPO_DIR|g" "$SCRIPT_DIR/entangible-kiosk.desktop" \
    | ent_as_user tee "$ENT_HOME/.config/autostart/$AUTOSTART_NAME" >/dev/null
  say "Kiosk autostart installed (Chromium opens the booth screen at login)"
fi

echo
if [ "$RUNNING" -eq 0 ]; then
  say "Done. Entangible is installed; $ENT_UNIT is not running and does not start at boot."
  echo "    start it:      $SCRIPT_DIR/entangible start"
elif [ "$NO_ENABLE" -eq 1 ]; then
  say "Done. Entangible is running as $ENT_UNIT (not started at boot)."
else
  say "Done. Entangible is running as $ENT_UNIT."
fi
echo "    booth screen:  $(ent_kiosk_url)"
echo "    phones join:   $(ent_visitor_url)"
echo "    preflight:     $SCRIPT_DIR/entangible doctor"
echo "    settings:      $ENT_ENV_FILE (then: $SCRIPT_DIR/entangible restart)"
