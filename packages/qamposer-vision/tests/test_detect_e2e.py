"""End-to-end: render each scenario (flat + warped) -> detect -> golden JSON."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from qamposer_vision.board import BoardConfig
from qamposer_vision.cli import detect_circuit
from qamposer_vision.detector import ArucoDetector

from tests.utils.render_board import SCENARIOS, RenderOptions, render_board

FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "circuits"


@pytest.fixture(scope="module")
def config() -> BoardConfig:
    return BoardConfig.from_toml()


@pytest.fixture(scope="module")
def detector() -> ArucoDetector:
    return ArucoDetector()


def _golden(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text())


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.name)
@pytest.mark.parametrize(
    "options",
    [
        RenderOptions(),
        RenderOptions(warp=0.15, blur_sigma=0.6, noise_sigma=2.0, seed=11),
    ],
    ids=["flat", "warped"],
)
def test_render_detect_matches_golden(scenario, options, config, detector) -> None:
    img = render_board(scenario.placements, config, options)
    result = detect_circuit(img, config, detector=detector)
    assert result.has_board
    assert result.circuit == _golden(scenario.name)


def test_lone_control_scenario_reports_warning(config, detector) -> None:
    scenario = next(s for s in SCENARIOS if s.name == "warn_lone_control")
    img = render_board(scenario.placements, config, RenderOptions(warp=0.12, seed=5))
    result = detect_circuit(img, config, detector=detector)
    assert result.circuit == _golden("warn_lone_control")

    expected = json.loads((FIXTURES / "warn_lone_control.warnings.json").read_text())
    got = [w.to_dict() for w in result.warnings]
    assert got == expected["warnings"]


def test_s_and_t_detect_to_rz_equivalents(config, detector) -> None:
    # A physical board with H + S + T tiles must detect to a circuit whose S/T
    # are emitted as their RZ equivalents (RZ(pi/2) / RZ(pi/4)) — no native S/T
    # gate type reaches the circuit JSON.
    scenario = next(s for s in SCENARIOS if s.name == "s_and_t")
    img = render_board(
        scenario.placements, config, RenderOptions(warp=0.1, blur_sigma=0.5, seed=7)
    )
    result = detect_circuit(img, config, detector=detector)
    assert result.has_board
    assert result.circuit == _golden("s_and_t")
    types = [g["type"] for g in result.circuit["gates"]]
    assert types == ["H", "RZ", "RZ"]  # S and T became RZ
    assert "S" not in types and "T" not in types


def test_off_grid_tile_is_rejected(config, detector) -> None:
    from qamposer_vision.grid import GridConfig

    grid = GridConfig.from_board_config(config)
    cx, cy = grid.cell_center(0, 0)
    # Drop an H tile deep in the gutter between cells 0 and 1 (off any footprint).
    gutter_x = cx + config.cell_size / 2.0 + (config.pitch - config.cell_size) / 2.0
    img = render_board(
        (), config, RenderOptions(extra_mm=((10, gutter_x, cy),))
    )
    result = detect_circuit(img, config, detector=detector)
    assert result.circuit == {"qubits": 5, "gates": []}
    assert result.placements == []
    off_grid = [w for w in result.warnings if w.kind == "off_grid"]
    assert len(off_grid) == 1
    assert off_grid[0].marker_ids == (10,)


def test_no_board_when_corners_missing(config, detector) -> None:
    img = render_board(((10, 0, 0),), config, RenderOptions(corners=(0,)))
    result = detect_circuit(img, config, detector=detector)
    assert not result.has_board
    assert result.circuit == {"qubits": 5, "gates": []}
