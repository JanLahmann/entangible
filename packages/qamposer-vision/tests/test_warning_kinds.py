"""Warning totality — the Python twin of ``pocket-app/tests/warningKinds.test.ts``.

Every ``BuildWarning(kind=...)`` the vision package constructs must be listed in
:data:`~qamposer_vision.circuit_builder.WARNING_KINDS`, that list must equal the
TS pipeline's ``WARNING_KINDS``, and every kind must carry an explicit visitor
decision in ``shared/display/warnings.ts`` (``WARNING_AUDIENCE``) — so a new
kind fails here until it is listed AND classified for the kiosk.
"""

from __future__ import annotations

import re
from pathlib import Path

from qamposer_vision.circuit_builder import WARNING_KINDS

_REPO = Path(__file__).resolve().parents[3]
_PY_SRC = _REPO / "packages" / "qamposer-vision" / "src" / "qamposer_vision"
_TS_BUILDER = _REPO / "pocket-app" / "src" / "vision" / "circuitBuilder.ts"
_TS_WARNINGS = _REPO / "shared" / "display" / "warnings.ts"


def _python_kinds() -> set[str]:
    kinds: set[str] = set()
    for path in _PY_SRC.glob("*.py"):
        kinds |= set(re.findall(r'BuildWarning\(\s*kind="([a-z_]+)"', path.read_text(encoding="utf-8")))
    return kinds


def _ts_const_list(path: Path, name: str) -> set[str]:
    body = re.search(rf"export const {name} = \[(.*?)\] as const;", path.read_text(encoding="utf-8"), re.S)
    assert body, f"{name} not found in {path}"
    code = re.sub(r"//.*", "", body.group(1))
    return set(re.findall(r"'([a-z_]+)'", code))


def _ts_audience() -> dict[str, str]:
    body = re.search(
        r"export const WARNING_AUDIENCE = \{(.*?)\} as const", _TS_WARNINGS.read_text(encoding="utf-8"), re.S
    )
    assert body, "WARNING_AUDIENCE not found in shared/display/warnings.ts"
    code = re.sub(r"//.*", "", body.group(1))
    return dict(re.findall(r"([a-z_]+): '(visitor|staff)'", code))


def test_every_emitted_kind_is_listed() -> None:
    found = _python_kinds()
    assert len(found) >= 10  # guards the regex itself
    assert found == set(WARNING_KINDS)


def test_python_and_ts_lists_are_identical() -> None:
    assert _ts_const_list(_TS_BUILDER, "WARNING_KINDS") == set(WARNING_KINDS)


def test_every_kind_has_an_explicit_kiosk_decision() -> None:
    audience = _ts_audience()
    assert set(audience) == set(WARNING_KINDS)
    # Inventory beside the board and board set-up never reach a visitor.
    assert {k for k, v in audience.items() if v == "staff"} == {
        "stray_tiles",
        "stray_furniture",
        "measure_span_mismatch",
    }
