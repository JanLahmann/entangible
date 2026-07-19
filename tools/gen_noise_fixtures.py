# /// script
# requires-python = ">=3.11"
# dependencies = ["qiskit", "numpy"]
# ///
"""Generate golden noise-model fixtures with an INDEPENDENT implementation of
the density-matrix channel schedule, using qiskit.quantum_info (DensityMatrix /
Operator / Kraus — trusted linear algebra, no Aer).

    uv run --no-project tools/gen_noise_fixtures.py

Writes shared/quantum/__fixtures__/noise-fixtures.json: for each fixture, the
circuit JSON (matching @qamposer/react's Circuit type), the NoiseParams, and the
expected length-32 probability vector at full precision. shared/quantum/noise.ts
must reproduce these within 1e-9.

The schedule mirrors noise.ts EXACTLY (same moment grouping, same channel order,
same dephasing convention λ = γφ/2). Qubit ordering is little-endian throughout
(qubit 0 = least-significant bit), matching statevector.ts and DensityMatrix.
"""

from __future__ import annotations

import itertools
import json
import math
from pathlib import Path

import numpy as np
from qiskit.circuit.library import CXGate
from qiskit.quantum_info import DensityMatrix, Kraus, Operator, Pauli

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "shared" / "quantum" / "__fixtures__" / "noise-fixtures.json"
PRESETS = json.loads((ROOT / "shared" / "quantum" / "noisePresets.json").read_text())

NUM_QUBITS = 5
DIM = 1 << NUM_QUBITS

# --- Gate unitaries, matching statevector.ts exactly ------------------------

R = 1 / math.sqrt(2)


def single_qubit_matrix(gate: dict) -> np.ndarray:
    t = gate.get("parameter", 0.0)
    kind = gate["type"]
    if kind == "H":
        return np.array([[R, R], [R, -R]], dtype=complex)
    if kind == "X":
        return np.array([[0, 1], [1, 0]], dtype=complex)
    if kind == "Y":
        return np.array([[0, -1j], [1j, 0]], dtype=complex)
    if kind == "Z":
        return np.array([[1, 0], [0, -1]], dtype=complex)
    if kind == "RX":
        c, s = math.cos(t / 2), math.sin(t / 2)
        return np.array([[c, -1j * s], [-1j * s, c]], dtype=complex)
    if kind == "RY":
        c, s = math.cos(t / 2), math.sin(t / 2)
        return np.array([[c, -s], [s, c]], dtype=complex)
    if kind == "RZ":
        return np.array([[np.exp(-1j * t / 2), 0], [0, np.exp(1j * t / 2)]], dtype=complex)
    raise ValueError(f"unexpected single-qubit gate {kind}")


# --- Channels ---------------------------------------------------------------


def depolarizing_kraus(p: float, k: int) -> Kraus:
    """ρ → (1−p)ρ + p/(4^k−1)·Σ_{P≠I} PρP† as an explicit Kraus set."""
    ops = [math.sqrt(1 - p) * np.eye(2**k, dtype=complex)]
    w = math.sqrt(p / (4**k - 1))
    for label in itertools.product("IXYZ", repeat=k):
        if all(c == "I" for c in label):
            continue
        ops.append(w * Pauli("".join(label)).to_matrix())
    return Kraus(ops)


def amplitude_damping_kraus(gamma: float) -> Kraus:
    k0 = np.array([[1, 0], [0, math.sqrt(1 - gamma)]], dtype=complex)
    k1 = np.array([[0, math.sqrt(gamma)], [0, 0]], dtype=complex)
    return Kraus([k0, k1])


def dephasing_kraus(gamma_phi: float) -> Kraus:
    """Pure dephasing with λ = γφ/2: ρ → (1−λ)ρ + λ·ZρZ."""
    lam = gamma_phi / 2
    k0 = math.sqrt(1 - lam) * np.eye(2, dtype=complex)
    k1 = math.sqrt(lam) * np.array([[1, 0], [0, -1]], dtype=complex)
    return Kraus([k0, k1])


def as_list(param, q: int) -> float:
    return param[q] if isinstance(param, list) else param


