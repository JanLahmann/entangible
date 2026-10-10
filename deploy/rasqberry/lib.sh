# shellcheck shell=bash
# shellcheck disable=SC2034  # variables here are used by the scripts that source it
# Shared helpers for deploy/rasqberry (install.sh, entangible, kiosk-launch.sh).
# Sourced, never executed. Contract: docs/rasqberry-integration.md.
#
# Everything here is plain functions + variables with ENT_/ENTANGIBLE_ names,
# so sourcing it has no side effects beyond defining them. Paths that tests
# (or an unusual RasQberry layout) need to redirect are env-overridable:
#
#   ENTANGIBLE_ENV_FILE   settings file the unit reads   (/etc/default/entangible)
#   ENTANGIBLE_UNIT       systemd unit name              (entangible-host)
#   ENTANGIBLE_UNIT_DIR   where the unit file goes       (/etc/systemd/system)
#   ENTANGIBLE_CACHE_DIR  optional cache on /data; EMPTY disables caching
#   USER_HOME             the desktop user's home (else from passwd)
#
# Test hooks only (camera detection, see ent_detect_source):
#   ENT_SYSFS_ROOT          sysfs mount point                 (/sys)
#   ENT_LIBCAMERA_LIST_CMD  camera-list command; "" disables  (rpicam-hello /
#                           libcamera-hello --list-cameras)

# --- the one place the cache location lives ---------------------------------
# A/B updates wipe / and /home, only /data survives — so a warm cache here makes
# a reinstall after an update offline-capable and fast. Pure accelerator:
# missing / unwritable / low on space => install works normally without it.
# `${VAR-default}` (no colon) on purpose: ENTANGIBLE_CACHE_DIR="" disables it.
ENT_CACHE_DIR_DEFAULT="/data/rasqberry/cache/entangible"
ENT_CACHE_DIR="${ENTANGIBLE_CACHE_DIR-$ENT_CACHE_DIR_DEFAULT}"
# /data is only ~10% of the card: never write the cache below this much free.
ENT_CACHE_MIN_FREE_MB="${ENTANGIBLE_CACHE_MIN_FREE_MB:-1024}"

ENT_ENV_FILE="${ENTANGIBLE_ENV_FILE:-/etc/default/entangible}"
ENT_UNIT="${ENTANGIBLE_UNIT:-entangible-host}"
ENT_UNIT_DIR="${ENTANGIBLE_UNIT_DIR:-/etc/systemd/system}"
ENT_DEFAULT_PORT=8443
ENT_DEFAULT_SOURCE="cv2:0"
ENT_GITHUB_REPO="JanLahmann/entangible"

# Exit codes (our own scheme; RasQberry treats every non-zero except 130 as
# "failure"). Keep in step with docs/rasqberry-integration.md.
ENT_EXIT_FAIL=1
ENT_EXIT_USAGE=2
ENT_EXIT_NOT_INSTALLED=3
ENT_EXIT_DOWNLOAD=4
ENT_EXIT_UNSUPPORTED=5
ENT_EXIT_INTERRUPTED=130

# --- repo layout -------------------------------------------------------------
# lib.sh lives in <repo>/deploy/rasqberry, wherever the checkout is (RasQberry
# puts it at ~/RasQberry-Two/demos/entangible, but nothing depends on that).
ENT_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENT_REPO_DIR="$(cd "$ENT_LIB_DIR/../.." && pwd)"
ENT_DIST_DIR="$ENT_REPO_DIR/pocket-app/dist"
ENT_STAMP_FILE="$ENT_DIST_DIR/.entangible-bundle"
ENT_VENV_DIR="$ENT_REPO_DIR/.venv"

ent_unit_file() { printf '%s/%s.service\n' "$ENT_UNIT_DIR" "$ENT_UNIT"; }

# The release tag of the prebuilt web bundle this checkout expects.
ent_bundle_tag() {
  local f="$ENT_LIB_DIR/BUNDLE_TAG"
  [ -f "$f" ] || return 1
  tr -d '[:space:]' <"$f"
}

