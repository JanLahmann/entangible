# /// script
# requires-python = ">=3.11"
# dependencies = ["qiskit-ibm-runtime"]
# ///
"""One-off extraction of in-browser noise-model presets from IBM fake-backend
calibration snapshots.

Reads two `qiskit_ibm_runtime.fake_provider` backends and writes
`shared/quantum/noisePresets.json` (checked in) so the browser never needs
Qiskit — presets change only via a reviewed re-run of this script:

    uv run --no-project tools/extract_noise_presets.py

Derivation (see docs/design.md "In-browser noise model"):
  - p1  = median 1-qubit gate error over the sx/x instruction properties.
  - p2  = median 2-qubit gate error (cz for the Heron Aachen, cx for Manila).
  - momentNs = median 2-qubit gate duration in ns (the per-moment time step).
  - Per-moment relaxation for a moment of duration t:
        gamma1   = 1 - exp(-t / T1)
        gammaPhi = 1 - exp(-t / Tphi),  with 1/Tphi = max(0, 1/T2 - 1/(2*T1))
  - readout = measure-instruction error (symmetric flip probability).

Presets:
  - `today` (FakeAachen, 156q Heron): device-wide medians, uniform scalars.
  - `early` (FakeManilaV2, 5q Falcon-era): per-qubit ARRAYS (length 5, qubit i
    -> wire i) for gamma1/gammaPhi/readout; median scalars for p1/p2.

Output is deterministic: keys sorted, floats rounded to 6 significant digits.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from statistics import median

from qiskit_ibm_runtime.fake_provider import FakeAachen, FakeManilaV2

OUT = Path(__file__).resolve().parent.parent / "shared" / "quantum" / "noisePresets.json"
REGEN_CMD = "uv run --no-project tools/extract_noise_presets.py"


def sig(x: float, digits: int = 6) -> float:
    """Round to `digits` significant figures (deterministic JSON output)."""
    if x == 0 or not math.isfinite(x):
        return 0.0
    return float(f"{x:.{digits}g}")


def gate_errors(target, name: str) -> list[float]:
    """All finite instruction errors for gate `name` in a Target."""
    out: list[float] = []
    if name not in target.operation_names:
        return out
    for props in target[name].values():
        if props is not None and props.error is not None and math.isfinite(props.error):
            out.append(props.error)
    return out


def gate_durations_ns(target, name: str) -> list[float]:
    """All finite instruction durations (nanoseconds) for gate `name`."""
    out: list[float] = []
    if name not in target.operation_names:
        return out
    for props in target[name].values():
        if props is not None and props.duration is not None and math.isfinite(props.duration):
            out.append(props.duration * 1e9)  # seconds -> ns
    return out


def measure_errors(target, num_qubits: int) -> list[float]:
    """Per-qubit measure error (readout flip probability), indexed by qubit."""
    out: list[float] = []
    meas = target["measure"] if "measure" in target.operation_names else {}
    for q in range(num_qubits):
        props = meas.get((q,)) if meas else None
        out.append(props.error if props is not None and props.error is not None else math.nan)
    return out


def relaxation(t_ns: float, t1_s: float, t2_s: float) -> tuple[float, float]:
    """(gamma1, gammaPhi) for a moment of duration t_ns given T1/T2 in seconds."""
    t = t_ns * 1e-9
    gamma1 = 1.0 - math.exp(-t / t1_s) if t1_s and math.isfinite(t1_s) else 0.0
    inv_tphi = max(0.0, 1.0 / t2_s - 1.0 / (2.0 * t1_s)) if t1_s and t2_s else 0.0
    gamma_phi = 1.0 - math.exp(-t * inv_tphi) if inv_tphi > 0 else 0.0
    return gamma1, gamma_phi


def summarize(target, num_qubits):
    """Collect the raw device statistics needed by both preset flavours."""
    p1_samples = gate_errors(target, "sx") + gate_errors(target, "x")
    two_q = "cz" if "cz" in target.operation_names else "cx"
    p2_samples = gate_errors(target, two_q)
    dur_samples = gate_durations_ns(target, two_q)
    t1 = [target.qubit_properties[q].t1 for q in range(num_qubits)]
    t2 = [target.qubit_properties[q].t2 for q in range(num_qubits)]
    ro = measure_errors(target, num_qubits)
    return {
        "two_q_gate": two_q,
        "p1": median(p1_samples),
        "p2": median(p2_samples),
        "momentNs": median(dur_samples),
        "t1": t1,
        "t2": t2,
        "readout": ro,
    }


def build_today(backend) -> dict:
    target = backend.target
    n = backend.num_qubits
    s = summarize(target, n)
    t1_med = median(x for x in s["t1"] if x and math.isfinite(x))
    t2_med = median(x for x in s["t2"] if x and math.isfinite(x))
    ro_med = median(x for x in s["readout"] if math.isfinite(x))
    gamma1, gamma_phi = relaxation(s["momentNs"], t1_med, t2_med)
    return {
        "p1": sig(s["p1"]),
        "p2": sig(s["p2"]),
        "gamma1": sig(gamma1),
        "gammaPhi": sig(gamma_phi),
        "readout": sig(ro_med),
        "provenance": {
            "backend": backend.name,
            "num_qubits": n,
            "statistic": "device-wide medians (uniform scalars)",
            "two_qubit_gate": s["two_q_gate"],
            "momentNs": sig(s["momentNs"]),
            "T1_median_us": sig(t1_med * 1e6),
            "T2_median_us": sig(t2_med * 1e6),
            "regenerate": REGEN_CMD,
        },
    }


def build_early(backend, wires: int = 5) -> dict:
    target = backend.target
    n = backend.num_qubits
    s = summarize(target, n)
    gamma1: list[float] = []
    gamma_phi: list[float] = []
    readout: list[float] = []
    t1_us: list[float] = []
    t2_us: list[float] = []
    for q in range(wires):
        g1, gphi = relaxation(s["momentNs"], s["t1"][q], s["t2"][q])
        gamma1.append(sig(g1))
        gamma_phi.append(sig(gphi))
        readout.append(sig(s["readout"][q]))
        t1_us.append(sig(s["t1"][q] * 1e6))
        t2_us.append(sig(s["t2"][q] * 1e6))
    return {
        "p1": sig(s["p1"]),
        "p2": sig(s["p2"]),
        "gamma1": gamma1,
        "gammaPhi": gamma_phi,
        "readout": readout,
        "provenance": {
            "backend": backend.name,
            "num_qubits": n,
            "statistic": "per-qubit arrays (qubit i -> wire i); median scalars for p1/p2",
            "two_qubit_gate": s["two_q_gate"],
            "momentNs": sig(s["momentNs"]),
            "T1_per_qubit_us": t1_us,
            "T2_per_qubit_us": t2_us,
            "regenerate": REGEN_CMD,
        },
    }


def main() -> None:
    presets = {
        "$comment": (
            "Generated by tools/extract_noise_presets.py from IBM fake-backend "
            "calibration snapshots. Do not edit by hand; re-run the script."
        ),
        "regenerate": REGEN_CMD,
        "wires": 5,
        "today": build_today(FakeAachen()),
        "early": build_early(FakeManilaV2()),
    }
    OUT.write_text(json.dumps(presets, indent=2, sort_keys=True) + "\n")
    print(f"wrote {OUT}")
    print(json.dumps(presets, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
