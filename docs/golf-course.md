# Quantum Golf — the Classic 18 (course version 2)

The fixed course every visitor plays first, on the phone, in the golf bundle and
on the booth mat. Source of truth: `COURSE` in
[`shared/quantum/golf.ts`](../shared/quantum/golf.ts); hole names and goal
lines in [`shared/i18n/en.ts`](../shared/i18n/en.ts) /
[`de.ts`](../shared/i18n/de.ts) (`golf.holeNames`, `golf.holeGoals`). Every
number below is asserted by
[`shared/quantum/golfCourse.test.ts`](../shared/quantum/golfCourse.test.ts).

**Shape (unchanged).** 18 holes in four rounds, each round unlocking clubs —
Easy X H CX · Medium +Y · Difficult +Z S · Extra +T CH — with the qubit stair
1→5 inside each round (Extra 1/3/5). **What changed** (version 1 → 2): version 1
was mostly GHZ-n and its flipped / minus / i variants, so a round felt like the
same state with one more wire. Version 2 gives every hole one new idea:
product states, all four Bell states, separate pairs, phases you only see as
colour, phases that multiply, uneven odds.

**Par** = proven shortest solution + 2 (#69): an eagle for the minimum, a
birdie for one extra stroke. Course par **108** (E 26 · M 31 · D 33 · X 18;
version 1 was 101). The legendary threshold stays −18 (two under on every hole).

## Conventions

- **Kets** are written like the bra-ket line under the sphere (`KetDisplay`)
  and like Qiskit: **MSB-first**, the leftmost bit is the HIGHEST wire q(k−1).
  `|+⟩|1⟩|+⟩` reads q2 q1 q0. (The histogram labels the other way round —
  leftmost = q0, the top wire; see *Open points*.)
- **Placement is free.** A hole scores the best fidelity over every ORDERED
  placement of its k wires on the five rows, so any relabelling of an answer
  holes in. The shortest solutions below were searched over every wiring, so
  relabelling never undercuts par.
- **Circuits** are QASM-style, `q[i]` = wire i (q0 = top row). Running one in
  Qiskit gives the listed amplitudes up to a global phase (amplitudes are
  shown with the first one real-positive).
- **Necessity** (the random course's rule #77): every Medium hole but M1 is
  strictly shorter with Y than with the easy clubs (BFS); every Difficult
  target carries a quarter-turn phase, which X/H/CX/Y can never make (they are
  real matrices, Y is i·real); every Extra target has uneven odds, which no
  Clifford club makes (stabiliser states spread probability evenly). M1 is
  exempt as on the random course: on one wire Y = X·Z up to a global phase.

## The course at a glance

Tiles: a CX is ● + X, a CH is ● + H; "col" = mat columns the layout needs
(8 available; a controlled gate's column holds only its ● and its target).
"Par-length" = the shortest solution plus a cancelling pair of a spare tile
(Z Z, or Y Y on D5) — any par-length board fits the kit the same way.

| # | Code | Round | Name EN / DE | Qubits | Target | Clubs | Optimal | Par | Tiles, shortest | Tiles, par-length |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | E1 | easy | Superposition / Überlagerung | 1 | `(\|0⟩+\|1⟩)/√2` | X H CX | 1 | 3 | H×1 (1 col) | H×1 Z×2 (3 col) |
| 2 | E2 | easy | Bell / Bell | 2 | `(\|00⟩+\|11⟩)/√2` | X H CX | 2 | 4 | H×1 X×1 ●×1 (2 col) | H×1 X×1 Z×2 ●×1 (4 col) |
| 3 | E3 | easy | Coin, flip, coin / Münze, Flip, Münze | 3 | `\|+⟩\|1⟩\|+⟩` | X H CX | 3 | 5 | H×2 X×1 (1 col) | H×2 X×1 Z×2 (3 col) |
| 4 | E4 | easy | Two couples / Zwei Pärchen | 4 | `(\|01⟩+\|10⟩)(\|00⟩+\|11⟩)/2` | X H CX | 5 | 7 | H×2 X×3 ●×2 (3 col) | H×2 X×3 Z×2 ●×2 (5 col) |
| 5 | E5 | easy | GHZ-5 / GHZ-5 | 5 | `(\|00000⟩+\|11111⟩)/√2` | X H CX | 5 | 7 | H×1 X×4 ●×4 (5 col) | H×1 X×4 Z×2 ●×4 (7 col) |
| 6 | M1 | medium | Minus / Minus | 1 | `(\|0⟩−\|1⟩)/√2` | X H CX Y | 2 | 4 | H×1 X×1 (2 col) | H×1 X×1 Z×2 (4 col) |
| 7 | M2 | medium | Singlet / Singulett | 2 | `(\|01⟩−\|10⟩)/√2` | X H CX Y | 3 | 5 | H×1 X×1 Y×1 ●×1 (3 col) | H×1 X×1 Y×1 Z×2 ●×1 (5 col) |
| 8 | M3 | medium | Singlet + coin / Singulett + Münze | 3 | `\|+⟩(\|01⟩−\|10⟩)/√2` | X H CX Y | 4 | 6 | H×2 X×1 Y×1 ●×1 (3 col) | H×2 X×1 Y×1 Z×2 ●×1 (5 col) |
| 9 | M4 | medium | Minus couples / Minus-Pärchen | 4 | `(\|01⟩−\|10⟩)(\|00⟩−\|11⟩)/2` | X H CX Y | 6 | 8 | H×2 X×3 Y×1 ●×2 (5 col) | H×2 X×3 Y×1 Z×2 ●×2 (6 col) |
| 10 | M5 | medium | Odd one out / Der Außenseiter | 5 | `(\|00001⟩−\|11110⟩)/√2` | X H CX Y | 6 | 8 | H×1 X×4 Y×1 ●×4 (6 col) | H×1 X×4 Y×1 Z×2 ●×4 (8 col) |
| 11 | D1 | difficult | i-coin / i-Münze | 1 | `(\|0⟩+i\|1⟩)/√2` | X H CX Y Z S | 2 | 4 | H×1 S×1 (2 col) | H×1 Z×2 S×1 (4 col) |
| 12 | D2 | difficult | i-Bell / i-Bell | 2 | `(\|00⟩+i\|11⟩)/√2` | X H CX Y Z S | 3 | 5 | H×1 X×1 S×1 ●×1 (3 col) | H×1 X×1 Z×2 S×1 ●×1 (5 col) |
| 13 | D3 | difficult | Rainbow / Regenbogen | 3 | `\|i⟩\|−⟩\|+⟩` | X H CX Y Z S | 5 | 7 | H×3 X×1 S×1 (2 col) | H×3 X×1 Z×2 S×1 (3 col) |
| 14 | D4 | difficult | Twisted couples / Verdrehte Pärchen | 4 | `(\|00⟩+i\|11⟩)(\|00⟩+i\|11⟩)/2` | X H CX Y Z S | 6 | 8 | H×2 X×2 S×2 ●×2 (5 col) | H×2 X×2 Z×2 S×2 ●×2 (6 col) |
| 15 | D5 | difficult | Three-quarter GHZ / Dreiviertel-GHZ | 5 | `(\|00000⟩−i\|11111⟩)/√2` | X H CX Y Z S | 7 | 9 | H×1 X×4 Z×1 S×1 ●×4 (7 col) | H×1 X×4 Y×2 Z×1 S×1 ●×4 (7 col) |
| 16 | X1 | extra | Lopsided coin / Schiefe Münze | 1 | `sin(π/8)\|0⟩+i·cos(π/8)\|1⟩` | X H CX Y Z S T CH | 4 | 6 | H×2 X×1 T×1 (4 col) | H×2 X×1 Z×2 T×1 (6 col) |
| 17 | X3 | extra | Cascade / Kaskade | 3 | `(√2\|000⟩+\|001⟩+\|111⟩)/2` | X H CX Y Z S T CH | 3 | 5 | H×2 X×1 ●×2 (3 col) | H×2 X×1 Z×2 ●×2 (5 col) |
| 18 | X5 | extra | Waterfall / Wasserfall | 5 | `(4\|00000⟩+2√2\|00001⟩+2\|00011⟩+√2\|00111⟩+\|01111⟩+\|11111⟩)/(4√2)` | X H CX Y Z S T CH | 5 | 7 | H×5 ●×4 (5 col) | H×5 Z×2 ●×4 (7 col) |

## Hole by hole

### E1 — Superposition / Überlagerung

- **Target** (1 qubit): `(|0⟩+|1⟩)/√2`
- **Amplitudes** (Qiskit order, leftmost = q[0]): 0: 1/√2, 1: 1/√2
- **Clubs**: X, H, CX
- **Reference solution** (drawn after a hole-in): `h q[0]`
- **Optimal** 1 · **par** 3
- **Par-length board** (kit check): `h q[0]; z q[0]; z q[0]`
- **Goal** EN: Goal: a fair 50/50 coin — H is your first club.  
  DE: Ziel: eine faire 50/50-Münze – H ist dein erster Schläger.
- **New idea**: Superposition: H makes a fair coin.

### E2 — Bell / Bell

- **Target** (2 qubits): `(|00⟩+|11⟩)/√2`
- **Amplitudes** (Qiskit order, leftmost = q[1]): 00: 1/√2, 11: 1/√2
- **Clubs**: X, H, CX
- **Reference solution** (drawn after a hole-in): `h q[0]; cx q[0],q[1]`
- **Optimal** 2 · **par** 4
- **Par-length board** (kit check): `h q[0]; cx q[0],q[1]; z q[0]; z q[0]`
- **Goal** EN: Goal: entangle two balls so they always agree.  
  DE: Ziel: verschränke zwei Kugeln, sodass sie immer übereinstimmen.
- **New idea**: Entanglement: CX ties a second ball to the coin (Bell Φ+).

### E3 — Coin, flip, coin / Münze, Flip, Münze

- **Target** (3 qubits): `|+⟩|1⟩|+⟩`
- **Amplitudes** (Qiskit order, leftmost = q[2]): 010: 1/2, 011: 1/2, 110: 1/2, 111: 1/2
- **Clubs**: X, H, CX
- **Reference solution** (drawn after a hole-in): `h q[0]; x q[1]; h q[2]`
- **Solver's first shortest find**: `x q[1]; h q[0]; h q[2]`
- **Optimal** 3 · **par** 5
- **Par-length board** (kit check): `h q[0]; x q[1]; h q[2]; z q[0]; z q[0]`
- **Goal** EN: Goal: coin, sure 1, coin — no entanglement needed.  
  DE: Ziel: Münze, sichere 1, Münze – ganz ohne Verschränkung.
- **New idea**: Product state: four outcomes, no entanglement — each ball on its own.

### E4 — Two couples / Zwei Pärchen

- **Target** (4 qubits): `(|01⟩+|10⟩)(|00⟩+|11⟩)/2`
- **Amplitudes** (Qiskit order, leftmost = q[3]): 0100: 1/2, 0111: 1/2, 1000: 1/2, 1011: 1/2
- **Clubs**: X, H, CX
- **Reference solution** (drawn after a hole-in): `h q[0]; cx q[0],q[1]; x q[2]; h q[3]; cx q[3],q[2]`
- **Solver's first shortest find**: `x q[2]; h q[0]; h q[3]; cx q[0],q[1]; cx q[3],q[2]`
- **Optimal** 5 · **par** 7
- **Par-length board** (kit check): `h q[0]; cx q[0],q[1]; x q[2]; h q[3]; cx q[3],q[2]; z q[0]; z q[0]`
- **Goal** EN: Goal: two separate pairs — one agrees, one disagrees.  
  DE: Ziel: zwei getrennte Pärchen – eins stimmt überein, eins nie.
- **New idea**: Two independent pairs: Φ+ next to Ψ+ (always agree / always disagree).

### E5 — GHZ-5 / GHZ-5

- **Target** (5 qubits): `(|00000⟩+|11111⟩)/√2`
- **Amplitudes** (Qiskit order, leftmost = q[4]): 00000: 1/√2, 11111: 1/√2
- **Clubs**: X, H, CX
- **Reference solution** (drawn after a hole-in): `h q[0]; cx q[0],q[1]; cx q[0],q[2]; cx q[0],q[3]; cx q[0],q[4]`
- **Optimal** 5 · **par** 7
- **Par-length board** (kit check): `h q[0]; cx q[0],q[1]; cx q[0],q[2]; cx q[0],q[3]; cx q[0],q[4]; z q[0]; z q[0]`
- **Goal** EN: Goal: entangle all 5 balls — always 00000 or 11111.  
  DE: Ziel: verschränke alle 5 Kugeln – immer 00000 oder 11111.
- **New idea**: One control fans out to all five wires — the only plain GHZ left.

### M1 — Minus / Minus

- **Target** (1 qubit): `(|0⟩−|1⟩)/√2`
- **Amplitudes** (Qiskit order, leftmost = q[0]): 0: 1/√2, 1: −1/√2
- **Clubs**: X, H, CX, Y
- **Reference solution** (drawn after a hole-in): `x q[0]; h q[0]`
- **Optimal** 2 · **par** 4
- **Par-length board** (kit check): `x q[0]; h q[0]; z q[0]; z q[0]`
- **Goal** EN: Goal: 50/50 like E1, but with a minus sign.  
  DE: Ziel: 50/50 wie bei E1, aber mit Minuszeichen.
- **New idea**: The minus sign: same odds as E1, opposite point on the Bloch sphere (twin of E1).

### M2 — Singlet / Singulett

- **Target** (2 qubits): `(|01⟩−|10⟩)/√2`
- **Amplitudes** (Qiskit order, leftmost = q[1]): 01: 1/√2, 10: −1/√2
- **Clubs**: X, H, CX, Y
- **Reference solution** (drawn after a hole-in): `h q[0]; cx q[0],q[1]; y q[0]`
- **Optimal** 3 · **par** 5
- **Par-length board** (kit check): `h q[0]; cx q[0],q[1]; y q[0]; z q[0]; z q[0]`
- **Goal** EN: Goal: always disagree, with a minus — try Y.  
  DE: Ziel: immer verschieden, mit Minus – probier Y.
- **New idea**: Y = flip + sign in one stroke: the singlet Ψ−. Without Y the obvious build is one stroke longer (4).

### M3 — Singlet + coin / Singulett + Münze

- **Target** (3 qubits): `|+⟩(|01⟩−|10⟩)/√2`
- **Amplitudes** (Qiskit order, leftmost = q[2]): 001: 1/2, 010: −1/2, 101: 1/2, 110: −1/2
- **Clubs**: X, H, CX, Y
- **Reference solution** (drawn after a hole-in): `h q[0]; cx q[0],q[1]; y q[0]; h q[2]`
- **Solver's first shortest find**: `h q[0]; h q[2]; cx q[0],q[1]; y q[0]`
- **Optimal** 4 · **par** 6
- **Par-length board** (kit check): `h q[0]; cx q[0],q[1]; y q[0]; h q[2]; z q[0]; z q[0]`
- **Goal** EN: Goal: a singlet pair plus a separate fair coin.  
  DE: Ziel: ein Singulett-Paar plus eine eigene faire Münze.
- **New idea**: Mix: an entangled pair next to an independent coin.

### M4 — Minus couples / Minus-Pärchen

- **Target** (4 qubits): `(|01⟩−|10⟩)(|00⟩−|11⟩)/2`
- **Amplitudes** (Qiskit order, leftmost = q[3]): 0100: 1/2, 0111: −1/2, 1000: −1/2, 1011: 1/2
- **Clubs**: X, H, CX, Y
- **Reference solution** (drawn after a hole-in): `x q[0]; h q[0]; cx q[0],q[1]; h q[2]; cx q[2],q[3]; y q[2]`
- **Solver's first shortest find**: `x q[0]; h q[0]; h q[2]; cx q[0],q[1]; cx q[2],q[3]; y q[2]`
- **Optimal** 6 · **par** 8
- **Par-length board** (kit check): `x q[0]; h q[0]; cx q[0],q[1]; h q[2]; cx q[2],q[3]; y q[2]; z q[0]; z q[0]`
- **Goal** EN: Goal: same odds as E4 — but both couples get a minus.  
  DE: Ziel: gleiche Chancen wie E4 – aber beide Pärchen mit Minus.
- **New idea**: Twin of E4: identical histogram, only the colours differ; brings Φ− (all four Bell states now seen).

### M5 — Odd one out / Der Außenseiter

- **Target** (5 qubits): `(|00001⟩−|11110⟩)/√2`
- **Amplitudes** (Qiskit order, leftmost = q[4]): 00001: 1/√2, 11110: −1/√2
- **Clubs**: X, H, CX, Y
- **Reference solution** (drawn after a hole-in): `h q[0]; cx q[0],q[1]; cx q[0],q[2]; cx q[0],q[3]; cx q[0],q[4]; y q[0]`
- **Optimal** 6 · **par** 8
- **Par-length board** (kit check): `h q[0]; cx q[0],q[1]; cx q[0],q[2]; cx q[0],q[3]; cx q[0],q[4]; y q[0]; z q[0]; z q[0]`
- **Goal** EN: Goal: one ball against the other four, with a minus.  
  DE: Ziel: eine Kugel gegen die anderen vier, mit Minus.
- **New idea**: One Y on a GHZ-5 makes the odd ball AND the minus (7 strokes without Y).

### D1 — i-coin / i-Münze

- **Target** (1 qubit): `(|0⟩+i|1⟩)/√2`
- **Amplitudes** (Qiskit order, leftmost = q[0]): 0: 1/√2, 1: i·1/√2
- **Clubs**: X, H, CX, Y, Z, S
- **Reference solution** (drawn after a hole-in): `h q[0]; s q[0]`
- **Optimal** 2 · **par** 4
- **Par-length board** (kit check): `h q[0]; s q[0]; z q[0]; z q[0]`
- **Goal** EN: Goal: 50/50 like E1, but a quarter-turn phase (S).  
  DE: Ziel: 50/50 wie bei E1, aber mit Viertel-Phasendrehung (S).
- **New idea**: Quarter-turn phase, visible only as colour (twin of E1/M1).

### D2 — i-Bell / i-Bell

- **Target** (2 qubits): `(|00⟩+i|11⟩)/√2`
- **Amplitudes** (Qiskit order, leftmost = q[1]): 00: 1/√2, 11: i·1/√2
- **Clubs**: X, H, CX, Y, Z, S
- **Reference solution** (drawn after a hole-in): `h q[0]; cx q[0],q[1]; s q[0]`
- **Optimal** 3 · **par** 5
- **Par-length board** (kit check): `h q[0]; cx q[0],q[1]; s q[0]; z q[0]; z q[0]`
- **Goal** EN: Goal: a Bell pair with a quarter-turn phase on 11.  
  DE: Ziel: ein Bell-Paar mit Viertel-Phasendrehung auf 11.
- **New idea**: Entangle, then add a phase (twin of E2).

### D3 — Rainbow / Regenbogen

- **Target** (3 qubits): `|i⟩|−⟩|+⟩`
- **Amplitudes** (Qiskit order, leftmost = q[2]): 000: 1/(2√2), 001: 1/(2√2), 010: −1/(2√2), 011: −1/(2√2), 100: i·1/(2√2), 101: i·1/(2√2), 110: −i·1/(2√2), 111: −i·1/(2√2)
- **Clubs**: X, H, CX, Y, Z, S
- **Reference solution** (drawn after a hole-in): `h q[0]; x q[1]; h q[1]; h q[2]; s q[2]`
- **Solver's first shortest find**: `x q[1]; h q[0]; h q[1]; h q[2]; s q[2]`
- **Optimal** 5 · **par** 7
- **Par-length board** (kit check): `h q[0]; x q[1]; h q[1]; h q[2]; s q[2]; z q[0]; z q[0]`
- **Goal** EN: Goal: three free coins with three different phases.  
  DE: Ziel: drei freie Münzen mit drei verschiedenen Phasen.
- **New idea**: Three independent phases (0, π, π/2) on three free coins — eight equal outcomes, four colours.

### D4 — Twisted couples / Verdrehte Pärchen

- **Target** (4 qubits): `(|00⟩+i|11⟩)(|00⟩+i|11⟩)/2`
- **Amplitudes** (Qiskit order, leftmost = q[3]): 0000: 1/2, 0011: i·1/2, 1100: i·1/2, 1111: −1/2
- **Clubs**: X, H, CX, Y, Z, S
- **Reference solution** (drawn after a hole-in): `h q[0]; cx q[0],q[1]; s q[0]; h q[2]; cx q[2],q[3]; s q[2]`
- **Solver's first shortest find**: `h q[0]; h q[2]; cx q[0],q[1]; cx q[2],q[3]; s q[0]; s q[2]`
- **Optimal** 6 · **par** 8
- **Par-length board** (kit check): `h q[0]; cx q[0],q[1]; s q[0]; h q[2]; cx q[2],q[3]; s q[2]; z q[0]; z q[0]`
- **Goal** EN: Goal: two i-twisted couples — i times i makes −1.  
  DE: Ziel: zwei i-verdrehte Pärchen – i mal i ergibt −1.
- **New idea**: Phases multiply: i·i = −1 on |1111⟩.

### D5 — Three-quarter GHZ / Dreiviertel-GHZ

- **Target** (5 qubits): `(|00000⟩−i|11111⟩)/√2`
- **Amplitudes** (Qiskit order, leftmost = q[4]): 00000: 1/√2, 11111: −i·1/√2
- **Clubs**: X, H, CX, Y, Z, S
- **Reference solution** (drawn after a hole-in): `h q[0]; cx q[0],q[1]; cx q[0],q[2]; cx q[0],q[3]; cx q[0],q[4]; s q[0]; z q[0]`
- **Solver's first shortest find**: `x q[0]; h q[0]; cx q[0],q[1]; cx q[0],q[2]; cx q[0],q[3]; cx q[0],q[4]; s q[0]`
- **Optimal** 7 · **par** 9
- **Par-length board** (kit check): `h q[0]; cx q[0],q[1]; cx q[0],q[2]; cx q[0],q[3]; cx q[0],q[4]; s q[0]; z q[0]; y q[1]; y q[1]`
- **Goal** EN: Goal: entangle all 5 with a three-quarter turn (−i).  
  DE: Ziel: verschränke alle 5 mit Dreiviertel-Drehung (−i).
- **New idea**: Three-quarter turn −i = S then Z, on all five (cheaper than S S S).

### X1 — Lopsided coin / Schiefe Münze

- **Target** (1 qubit): `sin(π/8)|0⟩+i·cos(π/8)|1⟩`
- **Amplitudes** (Qiskit order, leftmost = q[0]): 0: sin(π/8), 1: i·cos(π/8)
- **Clubs**: X, H, CX, Y, Z, S, T, CH
- **Reference solution** (drawn after a hole-in): `x q[0]; h q[0]; t q[0]; h q[0]`
- **Optimal** 4 · **par** 6
- **Par-length board** (kit check): `x q[0]; h q[0]; t q[0]; h q[0]; z q[0]; z q[0]`
- **Goal** EN: Goal: an unfair coin — about 85 % on 1.  
  DE: Ziel: eine unfaire Münze – etwa 85 % auf 1.
- **New idea**: T between two H tips the coin: uneven odds from a phase.

### X3 — Cascade / Kaskade

- **Target** (3 qubits): `(√2|000⟩+|001⟩+|111⟩)/2`
- **Amplitudes** (Qiskit order, leftmost = q[2]): 000: 1/√2, 001: 1/2, 111: 1/2
- **Clubs**: X, H, CX, Y, Z, S, T, CH
- **Reference solution** (drawn after a hole-in): `h q[0]; ch q[0],q[1]; cx q[1],q[2]`
- **Optimal** 3 · **par** 5
- **Par-length board** (kit check): `h q[0]; ch q[0],q[1]; cx q[1],q[2]; z q[0]; z q[0]`
- **Goal** EN: Goal: uneven odds — 50 % 000, 25 % 001, 25 % 111.  
  DE: Ziel: ungleiche Chancen – 50 % 000, 25 % 001, 25 % 111.
- **New idea**: Controlled-H splits unevenly (the Cascade, kept).

### X5 — Waterfall / Wasserfall

- **Target** (5 qubits): `(4|00000⟩+2√2|00001⟩+2|00011⟩+√2|00111⟩+|01111⟩+|11111⟩)/(4√2)`
- **Amplitudes** (Qiskit order, leftmost = q[4]): 00000: 1/√2, 00001: 1/2, 00011: 1/(2√2), 00111: 1/4, 01111: 1/(4√2), 11111: 1/(4√2)
- **Clubs**: X, H, CX, Y, Z, S, T, CH
- **Reference solution** (drawn after a hole-in): `h q[0]; ch q[0],q[1]; ch q[1],q[2]; ch q[2],q[3]; ch q[3],q[4]`
- **Optimal** 5 · **par** 7
- **Par-length board** (kit check): `h q[0]; ch q[0],q[1]; ch q[1],q[2]; ch q[2],q[3]; ch q[3],q[4]; z q[0]; z q[0]`
- **Goal** EN: Goal: each step half as likely — the last two equal.  
  DE: Ziel: jede Stufe nur halb so oft – die letzten zwei gleich.
- **New idea**: A chain of controlled-H halves the odds at every step.

## Physical kit check (booth mat)

The classic course is also played on the printed mat with gate tiles (camera
golf, kiosk). Inventory = `[kit]` in [`assets.toml`](../assets.toml), the one
32-tile set the paper booth kit, the laser sheets and the single-faced 3D beds
all print: **H ×5, X ×5, Y ×2, Z ×2, S ×2, T ×2, ● ×4** (CNOT target = an X
under a ●; no ⊕ tiles), SWAP ×4, RX/RY/RZ dials ×2 each. Mat: 5 rows × 8
columns ([board] in `assets.toml`).

- Every hole's shortest solution AND a par-length board fit: the table above,
  re-checked by `golfCourse.test.ts` against `assets.toml` itself.
- The tight holes: **E5 / M5 / D5** use all four ● and four X; **X5 Waterfall**
  uses all five H and all four ● (● + H = CH, per `docs/marker-ids.md`).
  D5's par-length board pads with Y Y (Z: one left). Widest layout: M5
  par-length, 8 of 8 columns (pad on q0); every other layout ≤ 7.
- S/T tiles emit RZ(π/2)/RZ(π/4); the engine scores both spellings the same.
- The 24-piece **double-faced** 3D kit (S|T ×2, CNOT ●|⊕ ×4, mixed H/X/Y/Z
  pieces ×2 each) covers every hole too, shortest and par-length (checked by
  face assignment; S + T together ≤ 2 is the binding limit, D4 needs exactly 2 S).

## Bests and the course version

Per-hole bests and paid reveals are stored per course version
(`GOLF_COURSE_VERSION = 2`): `entangible.pocket.golf.v2.holes` /
`entangible.pocket.golf.v2.revealed`. Version 1's keys
(`entangible.pocket.golf.holes`, `.revealed`) and the 5-level course's
`entangible.pocket.golf` are no longer read or migrated — a best from the old
hole 7 would be a lie on the new hole 7 — and are left untouched. Random
courses (`?course=` codes) are unaffected: their generator reads only the
round / qubit / code skeleton, which did not change (checked bit-for-bit on
ten seeds, placements included).

## Design notes and open points

- **Twins instead of consecutive pairs.** "Same odds, different state" is built
  as twins in the same slot of different rounds — E1 |+⟩ / M1 |−⟩ / D1 |i⟩,
  E2 Φ+ / D2 i-Bell, E4 / M4, E5 / D5 — because the qubit stair makes two
  consecutive holes differ in width, so they can never share a histogram. The
  goal lines name the twin ("like E1", "same odds as E4").
- **The clever stroke.** M2: the obvious build (Bell, then X and a sign trick)
  is 4; one Y does flip and sign together, 3. M5 likewise 7 → 6, D5 S S S → S Z.
- **No "un-entangling" hole.** An exhaustive search over every product of
  one-qubit stabiliser states on 2 and 3 wires (Medium and Difficult clubs)
  found none that a CX makes cheaper — so a hole "reached by un-entangling"
  would be a puzzle about a longer route, never the shortest one. Left out.
- **Bit order on screen.** The ket line and the Q-sphere are MSB-first
  (leftmost = highest wire); the histogram's bitstrings are leftmost = q0.
  Free placement keeps every hole fair, but a player comparing the two lines on
  an asymmetric hole (E3, E4, M3, M4, M5, D3, D4, X3, X5) sees the same outcome
  spelled in two orders. Pre-existing; worth one convention app-wide.