# The tag recorded in the installed bundle's stamp ("<tag> <sha256>"), if any.
ent_installed_bundle() {
  [ -f "$ENT_STAMP_FILE" ] || return 1
  local tag
  tag="$(awk 'NR==1{print $1}' "$ENT_STAMP_FILE")"
  [ -n "$tag" ] && printf '%s\n' "$tag"
}

# git describe of the checkout; falls back to BUNDLE_TAG (e.g. a tarball copy).
# safe.directory: root reading a user-owned checkout must not trip git's
# "dubious ownership" refusal (read-only use, nothing is written).
ent_version() {
  local v=""
  if command -v git >/dev/null 2>&1 && [ -e "$ENT_REPO_DIR/.git" ]; then
    v="$(git -c safe.directory="$ENT_REPO_DIR" -C "$ENT_REPO_DIR" \
      describe --tags --match 'booth-v*' --always --dirty 2>/dev/null || true)"
  fi
  [ -n "$v" ] || v="$(ent_bundle_tag 2>/dev/null || true)"
  printf '%s\n' "${v:-unknown}"
}

# --- user resolution ---------------------------------------------------------
# The desktop user is whatever name was set in Raspberry Pi Imager — never
# assume `rasqberry` or `pi`. Order: $SUDO_USER (when not root) > the current
# user when not root > the uid-1000 user. Home: $USER_HOME > passwd entry.
# Overridable for tests: _ent_euid, _ent_getent.
_ent_euid() { id -u; }
_ent_getent() { command -v getent >/dev/null 2>&1 && getent "$@"; }

ent_resolve_user() {
  local user="" entry=""
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    user="$SUDO_USER"
  elif [ "$(_ent_euid)" != "0" ]; then
    user="$(id -un)"
  else
    entry="$(_ent_getent passwd 1000 || true)"
    user="${entry%%:*}"
  fi
  if [ -z "$user" ]; then
    echo "entangible: cannot determine the desktop user (no \$SUDO_USER, no uid 1000)" >&2
    return 1
  fi
  local home="${USER_HOME:-}"
  if [ -z "$home" ]; then
    [ -n "$entry" ] || entry="$(_ent_getent passwd "$user" || true)"
    home="$(printf '%s' "$entry" | cut -d: -f6)"
  fi
  if [ -z "$home" ] && [[ "$user" =~ ^[A-Za-z0-9._-]+$ ]]; then
    # No getent (e.g. macOS dev box): let the shell expand ~user.
    home="$(eval "printf '%s' ~$user")"
  fi
  if [ -z "$home" ] || [ "${home:0:1}" != "/" ]; then
    echo "entangible: cannot determine the home of user '$user' (set USER_HOME)" >&2
    return 1
  fi
  ENT_USER="$user"
  ENT_HOME="$home"
  ENT_LOG_FILE="$ENT_HOME/.cache/rasqberry/entangible.log"
}

ent_is_root() { [ "$(_ent_euid)" = "0" ]; }

# Run as the desktop user: user-owned files (venv, bundle, uv, cache) must
# never end up root-owned in the checkout or home.
ent_as_user() {
  if ent_is_root && [ "${ENT_USER:-root}" != "root" ]; then
    sudo -u "$ENT_USER" -H "$@"
  else
    "$@"
  fi
}

# Run privileged (apt, systemd, /etc): directly as root, else via sudo.
ent_as_root() {
  if ent_is_root; then "$@"; else sudo "$@"; fi
}

# --- log ---------------------------------------------------------------------
# RasQberry's bug-report tool collects ~/.cache/rasqberry. Mirror stdout and
# stderr there (separately, so `status` JSON on stdout stays clean). tee ignores
# SIGINT so the Ctrl+C cleanup messages still reach the log and the terminal.
ent_start_log() {
  local label="$1"
  [ -n "${ENT_LOG_FILE:-}" ] || return 0
  ent_as_user mkdir -p "$(dirname "$ENT_LOG_FILE")" 2>/dev/null || return 0
  # Keep it bounded: one rotation at ~1 MB is plenty for a bug report.
  if [ -f "$ENT_LOG_FILE" ] && [ "$(wc -c <"$ENT_LOG_FILE")" -gt 1048576 ]; then
    ent_as_user mv -f "$ENT_LOG_FILE" "$ENT_LOG_FILE.1" 2>/dev/null || true
  fi
  ent_as_user touch "$ENT_LOG_FILE" 2>/dev/null || return 0
  [ -w "$ENT_LOG_FILE" ] || return 0
  printf '\n=== %s  entangible %s  (uid %s, version %s)\n' \
    "$(date '+%Y-%m-%d %H:%M:%S')" "$label" "$(_ent_euid)" "$(ent_version)" \
    >>"$ENT_LOG_FILE"
  exec > >(trap '' INT; exec tee -a "$ENT_LOG_FILE") \
    2> >(trap '' INT; exec tee -a "$ENT_LOG_FILE" >&2)
}