def simulate(circuit: dict, params: dict) -> list[float]:
    dm = DensityMatrix.from_label("0" * NUM_QUBITS)

    # Moments = gates grouped by column position, ascending.
    positions = sorted({g["position"] for g in circuit["gates"]})
    for pos in positions:
        moment = [g for g in circuit["gates"] if g["position"] == pos]
        # (a) unitary + depolarizing per gate
        for g in moment:
            if g["type"] == "CNOT":
                dm = dm.evolve(Operator(CXGate()), [g["control"], g["target"]])
                dm = dm.evolve(depolarizing_kraus(params["p2"], 2), [g["control"], g["target"]])
            else:
                q = g["qubit"]
                dm = dm.evolve(Operator(single_qubit_matrix(g)), [q])
                dm = dm.evolve(depolarizing_kraus(params["p1"], 1), [q])
        # (b) amplitude damping then dephasing on every qubit (incl. idle)
        for q in range(NUM_QUBITS):
            g1 = as_list(params["gamma1"], q)
            if g1 > 0:
                dm = dm.evolve(amplitude_damping_kraus(g1), [q])
            gphi = as_list(params["gammaPhi"], q)
            if gphi > 0:
                dm = dm.evolve(dephasing_kraus(gphi), [q])

    probs = np.real(np.diag(dm.data)).astype(float)

    # Readout confusion: per-qubit symmetric flip, applied classically.
    for q in range(NUM_QUBITS):
        r = as_list(params["readout"], q)
        if r == 0:
            continue
        bit = 1 << q
        src = probs.copy()
        for i in range(DIM):
            probs[i] = (1 - r) * src[i] + r * src[i ^ bit]

    return [float(x) for x in probs]


# --- Fixture circuits -------------------------------------------------------


def gate(idx, **kw):
    return {"id": f"g{idx}", **kw}


MODERATE = {"p1": 0.01, "p2": 0.02, "gamma1": 0.02, "gammaPhi": 0.02, "readout": 0.02}


def preset_params(name: str) -> dict:
    p = PRESETS[name]
    return {"p1": p["p1"], "p2": p["p2"], "gamma1": p["gamma1"],
            "gammaPhi": p["gammaPhi"], "readout": p["readout"]}


def fixtures() -> list[dict]:
    out = []

    # Bell (H + CNOT).
    out.append({
        "name": "bell_moderate",
        "circuit": {"qubits": 5, "gates": [
            gate(0, type="H", qubit=0, position=0),
            gate(1, type="CNOT", control=0, target=1, position=1),
        ]},
        "params": MODERATE,
    })

    # GHZ-5 under the `today` preset (uniform scalars).
    out.append({
        "name": "ghz5_today",
        "circuit": {"qubits": 5, "gates": [
            gate(0, type="H", qubit=0, position=0),
            gate(1, type="CNOT", control=0, target=1, position=1),
            gate(2, type="CNOT", control=0, target=2, position=2),
            gate(3, type="CNOT", control=0, target=3, position=3),
            gate(4, type="CNOT", control=0, target=4, position=4),
        ]},
        "params": preset_params("today"),
    })

    # Single X on q0 with 3 idle-moment padding: q1 flips in moments 1-3 while
    # q0 sits idle and amplitude-damps (exercises idle decay).
    out.append({
        "name": "x_idle_padding",
        "circuit": {"qubits": 5, "gates": [
            gate(0, type="X", qubit=0, position=0),
            gate(1, type="X", qubit=1, position=1),
            gate(2, type="X", qubit=1, position=2),
            gate(3, type="X", qubit=1, position=3),
        ]},
        "params": {**MODERATE, "gamma1": 0.05},
    })

    # RX(π/2) + RZ(π/4) chain on q0 (exercises coherence + dephasing).
    out.append({
        "name": "rx_rz_chain",
        "circuit": {"qubits": 5, "gates": [
            gate(0, type="RX", qubit=0, parameter=math.pi / 2, position=0),
            gate(1, type="RZ", qubit=0, parameter=math.pi / 4, position=1),
        ]},
        "params": MODERATE,
    })

    # Asymmetric circuit: CNOT with control > target.
    out.append({
        "name": "cnot_control_gt_target",
        "circuit": {"qubits": 5, "gates": [
            gate(0, type="H", qubit=2, position=0),
            gate(1, type="CNOT", control=2, target=0, position=1),
        ]},
        "params": MODERATE,
    })

    # `early` per-qubit params: GHZ-3 on q0-q2 plus an X on q3 to sample the
    # per-qubit gamma/readout arrays across four wires.
    out.append({
        "name": "spread_early",
        "circuit": {"qubits": 5, "gates": [
            gate(0, type="H", qubit=0, position=0),
            gate(1, type="X", qubit=3, position=0),
            gate(2, type="CNOT", control=0, target=1, position=1),
            gate(3, type="CNOT", control=1, target=2, position=2),
        ]},
        "params": preset_params("early"),
    })

    for f in out:
        f["expected"] = simulate(f["circuit"], f["params"])
    return out


def main() -> None:
    data = {
        "$comment": (
            "Generated by tools/gen_noise_fixtures.py using qiskit.quantum_info "
            "(independent density-matrix linear algebra). Regenerate with: "
            "uv run --no-project tools/gen_noise_fixtures.py"
        ),
        "fixtures": fixtures(),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2) + "\n")
    print(f"wrote {OUT} ({len(data['fixtures'])} fixtures)")
    for f in data["fixtures"]:
        top = max(range(DIM), key=lambda i: f["expected"][i])
        print(f"  {f['name']:24s} argmax=|{top:05b}⟩ p={f['expected'][top]:.4f} "
              f"sum={sum(f['expected']):.9f}")


if __name__ == "__main__":
    main()
