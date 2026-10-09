"""Sanity gates for deploy/rasqberry (docs/rasqberry.md, M5).

No Pi in CI, so these catch what a linter can: shell syntax, the placeholders
the installer substitutes, and that the unit's entry point / env file names
stay in step with the installer and the host package.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEPLOY = REPO / "deploy" / "rasqberry"


def test_shell_scripts_parse() -> None:
    scripts = sorted(DEPLOY.glob("*.sh"))
    assert scripts, "no deploy scripts found"
    for script in scripts:
        subprocess.run(["bash", "-n", str(script)], check=True)


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
    assert "/etc/default/entangible" in install


def test_kiosk_desktop_entry_points_at_launcher() -> None:
    desktop = (DEPLOY / "entangible-kiosk.desktop").read_text(encoding="utf-8")
    assert "@REPO@/deploy/rasqberry/kiosk-launch.sh" in desktop
    launcher = (DEPLOY / "kiosk-launch.sh").read_text(encoding="utf-8")
    # The launcher waits on the host's real health endpoint before Chromium.
    assert "/api/health" in launcher