# --- settings (/etc/default/entangible) -------------------------------------
# Read one KEY from the env file without executing it (it is systemd syntax:
# KEY=VALUE, optional quotes, # comments). Falls back to the process env.
ent_env_get() {
  local key="$1" val=""
  if [ -r "$ENT_ENV_FILE" ]; then
    val="$(sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "$ENT_ENV_FILE" | tail -n 1)"
    val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
  fi
  if [ -z "$val" ]; then
    val="${!key:-}"
  fi
  printf '%s\n' "$val"
}

# Every KEY=VALUE line of the env file as `KEY=VALUE` words (for `env ...`).
ent_env_assignments() {
  [ -r "$ENT_ENV_FILE" ] || return 0
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"; val="${BASH_REMATCH[2]}"
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
    printf '%s=%s\n' "$key" "$val"
  done <"$ENT_ENV_FILE"
}

ent_port() { local p; p="$(ent_env_get QAMPOSER_PORT)"; printf '%s\n' "${p:-$ENT_DEFAULT_PORT}"; }
ent_source() { local s; s="$(ent_env_get QAMPOSER_SOURCE)"; printf '%s\n' "${s:-$ENT_DEFAULT_SOURCE}"; }

ent_scheme() {
  case "$(ent_env_get QAMPOSER_NO_TLS | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) echo http ;;
    *) echo https ;;
  esac
}

# The address phones should use: QAMPOSER_ADVERTISE_HOST, else the LAN IPv4 the
# default route leaves through (same idea as the host's primary_lan_ip()).
ent_lan_host() {
  local h
  h="$(ent_env_get QAMPOSER_ADVERTISE_HOST)"
  if [ -z "$h" ] && command -v ip >/dev/null 2>&1; then
    h="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1)"
  fi
  if [ -z "$h" ] && command -v hostname >/dev/null 2>&1; then
    h="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  printf '%s\n' "${h:-127.0.0.1}"
}

# The booth screen runs on this machine, so the kiosk URL is localhost — it
# keeps working with no network at all. Visitors get the LAN/advertised host.
ent_kiosk_url() { printf '%s://localhost:%s/?kiosk&connect=1\n' "$(ent_scheme)" "$(ent_port)"; }
ent_visitor_url() { printf '%s://%s:%s/?connect=1\n' "$(ent_scheme)" "$(ent_lan_host)" "$(ent_port)"; }
ent_health_url() { printf '%s://localhost:%s/api/health\n' "$(ent_scheme)" "$(ent_port)"; }

# --- camera auto-detection ------------------------------------------------------
# Used to seed QAMPOSER_SOURCE on a fresh install and for the doctor hint.
# Never fails: missing tools / sysfs just mean "not detected".

