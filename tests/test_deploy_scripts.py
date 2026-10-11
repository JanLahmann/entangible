"""Sanity gates for deploy/rasqberry (docs/rasqberry.md, docs/rasqberry-integration.md).

No Pi in CI, so these catch what a linter can: shell syntax (+ shellcheck when
installed), the placeholders the installer substitutes, that the unit's entry
point / env file names stay in step with the installer and the host package,
and the parts of the `entangible` command contract that run without systemd:
help/usage exit codes, the one-line status JSON, user resolution, and the
camera auto-detection (against fake sysfs trees and a fake libcamera probe).
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parent.parent
DEPLOY = REPO / "deploy" / "rasqberry"
COMMAND = DEPLOY / "entangible"
LIB = DEPLOY / "lib.sh"
WORKFLOW = REPO / ".github" / "workflows" / "booth-release.yml"

STATUS_KEYS = {
    "installed", "running", "version", "bundle", "urls", "source", "ready", "health",
    "enabled",
}
# The contract's field order: the original fields, then additive ones at the end.
STATUS_ORDER = [
    "installed", "running", "version", "bundle", "urls", "source", "ready", "health",
    "enabled",
]


def _shell_scripts() -> list[Path]:
    return sorted([*DEPLOY.glob("*.sh"), COMMAND])


def _fake_env(tmp_path: Path, **extra: str) -> dict[str, str]:
    """An environment where nothing is installed and nothing real is touched.

    The env file / unit dir point into tmp_path, the cache is disabled, HOME is
    fake, and PATH drops systemctl (so the command must cope without systemd).
    A port nobody listens on keeps the health probe deterministic.
    """
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir(exist_ok=True)
    keep = {"bash", "curl", "git", "sed", "awk", "tr", "cut", "grep", "dirname",
            "readlink", "cat", "head", "tail", "id", "python3", "uname", "date",
            "hostname", "ip", "wc", "mkdir", "touch", "tee", "mv"}
    for tool in keep:
        found = shutil.which(tool)
        if found:
            (fake_bin / tool).symlink_to(found)
    env = {
        "PATH": str(fake_bin),
        "HOME": str(tmp_path / "home"),
        "USER_HOME": str(tmp_path / "home"),
        "ENTANGIBLE_ENV_FILE": str(tmp_path / "entangible.env"),
        "ENTANGIBLE_UNIT_DIR": str(tmp_path / "units"),
        "ENTANGIBLE_CACHE_DIR": "",
        "QAMPOSER_PORT": "1",
    }
    env.update(extra)
    return env


def _run(args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(COMMAND), *args], env=env, capture_output=True, text=True, encoding="utf-8", timeout=30
    )


def _run_install_sh(args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(DEPLOY / "install.sh"), *args],
        env=env, capture_output=True, text=True, encoding="utf-8", timeout=30,
    )


def _fake_tool(env: dict[str, str], name: str, body: str) -> None:
    """Replace (or add) a tool on the fake PATH with a small sh script."""
    tool = Path(env["PATH"]) / name
    if tool.is_symlink() or tool.exists():
        tool.unlink()
    tool.write_text("#!/bin/sh\n" + body, encoding="utf-8")
    tool.chmod(0o755)


# --- static checks -----------------------------------------------------------


def test_shell_scripts_parse() -> None:
    scripts = _shell_scripts()
    assert COMMAND in scripts and LIB in scripts
    for script in scripts:
        subprocess.run(["bash", "-n", str(script)], check=True)


def test_shellcheck_clean() -> None:
    if shutil.which("shellcheck") is None:
        pytest.skip("shellcheck not installed")
    subprocess.run(
        ["shellcheck", "-x", "-S", "warning", *map(str, _shell_scripts())],
        check=True, cwd=DEPLOY,
    )


def test_command_is_executable() -> None:
    for script in (COMMAND, DEPLOY / "install.sh", DEPLOY / "kiosk-launch.sh"):
        assert os.access(script, os.X_OK), f"{script.name} must be chmod +x"


def test_service_placeholders_match_installer() -> None:
    service = (DEPLOY / "entangible-host.service").read_text(encoding="utf-8")
    install = (DEPLOY / "install.sh").read_text(encoding="utf-8")
    # The installer substitutes every placeholder the unit uses.
    for placeholder in ("@USER@", "@REPO@"):
        assert placeholder in service
        assert placeholder in install
    # No uv at boot: the unit must run the venv entry point directly.
    assert ".venv/bin/qamposer-physical" in service
    # The settings file is the same one the installer seeds and docs name.
    assert "/etc/default/entangible" in service
    assert "/etc/default/entangible" in LIB.read_text(encoding="utf-8")


def test_kiosk_desktop_entry_points_at_launcher() -> None:
    desktop = (DEPLOY / "entangible-kiosk.desktop").read_text(encoding="utf-8")
    assert "@REPO@/deploy/rasqberry/kiosk-launch.sh" in desktop
    launcher = (DEPLOY / "kiosk-launch.sh").read_text(encoding="utf-8")
    # The launcher waits on the host's real health endpoint before Chromium.
    assert "ent_health_url" in launcher
    assert "/api/health" in LIB.read_text(encoding="utf-8")
    # Own profile: otherwise Chromium's singleton hands the URL to RasQberry's
    # already-running Chromium and drops the kiosk/cert flags.
    for flag in (
        "--user-data-dir=",
        "--no-first-run",
        "--password-store=basic",
        "--kiosk",
        "--ignore-certificate-errors",
    ):
        assert flag in launcher, f"kiosk-launch.sh lacks {flag}"


def test_no_hardcoded_desktop_user_home() -> None:
    # The Imager-chosen user name becomes the user: never assume one.
    for path in DEPLOY.rglob("*"):
        if path.is_file():
            text = path.read_text(encoding="utf-8")
            for literal in ("/home/rasqberry", "/home/pi"):
                assert literal not in text, f"{literal} hard-coded in {path.name}"


def test_installer_needs_no_node_by_default() -> None:
    install = (DEPLOY / "install.sh").read_text(encoding="utf-8")
    # nodesource only inside the --build-web path.
    body = install.split("build_web_locally() {", 1)[1].split("\n}\n", 1)[0]
    assert "nodesource" in body
    assert install.count("nodesource") == body.count("nodesource")
    # The booth packages only (no CAD kit generator on a Pi), from the lock.
    assert "--frozen" in install
    assert "--package qamposer-physical-host --package qamposer-vision" in install
    assert "--system-site-packages" in install


def test_cache_dir_is_one_switchable_variable() -> None:
    lib = LIB.read_text(encoding="utf-8")
    assert lib.count("/data/rasqberry/cache/entangible") == 1
    # `${VAR-default}` without a colon: an empty ENTANGIBLE_CACHE_DIR disables.
    assert 'ENT_CACHE_DIR="${ENTANGIBLE_CACHE_DIR-$ENT_CACHE_DIR_DEFAULT}"' in lib
    assert "ENT_CACHE_MIN_FREE_MB" in lib


def test_bundle_tag_pins_a_booth_release() -> None:
    tag = (DEPLOY / "BUNDLE_TAG").read_text(encoding="utf-8").strip()
    assert re.fullmatch(r"booth-v\d+(\.\d+)*(-[0-9A-Za-z.]+)?", tag), tag
    assert len((DEPLOY / "BUNDLE_TAG").read_text(encoding="utf-8").splitlines()) == 1


def test_booth_release_workflow() -> None:
    doc = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    # PyYAML reads the bare key `on` as boolean True.
    triggers = doc.get("on", doc.get(True))
    assert triggers["push"]["tags"] == ["booth-v*"]
    assert "tag" in triggers["workflow_dispatch"]["inputs"]
    text = WORKFLOW.read_text(encoding="utf-8")
    # Must never steal "latest" from the kit-* releases (latest/download links).
    assert "--latest=false" in text
    assert "kit-" not in str(triggers)
    assert "entangible-web-$tag.tar.gz" in text and ".sha256" in text
    assert "node-version: 20" in text


# --- the `entangible` command, without systemd ----------------------------------


def test_help_exits_zero(tmp_path: Path) -> None:
    result = _run(["--help"], _fake_env(tmp_path))
    assert result.returncode == 0, result.stderr
    assert "status" in result.stdout and "130" in result.stdout


@pytest.mark.parametrize("args", [
    ["bogus"], [], ["url", "--nope"], ["install", "--bad"],
    ["install", "--no-enable", "--kiosk"], ["install", "--kiosk", "--no-enable"],
])
def test_usage_errors_exit_two(tmp_path: Path, args: list[str]) -> None:
    result = _run(args, _fake_env(tmp_path))
    assert result.returncode == 2, (result.stdout, result.stderr)


def test_no_enable_with_kiosk_names_the_reason(tmp_path: Path) -> None:
    result = _run(["install", "--no-enable", "--kiosk"], _fake_env(tmp_path))
    assert result.returncode == 2
    assert "--no-enable" in result.stderr and "--kiosk" in result.stderr


@pytest.mark.parametrize("args", [
    ["--no-enable", "--kiosk"], ["--kiosk", "--no-enable"],
    ["--uninstall", "--no-enable"], ["--bogus"],
])
def test_install_sh_usage_errors_exit_two(tmp_path: Path, args: list[str]) -> None:
    result = _run_install_sh(args, _fake_env(tmp_path))
    assert result.returncode == 2, (result.stdout, result.stderr)


def test_help_texts_document_no_enable(tmp_path: Path) -> None:
    env = _fake_env(tmp_path)
    assert "--no-enable" in _run(["--help"], env).stdout
    result = _run_install_sh(["--help"], env)
    assert result.returncode == 0 and "--no-enable" in result.stdout


@pytest.mark.parametrize("via_wrapper", [True, False])
@pytest.mark.parametrize("args", [["--no-enable"], ["--no-enable", "--build-web"]])
def test_no_enable_is_accepted(tmp_path: Path, via_wrapper: bool, args: list[str]) -> None:
    # Parsing passes and the install proceeds to the platform check, which a
    # fake uname makes fail with "unsupported" (5) before anything is touched.
    env = _fake_env(tmp_path)
    _fake_tool(env, "uname", "echo Plan9\n")
    result = _run(["install", *args], env) if via_wrapper else _run_install_sh(args, env)
    assert result.returncode == 5, (result.stdout, result.stderr)
    assert "unsupported OS" in result.stderr


def test_installer_no_enable_disables_and_never_claims_running() -> None:
    install = (DEPLOY / "install.sh").read_text(encoding="utf-8")
    service = install.split("# --- 5. systemd service", 1)[1].split("# --- 6.", 1)[0]
    no_enable, default = service.split('if [ "$NO_ENABLE" -eq 1 ]; then', 1)[1].split("\nelse\n", 1)
    # --no-enable: disable (idempotent), restart only an already running service.
    assert 'systemctl disable --quiet "$ENT_UNIT"' in no_enable
    assert "systemctl is-active --quiet" in no_enable
    assert "enable --quiet" not in no_enable.replace("disable --quiet", "")
    # Default unchanged: enable + restart.
    assert 'systemctl enable --quiet "$ENT_UNIT"' in default
    assert 'systemctl restart "$ENT_UNIT"' in default
    # The final message depends on whether it actually runs.
    tail = install.split("# --- 6.", 1)[1]
    assert 'if [ "$RUNNING" -eq 0 ]; then' in tail
    assert "entangible start" in tail


def test_status_when_nothing_installed(tmp_path: Path) -> None:
    result = _run(["status"], _fake_env(tmp_path))
    assert result.returncode == 0, result.stderr
    lines = result.stdout.splitlines()
    assert len(lines) == 1, result.stdout
    status = json.loads(lines[0])
    assert set(status) == STATUS_KEYS
    assert list(status) == STATUS_ORDER
    assert status["installed"] is False
    assert status["running"] is False
    assert status["enabled"] is False
    assert status["health"] == "unknown"
    assert status["ready"] is None
    assert set(status["urls"]) == {"kiosk", "visitor"}
    assert status["source"] == "cv2:0"
    assert isinstance(status["version"], str) and status["version"]


def test_status_and_url_read_the_env_file(tmp_path: Path) -> None:
    env = _fake_env(tmp_path)
    env.pop("QAMPOSER_PORT")
    Path(env["ENTANGIBLE_ENV_FILE"]).write_text(
        '# comment\nQAMPOSER_SOURCE=push\nQAMPOSER_PORT=9443\n'
        'QAMPOSER_ADVERTISE_HOST="10.42.0.1"\n',
        encoding="utf-8",
    )
    status = json.loads(_run(["status"], env).stdout)
    assert status["source"] == "push"
    assert status["urls"]["visitor"] == "https://10.42.0.1:9443/?connect=1"
    assert status["urls"]["kiosk"] == "https://localhost:9443/?kiosk&connect=1"
    assert _run(["url"], env).stdout == "https://localhost:9443/?kiosk&connect=1\n"
    assert _run(["url", "--visitor"], env).stdout == "https://10.42.0.1:9443/?connect=1\n"


_FAKE_SYSTEMCTL = (
    'case "$1" in\n'
    '  is-enabled) echo "$FAKE_ENABLED"; [ "$FAKE_ENABLED" = enabled ] ;;\n'
    '  is-active) exit 3 ;;\n'
    '  *) exit 1 ;;\n'
    'esac\n'
)


@pytest.mark.parametrize(("state", "unit_file", "expected"), [
    ("enabled", True, True),
    ("disabled", True, False),
    ("enabled-runtime", True, False),  # gone after a reboot: not "starts at boot"
    ("enabled", False, False),          # no unit file: not installed
])
def test_status_reports_enabled(
    tmp_path: Path, state: str, unit_file: bool, expected: bool
) -> None:
    env = _fake_env(tmp_path, FAKE_ENABLED=state)
    _fake_tool(env, "systemctl", _FAKE_SYSTEMCTL)
    if unit_file:
        units = Path(env["ENTANGIBLE_UNIT_DIR"])
        units.mkdir()
        (units / "entangible-host.service").write_text("[Unit]\n", encoding="utf-8")
    result = _run(["status"], env)
    assert result.returncode == 0, result.stderr
    assert len(result.stdout.splitlines()) == 1
    status = json.loads(result.stdout)
    assert list(status) == STATUS_ORDER
    assert status["enabled"] is expected
    assert status["running"] is False


def test_service_commands_need_an_install(tmp_path: Path) -> None:
    env = _fake_env(tmp_path)
    for cmd in ("start", "stop", "restart"):
        assert _run([cmd], env).returncode == 3


# --- user resolution (lib.sh) ----------------------------------------------------


def _resolve(script: str, env: dict[str, str]) -> str:
    result = subprocess.run(
        ["bash", "-c", f". {LIB}; {script}; ent_resolve_user; echo \"$ENT_USER $ENT_HOME\""],
        env={"PATH": os.environ["PATH"], **env},
        capture_output=True, text=True, encoding="utf-8", check=True,
    )
    return result.stdout.strip()


_AS_ROOT_WITH_UID_1000 = (
    "_ent_euid(){ echo 0; }; "
    "_ent_getent(){ case \"$2\" in "
    "1000) echo 'imager:x:1000:1000::/home/imager:/bin/bash';; "
    "alice) echo 'alice:x:1001:1001::/srv/alice:/bin/bash';; esac; }"
)


def test_user_resolution_prefers_sudo_user() -> None:
    assert _resolve(_AS_ROOT_WITH_UID_1000, {"SUDO_USER": "alice"}) == "alice /srv/alice"


def test_user_resolution_falls_back_to_uid_1000() -> None:
    assert _resolve(_AS_ROOT_WITH_UID_1000, {}) == "imager /home/imager"
    # sudo from a root shell: SUDO_USER=root is not the desktop user.
    assert _resolve(_AS_ROOT_WITH_UID_1000, {"SUDO_USER": "root"}) == "imager /home/imager"


def test_user_home_override() -> None:
    assert _resolve(_AS_ROOT_WITH_UID_1000, {"USER_HOME": "/mnt/h"}) == "imager /mnt/h"


# --- camera auto-detection (lib.sh) ------------------------------------------------

_LIST_IMX708 = (
    "Available cameras\n-----------------\n"
    "0 : imx708 [4608x2592 10-bit RGGB] (/base/axi/pcie@120000/rp1/i2c@88000/imx708@1a)\n"
    "    Modes: 'SRGGB10_CSI2P' : 1536x864 [120.13 fps - (768, 432)/3072x1728 crop]\n"
    "                             2304x1296 [56.03 fps - (0, 0)/4608x2592 crop]\n"
)
_LIST_USB_ONLY = (
    "Available cameras\n-----------------\n"
    "0 : 'HD Pro Webcam C920' (/base/axi/pcie@120000/rp1/usb@200000-1:1.0-046d:082d)\n"
    "    Modes: 'MJPEG' : 1920x1080 [30.00 fps - (0, 0)/0x0 crop]\n"
)
_LIST_NONE = "No cameras available!\n"


def _v4l_node(sysfs: Path, name: str, device: str, index: int = 0) -> None:
    """One /sys/class/video4linux/<name> entry whose `device` links to <device>."""
    target = sysfs / "devices" / device
    target.mkdir(parents=True, exist_ok=True)
    node = sysfs / "class" / "video4linux" / name
    node.mkdir(parents=True)
    (node / "device").symlink_to(target)
    (node / "index").write_text(f"{index}\n", encoding="utf-8")


def _pi5_isp_nodes(sysfs: Path) -> None:
    # A Pi 5 always has these, camera or not: "any /dev/video*" proves nothing.
    for i in range(4):
        _v4l_node(sysfs, f"video{20 + i}", "platform/axi/1000880000.pispbe", i)
    _v4l_node(sysfs, "video0", "platform/axi/1000120000.pcie/1f00128000.csi")


def _usb_cam(sysfs: Path) -> None:
    dev = "platform/axi/1000120000.pcie/1f00200000.usb/xhci-hcd.0/usb1/1-1/1-1:1.0"
    _v4l_node(sysfs, "video8", dev, 0)
    _v4l_node(sysfs, "video9", dev, 1)  # UVC metadata node


def _detect(tmp_path: Path, listing: str | None, fn: str = "ent_detect_source",
            env_file: str | None = None) -> str:
    """Run a lib.sh detection function; listing=None means no probe command."""
    tmp_path.mkdir(parents=True, exist_ok=True)
    env = {"PATH": os.environ["PATH"], "ENT_SYSFS_ROOT": str(tmp_path / "sys"),
           "ENTANGIBLE_ENV_FILE": str(tmp_path / "entangible.env")}
    if listing is None:
        env["ENT_LIBCAMERA_LIST_CMD"] = str(tmp_path / "no-such-rpicam-hello")
    else:
        probe = tmp_path / "rpicam-hello"
        probe.write_text(f"#!/bin/sh\ncat <<'X'\n{listing}X\n", encoding="utf-8")
        probe.chmod(0o755)
        env["ENT_LIBCAMERA_LIST_CMD"] = f"{probe} --list-cameras"
    if env_file is not None:
        Path(env["ENTANGIBLE_ENV_FILE"]).write_text(env_file, encoding="utf-8")
    result = subprocess.run(
        ["bash", "-c", f"set -euo pipefail; . {LIB}; {fn}"],
        env=env, capture_output=True, text=True, encoding="utf-8", timeout=30,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout


def test_detect_usb_camera_wins(tmp_path: Path) -> None:
    _pi5_isp_nodes(tmp_path / "sys")
    _usb_cam(tmp_path / "sys")
    assert _detect(tmp_path, _LIST_IMX708) == "cv2:0\n"


def test_detect_pi_camera_module(tmp_path: Path) -> None:
    _pi5_isp_nodes(tmp_path / "sys")
    assert _detect(tmp_path, _LIST_IMX708) == "picamera2\n"


def test_detect_ignores_usb_cameras_in_the_libcamera_list(tmp_path: Path) -> None:
    # libcamera lists UVC cameras too: a webcam in the probe output alone must
    # never turn into "picamera2".
    _pi5_isp_nodes(tmp_path / "sys")
    assert _detect(tmp_path, _LIST_USB_ONLY) == "cv2:0\n"


def test_detect_nothing(tmp_path: Path) -> None:
    _pi5_isp_nodes(tmp_path / "sys")
    assert _detect(tmp_path, _LIST_NONE) == "cv2:0\n"
    assert _detect(tmp_path / "empty", None) == "cv2:0\n"  # no sysfs at all


def test_detect_probe_missing(tmp_path: Path) -> None:
    _pi5_isp_nodes(tmp_path / "sys")
    assert _detect(tmp_path, None) == "cv2:0\n"


def test_detect_usb_metadata_node_alone_is_no_camera(tmp_path: Path) -> None:
    dev = "platform/scb/fd500000.pcie/pci0000:00/0000:00:00.0/0000:01:00.0/usb1/1-1/1-1:1.0"
    _v4l_node(tmp_path / "sys", "video1", dev, 1)
    _v4l_node(tmp_path / "sys", "video10", "platform/soc/fe00b840.mailbox/bcm2835-codec", 0)
    assert _detect(tmp_path, _LIST_NONE) == "cv2:0\n"


@pytest.mark.parametrize(("hw", "listing", "configured", "hint"), [
    ("csi", _LIST_IMX708, "QAMPOSER_SOURCE=cv2:0\n", "QAMPOSER_SOURCE=picamera2"),
    ("usb", _LIST_NONE, "QAMPOSER_SOURCE=picamera2\n", "QAMPOSER_SOURCE=cv2:0"),
    ("usb", _LIST_IMX708, "QAMPOSER_SOURCE=cv2:0\n", None),
    ("csi", _LIST_IMX708, "QAMPOSER_SOURCE=picamera2\n", None),
    ("csi", _LIST_IMX708, "QAMPOSER_SOURCE=push\n", None),
    ("none", _LIST_NONE, "QAMPOSER_SOURCE=picamera2\n", None),
])
def test_source_hint(
    tmp_path: Path, hw: str, listing: str, configured: str, hint: str | None
) -> None:
    _pi5_isp_nodes(tmp_path / "sys")
    if hw == "usb":
        _usb_cam(tmp_path / "sys")
    out = _detect(tmp_path, listing, fn="ent_source_hint", env_file=configured)
    if hint is None:
        assert out == ""
    else:
        assert len(out.splitlines()) == 1 and out.startswith("hint: ")
        assert f"set {hint} in {tmp_path / 'entangible.env'}" in out
        assert "entangible restart" in out


def test_installer_seeds_detected_source_only_when_seeding() -> None:
    install = (DEPLOY / "install.sh").read_text(encoding="utf-8")
    seed = install.split('if [ ! -f "$ENT_ENV_FILE" ]; then', 1)[1].split("\nelse\n", 1)[0]
    assert 'SEED_SOURCE="$(ent_detect_source)"' in seed
    assert "QAMPOSER_SOURCE=$SEED_SOURCE" in seed
    assert install.count("ent_detect_source") == 1
    # The doctor hints, never edits.
    command = COMMAND.read_text(encoding="utf-8")
    assert "ent_source_hint" in command.split("cmd_doctor() {", 1)[1].split("\n}\n", 1)[0]


# --- the replay demo loop -----------------------------------------------------

DEMO_RECORDING = REPO / "examples" / "recordings" / "bell-sequence"


def test_documented_replay_sources_exist_in_the_checkout() -> None:
    # Every `replay:<dir>` the deploy files or booth docs tell an operator to
    # use must play on a fresh, offline install: committed frames, nothing to
    # generate. (The rig once followed the docs to a never-committed fixture.)
    texts = [p.read_text(encoding="utf-8") for p in DEPLOY.iterdir() if p.is_file()]
    texts += [(REPO / "docs" / name).read_text(encoding="utf-8")
              for name in ("rasqberry.md", "rasqberry-integration.md", "mac-booth.md")]
    texts.append((REPO / "Makefile").read_text(encoding="utf-8"))
    specs = {m for text in texts for m in re.findall(r"replay:([\w./-]*[\w-])", text)}
    assert specs == {"examples/recordings/bell-sequence"}, specs
    frames = sorted(DEMO_RECORDING.glob("frame_*.jpg"))
    assert len(frames) == 48
    assert sum(f.stat().st_size for f in frames) < 2_000_000
    if shutil.which("git") and (REPO / ".git").exists():
        tracked = subprocess.run(
            ["git", "ls-files", "--", str(DEMO_RECORDING)], cwd=REPO,
            capture_output=True, text=True, encoding="utf-8", check=True,
        ).stdout.split()
        assert len(tracked) == 48, "the demo frames must be committed, not generated"
