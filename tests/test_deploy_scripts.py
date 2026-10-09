"""Sanity gates for deploy/rasqberry (docs/rasqberry.md, docs/rasqberry-integration.md).

No Pi in CI, so these catch what a linter can: shell syntax (+ shellcheck when
installed), the placeholders the installer substitutes, that the unit's entry
point / env file names stay in step with the installer and the host package,
and the parts of the `entangible` command contract that run without systemd:
help/usage exit codes, the one-line status JSON, user resolution.
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
}


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


@pytest.mark.parametrize("args", [["bogus"], [], ["url", "--nope"], ["install", "--bad"]])
def test_usage_errors_exit_two(tmp_path: Path, args: list[str]) -> None:
    result = _run(args, _fake_env(tmp_path))
    assert result.returncode == 2, (result.stdout, result.stderr)


def test_status_when_nothing_installed(tmp_path: Path) -> None:
    result = _run(["status"], _fake_env(tmp_path))
    assert result.returncode == 0, result.stderr
    lines = result.stdout.splitlines()
    assert len(lines) == 1, result.stdout
    status = json.loads(lines[0])
    assert set(status) == STATUS_KEYS
    assert status["installed"] is False
    assert status["running"] is False
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