# A USB (UVC) camera: a video4linux node whose device resolves under a USB bus.
# NOT "any /dev/video*": a Pi 5 always has ISP/CSI front-end nodes (pispbe,
# rp1-cfe) and a Pi 4 has bcm2835-codec/isp nodes. UVC makes two nodes per
# camera (capture index 0 + metadata index 1); only the capture one counts.
ent_has_usb_camera() {
  local dev real idx
  for dev in "${ENT_SYSFS_ROOT:-/sys}"/class/video4linux/video*; do
    [ -e "$dev/device" ] || continue
    real="$(readlink -f "$dev/device" 2>/dev/null)" || continue
    case "$real" in */usb[0-9]*/*) ;; *) continue ;; esac
    idx="$(cat "$dev/index" 2>/dev/null || echo 0)"
    [ "$idx" = "0" ] && return 0
  done
  return 1
}

# A Pi camera module (CSI): `rpicam-hello --list-cameras` (older images:
# libcamera-hello) lists it as "N : <sensor> [...] (<path>)". libcamera lists
# UVC cameras too — their path/id contains "usb", so those are skipped.
# Time-limited: a wedged camera stack must not hang the install.
ent_has_pi_camera() {
  local probe=() out="" c
  if [ -n "${ENT_LIBCAMERA_LIST_CMD+x}" ]; then
    read -r -a probe <<<"$ENT_LIBCAMERA_LIST_CMD"
  else
    for c in rpicam-hello libcamera-hello; do
      if command -v "$c" >/dev/null 2>&1; then probe=("$c" --list-cameras); break; fi
    done
  fi
  [ "${#probe[@]}" -gt 0 ] && command -v "${probe[0]}" >/dev/null 2>&1 || return 1
  if command -v timeout >/dev/null 2>&1; then probe=(timeout 10 "${probe[@]}"); fi
  # The listing goes to stdout or stderr depending on the rpicam-apps version.
  out="$("${probe[@]}" 2>&1 </dev/null || true)"
  printf '%s\n' "$out" | grep -E '^[[:space:]]*[0-9]+[[:space:]]+:[[:space:]]' \
    | grep -vi 'usb' >/dev/null  # no -q: an early exit could SIGPIPE under pipefail
}

# The source a fresh install should use: USB camera > Pi camera module > cv2:0.
ent_detect_source() {
  if ent_has_usb_camera; then
    echo "cv2:0"
  elif ent_has_pi_camera; then
    echo "picamera2"
  else
    echo "$ENT_DEFAULT_SOURCE"
  fi
}

# One hint line when the configured source disagrees with the hardware found
# (nothing otherwise). Hint only: the env file is never edited for the user.
ent_source_hint() {
  local src want=""
  src="$(ent_source)"
  case "$src" in
    cv2:*)
      ent_has_usb_camera || { ent_has_pi_camera && want="picamera2"; } ;;
    picamera2)
      ent_has_pi_camera || { ent_has_usb_camera && want="cv2:0"; } ;;
  esac
  [ -n "$want" ] || return 0
  printf 'hint: QAMPOSER_SOURCE=%s, but this Pi has %s — set QAMPOSER_SOURCE=%s in %s, then: entangible restart\n' \
    "$src" "$([ "$want" = picamera2 ] && echo 'a Pi camera module and no USB camera' || echo 'a USB camera and no Pi camera module')" \
    "$want" "$ENT_ENV_FILE"
}

# --- platform ----------------------------------------------------------------
# Linux on arm64 (Pi 4/5) or x86_64 (dev/CI) only; Trixie is the supported
# release — anything else warns but proceeds.
ent_check_platform() {
  local os arch codename=""
  os="$(uname -s)"; arch="$(uname -m)"
  if [ "$os" != "Linux" ]; then
    echo "entangible: unsupported OS '$os' (Linux / Raspberry Pi OS only)" >&2
    return "$ENT_EXIT_UNSUPPORTED"
  fi
  case "$arch" in
    aarch64|arm64|x86_64) ;;
    *) echo "entangible: unsupported architecture '$arch' (arm64 or x86_64 only)" >&2
       return "$ENT_EXIT_UNSUPPORTED" ;;
  esac
  if [ -r /etc/os-release ]; then
    codename="$(sed -n 's/^VERSION_CODENAME=//p' /etc/os-release | tr -d '"')"
  fi
  if [ "$codename" != "trixie" ]; then
    echo "WARNING: this is '${codename:-unknown}', not Debian/Raspberry Pi OS trixie — untested, continuing." >&2
  fi
  return 0
}

# --- misc ----------------------------------------------------------------------
ent_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# Minimal JSON string escaping for status output (no python needed).
ent_json_str() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"; s="${s//$'\r'/\\r}"; s="${s//$'\t'/\\t}"
  printf '"%s"' "$s"
}
